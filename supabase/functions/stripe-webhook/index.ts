import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const projectUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY") || "";
const stripeWebhookSecret = (Deno.env.get("STRIPE_WEBHOOK_SECRET") || "").trim();
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

async function invokeInternalEmail(functionName: "send-order-email" | "send-store-email", payload: Record<string, unknown>) {
  try {
    const response = await network(`${projectUrl}/functions/v1/${functionName}`, {
      method: "POST",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.error || Number(result.sent) < 1) throw new Error(text(result.error || result.message || "Email service did not confirm delivery.", 240));
    return;
  } catch (error) {
    console.error(`${functionName} delivery failed.`, error);
    throw error;
  }
}

async function sendRefundReceipt(orderId: string, refund: Record<string, any>) {
  const orders = await database(`orders?id=eq.${encodeURIComponent(orderId)}&select=total,refunded_amount`);
  const order = orders[0];
  if (!order) throw new Error("Refunded order was not available for its receipt email.");
  await invokeInternalEmail("send-store-email", {
    action: "refund_receipt",
    orderId,
    refundId: text(refund.id, 80),
    refundAmount: Number(refund.amount || 0) / 100,
    remaining: Math.max(0, Number(order.total || 0) - Number(order.refunded_amount || 0)),
  });
}

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

async function stripeRefunds(paymentIntent: string) {
  if (!stripeSecret) throw new Error("Stripe refund lookup is not configured.");
  const refunds: Record<string, any>[] = [];
  let startingAfter = "";
  do {
    const query = new URLSearchParams({ payment_intent: paymentIntent, limit: "100" });
    if (startingAfter) query.set("starting_after", startingAfter);
    const response = await network(`https://api.stripe.com/v1/refunds?${query}`, {
      headers: { Authorization: `Basic ${btoa(`${stripeSecret}:`)}` },
    });
    if (!response.ok) throw new Error(`Stripe refund lookup failed (${response.status}).`);
    const page = await response.json();
    if (!Array.isArray(page.data)) throw new Error("Stripe returned an invalid refund list.");
    refunds.push(...page.data);
    if (!page.has_more) break;
    startingAfter = text(page.data.at(-1)?.id, 255);
    if (!startingAfter) throw new Error("Stripe returned an incomplete refund page.");
  } while (startingAfter);
  return refunds;
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

async function verifyWebhook(body: Uint8Array, signature: string) {
  const parts = signature.split(",").reduce<Record<string, string[]>>((result, part) => {
    const [key, value] = part.split("=", 2);
    if (key && value) (result[key] ||= []).push(value);
    return result;
  }, {});
  const timestamp = Number(parts.t?.[0] || 0);
  if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > 300 || !stripeWebhookSecret) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(stripeWebhookSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const timestampPrefix = new TextEncoder().encode(`${timestamp}.`);
  const signedPayload = new Uint8Array(timestampPrefix.length + body.length);
  signedPayload.set(timestampPrefix);
  signedPayload.set(body, timestampPrefix.length);
  const expected = hex(await crypto.subtle.sign("HMAC", key, signedPayload));
  return (parts.v1 || []).some((value) => safeEqual(value, expected));
}

async function refundOrderId(refund: Record<string, any>, fallbackOrderId: string | null = null) {
  if (refund.metadata?.order_id) return refund.metadata.order_id;
  if (fallbackOrderId) return fallbackOrderId;
  const paymentIntent = typeof refund.payment_intent === "string" ? refund.payment_intent : refund.payment_intent?.id;
  if (paymentIntent) {
    const orders = await database(`orders?stripe_payment_intent_id=eq.${encodeURIComponent(paymentIntent)}&select=id`);
    if (orders[0]?.id) return orders[0].id;
  }
  const refunds = await database(`stripe_refunds?stripe_refund_id=eq.${encodeURIComponent(text(refund.id, 80))}&select=order_id`);
  return refunds[0]?.order_id || null;
}

async function finalizeRefund(refund: Record<string, any>, status: string, fallbackOrderId: string | null = null) {
  const orderId = await refundOrderId(refund, fallbackOrderId);
  if (!orderId) return;
  const requestKey = text(refund.metadata?.request_key, 36);
  if (requestKey) {
    await rpc("attach_stripe_refund_request", {
      request_key_value: requestKey,
      stripe_refund_id_value: refund.id,
    });
  }
  await rpc("finalize_stripe_refund", {
    stripe_refund_id_value: refund.id,
    order_id_value: orderId,
    amount_value: Number(refund.amount || 0) / 100,
    status_value: status,
    reason_value: status === "succeeded" ? "Refund processed in Stripe." : text(refund.failure_reason || `Stripe refund ${status}.`, 240),
  });
  if (status === "succeeded") await sendRefundReceipt(orderId, refund);
}

async function handleWebhook(request: Request) {
  const body = new Uint8Array(await request.arrayBuffer());
  if (!await verifyWebhook(body, request.headers.get("stripe-signature") || "")) return json({ error: "Invalid Stripe signature." }, 400);
  let event: Record<string, any>;
  try {
    event = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return json({ error: "Invalid Stripe event payload." }, 400);
  }
  const object = event.data?.object || {};
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    if (object.payment_status === "paid" && object.metadata?.order_id) {
      const order = await rpc("complete_stripe_order", { order_id_value: object.metadata.order_id, session_id_value: object.id, payment_intent_value: typeof object.payment_intent === "string" ? object.payment_intent : object.payment_intent?.id || null });
      if (order?.payment_status === "paid") await invokeInternalEmail("send-order-email", { action: "confirmation", orderId: object.metadata.order_id });
    }
  } else if (event.type === "checkout.session.expired") {
    const orderId = object.metadata?.order_id;
    if (orderId) await rpc("release_stripe_order", { order_id_value: orderId, reason_value: "Stripe Checkout session expired." });
  } else if (event.type === "payment_intent.payment_failed") {
    const orderId = object.metadata?.order_id;
    if (orderId) await rpc("release_stripe_order", { order_id_value: orderId, reason_value: text(object.last_payment_error?.message || "Stripe payment failed.", 240) });
  } else if (event.type === "refund.updated" || event.type === "refund.failed") {
    const status = event.type === "refund.failed" ? "failed" : text(object.status || "pending", 30).toLowerCase();
    await finalizeRefund(object, status);
  } else if (event.type === "charge.refunded") {
    const paymentIntent = typeof object.payment_intent === "string" ? object.payment_intent : object.payment_intent?.id;
    if (paymentIntent) {
      const orders = await database(`orders?stripe_payment_intent_id=eq.${encodeURIComponent(paymentIntent)}&select=id`);
      const orderId = orders[0]?.id;
      const refunds = await stripeRefunds(paymentIntent);
      if (!refunds.length && Number(object.amount_refunded) > 0) throw new Error("Stripe reported a refund without a refund record.");
      for (const refund of refunds) {
        if (refund.payment_intent !== paymentIntent) throw new Error("Stripe refund payment does not match the event.");
        if (refund.status === "succeeded") await finalizeRefund(refund, "succeeded", orderId || null);
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
    return json({ error: text(error instanceof Error ? error.message : error, 300) || "Stripe webhook failed." }, 500);
  }
});
