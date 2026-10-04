import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const projectUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY") || "";
const storefrontUrl = (Deno.env.get("STOREFRONT_URL") || "https://www.beaddifferentco.com").replace(/\/$/, "");
const ohioTestTaxRate = 0.0575;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, stripe-signature",
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
  const payload = await response.text();
  if (!response.ok) {
    let detail = '';
    try {
      const parsed = JSON.parse(payload);
      detail = text(parsed?.message || parsed?.hint || parsed?.details || parsed?.error, 240);
    } catch {
      detail = '';
    }
    throw new Error(detail ? `Payment storage request failed (${response.status}): ${detail}` : `Payment storage request failed (${response.status}).`);
  }
  if (!payload.trim()) return [];
  return JSON.parse(payload);
}

async function rpc(name: string, args: Record<string, unknown>) {
  const rows = await database(`rpc/${name}`, "POST", args);
  const value = Array.isArray(rows) ? rows[0] : rows;
  if (value && typeof value === "object" && name in value && Object.keys(value).length === 1) {
    return value[name];
  }
  return value;
}

async function userFrom(request: Request) {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const response = await network(`${projectUrl}/auth/v1/user`, { headers: { apikey: serviceKey, Authorization: authorization } });
  if (!response.ok) return null;
  const user = await response.json();
  return user?.id ? user : null;
}

async function adminFrom(request: Request) {
  const user = await userFrom(request);
  if (!user?.id) return null;
  const rows = await database(`profiles?id=eq.${encodeURIComponent(user.id)}&select=id,role,status`);
  return rows[0]?.role === "admin" && rows[0]?.status === "active" ? user : null;
}

function stripeForm(entries: Record<string, string | number | boolean | null | undefined>) {
  const form = new URLSearchParams();
  Object.entries(entries).forEach(([key, value]) => {
    if (value !== null && value !== undefined) form.set(key, String(value));
  });
  return form;
}

async function stripeRequest(path: string, form: URLSearchParams, idempotencyKey = "") {
  if (!stripeSecret) throw new Error("Stripe is not configured. Add STRIPE_SECRET_KEY to the payment function.");
  const response = await network(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${stripeSecret}:`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: form,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(text(payload?.error?.message || "Stripe rejected the request.", 240));
  return payload;
}

function taxAddress(form: URLSearchParams, address: Record<string, any>) {
  form.set("customer_details[address][line1]", text(address.address_line1, 120));
  if (address.address_line2) form.set("customer_details[address][line2]", text(address.address_line2, 120));
  form.set("customer_details[address][city]", text(address.city, 80));
  form.set("customer_details[address][state]", text(address.state, 2).toUpperCase());
  form.set("customer_details[address][postal_code]", text(address.postal_code, 10));
  form.set("customer_details[address][country]", "US");
  form.set("customer_details[address_source]", "shipping");
}

function stripeTaxResult(calculation: Record<string, any>, taxableBase: number) {
  const stripeAmount = Math.max(0, Number(calculation.tax_amount_exclusive || 0));
  const useTestFallback = stripeSecret.startsWith("sk_test_") && stripeAmount === 0 && taxableBase > 0;
  const amountCents = useTestFallback ? Math.round(taxableBase * ohioTestTaxRate) : stripeAmount;
  return {
    amount: amountCents / 100,
    rate: useTestFallback ? ohioTestTaxRate : taxableBase > 0 ? amountCents / taxableBase : 0,
    useTestFallback,
  };
}

async function calculateStripeTax(order: Record<string, any>) {
  const address = (order.shipping_address || {}) as Record<string, any>;
  const state = text(address.state, 2).toUpperCase();
  const taxableItems = checkoutLineItems(order);
  const shippingAmount = cents(order.shipping_amount);
  if (state !== "OH" || (!taxableItems.length && !shippingAmount)) return { amount: 0, rate: 0, state: "", jurisdiction: "Stripe Tax" };
  const form = stripeForm({ currency: "usd", "shipping_cost[amount]": shippingAmount, "shipping_cost[tax_code]": "txcd_92010001" });
  taxAddress(form, address);
  taxableItems.forEach((line, index) => {
    form.set(`line_items[${index}][amount]`, String(line.amount));
    form.set(`line_items[${index}][reference]`, `${text(order.id, 80)}-${index}`);
    form.set(`line_items[${index}][tax_code]`, "txcd_99999999");
  });
  const calculation = await stripeRequest("tax/calculations", form);
  const taxableBase = taxableItems.reduce((sum, line) => sum + line.amount, 0) + shippingAmount;
  const tax = stripeTaxResult(calculation, taxableBase);
  return {
    amount: tax.amount,
    rate: tax.rate,
    state: "OH",
    jurisdiction: "Stripe Tax",
    calculation_id: text(calculation.id, 80),
  };
}

async function calculateTaxPreview(body: Record<string, any>) {
  const taxPayload = body.tax_payload || {};
  const address = (taxPayload.shipping_address || {}) as Record<string, any>;
  const taxableAmount = Math.max(0, Number(taxPayload.taxable_amount) || 0);
  const shippingAmount = Math.max(0, Number(taxPayload.shipping_amount) || 0);
  const state = text(address.state, 2).toUpperCase();
  if (state !== "OH" || (!taxableAmount && !shippingAmount)) return json({ amount: 0, rate: 0, state: "", jurisdiction: "Stripe Tax" });
  const form = stripeForm({ currency: "usd", "shipping_cost[amount]": cents(shippingAmount), "shipping_cost[tax_code]": "txcd_92010001" });
  taxAddress(form, address);
  if (taxableAmount) {
    form.set("line_items[0][amount]", String(cents(taxableAmount)));
    form.set("line_items[0][reference]", "cart");
    form.set("line_items[0][tax_code]", "txcd_99999999");
  }
  const calculation = await stripeRequest("tax/calculations", form);
  const taxableBase = cents(taxableAmount) + cents(shippingAmount);
  const tax = stripeTaxResult(calculation, taxableBase);
  return json({ amount: tax.amount, rate: tax.rate, state: "OH", jurisdiction: tax.useTestFallback ? "Ohio test rate" : "Stripe Tax", calculation_id: text(calculation.id, 80) });
}

function cents(value: unknown) {
  return Math.max(0, Math.round((Number(value) || 0) * 100));
}

function checkoutLineItems(order: Record<string, any>) {
  const lines = Array.isArray(order.lines) ? order.lines : [];
  const base = lines.map((line: Record<string, any>) => ({
    name: text(line.product_name || line.sku || "Store item", 120),
    quantity: Math.max(1, Number(line.quantity) || 1),
    amount: cents(line.unit_price) * Math.max(1, Number(line.quantity) || 1),
  }));
  let remainingDiscount = Math.min(cents(order.discount), base.reduce((sum, line) => sum + Math.max(0, line.amount - 1), 0));
  const adjusted = base.map((line) => {
    const reduction = Math.min(remainingDiscount, Math.max(0, line.amount - 1));
    remainingDiscount -= reduction;
    return { ...line, amount: line.amount - reduction };
  });
  if (remainingDiscount > 0) throw new Error("The promotion could not be represented safely in Stripe.");
  return adjusted.filter((line) => line.amount > 0);
}

function appendLineItems(form: URLSearchParams, order: Record<string, any>) {
  const lineItems = checkoutLineItems(order);
  const shipping = cents(order.shipping_amount);
  const tax = cents(order.tax_amount);
  if (!lineItems.length && !shipping && !tax) throw new Error("Stripe cannot collect a zero-dollar order.");
  let index = 0;
  for (const line of lineItems) {
    form.set(`line_items[${index}][price_data][currency]`, "usd");
    form.set(`line_items[${index}][price_data][unit_amount]`, String(line.amount));
    form.set(`line_items[${index}][price_data][product_data][name]`, line.name + (line.quantity > 1 ? ` × ${line.quantity}` : ""));
    form.set(`line_items[${index}][quantity]`, "1");
    index += 1;
  }
  if (shipping) {
    form.set(`line_items[${index}][price_data][currency]`, "usd");
    form.set(`line_items[${index}][price_data][unit_amount]`, String(shipping));
    form.set(`line_items[${index}][price_data][product_data][name]`, "Shipping");
    form.set(`line_items[${index}][quantity]`, "1");
    index += 1;
  }
  if (tax) {
    form.set(`line_items[${index}][price_data][currency]`, "usd");
    form.set(`line_items[${index}][price_data][unit_amount]`, String(tax));
    form.set(`line_items[${index}][price_data][product_data][name]`, "Sales tax");
    form.set(`line_items[${index}][quantity]`, "1");
  }
  const expected = cents(order.total);
  const actual = lineItems.reduce((sum, line) => sum + line.amount, 0) + shipping + tax;
  if (actual !== expected) throw new Error("The checkout total changed. Please refresh your cart and try again.");
}

async function createCheckout(request: Request, body: Record<string, any>) {
  const user = await userFrom(request);
  const payload = { ...(body.order_payload || {}), user_id: user?.id || null };
  const order = await rpc("create_stripe_pending_order", { order_payload: payload, owner_user_id: user?.id || null });
  try {
    const stripeTax = await calculateStripeTax({ ...order, shipping_address: payload.shipping_address || {} });
    if (cents(stripeTax.amount) !== cents(order.tax_amount)) throw new Error("Stripe Tax changed. Refresh your checkout and try again.");
    const form = stripeForm({
      mode: "payment",
      customer_email: text(order.customer_email, 180),
      client_reference_id: order.id,
      "metadata[order_id]": order.id,
      "payment_intent_data[metadata][order_id]": order.id,
      success_url: `${storefrontUrl}/payment-success.html?session_id={CHECKOUT_SESSION_ID}&order_id=${encodeURIComponent(order.id)}`,
      cancel_url: `${storefrontUrl}/payment-cancelled.html?order_id=${encodeURIComponent(order.id)}`,
      "shipping_address_collection[allowed_countries][0]": "US",
    });
    appendLineItems(form, order);
    const session = await stripeRequest("checkout/sessions", form, `bead-order-${order.id}`);
    await rpc("set_stripe_checkout_session", { order_id_value: order.id, session_id_value: session.id });
    return json({ url: session.url, order_id: order.id, session_id: session.id });
  } catch (error) {
    try { await rpc("release_stripe_order", { order_id_value: order.id, reason_value: text(error instanceof Error ? error.message : error, 240) }); } catch { /* The webhook/expiry path remains the cleanup fallback. */ }
    throw error;
  }
}

async function createRefund(request: Request, body: Record<string, any>) {
  if (!await adminFrom(request)) return json({ error: "Administrator authorization required." }, 401);
  const orderId = text(body.order_id, 80);
  const reason = text(body.reason, 240);
  const orders = await database(`orders?id=eq.${encodeURIComponent(orderId)}&select=id,total,refunded_amount,status,payment_status,stripe_payment_intent_id`);
  const order = orders[0];
  if (!order) return json({ error: "Order not found." }, 404);
  const remaining = Math.max(0, cents(order.total) - cents(order.refunded_amount));
  const amount = body.full === true ? remaining : cents(body.amount);
  if (!amount || amount > remaining) return json({ error: `Refund must be between $0.01 and $${(remaining / 100).toFixed(2)}.` }, 400);
  const refundKind = text(body.refund_kind, 40);
  const applyLocalRefund = async (stripeRefundId: string | null) => {
    if (refundKind === "satisfaction") {
      return rpc("process_stripe_satisfaction_refund", { order_id_value: order.id, amount_value: amount / 100, reason_value: reason || null, stripe_refund_id_value: stripeRefundId });
    }
    return rpc("apply_stripe_refund", { order_id_value: order.id, refund_amount_value: amount / 100, reason_value: reason || null, stripe_refund_id_value: stripeRefundId });
  };
  if (!order.stripe_payment_intent_id || order.payment_status === "unpaid") {
    const applied = await applyLocalRefund(null);
    return json(applied);
  }
  const refund = await stripeRequest("refunds", stripeForm({ payment_intent: order.stripe_payment_intent_id, amount, "metadata[order_id]": order.id, reason: "requested_by_customer" }), `bead-refund-${order.id}-${amount}-${Date.now()}`);
  const applied = await applyLocalRefund(refund.id);
  return json({ ...applied, stripe_refund_id: refund.id });
}

async function createReturnRefund(request: Request, body: Record<string, any>) {
  if (!await adminFrom(request)) return json({ error: "Administrator authorization required." }, 401);
  const orderId = text(body.order_id, 80);
  const lineItems = Array.isArray(body.line_items) ? body.line_items : [];
  const reason = text(body.reason, 240);
  const refundShipping = body.refund_shipping === true;
  const preview = await rpc("process_stripe_order_return", {
    order_id_value: orderId,
    line_items: lineItems,
    reason_value: reason || null,
    refund_shipping: refundShipping,
    expected_amount: null,
    stripe_refund_id_value: null,
    dry_run: true,
  });
  const amount = cents(preview?.refund_amount);
  if (!amount) return json({ error: "The selected return has no refundable balance." }, 400);
  const orders = await database(`orders?id=eq.${encodeURIComponent(orderId)}&select=id,total,refunded_amount,payment_status,stripe_payment_intent_id`);
  const order = orders[0];
  if (!order) return json({ error: "Order not found." }, 404);
  if (!order.stripe_payment_intent_id || order.payment_status === "unpaid") {
    return json(await rpc("process_stripe_order_return", {
      order_id_value: orderId,
      line_items: lineItems,
      reason_value: reason || null,
      refund_shipping: refundShipping,
      expected_amount: amount / 100,
      stripe_refund_id_value: null,
      dry_run: false,
    }));
  }
  const refund = await stripeRequest("refunds", stripeForm({ payment_intent: order.stripe_payment_intent_id, amount, "metadata[order_id]": orderId, reason: "requested_by_customer" }), `bead-return-${orderId}-${amount}-${Date.now()}`);
  const applied = await rpc("process_stripe_order_return", {
    order_id_value: orderId,
    line_items: lineItems,
    reason_value: reason || null,
    refund_shipping: refundShipping,
    expected_amount: amount / 100,
    stripe_refund_id_value: refund.id,
    dry_run: false,
  });
  return json({ ...applied, stripe_refund_id: refund.id });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error: "POST required." }, 405);
  try {
    const body = await request.json();
    if (body?.action === "calculate_tax") return await calculateTaxPreview(body);
    if (body?.action === "create_checkout") return await createCheckout(request, body);
    if (body?.action === "refund_order") return await createRefund(request, body);
    if (body?.action === "refund_return") return await createReturnRefund(request, body);
    return json({ error: "Unsupported payment action." }, 400);
  } catch (error) {
    return json({ error: text(error instanceof Error ? error.message : error, 300) || "Stripe payment request failed." }, 400);
  }
});
