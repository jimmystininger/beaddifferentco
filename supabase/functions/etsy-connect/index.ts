// GET callback authenticates with single-use, expiring OAuth state + PKCE.
// Every POST requires a validated Supabase user and an active admin profile.
const projectUrl = Deno.env.get('SUPABASE_URL') || '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const etsyKey = Deno.env.get('ETSY_API_KEY') || '';
const etsySecret = Deno.env.get('ETSY_SHARED_SECRET') || '';
const callbackUrl = `${projectUrl}/functions/v1/etsy-connect/callback`;
const scopes = 'shops_r listings_r transactions_r';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
const hash = async (value: string) => base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
const network = (url: string, init: RequestInit = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
async function database(path: string, method = 'GET', body?: unknown) {
  const response = await network(`${projectUrl}/rest/v1/${path}`, { method, headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.ok) throw new Error('Connection storage is unavailable.');
  return response.status === 204 ? [] : response.json();
}
async function activeAdmin(id: string) {
  const rows = await database(`profiles?id=eq.${encodeURIComponent(id)}&select=role,status`);
  return rows[0]?.role === 'admin' && rows[0]?.status === 'active';
}
async function adminFor(request: Request) {
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  const response = await network(`${projectUrl}/auth/v1/user`, { headers: { apikey: serviceKey, Authorization: authorization } });
  if (!response.ok) return null;
  const user = await response.json();
  return user.id && await activeAdmin(user.id) ? user.id : null;
}
function returnOrigin(value: string) {
  const url = new URL(value);
  if (url.origin !== value || !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error('Open the admin on HTTPS or a local preview.');
  return url.origin;
}
async function tokenRequest(body: URLSearchParams) {
  const response = await network('https://api.etsy.com/v3/public/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!response.ok) throw new Error('Etsy authorization expired or was rejected. Please reconnect.');
  const token = await response.json();
  if (typeof token.access_token !== 'string' || typeof token.refresh_token !== 'string' || !(Number(token.expires_in) > 0)) throw new Error('Etsy returned an invalid authorization response.');
  return token;
}
let nextEtsyRequestAt = 0;
const pause = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function etsy(path: string, accessToken: string) {
  // Receipt imports need detail and payment reads. Serialize them below Etsy's
  // per-second limit and honor a temporary 429 instead of failing the preview.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const now = Date.now(), scheduled = Math.max(now, nextEtsyRequestAt);
    nextEtsyRequestAt = scheduled + 175;
    if (scheduled > now) await pause(scheduled - now);
    const response = await network(`https://api.etsy.com/v3/application/${path}`, { headers: { 'x-api-key': `${etsyKey}:${etsySecret}`, Authorization: `Bearer ${accessToken}` } });
    if (response.ok) return response.json();
    if (response.status !== 429) throw new Error('Etsy could not verify this connection. Try reconnecting.');
    const retryAfter = Math.max(1000, Number(response.headers.get('Retry-After')) * 1000 || 1000 * (attempt + 1));
    nextEtsyRequestAt = Math.max(nextEtsyRequestAt, Date.now() + retryAfter);
    await pause(retryAfter);
  }
  throw new Error('Etsy is busy. Please wait a minute, then try the import again.');
}
async function refreshConnection(connection: Record<string, any>) {
  if (Date.parse(connection.expires_at) > Date.now() + 90000) return connection;
  const now = new Date().toISOString();
  const lease = new Date(Date.now() + 60000).toISOString();
  const locked = await database(`etsy_connections?id=eq.true&or=(refresh_lock_until.is.null,refresh_lock_until.lt.${now})`, 'PATCH', { refresh_lock_until: lease });
  if (!locked.length) throw new Error('Another connection check is running. Try again shortly.');
  try {
    // Use the row read while taking the lock; another request may have refreshed it.
    connection = locked[0];
    if (Date.parse(connection.expires_at) > Date.now() + 90000) return connection;
    const token = await tokenRequest(new URLSearchParams({ grant_type: 'refresh_token', client_id: etsyKey, refresh_token: connection.refresh_token }));
    const changes = { access_token: token.access_token, refresh_token: token.refresh_token, expires_at: new Date(Date.now() + Number(token.expires_in) * 1000).toISOString() };
    const updated = await database(`etsy_connections?id=eq.true&refresh_lock_until=eq.${encodeURIComponent(lease)}`, 'PATCH', changes);
    if (!updated.length) throw new Error('The connection changed during verification. Try again.');
    return updated[0];
  } finally {
    await database(`etsy_connections?id=eq.true&refresh_lock_until=eq.${encodeURIComponent(lease)}`, 'PATCH', { refresh_lock_until: null });
  }
}
const list = (value: unknown): Record<string, any>[] => Array.isArray(value) ? value.filter((item): item is Record<string, any> => Boolean(item) && typeof item === 'object') : [];
const money = (value: unknown) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') return Number.isFinite(Number(value)) ? Number(value) : 0;
  if (!value || typeof value !== 'object') return 0;
  const row = value as Record<string, any>, amount = Number(row.amount), divisor = Number(row.divisor);
  return Number.isFinite(amount) ? amount / (Number.isFinite(divisor) && divisor > 0 ? divisor : 1) : 0;
};
const stamp = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? new Date(number * 1000).toISOString() : new Date().toISOString();
};
async function concurrent<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>) {
  const output: R[] = []; let index = 0;
  const worker = async () => { while (index < items.length) { const current = index++; output[current] = await task(items[current]); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return output;
}
async function importConnection() {
  const connection = (await database('etsy_connections?id=eq.true'))[0];
  if (!connection) throw new Error('Connect Etsy before preparing an import.');
  return refreshConnection(connection);
}
async function createImportBatch(adminId: string, kind: 'orders' | 'reviews', payload: Record<string, unknown>) {
  const rows = await database('etsy_import_batches', 'POST', { created_by: adminId, kind, payload, expires_at: new Date(Date.now() + 30 * 60000).toISOString() });
  return rows[0]?.id as string | undefined;
}
async function orderSyncStart() {
  const latest = (await database('etsy_sale_lines?select=sale_date&order=sale_date.desc&limit=1'))[0];
  const threeYearsAgo = Date.now() - 3 * 365 * 24 * 60 * 60 * 1000;
  const overlapStart = latest?.sale_date ? Date.parse(latest.sale_date) - 30 * 24 * 60 * 60 * 1000 : threeYearsAgo;
  const startedAt = Math.max(threeYearsAgo, Number.isFinite(overlapStart) ? overlapStart : threeYearsAgo);
  return { min_created: Math.floor(startedAt / 1000), mode: latest?.sale_date ? 'incremental' : 'initial' };
}
function receiptStatus(receipt: Record<string, any>) {
  if (receipt.was_canceled === true || receipt.is_canceled === true) return 'cancelled';
  if (receipt.was_refunded === true || receipt.is_refunded === true) return 'refunded';
  const status = String(receipt.status || '').toLowerCase();
  return ['paid', 'completed', 'refunded', 'returned', 'cancelled'].includes(status) ? status : 'paid';
}
async function previewOrders(adminId: string, offset: number, minCreated?: number) {
  const connection = await importConnection();
  const dateFilter = Number.isFinite(minCreated) && Number(minCreated) > 0 ? `&min_created=${Math.floor(Number(minCreated))}` : '';
  const page = await etsy(`shops/${connection.shop_id}/receipts?limit=25&offset=${offset}${dateFilter}`, connection.access_token);
  const receipts = list(page.results);
  const mappingRows = await database('product_etsy_mappings?select=etsy_sku,inventory_sku&active=eq.true');
  const inventoryByEtsySku = new Map(mappingRows.map((row: Record<string, any>) => [String(row.etsy_sku || '').trim().toLowerCase(), String(row.inventory_sku || '').trim()]));
  const sales = (await concurrent(receipts, 2, async (receipt) => {
    const receiptId = String(receipt.receipt_id || '');
    const transactions = list(receipt.transactions).length ? list(receipt.transactions) : list(await etsy(`shops/${connection.shop_id}/receipts/${encodeURIComponent(receiptId)}/transactions`, connection.access_token));
    const payments = list(await etsy(`shops/${connection.shop_id}/receipts/${encodeURIComponent(receiptId)}/payments`, connection.access_token));
    const totalGross = transactions.reduce((sum, transaction) => sum + money(transaction.price) * Math.max(1, Number(transaction.quantity) || 1), 0);
    const divisor = totalGross > 0 ? totalGross : Math.max(1, transactions.length);
    const shipping = money(receipt.total_shipping_cost || receipt.total_shipping), tax = money(receipt.total_tax_cost || receipt.total_tax), discount = money(receipt.discount_amt || receipt.discount_amount);
    const fees = payments.reduce((sum, payment) => sum + money(payment.amount_fees || payment.fee_amount), 0);
    return transactions.map((transaction) => {
      const quantity = Math.max(0, Number(transaction.quantity) || 0);
      const gross = money(transaction.price) * quantity;
      const share = totalGross > 0 ? gross / divisor : 1 / Math.max(1, transactions.length);
      const sku = String(transaction.sku || transaction.listing_sku || '').trim() || `listing:${String(transaction.listing_id || 'unknown')}`;
      const refunded = receiptStatus(receipt) === 'refunded' || receiptStatus(receipt) === 'cancelled' ? quantity : 0;
      return {
        external_order_id: receiptId,
        external_line_id: String(transaction.transaction_id || `${receiptId}:${transaction.listing_id || sku}`),
        etsy_sku: sku,
        listing_id: transaction.listing_id || null,
        title: String(transaction.title || transaction.product_data?.[0]?.property_name || 'Etsy item'),
        sale_date: stamp(transaction.paid_timestamp || receipt.paid_timestamp || transaction.created_timestamp || receipt.create_timestamp),
        status: receiptStatus(receipt), quantity, refunded_quantity: refunded,
        gross_revenue: gross, discount_amount: discount * share, refund_amount: refunded ? Math.max(0, gross - discount * share) : 0,
        shipping_revenue: shipping * share, sales_tax: tax * share, marketplace_fees: fees * share,
        currency: String(receipt.currency_code || transaction.currency_code || 'USD'),
        matched_inventory_sku: inventoryByEtsySku.get(sku.toLowerCase()) || null
      };
    });
  })).flat();
  const batchId = await createImportBatch(adminId, 'orders', { sales });
  const total = (key: string) => sales.reduce((sum, sale) => sum + (Number(sale[key]) || 0), 0);
  return { batch_id: batchId, next_offset: offset + receipts.length, has_more: receipts.length === 25, receipts: receipts.length, sales: sales.length, matched: sales.filter((sale) => sale.matched_inventory_sku).length, unmatched: sales.filter((sale) => !sale.matched_inventory_sku).length, totals: { revenue: total('gross_revenue'), discounts: total('discount_amount'), shipping: total('shipping_revenue'), tax: total('sales_tax'), fees: total('marketplace_fees'), refunds: total('refund_amount') }, rows: sales.slice(0, 50) };
}
async function previewReviews(adminId: string, offset: number) {
  const connection = await importConnection();
  const page = await etsy(`shops/${connection.shop_id}/reviews?limit=25&offset=${offset}`, connection.access_token);
  const source = list(page.results);
  const products = await database('products?select=id,name,external_id,etsy_listing_id');
  const productByListing = new Map(products.map((product: Record<string, any>) => [String(product.etsy_listing_id), product]));
  const productsById = new Map(products.map((product: Record<string, any>) => [String(product.id), product]));
  const skuMappings = await database('product_etsy_mappings?select=product_id,etsy_sku&active=eq.true');
  const productIdsBySku = new Map<string, Set<string>>();
  skuMappings.forEach((mapping: Record<string, any>) => { const sku = String(mapping.etsy_sku || '').trim().toLowerCase(); if (!sku || !mapping.product_id) return; const ids = productIdsBySku.get(sku) || new Set<string>(); ids.add(String(mapping.product_id)); productIdsBySku.set(sku, ids); });
  const unresolved = [...new Set(source.map((review) => String(review.listing_id || '')).filter((listingId) => listingId && !productByListing.has(listingId)))];
  const inferredByListing = new Map<string, Record<string, any>>();
  await concurrent(unresolved, 2, async (listingId) => {
    try {
      const inventory = await etsy(`listings/${encodeURIComponent(listingId)}/inventory`, connection.access_token);
      const candidates = new Set<string>();
      list(inventory.products).forEach((listingProduct) => { const ids = productIdsBySku.get(String(listingProduct.sku || '').trim().toLowerCase()); ids?.forEach((id) => candidates.add(id)); });
      if (candidates.size === 1) { const product = productsById.get([...candidates][0]); if (product) inferredByListing.set(listingId, product); }
    } catch { /* Expired or non-inventory listings remain available for manual matching. */ }
  });
  const matched = source.map((review) => {
    const listingId = String(review.listing_id || ''); const product = productByListing.get(listingId) || inferredByListing.get(listingId);
    const createdAt = stamp(review.create_timestamp || review.created_timestamp);
    const externalReviewId = String(review.transaction_id || review.review_id || `${listingId}:${createdAt}:${review.rating || ''}`);
    return { external_review_id: externalReviewId, listing_id: listingId, product_id: product?.id || null, product_name: product?.name || null, rating: Math.max(1, Math.min(5, Number(review.rating) || 5)), body: String(review.review || ''), photos: review.image_url_fullxfull ? [String(review.image_url_fullxfull)] : [], reviewer_name: String(review.buyer_name || review.buyer_login_name || ''), created_at: createdAt };
  });
  const importable = matched.filter((review) => review.product_id);
  const batchId = await createImportBatch(adminId, 'reviews', { reviews: importable });
  const unmatchedListings = [...new Map(matched.filter((review) => !review.product_id && review.listing_id).map((review) => [review.listing_id, review])).values()].map((review) => ({ listing_id: review.listing_id, rating: review.rating, body: review.body }));
  return { batch_id: batchId, next_offset: offset + source.length, has_more: source.length === 25, reviews: source.length, matched: importable.length, unmatched: matched.length - importable.length, unmatched_listings: unmatchedListings, rows: matched.slice(0, 50) };
}
async function callback(request: Request) {
  const url = new URL(request.url), state = url.searchParams.get('state') || '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(state)) return json({ error: 'Invalid or missing authorization state. Start again from Store Control.' }, 400);
  // DELETE ... RETURNING atomically consumes the nonce, preventing callback replay.
  const rows = await database(`etsy_oauth_states?state_hash=eq.${await hash(state)}&expires_at=gt.${new Date().toISOString()}`, 'DELETE');
  const pending = rows[0];
  if (!pending) return json({ error: 'Authorization expired or was already used. Start again from Store Control.' }, 400);
  const redirect = (result: string) => new Response(null, { status: 303, headers: { Location: `${returnOrigin(pending.return_origin)}/admin.html?etsy=${result}`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  try {
    if (!await activeAdmin(pending.admin_id)) return json({ error: 'Administrator access is required.' }, 403);
    if (url.searchParams.has('error')) return redirect('denied');
    const code = url.searchParams.get('code');
    if (!code || code.length > 4096) return redirect('failed');
    const token = await tokenRequest(new URLSearchParams({ grant_type: 'authorization_code', client_id: etsyKey, redirect_uri: callbackUrl, code, code_verifier: pending.code_verifier }));
    const userId = token.access_token.split('.')[0];
    if (!/^\d+$/.test(userId)) throw new Error('Invalid Etsy account.');
    const granted = String(token.scope || scopes).split(' ');
    if (scopes.split(' ').some(scope => !granted.includes(scope))) throw new Error('Required permissions were not granted.');
    const shop = await etsy(`users/${userId}/shops`, token.access_token);
    if (!shop.shop_id || String(shop.user_id) !== userId || !shop.shop_name) throw new Error('No owned Etsy shop found.');
    // Verify the OAuth token itself, not just API-key access to a public shop.
    await etsy(`shops/${shop.shop_id}/receipts?limit=1`, token.access_token);
    const existing = (await database('etsy_connections?id=eq.true&select=shop_id'))[0];
    if (existing && String(existing.shop_id) !== String(shop.shop_id)) return redirect('wrong-shop');
    const row = { id: true, shop_id: shop.shop_id, shop_name: shop.shop_name, etsy_user_id: userId, access_token: token.access_token, refresh_token: token.refresh_token, expires_at: new Date(Date.now() + Number(token.expires_in) * 1000).toISOString(), scopes: granted.join(' '), connected_by: pending.admin_id, connected_at: new Date().toISOString(), verified_at: new Date().toISOString(), refresh_lock_until: null };
    if (existing) await database('etsy_connections?id=eq.true', 'PATCH', row);
    else await database('etsy_connections', 'POST', row);
    return redirect('connected');
  } catch {
    // Never return provider responses, credentials, or authorization codes to the browser.
    return redirect('failed');
  }
}
Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  try {
    const missing = Object.entries({ SUPABASE_URL: projectUrl, SUPABASE_SERVICE_ROLE_KEY: serviceKey, ETSY_API_KEY: etsyKey, ETSY_SHARED_SECRET: etsySecret }).filter(([, value]) => !value).map(([name]) => name);
    if (missing.length) return json({ error: 'Missing backend secrets: ' + missing.join(', ') + '.' }, 503);
    if (request.method === 'GET' && new URL(request.url).pathname.endsWith('/callback')) return await callback(request);
    if (request.method !== 'POST') return json({ error: 'Use Connect Etsy in Store Control.' }, 405);
    const adminId = await adminFor(request);
    if (!adminId) return json({ error: 'An active administrator account is required.' }, 403);
    const body = await request.json();
    if (body.action === 'start') {
      const origin = returnOrigin(String(request.headers.get('Origin') || ''));
      const state = random(), verifier = random();
      await database(`etsy_oauth_states?expires_at=lt.${new Date().toISOString()}`, 'DELETE');
      await database(`etsy_oauth_states?admin_id=eq.${adminId}`, 'DELETE');
      await database('etsy_oauth_states', 'POST', { state_hash: await hash(state), admin_id: adminId, code_verifier: verifier, return_origin: origin, expires_at: new Date(Date.now() + 600000).toISOString() });
      const authorize = new URL('https://www.etsy.com/oauth/connect');
      authorize.search = new URLSearchParams({ response_type: 'code', client_id: etsyKey, redirect_uri: callbackUrl, scope: scopes, state, code_challenge: await hash(verifier), code_challenge_method: 'S256' }).toString();
      return json({ authorize_url: authorize.href });
    }
    if (body.action === 'disconnect') {
      await database('etsy_oauth_states?state_hash=not.is.null', 'DELETE');
      await database('etsy_connections?id=eq.true', 'DELETE');
      return json({ connected: false });
    }
    if (body.action === 'preview_orders') return json(await previewOrders(adminId, Math.max(0, Math.floor(Number(body.offset) || 0)), Number(body.min_created)));
    if (body.action === 'preview_reviews') return json(await previewReviews(adminId, Math.max(0, Math.floor(Number(body.offset) || 0))));
    if (body.action === 'order_sync_start') return json(await orderSyncStart());
    if (!['status', 'verify'].includes(body.action)) return json({ error: 'Unknown connection action.' }, 400);
    let connection = (await database('etsy_connections?id=eq.true'))[0];
    if (!connection) return json({ connected: false, callback_url: callbackUrl });
    if (body.action === 'verify') {
      connection = await refreshConnection(connection);
      await etsy(`shops/${connection.shop_id}/receipts?limit=1`, connection.access_token);
      connection.verified_at = new Date().toISOString();
      await database('etsy_connections?id=eq.true', 'PATCH', { verified_at: connection.verified_at });
    }
    return json({ connected: true, shop_id: connection.shop_id, shop_name: connection.shop_name, connected_at: connection.connected_at, verified_at: connection.verified_at, callback_url: callbackUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const allowed = ['Connection storage is unavailable.', 'Open the admin on HTTPS or a local preview.', 'Etsy authorization expired or was rejected. Please reconnect.', 'Etsy could not verify this connection. Try reconnecting.', 'Etsy is rate limiting requests. Try again shortly.', 'Another connection check is running. Try again shortly.', 'The connection changed during verification. Try again.', 'Connect Etsy before preparing an import.'];
    return json({ error: allowed.includes(message) ? message : 'Unable to complete the Etsy connection request. Please try again.' }, 400);
  }
});
