const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const resendApiKey = Deno.env.get('RESEND_API_KEY') || '';
const restockEmailFrom = Deno.env.get('RESTOCK_EMAIL_FROM') || '';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character));

async function supabaseRequest(path: string, init: RequestInit = {}) {
  return fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });
}

async function isAdmin(request: Request) {
  const authorization = request.headers.get('Authorization');
  if (!authorization || !supabaseUrl || !serviceRoleKey) return false;
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: serviceRoleKey, Authorization: authorization } });
  if (!userResponse.ok) return false;
  const user = await userResponse.json();
  const profileResponse = await supabaseRequest(`profiles?id=eq.${encodeURIComponent(user.id)}&select=role,status`);
  if (!profileResponse.ok) return false;
  const profiles = await profileResponse.json();
  return profiles[0]?.role === 'admin' && profiles[0]?.status === 'active';
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'POST required.' }, 405);
  if (!(await isAdmin(request))) return json({ error: 'Admin access required.' }, 403);
  if (!resendApiKey || !restockEmailFrom) return json({ error: 'Restock email delivery is not configured.' }, 503);

  const pendingResponse = await supabaseRequest('waitlist_restock_notifications?status=eq.pending&order=created_at.asc&limit=100');
  if (!pendingResponse.ok) return json({ error: 'Unable to load pending restock notifications.' }, 500);
  const pending = await pendingResponse.json();
  let sent = 0;
  let failed = 0;

  for (const notification of pending) {
    const claimResponse = await supabaseRequest(`waitlist_restock_notifications?id=eq.${encodeURIComponent(notification.id)}&status=eq.pending`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ status: 'sending', attempt_count: Number(notification.attempt_count || 0) + 1, last_error: null })
    });
    if (!claimResponse.ok || !(await claimResponse.json()).length) continue;

    const entryResponse = await supabaseRequest(`waitlist_entries?id=eq.${encodeURIComponent(notification.waitlist_entry_id)}&select=requested_quantity,requested_total_quantity,selected_options,products(name),profiles(email,full_name),inventory_skus(sku,name)`);
    const entryRows = entryResponse.ok ? await entryResponse.json() : [];
    const entry = entryRows[0];
    const email = entry?.profiles?.email;
    if (!email) {
      failed += 1;
      await supabaseRequest(`waitlist_restock_notifications?id=eq.${encodeURIComponent(notification.id)}`, { method: 'PATCH', body: JSON.stringify({ status: 'failed', last_error: 'Waitlist customer email is unavailable.' }) });
      continue;
    }

    const productName = entry.products?.name || 'an item';
    const skuName = entry.inventory_skus?.name || entry.inventory_skus?.sku || 'your selected option';
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: restockEmailFrom,
        to: [email],
        subject: `${productName} is back in stock`,
        html: `<p>Hello${entry.profiles?.full_name ? ` ${escapeHtml(entry.profiles.full_name)}` : ''},</p><p>The selected option <strong>${escapeHtml(skuName)}</strong> for <strong>${escapeHtml(productName)}</strong> has new inventory available.</p><p>Your waitlist request is for ${Number(entry.requested_quantity) || 1} item${Number(entry.requested_quantity) === 1 ? '' : 's'}. Visit the product page to place your order.</p><p>Bead Different Co.</p>`
      })
    });
    if (!response.ok) {
      failed += 1;
      const detail = await response.text();
      await supabaseRequest(`waitlist_restock_notifications?id=eq.${encodeURIComponent(notification.id)}`, { method: 'PATCH', body: JSON.stringify({ status: 'failed', last_error: detail.slice(0, 500) }) });
      continue;
    }
    sent += 1;
    await supabaseRequest(`waitlist_restock_notifications?id=eq.${encodeURIComponent(notification.id)}`, { method: 'PATCH', body: JSON.stringify({ status: 'sent', sent_at: new Date().toISOString(), last_error: null }) });
  }

  return json({ processed: sent + failed, sent, failed });
});
