import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const projectUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const stripeWebhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, stripe-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
});
const text = (value: unknown, max = 500) => String(value ?? "").trim().slice(0, max);
const network = (url: string, init: RequestInit = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(20000) });

async function database(path: string, method = "GET", body?: unknown) {
  const response = await network(`${projectUrl}/rest/v1/${path}`, {
    method,
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Prefer: "return=representation" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`Payment storage request failed (${response.status}).`);
  const payload = await response.text();
  if (!payload.trim()) return [];
  return JSON.parse(payload);
}

async function rpc(name: string, args: Record<string, unknown>) {
  const rows = await database(`rpc/${name}`, "POST", args);
  return Array.isArray(rows) ? rows[0] : rows;
}

function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeEqual(first: string, second: string) {
  if (first.length !== second.length) return false;
  let result = 0;
  for (let index = 0; index < first.length; index += 1) result |= first.charCodeAt(index) ^ second.charCodeAt(index);
  return result === 0;
}

async function verifyWebhook(body: string, signature: string) {
  const parts = signature.split(",").reduce<Record<string, string[]>>((result, part) => {
    const [key, value] = part.split("=", 2);
    if (key && value) (result[key] ||= []).push(value);
    return result;
  }, {});
  const timestamp = Number(parts.t?.[0] || 0);
  if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > 300 || !stripeWebhookSecret) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(stripeWebhookSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`)));
  return (parts.v1 || []).some((value) => safeEqual(value, expected));
}

async function handleWebhook(request: Request) {
  const body = await request.text();
  if (!await verifyWebhook(body, request.headers.get("stripe-signature") || "")) return json({ error: "Invalid Stripe signature." }, 400);
  let event: Record<string, any>;
  try {
    event = JSON.parse(body);
  } catch {
    return json({ error: "Invalid Stripe event payload." }, 400);
  }
  const object = event.data?.object || {};
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    if (object.payment_status === "paid" && object.metadata?.order_id) {
      await rpc("complete_stripe_order", { order_id_value: object.metadata.order_id, session_id_value: object.id, payment_intent_value: typeof object.payment_intent === "string" ? object.payment_intent : object.payment_intent?.id || null });
    }
  } else if (event.type === "checkout.session.expired") {
    const orderId = object.metadata?.order_id;
    if (orderId) await rpc("release_stripe_order", { order_id_value: orderId, reason_value: "Stripe Checkout session expired." });
  } else if (event.type === "payment_intent.payment_failed") {
    const orderId = object.metadata?.order_id;
    if (orderId) await rpc("release_stripe_order", { order_id_value: orderId, reason_value: text(object.last_payment_error?.message || "Stripe payment failed.", 240) });
  } else if (event.type === "charge.refunded") {
    const paymentIntent = typeof object.payment_intent === "string" ? object.payment_intent : object.payment_intent?.id;
    if (paymentIntent) {
      const orders = await database(`orders?stripe_payment_intent_id=eq.${encodeURIComponent(paymentIntent)}&select=id`);
      const orderId = orders[0]?.id;
      const refunds = Array.isArray(object.refunds?.data) ? object.refunds.data : [];
      for (const refund of refunds) {
        if (orderId && refund.status === "succeeded") {
          await rpc("apply_stripe_refund", { order_id_value: orderId, refund_amount_value: Number(refund.amount || 0) / 100, reason_value: "Refund processed in Stripe.", stripe_refund_id_value: refund.id });
        }
      }
    }
  }
  return json({ received: true });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error: "POST required." }, 405);
  try {
    return await handleWebhook(request);
  } catch (error) {
    return json({ error: text(error instanceof Error ? error.message : error, 300) || "Stripe webhook failed." }, 400);
  }
});
