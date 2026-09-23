const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const resendApiKey = Deno.env.get("RESEND_API_KEY") || "";
const emailFrom = Deno.env.get("EMAIL_FROM") || Deno.env.get("RESTOCK_EMAIL_FROM") || "";
const storefrontUrl = (Deno.env.get("STOREFRONT_URL") || "https://beaddifferentco.com").replace(/\/$/, "");
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const textValue = (value: unknown, maxLength = 5000) => String(value ?? "").trim().slice(0, maxLength);
const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}[character] || character));
const orderTrackingUrl = (carrier: unknown, tracking: unknown) => {
  const value = textValue(tracking, 200);
  if (!value) return "";
  const normalized = textValue(carrier, 80).toLowerCase();
  if (normalized.includes("usps") || normalized.includes("standard")) return `https://tools.usps.com/go/TrackConfirmAction_input?origTrackNum=${encodeURIComponent(value)}`;
  if (normalized.includes("ups")) return `https://www.ups.com/track?tracknum=${encodeURIComponent(value)}`;
  if (normalized.includes("fedex")) return `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(value)}`;
  return "";
};

async function supabaseRequest(path: string, init: RequestInit = {}) {
  return fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}

const brandedHtml = (title: string, content: string) => `<!doctype html><html><body style="margin:0;background:#f7f3f1;color:#241e1d;font-family:Arial,sans-serif"><div style="max-width:600px;margin:0 auto;padding:32px 20px"><div style="background:#ffffff;border:1px solid #e4deda;border-radius:14px;padding:32px"><p style="margin:0 0 18px;color:#8b4261;font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase">BEAD DIFFERENT CO.</p><h1 style="margin:0 0 22px;font-family:Georgia,serif;font-size:28px;line-height:1.15;color:#241e1d">${escapeHtml(title)}</h1>${content}<p style="margin:28px 0 0;color:#756d6a;font-size:13px">Bead Different Co.</p></div></div></body></html>`;

async function currentUser(request: Request) {
  const authorization = request.headers.get("Authorization");
  if (!authorization || !supabaseUrl || !serviceRoleKey) return null;
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceRoleKey, Authorization: authorization },
  });
  return response.ok ? await response.json() : null;
}

async function sendResendEmail(to: string, subject: string, text: string, html: string, idempotencyKey: string) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({ from: emailFrom, to: [to], subject, text, html }),
  });
  if (response.ok) return;
  const detail = textValue(await response.text(), 300);
  throw new Error(`Resend rejected the message${detail ? `: ${detail}` : "."}`);
}

async function sendOrderConfirmation(orderId: string, user: { id: string; email?: string; user_metadata?: Record<string, unknown> } | null, guestOrderToken = "") {
  const ownershipFilter = user ? `user_id=eq.${encodeURIComponent(user.id)}` : `user_id=is.null&guest_order_token=eq.${encodeURIComponent(guestOrderToken)}`;
  const response = await supabaseRequest(`orders?id=eq.${encodeURIComponent(orderId)}&${ownershipFilter}&select=id,order_number,status,total,subtotal,discount,tax_amount,tax_rate,tax_state,tax_jurisdiction,promo_code,shipping_amount,shipping_cost,shipping_name,shipping_address,customer_email,carrier,tracking_number,created_at,order_items(product_name,sku,quantity,unit_price,selected_options)`);
  if (!response.ok) throw new Error("Unable to load the order.");
  const orders = await response.json();
  const order = orders[0];
  if (!order) throw new Error("Order not found.");
  const email = textValue(order.customer_email || user?.email, 320).toLowerCase();
  if (!emailPattern.test(email)) return { sent: 0, skipped: true };
  const name = textValue(order.shipping_name || user?.user_metadata?.full_name, 160);
  const orderShortId = order.order_number ? `BD-${String(order.order_number).padStart(6, "0")}` : String(order.id).slice(0, 8);
  const items = Array.isArray(order.order_items) ? order.order_items : [];
  const orderedSkus = [...new Set(items.map((item: { sku?: string }) => textValue(item.sku, 120)).filter(Boolean))];
  const skuNames = new Map<string, string>();
  if (orderedSkus.length) {
    const skuFilter = orderedSkus.map((sku) => encodeURIComponent(sku)).join(",");
    const skuResponse = await supabaseRequest(`inventory_skus?sku=in.(${skuFilter})&select=sku,name`);
    if (skuResponse.ok) {
      const skuRows = await skuResponse.json();
      for (const row of Array.isArray(skuRows) ? skuRows : []) {
        const sku = textValue(row?.sku, 120);
        const name = textValue(row?.name, 200);
        if (sku && name) skuNames.set(sku.toLowerCase(), name);
      }
    }
  }
  const itemName = (item: { product_name?: string; sku?: string }) => skuNames.get(textValue(item.sku, 120).toLowerCase()) || textValue(item.product_name, 200) || "Item";
  const itemLines = items.map((item: { product_name?: string; sku?: string; quantity?: number; unit_price?: number }) => `${itemName(item)}${item.sku ? ` (${item.sku})` : ""} × ${Math.max(1, Number(item.quantity) || 1)} — $${(Number(item.unit_price) * Math.max(1, Number(item.quantity) || 1)).toFixed(2)}`).join("\n");
  const subtotal = Number(order.subtotal || 0);
  const discount = Number(order.discount || 0);
  const shipping = Number(order.shipping_amount ?? order.shipping_cost ?? 0);
  const tax = Number(order.tax_amount || 0);
  const total = Number(order.total || 0);
  const shippingAddress = order.shipping_address && typeof order.shipping_address === "object"
    ? (() => {
        const address = order.shipping_address as Record<string, unknown>;
        const city = textValue(address.city, 120);
        const state = textValue(address.state, 80);
        const postalCode = textValue(address.postal_code, 40);
        const cityLine = [city, [state, postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
        return [
          textValue(address.recipient_name || address.name, 160),
          textValue(address.address_line1 || address.line1 || address.address, 200),
          textValue(address.address_line2 || address.line2, 200),
          cityLine,
          textValue(address.country, 80),
        ].filter(Boolean);
      })()
    : [textValue(order.shipping_address, 500)].filter(Boolean);
  const shippingAddressText = shippingAddress.join("\n");
  const shippingAddressHtml = shippingAddress.map((line) => escapeHtml(line)).join("<br>");
  const carrierName = textValue(order.carrier, 80).toLowerCase();
  const uspsTrackingUrl = carrierName.includes("usps") || carrierName.includes("standard") ? orderTrackingUrl(order.carrier, order.tracking_number) : "";
  const trackingUrl = `${storefrontUrl}/account.html?view=orders&order=${encodeURIComponent(order.id)}`;
  const trackingLabel = order.tracking_number ? `Tracking: ${order.carrier ? `${order.carrier} ` : ""}${order.tracking_number}` : "Track your order and view shipping updates from your account.";
  const greeting = `Hello${name ? ` ${name}` : ""},`;
  const text = `${greeting}\n\nThanks for your order from Bead Different Co. Your order ${orderShortId} has been received.\n\nITEMS\n${itemLines || "Your order items are listed in your account."}\n\nORDER SUMMARY\nSubtotal: $${subtotal.toFixed(2)}\nDiscount${order.promo_code ? ` (${order.promo_code})` : ""}: -$${discount.toFixed(2)}\nShipping: $${shipping.toFixed(2)}\nTax: $${tax.toFixed(2)}\nTotal: $${total.toFixed(2)}\n\n${shippingAddressText ? `SHIPPING TO\n${shippingAddressText}\n\n` : ""}${trackingLabel}\n\n${uspsTrackingUrl ? `Track with USPS: ${uspsTrackingUrl}` : `Log in to track your order: ${trackingUrl}`}\n\nThank you,\nBead Different Co.`;
  const rows = items.map((item: { product_name?: string; sku?: string; quantity?: number; unit_price?: number }) => { const quantity = Math.max(1, Number(item.quantity) || 1); const lineTotal = Number(item.unit_price || 0) * quantity; return `<tr><td style="padding:10px 0;border-bottom:1px solid #eee"><strong>${escapeHtml(itemName(item))}</strong>${item.sku ? `<br><span style="color:#756d6a;font-size:12px">SKU: ${escapeHtml(item.sku)}</span>` : ""}</td><td style="padding:10px 0;border-bottom:1px solid #eee;text-align:center;vertical-align:top">${quantity}</td><td style="padding:10px 0;border-bottom:1px solid #eee;text-align:right;vertical-align:top">$${lineTotal.toFixed(2)}</td></tr>`; }).join("");
  const summaryRows = `<tr><td style="padding:5px 0">Subtotal</td><td style="padding:5px 0;text-align:right">$${subtotal.toFixed(2)}</td></tr><tr><td style="padding:5px 0">Discount${order.promo_code ? ` (${escapeHtml(order.promo_code)})` : ""}</td><td style="padding:5px 0;text-align:right;color:#8b4261">−$${discount.toFixed(2)}</td></tr><tr><td style="padding:5px 0">Shipping</td><td style="padding:5px 0;text-align:right">$${shipping.toFixed(2)}</td></tr><tr><td style="padding:5px 0">Tax${order.tax_jurisdiction ? ` (${escapeHtml(order.tax_jurisdiction)})` : ""}</td><td style="padding:5px 0;text-align:right">$${tax.toFixed(2)}</td></tr><tr><td style="padding:12px 0 0;border-top:1px solid #ddd;font-weight:700;font-size:17px">Total</td><td style="padding:12px 0 0;border-top:1px solid #ddd;text-align:right;font-weight:700;font-size:17px">$${total.toFixed(2)}</td></tr>`;
  const addressBlock = shippingAddressText ? `<h2 style="margin:26px 0 8px;font-size:16px">Shipping information</h2><p style="margin:0;color:#756d6a;line-height:1.55">${shippingAddressHtml}</p>` : "";
  const html = brandedHtml(`Order ${orderShortId} received`, `<p>${escapeHtml(greeting)}</p><p>Thanks for your order from Bead Different Co. We received it and will keep you updated as it moves through fulfillment.</p><h2 style="margin:26px 0 8px;font-size:16px">Items purchased</h2><table style="width:100%;border-collapse:collapse;margin:0 0 18px"><thead><tr><th style="text-align:left;padding:0 0 8px">Item</th><th style="padding:0 0 8px">Qty</th><th style="text-align:right;padding:0 0 8px">Total</th></tr></thead><tbody>${rows}</tbody></table><table style="width:100%;border-collapse:collapse;margin:18px 0">${summaryRows}</table>${addressBlock}<p style="margin:24px 0 0;color:#756d6a">${escapeHtml(trackingLabel)}</p><p style="margin:18px 0 0"><a href="${escapeHtml(uspsTrackingUrl||trackingUrl)}" style="display:inline-block;background:#4b214f;color:#fff;text-decoration:none;border-radius:999px;padding:14px 22px;font-weight:700">${uspsTrackingUrl ? "Track with USPS ↗" : "Log in to track your order"}</a></p>`);
  await sendResendEmail(email, `Order ${orderShortId} received from Bead Different Co.`, text, html, `order-confirmation/${order.id}`);
  return { sent: 1 };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "POST required." }, 405);
  if (!resendApiKey || !emailFrom) return json({ error: "Resend email delivery is not configured." }, 503);
  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "A JSON request body is required." }, 400);
  }
  if (textValue(payload.action, 40) !== "confirmation") return json({ error: "Unsupported email action." }, 400);
  const orderId = textValue(payload.orderId, 80);
  if (!orderId) return json({ error: "Order id is required." }, 400);
  const user = await currentUser(request);
  const guestOrderToken = textValue(payload.guestOrderToken, 100);
  if (!user && !guestOrderToken) return json({ error: "Authentication or guest order token is required." }, 401);
  try {
    return json(await sendOrderConfirmation(orderId, user, guestOrderToken));
  } catch (error) {
    return json({ error: textValue(error instanceof Error ? error.message : error, 500) }, 502);
  }
});
