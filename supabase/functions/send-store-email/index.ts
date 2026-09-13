import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const resendApiKey = Deno.env.get("RESEND_API_KEY") || "";
const emailFrom = Deno.env.get("EMAIL_FROM") || Deno.env.get("RESTOCK_EMAIL_FROM") || "";

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
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

async function requireJsonArray(response: Response, label: string) {
  if (!response.ok) {
    const detail = textValue(await response.text(), 300);
    throw new Error(`${label} lookup failed (${response.status})${detail ? `: ${detail}` : "."}`);
  }
  const value = await response.json();
  if (!Array.isArray(value)) throw new Error(`${label} lookup returned an invalid response.`);
  return value;
}

async function isAdmin(request: Request) {
  const authorization = request.headers.get("Authorization");
  if (!authorization || !supabaseUrl || !serviceRoleKey) return false;
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceRoleKey, Authorization: authorization },
  });
  if (!userResponse.ok) return false;
  const user = await userResponse.json();
  const profileResponse = await supabaseRequest(`profiles?id=eq.${encodeURIComponent(user.id)}&select=role,status`);
  if (!profileResponse.ok) return false;
  const profiles = await profileResponse.json();
  return profiles[0]?.role === "admin" && profiles[0]?.status === "active";
}

const normalizeEmails = (value: unknown) => {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.map((entry) => textValue(entry, 320).toLowerCase()).filter((entry) => emailPattern.test(entry)))];
};

const textToHtml = (value: unknown) => escapeHtml(value).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#8b4261;text-decoration:underline">$1</a>').replace(/\r?\n/g, "<br>");

const brandedHtml = (title: string, content: string) => `<!doctype html><html><body style="margin:0;background:#f7f3f1;color:#241e1d;font-family:Arial,sans-serif"><div style="max-width:600px;margin:0 auto;padding:32px 20px"><div style="background:#ffffff;border:1px solid #e4deda;border-radius:14px;padding:32px"><p style="margin:0 0 18px;color:#8b4261;font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase">BEAD DIFFERENT CO.</p><h1 style="margin:0 0 22px;font-family:Georgia,serif;font-size:28px;line-height:1.15;color:#241e1d">${escapeHtml(title)}</h1>${content}<p style="margin:28px 0 0;color:#756d6a;font-size:13px">Bead Different Co.</p></div></div></body></html>`;

const campaignHtml = (subject: string, body: string) => brandedHtml(subject, `<div style="height:4px;margin:-4px 0 26px;background:#e8a2bd;border-radius:999px"></div><div style="padding:22px 20px;background:#fbf6f8;border:1px solid #f0dce4;border-radius:12px;font-size:16px;line-height:1.7">${textToHtml(body)}</div><p style="margin:26px 0 0;font-size:14px;line-height:1.6;color:#756d6a">Thank you for being part of the Bead Different Co. community.</p>`);

const orderTrackingUrl = (carrier: unknown, tracking: unknown) => {
  const value = textValue(tracking, 200);
  if (!value) return "";
  const normalized = textValue(carrier, 80).toLowerCase();
  if (normalized.includes("usps")) return `https://tools.usps.com/go/TrackConfirmAction?tRef=fullpage&tLc=2&text=${encodeURIComponent(value)}`;
  if (normalized.includes("ups")) return `https://www.ups.com/track?tracknum=${encodeURIComponent(value)}`;
  if (normalized.includes("fedex")) return `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(value)}`;
  return "";
};

async function sendResendEmail(to: string, subject: string, body: string, idempotencyKey: string, html = textToHtml(body)) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      from: emailFrom,
      to: [to],
      subject,
      text: body,
      html: html,
    }),
  });
  if (response.ok) return;
  const detail = textValue(await response.text(), 300);
  throw new Error(`Resend rejected the message${detail ? `: ${detail}` : "."}`);
}

async function sendToMany(emails: string[], subject: string, body: string, keyPrefix: string, html?: string) {
  let sent = 0;
  const failures: string[] = [];
  for (const email of emails) {
    try {
      await sendResendEmail(email, subject, body, `${keyPrefix}/${encodeURIComponent(email)}`, html);
      sent += 1;
    } catch (error) {
      failures.push(`${email}: ${textValue(error instanceof Error ? error.message : error, 300)}`);
    }
  }
  return { sent, failures };
}

async function campaignRecipients(audience: string) {
  const [subscriberResponse, preferenceResponse, profileResponse] = await Promise.all([
    supabaseRequest("notification_subscribers?active=eq.true&select=email"),
    supabaseRequest("customer_preferences?marketing_opt_in=eq.true&select=user_id"),
    supabaseRequest("profiles?select=id,email"),
  ]);
  const [subscribers, preferences, profiles] = await Promise.all([
    requireJsonArray(subscriberResponse, "Subscriber"),
    requireJsonArray(preferenceResponse, "Member opt-in"),
    requireJsonArray(profileResponse, "Profile"),
  ]);
  const subscriberEmails = normalizeEmails(subscribers.map((entry: { email: string }) => entry.email));
  const optedInIds = new Set(preferences.map((entry: { user_id: string }) => entry.user_id));
  const profileEmails = normalizeEmails(profiles.map((entry: { email: string }) => entry.email));
  const memberOptins = normalizeEmails(profiles.filter((entry: { id: string }) => optedInIds.has(entry.id)).map((entry: { email: string }) => entry.email));
  if (audience === "all_subscribers_optins") return normalizeEmails([...subscriberEmails, ...memberOptins]);
  if (audience === "member_optins") return memberOptins;
  if (audience === "nonmember_subscribers") {
    const registeredEmails = new Set(profileEmails);
    return subscriberEmails.filter((email) => !registeredEmails.has(email));
  }
  if (audience === "waitlist_product") {
    const response = await supabaseRequest("waitlist_entries?status=eq.waiting&select=profiles(email)");
    const entries = await requireJsonArray(response, "Waitlist");
    return normalizeEmails(entries.map((entry: { profiles?: { email?: string } }) => entry.profiles?.email));
  }
  throw new Error("Unsupported email audience.");
}

async function sendCampaign(campaignId: string) {
  const response = await supabaseRequest(`email_campaigns?id=eq.${encodeURIComponent(campaignId)}&select=id,subject,body,audience,status`);
  if (!response.ok) throw new Error("Unable to load the email campaign.");
  const campaigns = await response.json();
  const campaign = campaigns[0];
  if (!campaign) throw new Error("Email campaign not found.");
  if (campaign.status === "sent") return { sent: 0, failures: [], alreadySent: true };
  if (!['draft', 'queued'].includes(campaign.status)) throw new Error("This campaign is not ready to send.");
  const subject = textValue(campaign.subject, 200);
  const body = textValue(campaign.body, 10000);
  if (!subject || !body) throw new Error("Campaign subject and message are required.");
  const recipients = await campaignRecipients(campaign.audience);
  if (!recipients.length) throw new Error("This campaign has no eligible recipients.");
  await supabaseRequest(`email_campaigns?id=eq.${encodeURIComponent(campaignId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status: "queued", updated_at: new Date().toISOString() }),
  });
  const result = await sendToMany(recipients, subject, body, `campaign/${campaignId}`, campaignHtml(subject, body));
  await supabaseRequest(`email_campaigns?id=eq.${encodeURIComponent(campaignId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status: result.failures.length ? "queued" : "sent", updated_at: new Date().toISOString() }),
  });
  return { ...result, recipients: recipients.length };
}

async function sendOrderUpdate(orderId: string) {
  const response = await supabaseRequest(`orders?id=eq.${encodeURIComponent(orderId)}&select=id,status,total,carrier,tracking_number,shipping_name,profiles(email,full_name)`);
  if (!response.ok) throw new Error("Unable to load the order.");
  const orders = await response.json();
  const order = orders[0];
  const email = order?.profiles?.email;
  if (!order) throw new Error("Order not found.");
  if (!emailPattern.test(String(email || ""))) return { sent: 0, skipped: true };
  const orderShortId = String(order.id).slice(0, 8);
  const tracking = order.tracking_number ? `\nTracking: ${order.carrier ? `${order.carrier} ` : ""}${order.tracking_number}` : "";
  const greeting = `Hello${order.profiles?.full_name ? ` ${order.profiles.full_name}` : ""},`;
  const body = `${greeting}\n\nYour Bead Different Co. order ${orderShortId} has been updated.\n\nStatus: ${order.status}${tracking}\n\nThank you,\nBead Different Co.`;
  const trackingUrl = orderTrackingUrl(order.carrier, order.tracking_number);
  const html = brandedHtml(`Order ${orderShortId} updated`, `<p>${escapeHtml(greeting)}</p><p>Your Bead Different Co. order has been updated.</p><div style="margin:22px 0;padding:16px;background:#f7f3f1;border-radius:10px"><p style="margin:0 0 8px"><strong>Status:</strong> ${escapeHtml(order.status)}</p>${order.tracking_number ? `<p style="margin:0"><strong>Tracking:</strong> ${escapeHtml(`${order.carrier ? `${order.carrier} ` : ""}${order.tracking_number}`)}${trackingUrl ? ` · <a href="${escapeHtml(trackingUrl)}" style="color:#8b4261">Track package</a>` : ""}</p>` : ""}</div>`);
  return sendToMany([String(email)], `Order ${orderShortId} update from Bead Different Co.`, body, `order-update/${order.id}/${order.status}/${order.tracking_number || "none"}`, html);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "POST required." }, 405);
  if (!(await isAdmin(request))) return json({ error: "Admin access required." }, 403);
  if (!resendApiKey || !emailFrom) return json({ error: "Resend email delivery is not configured." }, 503);
  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "A JSON request body is required." }, 400);
  }
  try {
    const action = textValue(payload.action, 40);
    if (action === "direct") {
      const recipients = normalizeEmails(payload.to);
      const subject = textValue(payload.subject, 200);
      const body = textValue(payload.body, 10000);
      if (!recipients.length || recipients.length > 20 || !subject || !body) return json({ error: "A valid recipient, subject, and message are required." }, 400);
      return json(await sendToMany(recipients, subject, body, `direct/${crypto.randomUUID()}`));
    }
    if (action === "campaign") {
      const campaignId = textValue(payload.campaignId, 80);
      if (!campaignId) return json({ error: "Campaign id is required." }, 400);
      return json(await sendCampaign(campaignId));
    }
    if (action === "order_update") {
      const orderId = textValue(payload.orderId, 80);
      if (!orderId) return json({ error: "Order id is required." }, 400);
      return json(await sendOrderUpdate(orderId));
    }
    return json({ error: "Unsupported email action." }, 400);
  } catch (error) {
    return json({ error: textValue(error instanceof Error ? error.message : error, 500) }, 502);
  }
});
