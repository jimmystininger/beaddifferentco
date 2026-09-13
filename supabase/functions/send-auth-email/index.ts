import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, webhook-id, webhook-timestamp, webhook-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const resendApiKey = Deno.env.get("RESEND_API_KEY") || "";
const emailFrom = Deno.env.get("EMAIL_FROM") || Deno.env.get("RESTOCK_EMAIL_FROM") || "";
const hookSecret = (Deno.env.get("SEND_EMAIL_HOOK_SECRET") || "").replace(/^v1,whsec_/, "");
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

const actionCopy = (action: string) => {
  if (action === "recovery") return { subject: "Reset your Bead Different Co. password", title: "Reset your password", intro: "We received a request to reset your Bead Different Co. password.", button: "Reset password", note: "If you did not request this, you can safely ignore this email." };
  if (action === "signup") return { subject: "Confirm your Bead Different Co. account", title: "Confirm your account", intro: "Thanks for creating a Bead Different Co. account. Confirm your email address to finish signing up.", button: "Confirm email", note: "If you did not create this account, you can safely ignore this email." };
  if (action === "email_change") return { subject: "Confirm your new Bead Different Co. email", title: "Confirm your new email", intro: "Confirm this email address to finish updating your Bead Different Co. account.", button: "Confirm email", note: "If you did not request this change, contact us right away." };
  return { subject: "Action needed for your Bead Different Co. account", title: "Confirm your account", intro: "Use the button below to continue with your Bead Different Co. account.", button: "Continue", note: "If you did not request this, you can safely ignore this email." };
};

const authUrl = (emailData: { token_hash?: string; email_action_type?: string; redirect_to?: string }) => `${supabaseUrl}/auth/v1/verify?token=${encodeURIComponent(textValue(emailData.token_hash, 500))}&type=${encodeURIComponent(textValue(emailData.email_action_type, 80))}&redirect_to=${encodeURIComponent(textValue(emailData.redirect_to, 1000))}`;

async function sendEmail(to: string, subject: string, text: string, html: string, idempotencyKey: string) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ from: emailFrom, to: [to], subject, text, html }),
  });
  if (response.ok) return;
  throw new Error(`Resend rejected the message: ${textValue(await response.text(), 300)}`);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "POST required." }, 405);
  if (!resendApiKey || !emailFrom || !hookSecret) return json({ error: "Auth email delivery is not configured." }, 503);
  const rawBody = await request.text();
  try {
    const headers = Object.fromEntries(request.headers.entries());
    const webhook = new Webhook(hookSecret);
    const payload = webhook.verify(rawBody, headers) as { user?: { id?: string; email?: string; new_email?: string; user_metadata?: Record<string, unknown> }; email_data?: { token_hash?: string; token_hash_new?: string; email_action_type?: string; redirect_to?: string } };
    const user = payload.user || {};
    const emailData = payload.email_data || {};
    const action = textValue(emailData.email_action_type, 80) || "email";
    const copy = actionCopy(action);
    const recipient = textValue(action === "email_change" ? user.new_email || user.email : user.email, 320).toLowerCase();
    const tokenHash = textValue(emailData.token_hash, 500);
    if (!emailPattern.test(recipient) || !tokenHash) return json({ error: "The auth email payload is incomplete." }, 400);
    const url = authUrl({ ...emailData, token_hash: tokenHash, email_action_type: action });
    const name = textValue(user.user_metadata?.full_name, 160);
    const greeting = `Hello${name ? ` ${name}` : ""},`;
    const text = `${greeting}\n\n${copy.intro}\n\n${url}\n\n${copy.note}\n\nBead Different Co.`;
    const html = `<!doctype html><html><body style="margin:0;background:#f7f3f1;color:#241e1d;font-family:Arial,sans-serif"><div style="max-width:600px;margin:0 auto;padding:32px 20px"><div style="background:#ffffff;border:1px solid #e4deda;border-radius:14px;padding:32px"><p style="margin:0 0 18px;color:#8b4261;font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase">BEAD DIFFERENT CO.</p><h1 style="margin:0 0 22px;font-family:Georgia,serif;font-size:28px;line-height:1.15;color:#241e1d">${escapeHtml(copy.title)}</h1><p>${escapeHtml(greeting)}</p><p>${escapeHtml(copy.intro)}</p><p style="margin:28px 0"><a href="${escapeHtml(url)}" style="display:inline-block;background:#8b4261;color:#fff;text-decoration:none;border-radius:999px;padding:13px 22px;font-weight:700">${escapeHtml(copy.button)}</a></p><p style="color:#756d6a;font-size:13px">This link expires according to your account security settings. ${escapeHtml(copy.note)}</p><p style="margin:28px 0 0;color:#756d6a;font-size:13px">Bead Different Co.</p></div></div></body></html>`;
    await sendEmail(recipient, copy.subject, text, html, `auth/${action}/${user.id || recipient}/${tokenHash}`);
    return json({});
  } catch (error) {
    return json({ error: textValue(error instanceof Error ? error.message : error, 500) }, 400);
  }
});
