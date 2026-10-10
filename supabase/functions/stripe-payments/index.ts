import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const projectUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY") || "";
const storefrontUrl = (Deno.env.get("STOREFRONT_URL") || "https://beaddifferentco.com").replace(/\/$/, "");
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

async function withinPublicLimit(request: Request, action: "checkout" | "tax" | "status", limit: number) {
  const address = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const bytes = new TextEncoder().encode(`${serviceKey}:${address}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const clientHash = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  return await rpc("check_storefront_request_limit", {
    action_value: action, client_hash_value: clientHash, request_limit: limit, window_seconds: 900,
  }) === true;
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
  if (!response.ok) {
    const error = new Error(text(payload?.error?.message || "Stripe rejected the request.", 240)) as Error & { status: number };
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function stripeRead(path: string) {
  if (!stripeSecret) throw new Error("Stripe is not configured. Add STRIPE_SECRET_KEY to the payment function.");
  const response = await network(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Basic ${btoa(`${stripeSecret}:`)}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(text(payload?.error?.message || "Stripe could not verify the refund.", 240));
  return payload;
}

async function stripeCheckoutSession(sessionId: string) {
  if (!stripeSecret) throw new Error("Stripe is not configured.");
  const response = await network(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    headers: { Authorization: `Basic ${btoa(`${stripeSecret}:`)}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(text(payload?.error?.message || "Stripe could not verify this checkout.", 240));
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

function stripeTaxResult(calculation: Record<string, any>, taxableBase: number, useOhioTestFallback: boolean) {
  const stripeAmount = Math.max(0, Number(calculation.tax_amount_exclusive || 0));
  const useTestFallback = useOhioTestFallback && stripeSecret.startsWith("sk_test_") && stripeAmount === 0 && taxableBase > 0;
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
  const tax = stripeTaxResult(calculation, taxableBase, true);
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
  const tax = stripeTaxResult(calculation, taxableBase, true);
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

async function validateCheckoutShipping(order: Record<string, any>, address: Record<string, any>) {
  const settings = await rpc("get_storefront_site_settings", { p_scope: "common" });
  const threshold = Math.max(0, Number(settings?.freeShippingThreshold ?? 50));
  const method = text(order.shipping_method, 20);
  const amount = cents(order.shipping_amount);
  const postalCode = text(address.postal_code, 10);
  const origin = text(settings?.shippingOriginPostalCode, 10);
  if (!/^[A-Z]{2}$/.test(text(address.state, 2).toUpperCase()) || !text(address.city, 80) ||
      !text(address.address_line1, 120) || text(address.country, 2).toUpperCase() !== "US" ||
      !/^\d{5}(?:-\d{4})?$/.test(postalCode) || !/^\d{5}(?:-\d{4})?$/.test(origin)) {
    throw new Error("A valid US shipping address and ZIP code are required.");
  }
  if (method === "standard" && cents(order.subtotal) >= cents(threshold)) {
    if (amount !== 0) throw new Error("Free shipping was not applied. Refresh your checkout and try again.");
    return;
  }
  if (method === "standard" && amount === 0 && order.free_shipping === true) return;
  const weightOz = Math.max(0.01, Number(await rpc("get_checkout_shipping_weight", { order_id_value: order.id })) || 0.01);
  const boxes = (Array.isArray(settings?.shippingBoxes) ? settings.shippingBoxes : [])
    .filter((box: Record<string, any>) => Number(box.maxWeightOz) >= 0 && Number(box.lengthIn) > 0 && Number(box.widthIn) > 0 && Number(box.heightIn) > 0)
    .sort((first: Record<string, any>, second: Record<string, any>) => Number(first.maxWeightOz) - Number(second.maxWeightOz));
  const box = boxes.find((entry: Record<string, any>) => Number(entry.maxWeightOz) >= weightOz) || boxes.at(-1) ||
    { lengthIn: 6, widthIn: 4, heightIn: 1 };
  const acceptance = new Date();
  for (let remaining = Math.max(0, Math.floor(Number(settings?.processingDays) || 0)); remaining > 0;) {
    acceptance.setUTCDate(acceptance.getUTCDate() + 1);
    if (acceptance.getUTCDay() !== 0 && acceptance.getUTCDay() !== 6) remaining -= 1;
  }
  const response = await network(`${projectUrl}/functions/v1/shipping-rates`, {
    method: "POST",
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "usps", from: { postalCode: origin }, to: { postalCode },
      package: { weightOz, lengthIn: Number(box.lengthIn), widthIn: Number(box.widthIn), heightIn: Number(box.heightIn) },
      acceptanceDate: acceptance.toISOString().slice(0, 10),
    }),
  });
  const quote = await response.json().catch(() => ({}));
  if (!response.ok || quote.error) throw new Error(text(quote.error || "USPS could not verify shipping.", 240));
  const serviceCode = method === "priority" ? "PRIORITY_MAIL" : "USPS_GROUND_ADVANTAGE";
  const rate = quote.rates?.find((entry: Record<string, any>) => entry.serviceCode === serviceCode);
  if (!rate || cents(rate.amount) !== amount) throw new Error("USPS shipping changed. Refresh your checkout and try again.");
}

async function createCheckout(request: Request, body: Record<string, any>) {
  const user = await userFrom(request);
  const payload = { ...(body.order_payload || {}), user_id: user?.id || null };
  try { await rpc("expire_pending_stripe_orders", {}); } catch (error) { console.warn("Pending Stripe order cleanup unavailable.", error); }
  const order = await rpc("create_stripe_pending_order", { order_payload: payload, owner_user_id: user?.id || null });
  let createdSessionId = "";
  try {
    await validateCheckoutShipping(order, payload.shipping_address || {});
    const stripeTax = await calculateStripeTax({ ...order, shipping_address: payload.shipping_address || {} });
    if (cents(stripeTax.amount) !== cents(order.tax_amount)) throw new Error("Stripe Tax changed. Refresh your checkout and try again.");
    const expiresAt = Math.floor(Date.parse(order.payment_expires_at || "") / 1000) - 900;
    if (!Number.isFinite(expiresAt) || expiresAt < Math.floor(Date.now() / 1000) + 1800) {
      throw new Error("Checkout reservation expired before payment could start. Please try again.");
    }
    const form = stripeForm({
      mode: "payment",
      customer_email: text(order.customer_email, 180),
      client_reference_id: order.id,
      "metadata[order_id]": order.id,
      "payment_intent_data[metadata][order_id]": order.id,
      success_url: `${storefrontUrl}/payment-success.html?session_id={CHECKOUT_SESSION_ID}&order_id=${encodeURIComponent(order.id)}`,
      cancel_url: `${storefrontUrl}/payment-cancelled.html?order_id=${encodeURIComponent(order.id)}`,
      expires_at: expiresAt,
    });
    appendLineItems(form, order);
    const session = await stripeRequest("checkout/sessions", form, `bead-order-${order.id}`);
    createdSessionId = session.id;
    await rpc("set_stripe_checkout_session", { order_id_value: order.id, session_id_value: session.id });
    return json({ url: session.url, order_id: order.id, session_id: session.id });
  } catch (error) {
    let sessionExpired = !createdSessionId;
    if (createdSessionId) {
      try {
        await stripeRequest(`checkout/sessions/${encodeURIComponent(createdSessionId)}/expire`, new URLSearchParams());
        sessionExpired = true;
      }
      catch (expireError) { console.warn("Stripe checkout session could not be expired after setup failure.", expireError); }
    }
    if (sessionExpired) {
      try { await rpc("release_stripe_order", { order_id_value: order.id, reason_value: text(error instanceof Error ? error.message : error, 240) }); }
      catch { /* The webhook/expiry path remains the cleanup fallback. */ }
    }
    throw error;
  }
}

async function checkoutStatus(body: Record<string, any>) {
  const sessionId = text(body.session_id, 200);
  const orderId = text(body.order_id, 80);
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId) || !/^[0-9a-f-]{36}$/i.test(orderId)) {
    return json({ error: "A valid checkout session and order are required." }, 400);
  }
  const session = await stripeCheckoutSession(sessionId);
  if (session.id !== sessionId || session.metadata?.order_id !== orderId || session.client_reference_id !== orderId) {
    return json({ error: "Checkout session does not match this order." }, 400);
  }
  if (session.payment_status !== "paid") return json({ status: "pending" });
  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null;
  try {
    const order = await rpc("complete_stripe_order", { order_id_value: orderId, session_id_value: sessionId, payment_intent_value: paymentIntentId });
    return json({ status: order?.payment_status === "paid" ? "paid" : "processing", order_id: orderId });
  } catch (error) {
    console.error("Verified Stripe payment could not finalize the order.", error);
    return json({ status: "processing", order_id: orderId });
  }
}

function refundRequestKey(body: Record<string, any>) {
  const requested = text(body.request_id, 36);
  if (requested && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requested)) {
    throw new Error("A valid refund request id is required.");
  }
  return requested || crypto.randomUUID();
}

async function existingRefundRequest(requestKey: string, orderId: string) {
  const rows = await database(`stripe_refunds?request_key=eq.${encodeURIComponent(requestKey)}&select=order_id,stripe_refund_id,status,amount,created_at,request_key`);
  const existing = rows[0];
  if (existing && existing.order_id !== orderId) throw new Error("Refund request id belongs to another order.");
  if (existing?.stripe_refund_id.startsWith("pending:")) {
    const orders = await database(`orders?id=eq.${encodeURIComponent(orderId)}&select=id,stripe_payment_intent_id`);
    const order = orders[0];
    const query = new URLSearchParams({ payment_intent: order.stripe_payment_intent_id, limit: "100" });
    const result = await stripeRead(`refunds?${query.toString()}`);
    const refund = matchStripeRefund(Array.isArray(result?.data) ? result.data : [], order, existing);
    if (refund) return await reconcileStripeRefund(order, refund, requestKey);
    throw new Error("This refund request is still pending verification with Stripe. Do not submit another refund; use Sync Stripe status for this order.");
  }
  if (existing && !existing.stripe_refund_id.startsWith("pending:")) {
    if (["failed", "canceled"].includes(existing.status)) {
      throw new Error(`Stripe refund ${existing.status}. No inventory or order refund changes were applied.`);
    }
    if (existing.status === "pending") {
      const orders = await database(`orders?id=eq.${encodeURIComponent(orderId)}&select=id,stripe_payment_intent_id`);
      const order = orders[0];
      const refund = await stripeRead(`refunds/${encodeURIComponent(existing.stripe_refund_id)}`);
      return await reconcileStripeRefund(order, refund, requestKey);
    }
    return { stripe_refund_id: existing.stripe_refund_id, status: existing.status, refund_amount: Number(existing.amount) };
  }
  return null;
}

function refundPaymentIntent(refund: Record<string, any>) {
  return typeof refund?.payment_intent === "string" ? refund.payment_intent : text(refund?.payment_intent?.id, 100);
}

function validStripeRefund(refund: Record<string, any>) {
  const refundId = text(refund?.id, 255);
  return refund?.object === "refund" && refundId.startsWith("re_") && refundId.length >= 5 && !/\s/.test(refundId);
}

function matchStripeRefund(refunds: Record<string, any>[], order: Record<string, any>, request: Record<string, any>) {
  const paymentIntentId = text(order?.stripe_payment_intent_id, 100);
  const forPayment = refunds.filter((refund) => refundPaymentIntent(refund) === paymentIntentId);
  const exact = forPayment.filter((refund) => refund?.metadata?.request_key === request.request_key);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const requestCreatedAt = Date.parse(request.created_at || "");
  const expectedAmount = Math.round(Number(request.amount || 0) * 100);
  if (!Number.isFinite(requestCreatedAt) || !expectedAmount) return null;
  const contextual = forPayment.filter((refund) => {
    const metadata = refund?.metadata || {};
    const createdAt = Number(refund.created) * 1000;
    return Number(refund.amount) === expectedAmount &&
      (!metadata.request_key || metadata.request_key === request.request_key) &&
      (!metadata.order_id || metadata.order_id === order.id) &&
      Number.isFinite(createdAt) && createdAt >= requestCreatedAt - 60_000 && createdAt <= requestCreatedAt + 10 * 60_000;
  });
  return contextual.length === 1 ? contextual[0] : null;
}

async function refundWithRequestKey(refund: Record<string, any>, order: Record<string, any>, requestKey: string) {
  const requestRows = await database(`stripe_refunds?request_key=eq.${encodeURIComponent(requestKey)}&select=order_id,amount,created_at,request_key`);
  const request = requestRows[0];
  if (!request || request.order_id !== order.id) throw new Error("Refund request record could not be verified. No second refund was submitted.");
  const matchesRequest = (candidate: Record<string, any>) => validStripeRefund(candidate) &&
    refundPaymentIntent(candidate) === order.stripe_payment_intent_id &&
    Number(candidate.amount) === Math.round(Number(request.amount) * 100) &&
    (!candidate.metadata?.request_key || candidate.metadata.request_key === requestKey) &&
    (!candidate.metadata?.order_id || candidate.metadata.order_id === order.id);
  if (matchesRequest(refund)) return refund;
  const query = new URLSearchParams({ payment_intent: order.stripe_payment_intent_id, limit: "100" });
  const result = await stripeRead(`refunds?${query.toString()}`);
  const matched = matchStripeRefund(Array.isArray(result?.data) ? result.data : [], order, request);
  if (matched && matchesRequest(matched)) return matched;
  throw new Error("Stripe accepted the refund, but the app could not safely match its confirmation. Do not submit another refund; use Sync Stripe status for this order or contact support.");
}

async function reconcileStripeRefund(order: Record<string, any>, refund: Record<string, any>, requestKey: string, throwOnFailure = true) {
  if (!order?.id || !order?.stripe_payment_intent_id || refundPaymentIntent(refund) !== order.stripe_payment_intent_id || !validStripeRefund(refund)) {
    throw new Error("Stripe returned an invalid refund confirmation. The order was not changed.");
  }
  const requestRows = await database(`stripe_refunds?request_key=eq.${encodeURIComponent(requestKey)}&select=order_id,amount`);
  const request = requestRows[0];
  if (!request || request.order_id !== order.id || Number(refund.amount) !== Math.round(Number(request.amount) * 100)) {
    throw new Error("Stripe refund amount does not match this order request. The order was not changed.");
  }
  const attached = await rpc("attach_stripe_refund_request", {
    request_key_value: requestKey,
    stripe_refund_id_value: refund.id,
  });
  const stripeStatus = ["pending", "succeeded", "failed", "canceled"].includes(text(refund.status, 30).toLowerCase())
    ? text(refund.status, 30).toLowerCase()
    : "pending";
  const finalized = await rpc("finalize_stripe_refund", {
    stripe_refund_id_value: refund.id,
    order_id_value: order.id,
    amount_value: Number(refund.amount || 0) / 100,
    status_value: stripeStatus,
    reason_value: stripeStatus === "succeeded" ? "Refund processed in Stripe." : text(refund.failure_reason || `Stripe refund ${stripeStatus}.`, 240),
  });
  if (throwOnFailure && ["failed", "canceled"].includes(stripeStatus)) {
    throw new Error(text(finalized?.error || `Stripe refund ${stripeStatus}.`, 240));
  }
  return { ...attached, ...finalized, stripe_refund_id: refund.id, refund_amount: Number(refund.amount || 0) / 100 };
}

async function reconcileOrderRefunds(request: Request, body: Record<string, any>) {
  if (!await adminFrom(request)) return json({ error: "Administrator authorization required." }, 401);
  const orderId = text(body.order_id, 80);
  const orders = await database(`orders?id=eq.${encodeURIComponent(orderId)}&select=id,stripe_payment_intent_id`);
  const order = orders[0];
  if (!order) return json({ error: "Order not found." }, 404);
  if (!order.stripe_payment_intent_id) return json({ synced: 0, pending: 0, message: "This order has no Stripe payment." });
  const rows = await database(`stripe_refunds?order_id=eq.${encodeURIComponent(order.id)}&status=eq.pending&select=stripe_refund_id,request_key,amount,created_at`);
  if (!rows.length) return json({ synced: 0, pending: 0, message: "No pending Stripe refunds were found." });
  const query = new URLSearchParams({ payment_intent: order.stripe_payment_intent_id, limit: "100" });
  const list = await stripeRead(`refunds?${query.toString()}`);
  const stripeRefunds = Array.isArray(list?.data) ? list.data : [];
  let synced = 0;
  let unresolved = 0;
  let failed = 0;
  for (const row of rows) {
    const refund = row.stripe_refund_id.startsWith("pending:")
      ? matchStripeRefund(stripeRefunds, order, row)
      : await stripeRead(`refunds/${encodeURIComponent(row.stripe_refund_id)}`);
    if (!refund) {
      unresolved += 1;
      continue;
    }
    await reconcileStripeRefund(order, refund, row.request_key, false);
    if (["failed", "canceled"].includes(text(refund.status, 30).toLowerCase())) failed += 1;
    else if (text(refund.status, 30).toLowerCase() !== "pending") synced += 1;
    else unresolved += 1;
  }
  return json({ synced, pending: unresolved, failed, message: `Checked ${rows.length} pending Stripe refund${rows.length === 1 ? "" : "s"}.` });
}

async function submitStripeRefund(order: Record<string, any>, amount: number, reason: string,
  metadata: Record<string, unknown>, requestKey: string) {
  const reserved = await rpc("reserve_stripe_refund_request", {
    order_id_value: order.id, request_key_value: requestKey, amount_value: amount / 100,
    reason_value: reason || null, metadata_value: metadata,
  });
  if (reserved.already_submitted) return reserved;
  let refund: Record<string, any>;
  try {
    refund = await stripeRequest("refunds", stripeForm({
      payment_intent: order.stripe_payment_intent_id,
      amount,
      "metadata[order_id]": order.id,
      "metadata[refund_kind]": String(metadata.refund_kind),
      "metadata[request_key]": requestKey,
      reason: "requested_by_customer",
    }), `bead-refund-${requestKey}`);
  } catch (error) {
    const status = (error as { status?: number })?.status;
    if (status && status >= 400 && status < 500 && status !== 429) {
      await rpc("discard_rejected_stripe_refund_request", { request_key_value: requestKey });
    }
    throw error;
  }
  const confirmedRefund = await refundWithRequestKey(refund, order, requestKey);
  return await reconcileStripeRefund(order, confirmedRefund, requestKey);
}

async function createRefund(request: Request, body: Record<string, any>) {
  if (!await adminFrom(request)) return json({ error: "Administrator authorization required." }, 401);
  const orderId = text(body.order_id, 80);
  const requestKey = refundRequestKey(body);
  const existing = await existingRefundRequest(requestKey, orderId);
  if (existing) return json(existing);
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
  return json(await submitStripeRefund(order, amount, reason,
    { refund_kind: refundKind === "satisfaction" ? "satisfaction" : "order" }, requestKey));
}

async function createReturnRefund(request: Request, body: Record<string, any>) {
  if (!await adminFrom(request)) return json({ error: "Administrator authorization required." }, 401);
  const orderId = text(body.order_id, 80);
  const requestKey = refundRequestKey(body);
  const existing = await existingRefundRequest(requestKey, orderId);
  if (existing) return json(existing);
  const lineItems = Array.isArray(body.line_items) ? body.line_items : [];
  const itemIds = lineItems.map((line: Record<string, any>) => text(line.item_id, 80));
  if (itemIds.some((id: string) => !/^[0-9a-f-]{36}$/i.test(id)) || new Set(itemIds).size !== itemIds.length) {
    return json({ error: "Each return line must be selected only once." }, 400);
  }
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
  return json(await submitStripeRefund(order, amount, reason, {
    refund_kind: "return", line_items: lineItems, refund_shipping: refundShipping,
  }, requestKey));
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error: "POST required." }, 405);
  try {
    const body = await request.json();
    if (body?.action === "calculate_tax" && !await withinPublicLimit(request, "tax", 120)) return json({ error: "Too many tax estimates. Please try again shortly." }, 429);
    if (body?.action === "create_checkout" && !await withinPublicLimit(request, "checkout", 15)) return json({ error: "Too many checkout attempts. Please try again shortly." }, 429);
    if (body?.action === "checkout_status" && !await withinPublicLimit(request, "status", 120)) return json({ error: "Too many payment checks. Please try again shortly." }, 429);
    if (body?.action === "calculate_tax") return await calculateTaxPreview(body);
    if (body?.action === "create_checkout") return await createCheckout(request, body);
    if (body?.action === "checkout_status") return await checkoutStatus(body);
    if (body?.action === "refund_order") return await createRefund(request, body);
    if (body?.action === "refund_return") return await createReturnRefund(request, body);
    if (body?.action === "reconcile_order_refunds") return await reconcileOrderRefunds(request, body);
    return json({ error: "Unsupported payment action." }, 400);
  } catch (error) {
    return json({ error: text(error instanceof Error ? error.message : error, 300) || "Stripe payment request failed." }, 400);
  }
});
