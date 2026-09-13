const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const resendApiKey = Deno.env.get("RESEND_API_KEY") || "";
const emailFrom = Deno.env.get("EMAIL_FROM") || Deno.env.get("RESTOCK_EMAIL_FROM") || "";
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

async function sendOrderConfirmation(orderId: string, user: { id: string; email?: string; user_metadata?: Record<string, unknown> }) {
  const response = await supabaseRequest(`orders?id=eq.${encodeURIComponent(orderId)}&user_id=eq.${encodeURIComponent(user.id)}&select=id,status,total,subtotal,discount,shipping_amount,shipping_name,shipping_address,carrier,tracking_number,created_at,order_items(product_name,sku,quantity,unit_price,selected_options)`);
  if (!response.ok) throw new Error("Unable to load the order.");
  const orders = await response.json();
  const order = orders[0];
  const email = textValue(user.email, 320).toLowerCase();
  if (!order) throw new Error("Order not found.");
  if (!emailPattern.test(email)) return { sent: 0, skipped: true };
  const name = textValue(order.shipping_name || user.user_metadata?.full_name, 160);
  const orderShortId = String(order.id).slice(0, 8);
  const items = Array.isArray(order.order_items) ? order.order_items : [];
  const itemLines = items.map((item: { product_name?: string; quantity?: number; unit_price?: number }) => `${textValue(item.product_name, 200)} × ${Math.max(1, Number(item.quantity) || 1)} — $${(Number(item.unit_price) * Math.max(1, Number(item.quantity) || 1)).toFixed(2)}`).join("\n");
  const greeting = `Hello${name ? ` ${name}` : ""},`;
  const text = `${greeting}\n\nThanks for your order from Bead Different Co. Your test order ${orderShortId} has been received.\n\n${itemLines || "Your order items are listed in your account."}\n\nTotal: $${Number(order.total || 0).toFixed(2)}\n\nWe will email you again when the order status or tracking changes.\n\nThank you,\nBead Different Co.`;
  const rows = items.map((item: { product_name?: string; quantity?: number; unit_price?: number }) => `<tr><td style="padding:8px 0;border-bottom:1px solid #eee">${escapeHtml(item.product_name || "Item")}</td><td style="padding:8px 0;border-bottom:1px solid #eee;text-align:center">${Math.max(1, Number(item.quantity) || 1)}</td><td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right">$${(Number(item.unit_price) * Math.max(1, Number(item.quantity) || 1)).toFixed(2)}</td></tr>`).join("");
  const html = brandedHtml(`Order ${orderShortId} received`, `<p>${escapeHtml(greeting)}</p><p>Thanks for your order from Bead Different Co. We received it and will keep you updated as it moves through fulfillment.</p><table style="width:100%;border-collapse:collapse;margin:22px 0"><thead><tr><th style="text-align:left;padding-bottom:8px">Item</th><th style="padding-bottom:8px">Qty</th><th style="text-align:right;padding-bottom:8px">Total</th></tr></thead><tbody>${rows}</tbody></table><p style="margin:0"><strong>Order total:</strong> $${Number(order.total || 0).toFixed(2)}</p>`);
  await sendResendEmail(email, `Order ${orderShortId} received from Bead Different Co.`, text, html, `order-confirmation/${order.id}`);
  return { sent: 1 };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "POST required." }, 405);
  if (!resendApiKey || !emailFrom) return json({ error: "Resend email delivery is not configured." }, 503);
  const user = await currentUser(request);
  if (!user) return json({ error: "Authentication required." }, 401);
  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "A JSON request body is required." }, 400);
  }
  if (textValue(payload.action, 40) !== "confirmation") return json({ error: "Unsupported email action." }, 400);
  const orderId = textValue(payload.orderId, 80);
  if (!orderId) return json({ error: "Order id is required." }, 400);
  try {
    return json(await sendOrderConfirmation(orderId, user));
  } catch (error) {
    return json({ error: textValue(error instanceof Error ? error.message : error, 500) }, 502);
  }
});
