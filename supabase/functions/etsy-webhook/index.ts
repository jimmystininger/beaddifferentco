import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

const projectUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const webhookSecret = (Deno.env.get("ETSY_WEBHOOK_SECRET") || "").replace(/^v1,whsec_/, "");
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

async function database(path: string, method = "GET", body?: unknown, prefer = "return=representation") {
  const response = await fetch(`${projectUrl}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: prefer,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Queue storage returned ${response.status}.`);
  if (response.status === 204) return [];
  const payload = await response.text();
  return payload.trim() ? JSON.parse(payload) : [];
}

async function eventId(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = [...digest.slice(0, 16)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "POST required." }, 405);
  if (!projectUrl || !serviceKey || !webhookSecret) return json({ error: "Etsy webhook is not configured." }, 503);
  const rawBody = await request.text();
  if (rawBody.length > 65536) return json({ error: "Webhook payload is too large." }, 413);

  let payload: Record<string, unknown>;
  try {
    const webhook = new Webhook(webhookSecret);
    payload = webhook.verify(rawBody, Object.fromEntries(request.headers.entries())) as Record<string, unknown>;
  } catch {
    return json({ error: "Webhook signature could not be verified." }, 401);
  }

  const eventType = String(payload.event_type || "");
  if (!(["inventory.created", "inventory.updated"] as string[]).includes(eventType)) return json({ received: true, queued: false });
  const listingId = String(payload.listing_id || "").trim();
  const shopId = String(payload.shop_id || "").trim();
  const webhookId = request.headers.get("webhook-id") || "";
  if (!/^\d+$/.test(listingId) || !/^\d+$/.test(shopId) || !webhookId || webhookId.length > 200) {
    return json({ error: "Webhook event is missing its listing, shop, or delivery ID." }, 400);
  }

  try {
    const connections = await database("etsy_connections?id=eq.true&select=shop_id,connected_by&limit=1");
    const connection = connections[0];
    if (!connection || String(connection.shop_id) !== shopId || !connection.connected_by) return json({ received: true, queued: false });
    await database("etsy_import_batches?on_conflict=id", "POST", {
      id: await eventId(webhookId),
      created_by: connection.connected_by,
      kind: "listings",
      payload: {},
      expires_at: new Date(Date.now() + 90 * 86400000).toISOString(),
      import_type: "listings",
      status: "staged",
      source: "etsy_webhook",
      row_count: 1,
      matched_count: 0,
      applied_count: 0,
      metadata: {
        action: "inventory_webhook",
        webhook_id: webhookId,
        event_type: eventType,
        listing_id: listingId,
        product_id: String(payload.product_id || ""),
        attempts: 0,
      },
    }, "resolution=ignore-duplicates,return=minimal");
    return json({ received: true, queued: true });
  } catch {
    return json({ error: "Webhook event could not be queued." }, 503);
  }
});
