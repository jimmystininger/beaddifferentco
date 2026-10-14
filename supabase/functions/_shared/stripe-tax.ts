type StripeTaxConfig = {
  projectUrl: string;
  serviceKey: string;
  stripeSecret: string;
};

const text = (value: unknown, max = 255) => String(value ?? "").trim().slice(0, max);
const network = (url: string, init: RequestInit = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(20000) });

async function database(config: StripeTaxConfig, path: string, method = "GET", body?: unknown) {
  const response = await network(`${config.projectUrl}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.text();
  if (!response.ok) throw new Error(`Tax record storage failed (${response.status}).`);
  if (!payload.trim()) return [];
  return JSON.parse(payload);
}

async function stripeRequest(config: StripeTaxConfig, path: string, form: URLSearchParams, idempotencyKey: string) {
  if (!config.stripeSecret) throw new Error("Stripe Tax recording is not configured.");
  const response = await network(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${config.stripeSecret}:`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": idempotencyKey,
    },
    body: form,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(text(result?.error?.message || `Stripe Tax request failed (${response.status}).`));
  return result;
}

export async function storeStripeTaxCalculation(config: StripeTaxConfig, orderId: string, calculationId: string) {
  if (!calculationId.startsWith("taxcalc_")) throw new Error("Stripe did not return a valid tax calculation.");
  const orderFilter = encodeURIComponent(orderId);
  const updated = await database(
    config,
    `orders?id=eq.${orderFilter}&payment_status=eq.pending&tax_state=eq.OH&stripe_tax_calculation_id=is.null`,
    "PATCH",
    { stripe_tax_calculation_id: calculationId },
  );
  if (updated.length === 1 && updated[0].stripe_tax_calculation_id === calculationId) return;
  const rows = await database(config, `orders?id=eq.${orderFilter}&select=stripe_tax_calculation_id,payment_status,tax_state`);
  if (rows[0]?.stripe_tax_calculation_id !== calculationId || rows[0]?.payment_status !== "pending" || rows[0]?.tax_state !== "OH") {
    throw new Error("The Ohio tax calculation could not be safely attached to this pending order.");
  }
}

async function recordTaxReversal(config: StripeTaxConfig, orderId: string, refund: Record<string, any>, transactionId: string) {
  const refundId = text(refund.stripe_refund_id, 255);
  const rows = await database(
    config,
    `stripe_refunds?order_id=eq.${encodeURIComponent(orderId)}&stripe_refund_id=eq.${encodeURIComponent(refundId)}&select=stripe_refund_id,status,amount,stripe_tax_reversal_id`,
  );
  const row = rows[0];
  if (!row || row.status !== "succeeded" || row.stripe_tax_reversal_id) return;
  if (!/^(?:re|pyr)_[A-Za-z0-9]+$/.test(refundId)) throw new Error("The succeeded refund has no usable Stripe refund ID.");
  const amountCents = Math.round(Number(row.amount || 0) * 100);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new Error("The succeeded refund has an invalid amount for tax reversal.");

  const reference = `${orderId}-refund-${refundId}`;
  const form = new URLSearchParams({
    mode: "partial",
    original_transaction: transactionId,
    reference,
    flat_amount: String(-amountCents),
    "metadata[order_id]": orderId,
    "metadata[stripe_refund_id]": refundId,
  });
  const reversal = await stripeRequest(config, "tax/transactions/create_reversal", form, `bead-tax-reversal-${refundId}`);
  if (!String(reversal?.id || "").startsWith("tax_") || reversal?.type !== "reversal" || reversal?.reference !== reference) {
    throw new Error("Stripe did not confirm the expected tax reversal.");
  }
  const saved = await database(
    config,
    `stripe_refunds?order_id=eq.${encodeURIComponent(orderId)}&stripe_refund_id=eq.${encodeURIComponent(refundId)}&status=eq.succeeded&stripe_tax_reversal_id=is.null`,
    "PATCH",
    { stripe_tax_reversal_id: reversal.id },
  );
  if (saved.length !== 1 || saved[0]?.stripe_tax_reversal_id !== reversal.id) {
    const current = await database(config, `stripe_refunds?stripe_refund_id=eq.${encodeURIComponent(refundId)}&select=stripe_tax_reversal_id`);
    if (current[0]?.stripe_tax_reversal_id !== reversal.id) throw new Error("The Stripe Tax reversal could not be saved to the refund record.");
  }
}

export async function ensureStripeTaxRecords(config: StripeTaxConfig, orderId: string) {
  const orderFilter = encodeURIComponent(orderId);
  const rows = await database(
    config,
    `orders?id=eq.${orderFilter}&select=id,payment_status,tax_state,stripe_tax_calculation_id,stripe_tax_transaction_id`,
  );
  const order = rows[0];
  if (!order) throw new Error("The paid order was not available for Stripe Tax recording.");
  if (!["paid", "partially_refunded", "refunded"].includes(order.payment_status) || order.tax_state !== "OH" || !order.stripe_tax_calculation_id) return;

  let transactionId = text(order.stripe_tax_transaction_id, 255);
  if (!transactionId) {
    const reference = text(order.id, 80);
    const form = new URLSearchParams({
      calculation: text(order.stripe_tax_calculation_id, 255),
      reference,
      "metadata[order_id]": reference,
    });
    const transaction = await stripeRequest(config, "tax/transactions/create_from_calculation", form, `bead-tax-sale-${reference}`);
    if (!String(transaction?.id || "").startsWith("tax_") || transaction?.type !== "transaction" || transaction?.reference !== reference) {
      throw new Error("Stripe did not confirm the expected tax transaction.");
    }
    transactionId = transaction.id;
    const saved = await database(
      config,
      `orders?id=eq.${orderFilter}&payment_status=in.(paid,partially_refunded,refunded)&stripe_tax_calculation_id=eq.${encodeURIComponent(order.stripe_tax_calculation_id)}&stripe_tax_transaction_id=is.null`,
      "PATCH",
      { stripe_tax_transaction_id: transactionId },
    );
    if (saved.length !== 1 || saved[0]?.stripe_tax_transaction_id !== transactionId) {
      const current = await database(config, `orders?id=eq.${orderFilter}&select=stripe_tax_transaction_id`);
      if (current[0]?.stripe_tax_transaction_id !== transactionId) throw new Error("The Stripe Tax transaction could not be saved to the paid order.");
    }
  }

  const refunds = await database(
    config,
    `stripe_refunds?order_id=eq.${orderFilter}&status=eq.succeeded&select=stripe_refund_id,status,amount,stripe_tax_reversal_id`,
  );
  for (const refund of refunds) await recordTaxReversal(config, orderId, refund, transactionId);
}
