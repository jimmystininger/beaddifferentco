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
async function database(path: string, method = 'GET', body?: unknown, prefer = 'return=representation') {
  const response = await network(`${projectUrl}/rest/v1/${path}`, { method, headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: prefer }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.ok) {
    let detail = '';
    try { detail = (await response.text()).replace(/\s+/g, ' ').slice(0, 180); } catch { /* Keep unreadable provider details out of the response. */ }
    throw new Error(`Connection storage is unavailable (${response.status} at ${path.split('?')[0]})${detail ? `: ${detail}` : '.'}`);
  }
  if (response.status === 204) return [];
  const payload = await response.text();
  if (!payload.trim()) return [];
  try { return JSON.parse(payload); } catch { throw new Error('Connection storage returned an invalid response.'); }
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
    if (response.ok) {
      const payload = await response.text();
      if (!payload.trim()) return {};
      try { return JSON.parse(payload); } catch { throw new Error('Etsy returned an invalid response.'); }
    }
    if (response.status !== 429) {
      let detail = '';
      try { detail = (await response.text()).replace(/\s+/g, ' ').slice(0, 240); } catch { /* Keep provider details out of the response when unreadable. */ }
      throw new Error(`Etsy API request failed (${response.status})${detail ? `: ${detail}` : '.'}`);
    }
    const retryAfterHeader = Number(response.headers.get('Retry-After'));
    // Never let an Etsy rate-limit delay consume the entire Edge Function
    // request. A long Retry-After used to leave listing scans idle until the
    // platform returned IDLE_TIMEOUT after 150 seconds.
    if (retryAfterHeader > 10) throw new Error('Etsy is rate limiting requests. Wait a minute, then retry the scan.');
    const retryAfter = Math.min(5000, Math.max(1000, retryAfterHeader * 1000 || 1000 * (attempt + 1)));
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
    await database(`etsy_connections?id=eq.true&refresh_lock_until=eq.${encodeURIComponent(lease)}`, 'PATCH', { refresh_lock_until: null }, 'return=minimal');
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
async function concurrentSettled<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>) {
  const output: { item: T; value?: R; error?: string }[] = []; let index = 0;
  const worker = async () => {
    while (index < items.length) {
      const current = index++;
      try { output[current] = { item: items[current], value: await task(items[current]) }; }
      catch (error) { output[current] = { item: items[current], error: error instanceof Error ? error.message : String(error || 'Import failed.') }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return output;
}
async function importConnection() {
  const connection = (await database('etsy_connections?id=eq.true&select=id,shop_id,access_token,refresh_token,expires_at,refresh_lock_until'))[0];
  if (!connection) throw new Error('Connect Etsy before preparing an import.');
  return refreshConnection(connection);
}
async function createImportBatch(adminId: string, kind: 'orders' | 'reviews' | 'listings', payload: Record<string, unknown>, metadata: Record<string, unknown> = {}) {
  // The browser only needs the batch id. Returning the full JSON payload here
  // needlessly sends every staged sale back through the Edge Function.
  const rows = await database('etsy_import_batches?select=id', 'POST', { created_by: adminId, kind, payload, expires_at: new Date(Date.now() + 30 * 86400000).toISOString(), import_type: kind, status: 'staged', source: 'etsy_api', row_count: 0, matched_count: 0, applied_count: 0, metadata });
  return rows[0]?.id as string | undefined;
}
async function updateImportBatch(batchId: string | undefined, changes: Record<string, unknown>) {
  if (!batchId) return;
  await database(`etsy_import_batches?id=eq.${encodeURIComponent(batchId)}`, 'PATCH', { ...changes, updated_at: new Date().toISOString() }, 'return=minimal');
}
async function orderSyncStart() {
  const latestRows = (await Promise.all([
    database('etsy_sale_lines?select=sale_date&order=sale_date.desc&limit=1'),
    database('etsy_import_sales?select=sale_date&order=sale_date.desc&limit=1')
  ])).flat().filter((row: Record<string, any>) => row?.sale_date).sort((a: Record<string, any>, b: Record<string, any>) => Date.parse(String(b.sale_date)) - Date.parse(String(a.sale_date)));
  const latest = latestRows[0];
  const initialSyncWindow = Date.now() - 45 * 24 * 60 * 60 * 1000;
  // Re-read a short overlap so refunds/status corrections are picked up,
  // without re-scanning the full month on every order sync.
  const overlapStart = latest?.sale_date ? Date.parse(latest.sale_date) - 3 * 24 * 60 * 60 * 1000 : initialSyncWindow;
  const startedAt = Math.max(initialSyncWindow, Number.isFinite(overlapStart) ? overlapStart : initialSyncWindow);
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
  // Etsy allows a larger receipt page than the old 25-row preview. Fetching
  // up to 100 receipts per sync keeps the one-click import to fewer Edge
  // invocations without widening the date window.
  const page = await etsy(`shops/${connection.shop_id}/receipts?limit=100&offset=${offset}${dateFilter}`, connection.access_token);
  const receipts = list(page.results);
  const receiptTransactions = await concurrent(receipts, 2, async (receipt) => {
    const receiptId = String(receipt.receipt_id || '');
    const transactions = list(receipt.transactions).length ? list(receipt.transactions) : list(await etsy(`shops/${connection.shop_id}/receipts/${encodeURIComponent(receiptId)}/transactions`, connection.access_token));
    return { receipt, transactions };
  });
  const transactionSkus = [...new Map(receiptTransactions.flatMap(({ transactions }) => transactions.map((transaction) => String(transaction.sku || transaction.listing_sku || '').trim()).filter(Boolean).map((sku) => [sku.toLowerCase(), sku] as const))).values()];
  const mappingRows = transactionSkus.length
    ? await database(`product_etsy_mappings?select=etsy_sku,inventory_sku&active=eq.true&etsy_sku=in.(${transactionSkus.map((sku) => encodeURIComponent(sku)).join(',')})`)
    : [];
  const inventoryByEtsySku = new Map(mappingRows.map((row: Record<string, any>) => [String(row.etsy_sku || '').trim().toLowerCase(), String(row.inventory_sku || '').trim()]));
  const sales = receiptTransactions.flatMap(({ receipt, transactions }) => {
    const receiptId = String(receipt.receipt_id || '');
    // Fees are reconciled by syncReceiptFees from Etsy's ledger in one
    // bounded pass. Do not fetch a payments resource for every receipt here.
    const payments: Record<string, any>[] = [];
    const totalGross = transactions.reduce((sum, transaction) => sum + money(transaction.price) * Math.max(1, Number(transaction.quantity) || 1), 0);
    const divisor = totalGross > 0 ? totalGross : Math.max(1, transactions.length);
    const shipping = money(receipt.total_shipping_cost || receipt.total_shipping), tax = money(receipt.total_tax_cost || receipt.total_tax), discount = money(receipt.discount_amt || receipt.discount_amount);
    const fees = payments.reduce((sum, payment) => sum + money(payment.amount_fees || payment.posted_fees), 0);
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
  });
  const batchId = sales.length ? await createImportBatch(adminId, 'orders', { sales }, { action: 'orders', scope: 'sales_and_inventory_metrics', min_created: minCreated || null }) : undefined;
  const total = (key: string) => sales.reduce((sum, sale) => sum + (Number(sale[key]) || 0), 0);
  return { batch_id: batchId, next_offset: offset + receipts.length, has_more: receipts.length === 100, receipts: receipts.length, sales: sales.length, matched: sales.filter((sale) => sale.matched_inventory_sku).length, unmatched: sales.filter((sale) => !sale.matched_inventory_sku).length, min_created: minCreated || null, totals: { revenue: total('gross_revenue'), discounts: total('discount_amount'), shipping: total('shipping_revenue'), tax: total('sales_tax'), fees: total('marketplace_fees'), refunds: total('refund_amount') } };
}
async function finalizeOrderImport(adminId: string, batchId: string, summary: Record<string, unknown>) {
  const id = String(batchId || '').trim();
  if (!id) throw new Error('The Etsy order import did not return a batch id.');
  const batches = await database(`etsy_import_batches?id=eq.${encodeURIComponent(id)}&created_by=eq.${encodeURIComponent(adminId)}&select=id,kind,metadata`);
  if (!batches[0] || batches[0].kind !== 'orders') throw new Error('That Etsy order import batch is unavailable.');
  const receipts = Math.max(0, Math.floor(Number(summary.receipts) || 0));
  const sales = Math.max(0, Math.floor(Number(summary.sales) || 0));
  const matched = Math.max(0, Math.floor(Number(summary.matched) || 0));
  const unmatched = Math.max(0, Math.floor(Number(summary.unmatched) || 0));
  const inventoryUpdated = Math.max(0, Math.floor(Number(summary.inventory_updated) || 0));
  const result = { status: 'applied', receipts, sales, matched, unmatched, inventory_updated: inventoryUpdated };
  const metadata = { ...(batches[0].metadata || {}), action: 'orders', scope: 'sales_and_inventory_metrics', receipts, sale_lines: sales, unmatched, inventory_updated: inventoryUpdated, applied_at: new Date().toISOString() };
  // Clear the staged JSON after the RPC has applied it. History keeps the
  // compact summary, not another copy of every Etsy sale line.
  await updateImportBatch(id, { status: 'applied', row_count: receipts, matched_count: matched, applied_count: sales, metadata, result, payload: {} });
  return result;
}
async function paymentsFromLedger(connection: Record<string, any>, windowStart: number, windowEnd: number) {
  const ledgerIds = new Set<string>();
  let offset = 0;
  let count = Number.POSITIVE_INFINITY;
  while (offset < count) {
    const page = await etsy(`shops/${connection.shop_id}/payment-account/ledger-entries?min_created=${windowStart}&max_created=${windowEnd}&limit=100&offset=${offset}`, connection.access_token);
    const entries = list(page?.results);
    entries.forEach((entry) => {
      // Etsy's ledger-entry payment lookup expects the entry_id values from
      // this response. The payment_id and ledger_id fields are not valid
      // inputs for the ledger_entry_ids query parameter.
      if (entry.entry_id) ledgerIds.add(String(entry.entry_id));
    });
    const reportedCount = Number(page?.count);
    count = Number.isFinite(reportedCount) ? reportedCount : offset + entries.length;
    if (!entries.length || entries.length < 100) break;
    offset += entries.length;
  }
  const ids = [...ledgerIds];
  const chunks = Array.from({ length: Math.ceil(ids.length / 25) }, (_, index) => ids.slice(index * 25, index * 25 + 25));
  const pages = await concurrent(chunks, 2, (chunk) => etsy(`shops/${connection.shop_id}/payment-account/ledger-entries/payments?ledger_entry_ids=${encodeURIComponent(chunk.join(','))}`, connection.access_token));
  return pages.flatMap((page) => list(page?.results));
}
async function syncReceiptFees(connection: Record<string, any>, historical = false, startCursor = '') {
  // Use Etsy's ledger-to-payments endpoint one 31-day window at a time, then
  // join payment fees to our imported sales locally instead of making one
  // request per receipt. The cursor keeps each invocation bounded/resumable.
  const nowSeconds = Math.floor(Date.now() / 1000);
  const periodSeconds = (historical ? 3 * 365 : 45) * 24 * 60 * 60;
  const periodStart = nowSeconds - periodSeconds;
  const cursorSeconds = Number(startCursor);
  const windowStart = Number.isFinite(cursorSeconds) && cursorSeconds >= periodStart && cursorSeconds <= nowSeconds ? Math.floor(cursorSeconds) : periodStart;
  const windowEnd = Math.min(nowSeconds, windowStart + 31 * 24 * 60 * 60 - 1);
  const since = new Date(windowStart * 1000).toISOString();
  const until = new Date((windowEnd + 1) * 1000).toISOString();
  const payments = await paymentsFromLedger(connection, windowStart, windowEnd);
  const feesByReceipt = new Map<string, number>();
  payments.forEach((payment) => {
    const receiptId = String(payment.receipt_id || '').trim();
    if (!receiptId) return;
    const fee = Math.abs(money(payment.amount_fees || payment.posted_fees));
    feesByReceipt.set(receiptId, (feesByReceipt.get(receiptId) || 0) + fee);
  });
  const lines: Record<string, any>[] = [];
  // New imports are applied to etsy_sale_lines; older imports remain in
  // etsy_import_sales. Only receipts returned by Etsy can receive fees, so
  // filter the local reads by those receipt IDs instead of downloading every
  // sale line in the time window and discarding most of them afterward.
  const receiptIds = [...feesByReceipt.keys()];
  const receiptChunks = Array.from({ length: Math.ceil(receiptIds.length / 100) }, (_, index) => receiptIds.slice(index * 100, index * 100 + 100));
  for (const table of ['etsy_sale_lines', 'etsy_import_sales']) {
    for (const receiptChunk of receiptChunks) {
      const receiptFilter = receiptChunk.map((receiptId) => encodeURIComponent(receiptId)).join(',');
      for (let offset = 0; ; offset += 1000) {
        const fields = table === 'etsy_import_sales' ? 'id,batch_id,external_order_id,external_line_id,gross_revenue' : 'id,external_order_id,external_line_id,etsy_sku,sale_date,status,quantity,refunded_quantity,gross_revenue';
        const page = await database(`${table}?external_order_id=in.(${receiptFilter})&sale_date=gte.${encodeURIComponent(since)}&sale_date=lt.${encodeURIComponent(until)}&select=${fields}&order=external_order_id.asc,external_line_id.asc&limit=1000&offset=${offset}`);
        page.forEach((line: Record<string, any>) => lines.push({ ...line, fee_table: table }));
        if (page.length < 1000) break;
      }
    }
  }
  const linesByReceipt = new Map<string, Record<string, any>[]>();
  lines.forEach((line: Record<string, any>) => {
    const receiptId = String(line.external_order_id || '').trim();
    if (!receiptId) return;
    const receiptLines = linesByReceipt.get(`${line.fee_table || 'etsy_import_sales'}|${receiptId}`) || [];
    receiptLines.push(line);
    linesByReceipt.set(`${line.fee_table || 'etsy_import_sales'}|${receiptId}`, receiptLines);
  });
  const updates: Record<string, any>[] = [];
  let matchedReceipts = 0;
  const matchedReceiptIds = new Set<string>();
  linesByReceipt.forEach((receiptLines, receiptKey) => {
    const receiptId = receiptKey.slice(receiptKey.indexOf('|') + 1);
    if (!feesByReceipt.has(receiptId)) return;
    if (!matchedReceiptIds.has(receiptId)) { matchedReceiptIds.add(receiptId); matchedReceipts += 1; }
    const fee = feesByReceipt.get(receiptId) || 0;
    const totalGross = receiptLines.reduce((sum, line) => sum + Math.max(0, Number(line.gross_revenue) || 0), 0);
    let allocated = 0;
    receiptLines.forEach((line, lineIndex) => {
      const share = lineIndex === receiptLines.length - 1 ? Math.max(0, fee - allocated) : Math.round((totalGross > 0 ? fee * Math.max(0, Number(line.gross_revenue) || 0) / totalGross : fee / Math.max(1, receiptLines.length)) * 100) / 100;
      allocated += share;
      // Include the required identity columns so a REST upsert can update the
      // existing row without replacing unrelated sale data.
      updates.push({ ...line, marketplace_fees: share });
    });
  });
  const byTable = new Map<string, Record<string, any>[]>();
  updates.forEach((line) => { const table = String(line.fee_table || 'etsy_import_sales'); const rows = byTable.get(table) || []; const payload = table === 'etsy_import_sales' ? { id: line.id, batch_id: line.batch_id, external_order_id: line.external_order_id, external_line_id: line.external_line_id, marketplace_fees: line.marketplace_fees } : { id: line.id, external_order_id: line.external_order_id, external_line_id: line.external_line_id, etsy_sku: line.etsy_sku, sale_date: line.sale_date, status: line.status, quantity: line.quantity, refunded_quantity: line.refunded_quantity, gross_revenue: line.gross_revenue, marketplace_fees: line.marketplace_fees }; rows.push(payload); byTable.set(table, rows); });
  for (const [table, tableUpdates] of byTable) {
    const chunks = Array.from({ length: Math.ceil(tableUpdates.length / 1000) }, (_, index) => tableUpdates.slice(index * 1000, index * 1000 + 1000));
    await concurrent(chunks, 4, (chunk) => database(`${table}?on_conflict=id`, 'POST', chunk, 'resolution=merge-duplicates,return=minimal'));
  }
  const done = windowEnd >= nowSeconds;
  return { synced_receipts: matchedReceipts, updated_lines: updates.length, next_cursor: done ? null : String(windowEnd + 1), done, coverage: historical ? 'last 3 years' : 'last 45 days', window_start: since, window_end: until };
}
async function previewReviews(adminId: string, offset: number) {
  const connection = await importConnection();
  const page = await etsy(`shops/${connection.shop_id}/reviews?limit=25&offset=${offset}`, connection.access_token);
  const source = list(page.results);
  const listingIds = [...new Set(source.map((review) => String(review.listing_id || '').trim()).filter(Boolean))];
  const queryValues = (values: string[]) => values.map((value) => encodeURIComponent(String(value))).join(',');
  const products = listingIds.length ? await database(`products?select=id,name,external_id,etsy_listing_id&etsy_listing_id=in.(${queryValues(listingIds)})`) : [];
  const productByListing = new Map(products.map((product: Record<string, any>) => [String(product.etsy_listing_id), product]));
  const productsById = new Map(products.map((product: Record<string, any>) => [String(product.id), product]));
  const unresolved = [...new Set(source.map((review) => String(review.listing_id || '')).filter((listingId) => listingId && !productByListing.has(listingId)))];
  const inferredByListing = new Map<string, Record<string, any>>();
  const candidateSkus = new Set<string>();
  const inventoryByListing = new Map<string, string[]>();
  await concurrent(unresolved, 2, async (listingId) => {
    try {
      const inventory = await etsy(`listings/${encodeURIComponent(listingId)}/inventory`, connection.access_token);
      const skus = [...new Set(list(inventory.products).map((listingProduct) => String(listingProduct.sku || '').trim()).filter(Boolean))];
      inventoryByListing.set(listingId, skus);
      skus.forEach((sku) => candidateSkus.add(sku));
    } catch { /* Expired or non-inventory listings remain available for manual matching. */ }
  });
  const skuMappings = candidateSkus.size ? await database(`product_etsy_mappings?select=product_id,etsy_sku&active=eq.true&etsy_sku=in.(${queryValues([...candidateSkus])})`) : [];
  const productIdsBySku = new Map<string, Set<string>>();
  skuMappings.forEach((mapping: Record<string, any>) => { const sku = String(mapping.etsy_sku || '').trim().toLowerCase(); if (!sku || !mapping.product_id) return; const ids = productIdsBySku.get(sku) || new Set<string>(); ids.add(String(mapping.product_id)); productIdsBySku.set(sku, ids); });
  const mappedProductIds = [...new Set(skuMappings.map((mapping: Record<string, any>) => String(mapping.product_id || '').trim()).filter((id) => id && !productsById.has(id)))];
  if (mappedProductIds.length) {
    const mappedProducts = await database(`products?select=id,name,external_id,etsy_listing_id&id=in.(${queryValues(mappedProductIds)})`);
    mappedProducts.forEach((product: Record<string, any>) => { productsById.set(String(product.id), product); if (product.etsy_listing_id) productByListing.set(String(product.etsy_listing_id), product); });
  }
  inventoryByListing.forEach((skus, listingId) => {
    const candidates = new Set<string>();
    skus.forEach((sku) => productIdsBySku.get(sku.toLowerCase())?.forEach((id) => candidates.add(id)));
    if (candidates.size === 1) { const product = productsById.get([...candidates][0]); if (product) inferredByListing.set(listingId, product); }
  });
  const matched = source.map((review) => {
    const listingId = String(review.listing_id || ''); const product = productByListing.get(listingId) || inferredByListing.get(listingId);
    const createdAt = stamp(review.create_timestamp || review.created_timestamp);
    const externalReviewId = String(review.transaction_id || review.review_id || `${listingId}:${createdAt}:${review.rating || ''}`);
    const buyerId = String(review.buyer_user_id || '').trim();
    return { external_review_id: externalReviewId, listing_id: listingId, product_id: product?.id || null, product_name: product?.name || null, rating: Math.max(1, Math.min(5, Number(review.rating) || 5)), body: String(review.review || ''), photos: review.image_url_fullxfull ? [String(review.image_url_fullxfull)] : [], reviewer_name: String(review.buyer_name || review.buyer_login_name || (buyerId ? `Etsy member ${buyerId}` : '')), created_at: createdAt };
  });
  const importable = matched.filter((review) => review.product_id);
  const batchId = await createImportBatch(adminId, 'reviews', { reviews: importable });
  const unmatchedListings = [...new Map(matched.filter((review) => !review.product_id && review.listing_id).map((review) => [review.listing_id, review])).values()].map((review) => ({ listing_id: review.listing_id, rating: review.rating, body: review.body }));
  return { batch_id: batchId, next_offset: offset + source.length, has_more: source.length === 25, reviews: source.length, matched: importable.length, unmatched: matched.length - importable.length, unmatched_listings: unmatchedListings, rows: matched.slice(0, 50) };
}
function normalizeSku(value: unknown) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}
function cleanText(value: unknown) {
  // Etsy can return malformed UTF-16 in older listing descriptions. Replace
  // lone surrogates and NULs before JSON encoding so PostgREST never receives
  // an invalid JSON string for one listing.
  return String(value ?? '').replace(/\u0000/g, '').replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
}
function productNameFromListing(title: string, listingId: string) {
  const parts = String(title || '').split(/[,|]/).map((part) => part.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const generic = /^(?:diy|craft|bead supplies?|bead supply|beads? for (?:a )?(?:pen|pens|keychains?)|loose beads?|chunky beads?|acrylic beads?|shiny beads?|ombre beads?|jewelry making beads?|fundraiser ideas?)$/i;
  const useful = parts.filter((part) => !generic.test(part));
  // The first Etsy title segment is the human-facing product name. The
  // remaining comma-separated segments are search keywords, not part of the
  // product name shown to an admin.
  let candidate = useful[0] || parts[0] || '';
  const hasBead = /\bbeads?\b/i.test(candidate) || /\bbeads?\b/i.test(title);
  candidate = candidate.replace(/\bbeads?\b/gi, '').replace(/\s+/g, ' ').trim();
  if (hasBead) candidate = `${candidate} Beads`.trim();
  candidate = candidate.replace(/\s+([&/])/g, '$1').replace(/([&/])\s+/g, '$1 ');
  return cleanText(candidate).slice(0, 120).trim() || `Etsy listing ${listingId}`;
}
function packSizeForSku(sku: string) {
  const match = String(sku || '').match(/(?:^|-)(\d{1,3})(?:PK|PC|CT)$/i);
  return match ? Math.max(1, Number(match[1])) : 1;
}
function packUnitForSku(sku: string) {
  const match = String(sku || '').match(/(?:^|-)(\d{1,3})(PK|PC|CT)$/i);
  return match?.[2]?.toUpperCase() || 'PK';
}
function packVariantLabel(sku: string) {
  return `${packSizeForSku(sku)}${packUnitForSku(sku)}`;
}
function packChoiceLabel(sku: string) {
  const unit = packUnitForSku(sku);
  return `${packSizeForSku(sku)} ${unit === 'PC' ? 'Pieces' : unit === 'CT' ? 'Count' : packSizeForSku(sku) === 1 ? 'Bead' : 'Beads'}`;
}
function onePackSkuFor(etsySku: string, listingId: string, title: string) {
  const normalized = normalizeSku(etsySku) || normalizeSku(`ETSY-${listingId}`) || normalizeSku(title) || `ETSY-${listingId}`;
  if (/-\d{1,3}PK$/i.test(normalized)) return normalized.replace(/-\d{1,3}PK$/i, '-1PK');
  return /-\d{1,3}(?:PC|CT)$/i.test(normalized) ? `${normalized}-1PK` : normalized;
}
function etsyFamilyBaseSku(sku: string) {
  return normalizeSku(sku).replace(/(?:-\d{1,3}PK|-\d{1,3}(?:PC|CT))+$/i, '');
}
function orderEtsyVariantRows(variants: { sku: string; price: number; quantity: number; label: string }[]) {
  const familyOrder = new Map<string, number>();
  variants.forEach((variant) => {
    const family = etsyFamilyBaseSku(variant.sku);
    if (!familyOrder.has(family)) familyOrder.set(family, familyOrder.size);
  });
  return [...variants].sort((left, right) => {
    const familyDifference = (familyOrder.get(etsyFamilyBaseSku(left.sku)) || 0) - (familyOrder.get(etsyFamilyBaseSku(right.sku)) || 0);
    if (familyDifference) return familyDifference;
    const packDifference = packSizeForSku(left.sku) - packSizeForSku(right.sku);
    if (packDifference) return packDifference;
    return normalizeSku(left.sku).localeCompare(normalizeSku(right.sku), undefined, { numeric: true });
  });
}
function listingSkuFrom(listing: Record<string, any>, detail: Record<string, any>) {
  const inventory = detail.inventory || listing.inventory || {};
  const products = list(inventory.products);
  const candidate = products.map((product) => {
    const offerings = list(product.offerings);
    return product.sku || product.SKU || offerings[0]?.sku || offerings[0]?.SKU;
  }).find((value) => String(value || '').trim()) || detail.sku || detail.listing_sku || listing.sku || listing.listing_sku;
  return String(candidate || '').trim() || `ETSY-${String(detail.listing_id || listing.listing_id || listing.id || '').trim()}`;
}
function listingVariantsFrom(listing: Record<string, any>, detail: Record<string, any>) {
  const inventory = detail.inventory || listing.inventory || {};
  const products = list(inventory.products);
  const variants = products.map((product) => {
    const offerings = list(product.offerings);
    const sku = cleanText(product.sku || product.SKU || offerings[0]?.sku || offerings[0]?.SKU || (products.length === 1 ? detail.sku || detail.listing_sku || listing.sku || listing.listing_sku : '')).trim();
    if (!sku) return null;
    const price = Math.max(0, money(offerings[0]?.price || detail.price || listing.price));
    const rawQuantity = Number(offerings[0]?.quantity ?? detail.quantity ?? listing.quantity ?? 0);
    const propertyValues = list(product.property_values);
    const propertyLabel = propertyValues.flatMap((property) => list(property.values || property.value || property.value_names)).map((value) => cleanText(value)).filter(Boolean).join(' / ');
    const label = propertyLabel || packChoiceLabel(sku);
    return { sku, price, quantity: Number.isFinite(rawQuantity) ? Math.max(0, Math.floor(rawQuantity)) : 0, label };
  }).filter(Boolean) as { sku: string; price: number; quantity: number; label: string }[];
  if (products.length && variants.length !== products.length) {
    detail.variant_data_incomplete = true;
    return [];
  }
  if (variants.length) return variants;
  const sku = cleanText(detail.sku || detail.listing_sku || listing.sku || listing.listing_sku || '').trim();
  if (!sku) return [];
  const price = Math.max(0, money(detail.price || listing.price));
  const quantity = Number(detail.quantity ?? listing.quantity ?? 0);
  return [{ sku, price, quantity: Number.isFinite(quantity) ? Math.max(0, Math.floor(quantity)) : 0, label: packChoiceLabel(sku) }];
}
function listingPriceFrom(listing: Record<string, any>, detail: Record<string, any>) {
  const inventory = detail.inventory || listing.inventory || {};
  const products = list(inventory.products);
  const offerings = products.flatMap((product) => list(product.offerings));
  return Math.max(0, money(detail.price || listing.price || offerings[0]?.price));
}
function listingQuantityFrom(listing: Record<string, any>, detail: Record<string, any>) {
  const inventory = detail.inventory || listing.inventory || {};
  const products = list(inventory.products);
  const offerings = products.flatMap((product) => list(product.offerings));
  const quantity = Number(detail.quantity ?? listing.quantity ?? offerings[0]?.quantity ?? 0);
  return Number.isFinite(quantity) ? Math.max(0, Math.floor(quantity)) : 0;
}
function listingImagesFrom(listing: Record<string, any>, detail: Record<string, any>) {
  const sources = [...list(detail.images), ...list(listing.images)];
  const urls = sources.map((image) => String(image.url_fullxfull || image.url_570xN || image.url_170x135 || image.url_75x75 || image.url || '').trim()).filter(Boolean);
  return [...new Set(urls)].slice(0, 20);
}
function listingValues(value: unknown) {
  return Array.isArray(value) ? value.map((item) => typeof item === 'string' ? item : item && typeof item === 'object' ? String((item as Record<string, any>).name || '') : '').map((item) => item.trim()).filter(Boolean) : [];
}
function listingCategoryFrom(listing: Record<string, any>, detail: Record<string, any>, available: Set<string>) {
  const text = [detail.title, detail.description, detail.category_path, detail.taxonomy_path, listing.title, listing.description, listing.category_path, listing.taxonomy_path, ...listingValues(detail.tags), ...listingValues(listing.tags), ...listingValues(detail.materials), ...listingValues(listing.materials)].filter(Boolean).join(' ').toLowerCase();
  const beadLike = /\bbeads?\b/i.test(text);
  const candidates: [string, string[]][] = [
    ['mixes-bundles-kits', ['bundle', 'kit', 'mix', 'assort']],
    ['silicone', ['silicone']],
    ['rhinestone-beads', ['rhinestone']],
    ['focal-beads', ['focal bead', 'focal']],
    ['acrylic', ['acrylic', 'bubblegum', 'resin']],
    ['spacers-accessories', ['spacer', 'bead cap', 'lentil', 'abacus']],
    ['beadable-pen-blanks', beadLike ? [] : ['pen blank', 'pen base', 'beadable pen']],
    ['completed-pens-keychains', beadLike ? [] : ['finished keychain', 'assembled keychain', 'completed pen', 'finished pen', 'ready to ship']],
    ['acrylic-flatbacks', ['flatback', 'flat back']],
    ['rhinestone-beads', ['rhinestone']],
    ['cup-charms', ['cup charm', 'tumbler charm']],
    ['charms-dangles', ['charm', 'dangle']],
    ['spacers-accessories', ['accessor']]
  ];
  return candidates.find(([slug, words]) => available.has(slug) && words.some((word) => text.includes(word)))?.[0] || 'uncategorized';
}
async function findOrCreateInventorySku(sku: string, payload: Record<string, unknown>, cache?: Map<string, Record<string, any>>) {
  const cacheKey = normalizeSku(sku);
  const cached = cache?.get(cacheKey);
  if (cached) return cached;
  const caseVariants = [...new Set([cacheKey, cacheKey.toLowerCase()])];
  const skuFilter = caseVariants.map((value) => encodeURIComponent(value)).join(',');
  const existing = await database(`inventory_skus?sku=in.(${skuFilter})&select=id,sku,item_type,hierarchy,created_at,source_metadata&limit=2`);
  if (existing.length > 1) throw new Error(`Inventory SKU ${cacheKey} exists with multiple letter-case variants; no duplicate product page was created.`);
  if (existing[0]) {
    cache?.set(cacheKey, existing[0]);
    return existing[0];
  }
  try {
    const inserted = await database('inventory_skus', 'POST', payload);
    if (inserted[0]) {
      inserted[0].created_at = inserted[0].created_at || new Date().toISOString();
      cache?.set(cacheKey, inserted[0]);
    }
    return inserted[0];
  } catch (error) {
    const raced = await database(`inventory_skus?sku=in.(${skuFilter})&select=id,sku,item_type,hierarchy,created_at,source_metadata&limit=2`);
    if (raced.length > 1) throw new Error(`Inventory SKU ${cacheKey} exists with multiple letter-case variants; no duplicate product page was created.`);
    if (raced[0]) {
      cache?.set(cacheKey, raced[0]);
      return raced[0];
    }
    throw error;
  }
}
async function preloadInventorySkus(skus: string[]) {
  const values = [...new Set(skus.map((sku) => normalizeSku(sku)).filter(Boolean))];
  const cache = new Map<string, Record<string, any>>();
  for (let start = 0; start < values.length; start += 100) {
    const chunk = values.slice(start, start + 100);
    const caseVariants = [...new Set(chunk.flatMap((sku) => [sku, sku.toLowerCase()]))];
    const rows = await database(`inventory_skus?sku=in.(${caseVariants.map((sku) => encodeURIComponent(sku)).join(',')})&select=id,sku,item_type,hierarchy,created_at,source_metadata&limit=${caseVariants.length}`);
    rows.forEach((row: Record<string, any>) => {
      const key = normalizeSku(row.sku);
      const existing = cache.get(key);
      if (existing && String(existing.id) !== String(row.id)) throw new Error(`Inventory SKU ${key} exists with multiple letter-case variants; no duplicate product page was created.`);
      cache.set(key, row);
    });
  }
  return cache;
}
function inventorySkuExistedBeforeRun(cache: Map<string, Record<string, any>>, sku: string, runStartedAt: string) {
  const row = cache.get(normalizeSku(sku));
  const createdAt = Date.parse(String(row?.created_at || ''));
  const startedAt = Date.parse(runStartedAt);
  return Boolean(row && Number.isFinite(createdAt) && Number.isFinite(startedAt) && createdAt < startedAt);
}
async function findExistingProductByEtsySkus(skus: string[]) {
  const expectedSkus = [...new Set(skus.map((sku) => normalizeSku(sku)).filter(Boolean))].sort();
  if (!expectedSkus.length) return { product: null, ambiguous: false };
  const querySkus = [...new Set(expectedSkus.flatMap((sku) => [sku, sku.toLowerCase()]))];
  const filter = querySkus.map((sku) => encodeURIComponent(sku)).join(',');
  const [skuRows, inventorySkuRows, productSkuRows, productExternalIdRows, inventoryRows, mappingRows] = await Promise.all([
    database(`product_option_values?sku=in.(${filter})&select=option_id&limit=1000`),
    database(`product_option_values?inventory_sku=in.(${filter})&select=option_id&limit=1000`),
    database(`products?sku=in.(${filter})&select=id,sku,external_id,name,etsy_listing_id&limit=1000`),
    database(`products?external_id=in.(${filter})&select=id,sku,external_id,name,etsy_listing_id&limit=1000`),
    database(`inventory_skus?sku=in.(${filter})&select=id,sku&limit=1000`),
    database(`product_etsy_mappings?etsy_sku=in.(${filter})&select=product_id,etsy_sku,inventory_sku,inventory_sku_id&limit=1000`)
  ]);
  const inventoryIds = [...new Set(inventoryRows.map((row: Record<string, any>) => String(row.id || '')).filter(Boolean))];
  const inventoryIdOptionRows = inventoryIds.length
    ? await database(`product_option_values?inventory_sku_id=in.(${inventoryIds.map(encodeURIComponent).join(',')})&select=option_id&limit=1000`)
    : [];
  const optionIds = [...new Set([...skuRows, ...inventorySkuRows, ...inventoryIdOptionRows].map((row: Record<string, any>) => String(row.option_id || '')).filter(Boolean))];
  const matchingOptions = optionIds.length
    ? await database(`product_options?id=in.(${optionIds.map(encodeURIComponent).join(',')})&name=eq.SKU&select=id,product_id&limit=1000`)
    : [];
  const productIds = [...new Set([
    ...matchingOptions.map((option: Record<string, any>) => String(option.product_id || '')),
    ...productSkuRows.map((product: Record<string, any>) => String(product.id || '')),
    ...productExternalIdRows.map((product: Record<string, any>) => String(product.id || '')),
    ...mappingRows.map((mapping: Record<string, any>) => String(mapping.product_id || ''))
  ].filter(Boolean))];
  if (!productIds.length) return { product: null, ambiguous: false };
  const products = await database(`products?id=in.(${productIds.map(encodeURIComponent).join(',')})&select=id,sku,external_id,name,etsy_listing_id&limit=1000`);
  const productsById = new Map(products.map((product: Record<string, any>) => [String(product.id), product]));
  const skuOptions = await database(`product_options?product_id=in.(${productIds.map(encodeURIComponent).join(',')})&name=eq.SKU&select=id,product_id&limit=1000`);
  const productIdByOption = new Map(skuOptions.map((option: Record<string, any>) => [String(option.id), String(option.product_id)]));
  const inventorySkuById = new Map(inventoryRows.map((row: Record<string, any>) => [String(row.id), normalizeSku(row.sku)]));
  const optionIdsForProducts = skuOptions.map((option: Record<string, any>) => String(option.id)).filter(Boolean);
  const optionValues = optionIdsForProducts.length
    ? await database(`product_option_values?option_id=in.(${optionIdsForProducts.map(encodeURIComponent).join(',')})&select=option_id,sku,inventory_sku,inventory_sku_id&limit=5000`)
    : [];
  const skusByProduct = new Map<string, Set<string>>();
  optionValues.forEach((value: Record<string, any>) => {
    const productId = productIdByOption.get(String(value.option_id || ''));
    if (!productId) return;
    const productSkus = skusByProduct.get(productId) || new Set<string>();
    [value.sku, value.inventory_sku, inventorySkuById.get(String(value.inventory_sku_id || ''))].map(normalizeSku).filter(Boolean).forEach((sku) => productSkus.add(sku));
    skusByProduct.set(productId, productSkus);
  });
  mappingRows.forEach((mapping: Record<string, any>) => {
    const productId = String(mapping.product_id || '');
    if (!productId) return;
    const productSkus = skusByProduct.get(productId) || new Set<string>();
    [mapping.etsy_sku, mapping.inventory_sku, inventorySkuById.get(String(mapping.inventory_sku_id || ''))].map(normalizeSku).filter(Boolean).forEach((sku) => productSkus.add(sku));
    skusByProduct.set(productId, productSkus);
  });
  products.forEach((product: Record<string, any>) => {
    const productSkus = skusByProduct.get(String(product.id)) || new Set<string>();
    [product.sku, product.external_id].map(normalizeSku).filter(Boolean).forEach((sku) => productSkus.add(sku));
    skusByProduct.set(String(product.id), productSkus);
  });
  const expected = new Set(expectedSkus);
  const candidates = products.filter((product: Record<string, any>) => {
    const existingSkus = skusByProduct.get(String(product.id)) || new Set<string>();
    return [...expected].every((sku) => existingSkus.has(sku));
  });
  const skuOwners = new Map<string, Set<string>>();
  products.forEach((product: Record<string, any>) => {
    const productId = String(product.id);
    const existingSkus = skusByProduct.get(productId) || new Set<string>();
    expected.forEach((sku) => {
      if (!existingSkus.has(sku)) return;
      const owners = skuOwners.get(sku) || new Set<string>();
      owners.add(productId);
      skuOwners.set(sku, owners);
    });
  });
  const duplicateSkuOwnership = [...skuOwners.values()].some((owners) => owners.size > 1);
  if (candidates.length === 1 && !duplicateSkuOwnership) return { product: candidates[0], ambiguous: false };
  if (candidates.length > 1 || duplicateSkuOwnership) return { product: null, ambiguous: true };
  const partialOwners = new Set([...skuOwners.values()].flatMap((owners) => [...owners]));
  if (partialOwners.size === 1 && [...skuOwners.values()].every((owners) => owners.size === 1)) {
    const product = productsById.get([...partialOwners][0]);
    if (product) return { product, ambiguous: false };
  }
  if (skuOwners.size > 0) return { product: null, ambiguous: true };
  return { product: null, ambiguous: false };
}
async function ensurePhysicalInventorySku(row: Record<string, any>, listingId: string) {
  const itemType = String(row.item_type || '').trim().toLowerCase();
  const hierarchy = String(row.hierarchy || '').trim().toLowerCase();
  const metadata = row.source_metadata && typeof row.source_metadata === 'object' ? row.source_metadata : {};
  const ownedByListing = metadata.source === 'etsy_listing' && String(metadata.etsy_listing_id || '') === listingId;
  const updates: Record<string, unknown> = {};
  if (itemType !== 'inventory' || hierarchy !== 'single') {
    if (!ownedByListing) throw new Error(`SKU ${row.sku} already exists but is not verified as this listing's physical inventory child; it was left unchanged.`);
    updates.item_type = 'inventory';
    updates.hierarchy = 'single';
  }
  if (ownedByListing && !String(metadata.disposition || '').trim()) updates.source_metadata = { ...metadata, disposition: 'inventory' };
  if (Object.keys(updates).length) {
    await database(`inventory_skus?id=eq.${encodeURIComponent(String(row.id))}`, 'PATCH', updates, 'return=minimal');
    return { ...row, ...updates };
  }
  return row;
}
async function ensureEtsyRecipe(parent: Record<string, any>, child: Record<string, any>, packSize: number) {
  if (!parent?.id || !child?.id || packSize <= 1) return { created: false, components: [] as { sku: string; quantity: number }[] };
  const existing = await database(`inventory_bundle_components?bundle_sku_id=eq.${encodeURIComponent(String(parent.id))}&select=component_sku_id,quantity,sort_order&order=sort_order.asc`);
  if (!existing.length) {
    await database('inventory_bundle_components?on_conflict=bundle_sku_id,component_sku_id', 'POST', [{ bundle_sku_id: parent.id, component_sku_id: child.id, quantity: packSize, sort_order: 0 }], 'resolution=merge-duplicates,return=minimal');
    return { created: true, components: [{ sku: String(child.sku), quantity: packSize }] };
  }
  const componentIds = [...new Set(existing.map((row: Record<string, any>) => String(row.component_sku_id || '')).filter(Boolean))];
  const componentRows = componentIds.length ? await database(`inventory_skus?id=in.(${componentIds.map((id) => encodeURIComponent(id)).join(',')})&select=id,sku`) : [];
  const componentById = new Map(componentRows.map((row: Record<string, any>) => [String(row.id), String(row.sku || '')]));
  return {
    created: false,
    components: existing.map((row: Record<string, any>) => ({ sku: componentById.get(String(row.component_sku_id || '')) || String(row.component_sku_id || ''), quantity: Math.max(1, Number(row.quantity) || 1) }))
  };
}
async function upsertEtsyProductOptionValue(optionId: string, variant: { sku: string; price: number; quantity: number; label: string }, parent: Record<string, any>, child: Record<string, any>, listingPrice: number, imageUrl: string, sortOrder: number, existingOptionValues: Record<string, any>[], preserveExisting = false) {
  if (!optionId || !parent?.id) return;
  const parentSku = normalizeSku(parent.sku || variant.sku);
  const childSku = normalizeSku(child?.sku || '');
  const packSize = packSizeForSku(String(variant.sku || parent.sku || ''));
  const existingParent = existingOptionValues.find((row) => String(row.inventory_sku_id || '') === String(parent.id) || normalizeSku(row.inventory_sku || row.sku) === parentSku);
  const existingChild = existingOptionValues.find((row) => childSku && normalizeSku(row.inventory_sku || row.sku) === childSku);
  const existing = packSize === 1 ? existingParent || existingChild : existingParent;
  const payload = {
    option_id: optionId,
    label: variant.label || packChoiceLabel(String(variant.sku || parent.sku || '')),
    price_delta: Number(variant.price) - Number(listingPrice),
    sku: String(parent.sku || variant.sku).trim(),
    inventory_sku: String(parent.sku || variant.sku).trim(),
    inventory_sku_id: parent.id,
    inventory_units: 1,
    quantity: Math.max(0, Number(parent.quantity_on_hand ?? variant.quantity) || 0),
    low_stock_threshold: Math.max(0, Number(parent.reorder_point) || 0),
    unit_type: String(parent.unit_type || 'Each').trim() || 'Each',
    image_url: imageUrl || null,
    sort_order: sortOrder
  };
  if (existing?.id) {
    if (preserveExisting) return;
    await database(`product_option_values?id=eq.${encodeURIComponent(String(existing.id))}`, 'PATCH', payload, 'return=minimal');
    Object.assign(existing, payload);
  } else {
    const inserted = await database('product_option_values', 'POST', payload);
    if (inserted[0]) existingOptionValues.push(inserted[0]);
  }
}
async function syncMissingEtsyProductData(productId: string, values: { listingId: string; title: string; description: string; categorySlug: string; tags: string[]; materials: string[] }) {
  const currentRows = await database(`products?id=eq.${encodeURIComponent(productId)}&select=etsy_listing_id,category_slug,seo_title,short_description,description,item_details&limit=1`);
  const current = currentRows[0];
  if (!current) return;
  const updates: Record<string, unknown> = {};
  if (!current.etsy_listing_id) updates.etsy_listing_id = Number(values.listingId);
  if ((!current.category_slug || current.category_slug === 'uncategorized') && values.categorySlug !== 'uncategorized') updates.category_slug = values.categorySlug;
  if (!String(current.seo_title || '').trim()) updates.seo_title = values.title;
  if (!String(current.short_description || '').trim() && values.description) updates.short_description = values.description.slice(0, 240);
  if (!String(current.description || '').trim() && values.description) updates.description = values.description;
  if (!String(current.item_details || '').trim()) updates.item_details = `Imported from Etsy listing ${values.listingId}. Tags: ${values.tags.join(', ') || 'None'}. Materials: ${values.materials.join(', ') || 'None'}.`;
  if (Object.keys(updates).length) await database(`products?id=eq.${encodeURIComponent(productId)}`, 'PATCH', updates, 'return=minimal');
}
async function ensureEtsyProductImages(productId: string, images: string[], title: string) {
  if (!images.length) return;
  const existing = await database(`product_images?product_id=eq.${encodeURIComponent(productId)}&select=id&limit=1`);
  if (existing.length) return;
  await database('product_images', 'POST', images.map((url, index) => ({ product_id: productId, url, alt_text: title, sort_order: index, media_type: /\.(mp4|m4v|webm|mov|ogv)(?:[?#].*)?$/i.test(url) ? 'video' : 'image' })), 'return=minimal');
}
async function fetchEtsyListingDetail(connection: Record<string, any>, listing: Record<string, any>) {
  const listingId = String(listing.listing_id || listing.id || '').trim();
  if (!listingId) throw new Error('Etsy returned a listing without an ID.');
  const detail = await etsy(`listings/${encodeURIComponent(listingId)}?includes=Images,Translations`, connection.access_token);
  if (!Array.isArray(detail.inventory?.products)) {
    try { detail.inventory = await etsy(`listings/${encodeURIComponent(listingId)}/inventory`, connection.access_token); }
    catch (error) { detail.inventory_fetch_error = error instanceof Error ? error.message : 'Etsy inventory could not be verified.'; }
  }
  if (!list(detail.images).length) {
    try { detail.images = list((await etsy(`listings/${encodeURIComponent(listingId)}/images`, connection.access_token))?.results); } catch { detail.images = []; }
  }
  return detail;
}
async function importEtsyListing(connection: Record<string, any>, batchId: string | undefined, listing: Record<string, any>, detail: Record<string, any>, availableCategories: Set<string>, runStartedAt: string, existingOnly = false) {
  const listingId = String(detail.listing_id || listing.listing_id || listing.id || '').trim();
  if (detail.inventory_fetch_error) throw new Error(`Etsy inventory for listing ${listingId} could not be verified. No SKU family was changed. ${detail.inventory_fetch_error}`);
  const title = cleanText(detail.title || listing.title || `Etsy listing ${listingId}`).trim();
  // Imported pages intentionally start as an exact Etsy copy. Admins can
  // shorten or rewrite the title after opening the product editor.
  const productName = cleanText(title).trim() || productNameFromListing(title, listingId);
  const description = cleanText(detail.description || listing.description || '').trim();
  const etsySku = cleanText(listingSkuFrom(listing, detail)).trim();
  const canonicalEtsySku = normalizeSku(etsySku) || `ETSY-${listingId}`;
  const variantRows = listingVariantsFrom(listing, detail);
  const orderedVariantRows = orderEtsyVariantRows(variantRows);
  if (detail.variant_data_incomplete) throw new Error(`Etsy returned incomplete SKU data for listing ${listingId}; no SKU family was changed.`);
  if (!orderedVariantRows.length) throw new Error(`Etsy returned no explicit SKU variants for listing ${listingId}; no SKU or product page was created.`);
  const uniqueVariantSkus = new Set(orderedVariantRows.map((variant) => normalizeSku(variant.sku)));
  if (uniqueVariantSkus.size !== orderedVariantRows.length) throw new Error(`Etsy returned the same SKU more than once for listing ${listingId}; no family changes were made.`);
  const variantSkus = [...new Set(orderedVariantRows.map((variant) => normalizeSku(variant.sku)).filter(Boolean))];
  const oneSku = onePackSkuFor(canonicalEtsySku, listingId, title);
  const inventoryCache = await preloadInventorySkus([...variantRows.flatMap((variant) => [variant.sku, onePackSkuFor(variant.sku, listingId, title)]), canonicalEtsySku, oneSku]);
  const packSize = packSizeForSku(canonicalEtsySku);
  const listingPrice = listingPriceFrom(listing, detail);
  const unitPrice = packSize > 1 ? Math.round((listingPrice / packSize) * 100) / 100 : listingPrice;
  const quantity = listingQuantityFrom(listing, detail);
  const categorySlug = listingCategoryFrom(listing, detail, availableCategories);
  const optionOrder = new Map<string, number>();
  const addOptionOrder = (sku: string) => {
    const normalized = normalizeSku(sku);
    if (normalized && !optionOrder.has(normalized)) optionOrder.set(normalized, optionOrder.size);
  };
  orderedVariantRows.forEach((variant) => {
    const variantCanonical = normalizeSku(variant.sku);
    const variantOneSku = onePackSkuFor(variantCanonical, listingId, title);
    addOptionOrder(variantCanonical);
  });
  const recipeText = [title, description, etsySku, detail.category_path, detail.taxonomy_path, listing.category_path, listing.taxonomy_path].filter(Boolean).join(' ');
  // A pack SKU has a deterministic physical 1PK child. Create that recipe
  // automatically when it is missing, while preserving any recipe an admin
  // already edited for a mixed or special listing.
  const manualRecipeRequired = false;
  const images = listingImagesFrom(listing, detail);
  const tags = listingValues(detail.tags).map(cleanText).slice(0, 40);
  const materials = listingValues(detail.materials).map(cleanText).slice(0, 40);
  const existingByListing = await database(`products?etsy_listing_id=eq.${encodeURIComponent(listingId)}&select=id,external_id,name,category_slug,seo_title,short_description,description&limit=1`);
  let product = existingByListing[0];
  let created = false;
  let productMatchedByExistingSkuSet = false;
  if (existingOnly && !product?.id) throw new Error(`No existing product page is linked to Etsy listing ${listingId}; repair stopped without creating a page.`);
  // Incremental scans skip known Etsy listing IDs; this branch is also used by
  // the explicit, page-preserving repair action for previously imported pages.
  if (product?.id) {
    // Older importer runs stored Etsy's keyword-heavy title as the internal
    // product name. Repair that specific shape on the next scan while keeping
    // the full title in seo_title for search/display metadata.
    const productRepair: Record<string, unknown> = {};
    if (!existingOnly && String(product.category_slug || '').trim() !== categorySlug) productRepair.category_slug = categorySlug;
    if (!existingOnly && String(product.seo_title || '').trim() !== title) productRepair.seo_title = title;
    if (!existingOnly && (String(product.name || '').trim() === title || !String(product.name || '').trim())) productRepair.name = productName;
    // Preserve an admin's edits, but backfill missing copy from Etsy so an
    // older staged page does not render an empty product-description panel.
    if (!existingOnly && description && !String(product.short_description || '').trim()) productRepair.short_description = description.slice(0, 240);
    if (!existingOnly && description && !String(product.description || '').trim()) productRepair.description = description;
    if (Object.keys(productRepair).length) await database(`products?id=eq.${encodeURIComponent(String(product.id))}`, 'PATCH', productRepair, 'return=minimal');
    // Etsy can store several pack SKUs under one listing. Older imports only
    // read the first inventory product, so audit an existing page and add any
    // additional physical child/parent/recipe/mapping rows that are present.
    const existingOption = await database(`product_options?product_id=eq.${encodeURIComponent(String(product.id))}&name=eq.SKU&select=id&limit=1`);
    const option = existingOption[0] || (await database('product_options', 'POST', { product_id: product.id, name: 'SKU', required: true, sort_order: 0 }))[0];
    const existingOptionValues = option?.id ? await database(`product_option_values?option_id=eq.${encodeURIComponent(String(option.id))}&select=id,inventory_sku_id,sku,inventory_sku,sort_order&limit=500`) : [];
    const existingMappings = await database(`product_etsy_mappings?product_id=eq.${encodeURIComponent(String(product.id))}&select=id,etsy_sku&limit=500`);
    const mappingsBySku = new Map(existingMappings.map((row: Record<string, any>) => [normalizeSku(row.etsy_sku), row]));
    let repaired = !existingOption[0];
    const family = orderedVariantRows.map((variant) => {
      const variantCanonical = normalizeSku(variant.sku) || `ETSY-${listingId}`;
      const variantOneSku = onePackSkuFor(variantCanonical, listingId, title);
      const variantPackSize = packSizeForSku(variantCanonical);
      const onePkExistedBeforeRun = inventorySkuExistedBeforeRun(inventoryCache, variantOneSku, runStartedAt);
      const packExistedBeforeRun = inventorySkuExistedBeforeRun(inventoryCache, variantCanonical, runStartedAt);
      return { etsy_sku: variantCanonical, one_pk_sku: variantOneSku, pack_size: variantPackSize, label: variant.label, quantity: variant.quantity, manual_recipe_required: false, recipe_components: [], recipe_created: false, sku_existed: onePkExistedBeforeRun || packExistedBeforeRun, one_pk_sku_existed: onePkExistedBeforeRun, pack_sku_existed: packExistedBeforeRun, sku_existed_before_run: onePkExistedBeforeRun || packExistedBeforeRun, one_pk_sku_existed_before_run: onePkExistedBeforeRun, pack_sku_existed_before_run: packExistedBeforeRun };
    });
    // Repair every Etsy variation, including the first one. Older imports
    // could leave the first 1PK/parent pair incomplete, and skipping index 0
    // made that state permanent on every later scan.
    for (const variant of orderedVariantRows) {
      const variantCanonical = normalizeSku(variant.sku);
      if (!variantCanonical) continue;
      const variantOneSku = onePackSkuFor(variantCanonical, listingId, title);
      const variantPackSize = packSizeForSku(variantCanonical);
      const variantRecipeText = [title, description, variantCanonical, detail.category_path, detail.taxonomy_path].filter(Boolean).join(' ');
      const oneSkuExisted = inventorySkuExistedBeforeRun(inventoryCache, variantOneSku, runStartedAt);
      const packSkuExisted = inventorySkuExistedBeforeRun(inventoryCache, variantCanonical, runStartedAt);
      const variantChild = await findOrCreateInventorySku(variantOneSku, { sku: variantOneSku, name: productName, variant_name: '1PK', quantity_on_hand: variant.quantity * variantPackSize, reorder_point: 0, item_type: 'inventory', hierarchy: 'single', category: categorySlug, price: variantPackSize > 1 ? Math.round((variant.price / variantPackSize) * 100) / 100 : variant.price, unit_type: 'Each', source_system: 'etsy-import', source_metadata: { source: 'etsy_listing', etsy_listing_id: listingId, etsy_sku: variantCanonical, pack_size: 1, disposition: 'inventory', imported_quantity: variant.quantity * variantPackSize, imported_at: new Date().toISOString() } }, inventoryCache);
      const physicalChild = await ensurePhysicalInventorySku(variantChild, listingId);
      const variantParent = await findOrCreateInventorySku(variantCanonical, { sku: variantCanonical, name: productName, variant_name: packVariantLabel(variantCanonical), quantity_on_hand: variant.quantity, reorder_point: 0, item_type: 'non-inventory', hierarchy: 'parent', category: categorySlug, price: variant.price, unit_type: 'Each', source_system: 'etsy-import', source_metadata: { source: 'etsy_listing', etsy_listing_id: listingId, etsy_sku: variantCanonical, pack_size: variantPackSize, imported_quantity: variant.quantity, imported_at: new Date().toISOString() } }, inventoryCache);
      const recipe = await ensureEtsyRecipe(variantParent, physicalChild, variantPackSize);
      if (!oneSkuExisted || !packSkuExisted || recipe.created) repaired = true;
      const familyRow = family.find((entry) => entry.etsy_sku === variantCanonical);
      if (familyRow) {
        familyRow.recipe_components = recipe.components;
        familyRow.recipe_created = recipe.created;
        familyRow.sku_existed = oneSkuExisted || packSkuExisted;
        familyRow.one_pk_sku_existed = oneSkuExisted;
        familyRow.pack_sku_existed = packSkuExisted;
        familyRow.sku_existed_before_run = oneSkuExisted || packSkuExisted;
        familyRow.one_pk_sku_existed_before_run = oneSkuExisted;
        familyRow.pack_sku_existed_before_run = packSkuExisted;
      }
      if (option?.id) {
        const optionValueCount = existingOptionValues.length;
        await upsertEtsyProductOptionValue(option.id, variant, variantParent, physicalChild, listingPrice, images[0] || '', optionOrder.get(variantCanonical) || 0, existingOptionValues, existingOnly);
        if (existingOptionValues.length > optionValueCount) repaired = true;
      }
      const existingMapping = mappingsBySku.get(variantCanonical);
      const variantMapping = existingMapping || (await database('product_etsy_mappings', 'POST', { product_id: product.id, etsy_sku: variantCanonical, inventory_sku: variantOneSku, inventory_sku_id: physicalChild.id, inventory_units: Math.max(1, variantPackSize), active: true, sort_order: optionOrder.get(variantCanonical) || 0 }))[0];
      if (!existingMapping && variantMapping?.id) repaired = true;
      if (variantMapping?.id) mappingsBySku.set(variantCanonical, variantMapping);
      if (variantMapping?.id) await database('product_etsy_mapping_components?on_conflict=mapping_id,inventory_sku_id', 'POST', [{ mapping_id: variantMapping.id, inventory_sku_id: physicalChild.id, inventory_sku: variantOneSku, inventory_units: Math.max(1, variantPackSize), sort_order: 0 }], 'resolution=merge-duplicates,return=minimal');
    }
    const existingListingRows = await database(`etsy_import_listings?external_listing_id=eq.${encodeURIComponent(listingId)}&select=id,raw_payload&limit=1`);
    if (existingListingRows[0]) {
      const existingRaw = existingListingRows[0].raw_payload && typeof existingListingRows[0].raw_payload === 'object' ? existingListingRows[0].raw_payload : {};
      const variantPayload = variantRows.length ? { variant_skus: family.map((variant) => variant.etsy_sku), variants: family } : {};
      await database(`etsy_import_listings?id=eq.${encodeURIComponent(String(existingListingRows[0].id))}`, 'PATCH', { proposed_product_name: productName, proposed_product_sku: etsySku, proposed_single_sku: oneSku, proposed_product_id: product.id, raw_payload: { ...existingRaw, listing_id: listingId, title, description, sku: etsySku, ...variantPayload, one_pk_sku: oneSku, price: listingPrice, quantity, category_slug: categorySlug, updated_timestamp: detail.updated_timestamp || listing.updated_timestamp || null }, updated_at: new Date().toISOString() }, 'return=minimal');
    } else {
      const rawPayload = { listing_id: listingId, title, description, sku: etsySku, variant_skus: family.map((variant) => variant.etsy_sku), variants: family, one_pk_sku: oneSku, price: listingPrice, quantity, category_slug: categorySlug, images, url: detail.url || listing.url || null, updated_timestamp: detail.updated_timestamp || listing.updated_timestamp || null };
      await database('etsy_import_listings', 'POST', { batch_id: batchId, external_listing_id: listingId, title, proposed_product_name: productName, proposed_product_sku: etsySku, proposed_single_sku: oneSku, proposed_product_id: product.id, review_status: 'pending', raw_payload: rawPayload, updated_at: new Date().toISOString() }, 'return=minimal');
    }
    if (!existingOnly) await ensureEtsyProductImages(String(product.id), images, title);
    const productUrl = `admin.html?edit=${encodeURIComponent(product.id)}`;
    const onePkUrl = `admin.html?inventory=sku&sku=${encodeURIComponent(oneSku)}`;
    const packSkuUrl = canonicalEtsySku !== oneSku ? `admin.html?inventory=sku&sku=${encodeURIComponent(canonicalEtsySku)}` : null;
    const recipeUrl = canonicalEtsySku !== oneSku ? `admin.html?inventory=adjust&recipe=${encodeURIComponent(canonicalEtsySku)}` : null;
    return { listing_id: listingId, product_id: product.id, product_name: productName, etsy_title: title, etsy_sku: etsySku, one_pk_sku: oneSku, pack_size: packSize, family_skus: family, created: false, repaired, product_page_existed: true, quantity, manual_recipe_required: false, url: productUrl, links: { product: productUrl, one_pk_sku: onePkUrl, pack_sku: packSkuUrl, recipe: recipeUrl } };
  }
  if (!product) {
    const existingBySku = await database(`products?external_id=eq.${encodeURIComponent(oneSku)}&select=id,external_id,etsy_listing_id,name&limit=2`);
    if (existingBySku.length > 1) throw new Error(`Etsy listing ${listingId} matches multiple existing product pages by SKU; no duplicate page was created.`);
    if (existingBySku[0]) {
      if (existingBySku[0].etsy_listing_id && String(existingBySku[0].etsy_listing_id) !== listingId) throw new Error(`Etsy SKU ${oneSku} is already attached to a different Etsy listing; no duplicate page was created.`);
      product = existingBySku[0];
      await syncMissingEtsyProductData(String(product.id), { listingId, title, description, categorySlug, tags, materials });
    }
    if (!product) {
      const skuMatch = await findExistingProductByEtsySkus(variantSkus.length ? variantSkus : [canonicalEtsySku]);
      if (skuMatch.ambiguous) throw new Error(`Etsy listing ${listingId} shares SKUs with existing product pages, but the complete SKU family does not identify one unambiguous canonical page; no duplicate page was created.`);
        if (skuMatch.product && skuMatch.product.etsy_listing_id && String(skuMatch.product.etsy_listing_id) !== listingId) throw new Error(`Etsy listing ${listingId} shares SKU records with a different Etsy listing; no duplicate product page was created.`);
        if (skuMatch.product) {
        product = skuMatch.product;
        productMatchedByExistingSkuSet = true;
        await syncMissingEtsyProductData(String(product.id), { listingId, title, description, categorySlug, tags, materials });
      }
    }
  }
  if (product?.id && productMatchedByExistingSkuSet) {
    await database(`products?id=eq.${encodeURIComponent(String(product.id))}`, 'PATCH', { etsy_listing_id: Number(listingId) }, 'return=minimal');
    return await importEtsyListing(connection, batchId, listing, detail, availableCategories, runStartedAt, true);
  }
  const familyRecipeBySku = new Map<string, { recipe_created: boolean; recipe_components: { sku: string; quantity: number }[]; one_pk_sku_existed: boolean; pack_sku_existed: boolean }>();
  const oneSkuExisted = inventorySkuExistedBeforeRun(inventoryCache, oneSku, runStartedAt);
  const packSkuExisted = inventorySkuExistedBeforeRun(inventoryCache, canonicalEtsySku, runStartedAt);
  const childPayload = { sku: oneSku, name: productName, variant_name: '1PK', quantity_on_hand: quantity * packSize, reorder_point: 0, item_type: 'inventory', hierarchy: 'single', category: categorySlug, price: unitPrice, unit_type: 'Each', source_system: 'etsy-import', source_metadata: { source: 'etsy_listing', etsy_listing_id: listingId, etsy_sku: etsySku, pack_size: 1, disposition: 'inventory', imported_quantity: quantity * packSize, imported_at: new Date().toISOString() } };
  let childInventory = await findOrCreateInventorySku(oneSku, childPayload, inventoryCache);
  let parentInventory = childInventory;
  if (canonicalEtsySku !== oneSku) {
    childInventory = await ensurePhysicalInventorySku(childInventory, listingId);
    parentInventory = await findOrCreateInventorySku(canonicalEtsySku, { sku: canonicalEtsySku, name: productName, variant_name: `${packSize}PK`, quantity_on_hand: quantity, reorder_point: 0, item_type: 'non-inventory', hierarchy: 'parent', category: categorySlug, price: listingPrice, unit_type: 'Each', source_system: 'etsy-import', source_metadata: { source: 'etsy_listing', etsy_listing_id: listingId, etsy_sku: etsySku, pack_size: packSize, imported_quantity: quantity, imported_at: new Date().toISOString() } }, inventoryCache);
    const recipe = await ensureEtsyRecipe(parentInventory, childInventory, packSize);
    familyRecipeBySku.set(canonicalEtsySku, { recipe_created: recipe.created, recipe_components: recipe.components, one_pk_sku_existed: oneSkuExisted, pack_sku_existed: packSkuExisted });
  } else {
    familyRecipeBySku.set(canonicalEtsySku, { recipe_created: false, recipe_components: [], one_pk_sku_existed: oneSkuExisted, pack_sku_existed: oneSkuExisted });
  }
  if (!product) {
    const initialSkuFilterDefinitions = [{ label: 'Quantity', options: Object.fromEntries(orderedVariantRows.map((variant) => [normalizeSku(variant.sku), variant.label || packChoiceLabel(variant.sku)])) }];
    const inserted = await database('products', 'POST', { external_id: oneSku, sku: oneSku, etsy_listing_id: Number(listingId), category_slug: categorySlug, name: productName, seo_title: title, short_description: description.slice(0, 240) || null, description: description || null, item_details: `Imported from Etsy listing ${listingId}. Tags: ${tags.join(', ') || 'None'}. Materials: ${materials.join(', ') || 'None'}.`, shipping_details: null, price: unitPrice, quantity: quantity * packSize, visible: false, waitlist_enabled: false, estimated_cost: 0, low_stock_threshold: 0, badges: [], promo_skus: [], etsy_units_per_sale: 1, sku_filter_definitions: initialSkuFilterDefinitions, featured: false, added_at: stamp(detail.created_timestamp || listing.created_timestamp) });
    product = inserted[0];
    created = true;
  }
  if (!product?.id) throw new Error(`Etsy listing ${listingId} could not create a product page.`);
  if (categorySlug !== 'uncategorized' && availableCategories.has(categorySlug)) await database('product_categories?on_conflict=product_id,category_slug', 'POST', [{ product_id: product.id, category_slug: categorySlug, sort_order: 0 }], 'resolution=merge-duplicates,return=minimal');
  const existingOption = await database(`product_options?product_id=eq.${encodeURIComponent(product.id)}&name=eq.SKU&select=id&limit=1`);
  const option = existingOption[0] || (await database('product_options', 'POST', { product_id: product.id, name: 'SKU', required: true, sort_order: 0 }))[0];
  if (!option?.id) throw new Error(`Etsy listing ${listingId} could not create its SKU option.`);
  const existingOptionValues = await database(`product_option_values?option_id=eq.${encodeURIComponent(option.id)}&select=id,inventory_sku_id,sku,inventory_sku,sort_order&limit=500`);
  const existingMappings = await database(`product_etsy_mappings?product_id=eq.${encodeURIComponent(product.id)}&select=id,etsy_sku&limit=500`);
  const mappingsBySku = new Map(existingMappings.map((row: Record<string, any>) => [normalizeSku(row.etsy_sku), row]));
  const primaryVariant = orderedVariantRows.find((variant) => normalizeSku(variant.sku) === normalizeSku(canonicalEtsySku)) || orderedVariantRows[0] || { sku: canonicalEtsySku, price: listingPrice, quantity, label: packChoiceLabel(canonicalEtsySku) };
  await upsertEtsyProductOptionValue(option.id, primaryVariant, parentInventory, childInventory, listingPrice, images[0] || '', optionOrder.get(canonicalEtsySku) || 0, existingOptionValues);
  // Keep every Etsy variation on the one staged product page. Each variant
  // gets its own parent SKU, physical 1PK child, and default recipe when the
  // parent does not already have one.
  for (const variant of orderedVariantRows) {
    const variantCanonical = normalizeSku(variant.sku);
    const variantOneSku = onePackSkuFor(variant.sku, listingId, title);
    if (!variantCanonical || variantCanonical === canonicalEtsySku) continue;
    const variantPackSize = packSizeForSku(variant.sku);
    const variantOneSkuExisted = inventorySkuExistedBeforeRun(inventoryCache, variantOneSku, runStartedAt);
    const variantPackSkuExisted = inventorySkuExistedBeforeRun(inventoryCache, variantCanonical, runStartedAt);
    const variantChild = await findOrCreateInventorySku(variantOneSku, { sku: variantOneSku, name: productName, variant_name: '1PK', quantity_on_hand: variant.quantity * variantPackSize, reorder_point: 0, item_type: 'inventory', hierarchy: 'single', category: categorySlug, price: variantPackSize > 1 ? Math.round((variant.price / variantPackSize) * 100) / 100 : variant.price, unit_type: 'Each', source_system: 'etsy-import', source_metadata: { source: 'etsy_listing', etsy_listing_id: listingId, etsy_sku: variantCanonical, pack_size: 1, disposition: 'inventory', imported_quantity: variant.quantity * variantPackSize, imported_at: new Date().toISOString() } }, inventoryCache);
    const physicalChild = await ensurePhysicalInventorySku(variantChild, listingId);
    const variantParent = await findOrCreateInventorySku(variantCanonical, { sku: variantCanonical, name: productName, variant_name: packVariantLabel(variantCanonical), quantity_on_hand: variant.quantity, reorder_point: 0, item_type: 'non-inventory', hierarchy: 'parent', category: categorySlug, price: variant.price, unit_type: 'Each', source_system: 'etsy-import', source_metadata: { source: 'etsy_listing', etsy_listing_id: listingId, etsy_sku: variantCanonical, pack_size: variantPackSize, imported_quantity: variant.quantity, imported_at: new Date().toISOString() } }, inventoryCache);
    const recipe = await ensureEtsyRecipe(variantParent, physicalChild, variantPackSize);
    familyRecipeBySku.set(variantCanonical, { recipe_created: recipe.created, recipe_components: recipe.components, one_pk_sku_existed: variantOneSkuExisted, pack_sku_existed: variantPackSkuExisted });
    if (option?.id) {
      await upsertEtsyProductOptionValue(option.id, variant, variantParent, physicalChild, listingPrice, images[0] || '', optionOrder.get(variantCanonical) || 0, existingOptionValues);
    }
    const variantMapping = mappingsBySku.get(variantCanonical) || (await database('product_etsy_mappings', 'POST', { product_id: product.id, etsy_sku: variantCanonical, inventory_sku: variantOneSku, inventory_sku_id: physicalChild.id, inventory_units: Math.max(1, variantPackSize), active: true, sort_order: optionOrder.get(variantCanonical) || 0 }))[0];
    if (variantMapping?.id) mappingsBySku.set(variantCanonical, variantMapping);
    if (variantMapping?.id) await database('product_etsy_mapping_components?on_conflict=mapping_id,inventory_sku_id', 'POST', [{ mapping_id: variantMapping.id, inventory_sku_id: physicalChild.id, inventory_sku: variantOneSku, inventory_units: Math.max(1, variantPackSize), sort_order: 0 }], 'resolution=merge-duplicates,return=minimal');
  }
  await ensureEtsyProductImages(String(product.id), images, title);
  const mappingKey = normalizeSku(etsySku);
  const mapping = mappingsBySku.get(mappingKey) || (await database('product_etsy_mappings', 'POST', { product_id: product.id, etsy_sku: etsySku, inventory_sku: oneSku, inventory_sku_id: childInventory.id, inventory_units: Math.max(1, packSize), active: true, sort_order: 0 }))[0];
  if (mapping?.id) mappingsBySku.set(mappingKey, mapping);
  if (mapping?.id) await database('product_etsy_mapping_components?on_conflict=mapping_id,inventory_sku_id', 'POST', [{ mapping_id: mapping.id, inventory_sku_id: childInventory.id, inventory_sku: oneSku, inventory_units: Math.max(1, packSize), sort_order: 0 }], 'resolution=merge-duplicates,return=minimal');
  const familySkus = orderedVariantRows.map((variant) => {
    const variantCanonical = normalizeSku(variant.sku);
    const variantOneSku = onePackSkuFor(variant.sku, listingId, title);
    const variantPackSize = packSizeForSku(variant.sku);
    const recipe = familyRecipeBySku.get(variantCanonical);
    const onePkExistedBeforeRun = recipe?.one_pk_sku_existed || false;
    const packExistedBeforeRun = recipe?.pack_sku_existed || false;
    return { etsy_sku: variantCanonical, one_pk_sku: variantOneSku, pack_size: variantPackSize, label: variant.label, quantity: variant.quantity, manual_recipe_required: false, recipe_components: recipe?.recipe_components || [], recipe_created: recipe?.recipe_created || false, sku_existed: Boolean(onePkExistedBeforeRun || packExistedBeforeRun), one_pk_sku_existed: Boolean(onePkExistedBeforeRun), pack_sku_existed: Boolean(packExistedBeforeRun), sku_existed_before_run: Boolean(onePkExistedBeforeRun || packExistedBeforeRun), one_pk_sku_existed_before_run: Boolean(onePkExistedBeforeRun), pack_sku_existed_before_run: Boolean(packExistedBeforeRun) };
  });
  const skuFilterDefinitions = [{ label: 'Quantity', options: Object.fromEntries(familySkus.map((variant) => [variant.etsy_sku, variant.label || packChoiceLabel(variant.etsy_sku)])) }];
  const rawPayload = { listing_id: listingId, title, description, sku: etsySku, variant_skus: variantSkus, variants: familySkus, one_pk_sku: oneSku, price: listingPrice, quantity, category_slug: categorySlug, sku_filter_definitions: skuFilterDefinitions, etsy_category_path: detail.category_path || detail.taxonomy_path || listing.category_path || listing.taxonomy_path || null, tags, materials, images, url: detail.url || listing.url || null, updated_timestamp: detail.updated_timestamp || listing.updated_timestamp || null };
  const listingRows = await database(`etsy_import_listings?external_listing_id=eq.${encodeURIComponent(listingId)}&select=id&limit=1`);
  const listingPayload = { batch_id: batchId, external_listing_id: listingId, title, proposed_product_name: productName, proposed_product_sku: etsySku, proposed_single_sku: oneSku, proposed_product_id: product.id, review_status: 'pending', raw_payload: rawPayload, updated_at: new Date().toISOString() };
  if (listingRows[0]) await database(`etsy_import_listings?id=eq.${encodeURIComponent(listingRows[0].id)}`, 'PATCH', listingPayload, 'return=minimal');
  else await database('etsy_import_listings', 'POST', listingPayload, 'return=minimal');
  const productUrl = `admin.html?edit=${encodeURIComponent(product.id)}`;
  const onePkUrl = `admin.html?inventory=sku&sku=${encodeURIComponent(oneSku)}`;
  const packSkuUrl = canonicalEtsySku !== oneSku ? `admin.html?inventory=sku&sku=${encodeURIComponent(canonicalEtsySku)}` : null;
  const recipeUrl = canonicalEtsySku !== oneSku ? `admin.html?inventory=adjust&recipe=${encodeURIComponent(canonicalEtsySku)}` : null;
  return { listing_id: listingId, product_id: product.id, product_name: productName, etsy_title: title, etsy_sku: etsySku, one_pk_sku: oneSku, pack_size: packSize, family_skus: familySkus, created, product_page_existed: !created, quantity, manual_recipe_required: false, sku_existed: oneSkuExisted || packSkuExisted, url: productUrl, links: { product: productUrl, one_pk_sku: onePkUrl, pack_sku: packSkuUrl, recipe: recipeUrl } };
}
async function importEtsyListings(adminId: string, requestedRunId = '', requestedOffset = 0) {
  const recentBatches = await database('etsy_import_batches?kind=eq.listings&select=id,created_at,updated_at,status,metadata&order=created_at.desc&limit=5');
  const activeBatch = recentBatches.find((batch: Record<string, any>) => Boolean(batch.metadata?.running) && Date.parse(String(batch.updated_at || batch.created_at || '')) > Date.now() - 180000);
  if (activeBatch?.id) return { batch_id: activeBatch.id, history_recorded: true, rows: 0, matched: 0, created_count: 0, existing_count: 0, failed_count: 0, created_pages: [], existing_pages: [], failed_pages: [], truncated: false, continue_available: false, warning: 'An Etsy listing scan is already running. Wait for it to finish before trying again.', done: true };
  const completedScanRows = await database('etsy_import_batches?kind=eq.listings&metadata->>historical_scan_complete=eq.true&select=id,created_at,metadata&order=created_at.desc&limit=1');
  const historicalScanComplete = Boolean(completedScanRows[0]);
  const fullCatalogScan = !historicalScanComplete;
  const progressRows = await database('etsy_import_batches?kind=eq.listings&metadata->>listing_scan_in_progress=eq.true&select=id,created_at,updated_at,metadata&order=created_at.desc&limit=1');
  const progressBatch = progressRows.find((batch: Record<string, any>) => batch.metadata?.full_catalog_scan === fullCatalogScan);
  let runId = String(requestedRunId || '').trim();
  let initialOffset = Math.max(0, Math.floor(Number(requestedOffset) || 0));
  if (progressBatch) {
    runId = String(progressBatch.metadata?.run_id || runId || crypto.randomUUID());
    initialOffset = Math.max(0, Math.floor(Number(progressBatch.metadata?.next_offset ?? progressBatch.metadata?.offset) || 0));
  }
  if (!runId) runId = crypto.randomUUID();
  const connection = await importConnection();
  const categoryRows = await database('categories?select=slug,name&active=eq.true&limit=100');
  const availableCategories = new Set(categoryRows.map((row: Record<string, any>) => String(row.slug || '').trim()).filter(Boolean));
  const priorMetadata = progressBatch?.metadata && typeof progressBatch.metadata === 'object' ? progressBatch.metadata : {};
  const batchId = String(progressBatch?.id || await createImportBatch(adminId, 'listings', { listing_ids: [], run_id: runId, offset: initialOffset }, { action: 'listings', running: true, listing_scan_in_progress: true, full_catalog_scan: fullCatalogScan, historical_scan_complete: historicalScanComplete, run_id: runId, offset: initialOffset, next_offset: initialOffset }) || '');
  if (progressBatch?.id) await updateImportBatch(batchId, { metadata: { ...priorMetadata, running: true } });
  const runStartedAt = String(progressBatch?.created_at || new Date().toISOString());
  let listingPageSnapshot = priorMetadata.listing_page_snapshot && typeof priorMetadata.listing_page_snapshot === 'object' ? priorMetadata.listing_page_snapshot : null;
  const createdPages: Record<string, any>[] = list(priorMetadata.created_pages);
  const existingPages: Record<string, any>[] = list(priorMetadata.existing_pages);
  const priorFailedPages: Record<string, any>[] = list(priorMetadata.failed_pages);
  let failedPages: Record<string, any>[] = [...priorFailedPages];
  let unchangedCount = Math.max(0, Number(priorMetadata.unchanged_count) || 0);
  let rows = Math.max(0, Number(priorMetadata.processed_count) || 0);
  let truncated = false;
  let warning = '';
  let continueAvailable = false;
  let nextOffset: number | null = null;
  let scanInProgress = false;
  let scanComplete = historicalScanComplete;
  try {
    const offset = initialOffset;
    let page: Record<string, any>;
    const savedListingIds = fullCatalogScan && Number(listingPageSnapshot?.offset) === offset && Array.isArray(listingPageSnapshot?.listing_ids) ? listingPageSnapshot.listing_ids.map((id: unknown) => String(id || '').trim()).filter((id: string) => /^\d+$/.test(id)) : [];
    if (savedListingIds.length) {
      page = { results: savedListingIds.map((listing_id: string) => ({ listing_id })), count: listingPageSnapshot?.count };
    } else {
      try {
        page = await etsy(`shops/${connection.shop_id}/listings?state=active&limit=100&offset=${offset}&sort_on=created&sort_order=desc`, connection.access_token);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || '');
        if (offset > 0 && /offset exceeds the maximum allowed/i.test(message)) {
          truncated = true;
          warning = 'Etsy stopped the catalog scan at its pagination limit. The scan can be resumed if Etsy permits a later offset.';
        } else throw error;
        page = { results: [], count: 0 };
      }
      if (fullCatalogScan) {
        listingPageSnapshot = { offset, count: Number(page?.count) || 0, listing_ids: list(page?.results).map((listing) => String(listing.listing_id || listing.id || '').trim()).filter((id) => /^\d+$/.test(id)) };
        await updateImportBatch(batchId, { metadata: { ...priorMetadata, action: 'listings', running: true, listing_scan_in_progress: true, full_catalog_scan: fullCatalogScan, historical_scan_complete: historicalScanComplete, run_id: runId, offset, next_offset: offset, listing_page_snapshot: listingPageSnapshot } });
      }
    }
    const listings = list(page?.results);
    const pageIds = listings.map((listing) => String(listing.listing_id || listing.id || '').trim()).filter((id) => /^\d+$/.test(id));
    const [knownPageRows, linkedProducts] = await Promise.all([
      pageIds.length ? database(`etsy_import_listings?select=external_listing_id,proposed_product_id&external_listing_id=in.(${pageIds.join(',')})&limit=${pageIds.length}`) : Promise.resolve([]),
      pageIds.length ? database(`products?select=id,etsy_listing_id&etsy_listing_id=in.(${pageIds.join(',')})&limit=${pageIds.length}`) : Promise.resolve([])
    ]);
    const knownPageIds = new Set(knownPageRows.map((row: Record<string, any>) => String(row.external_listing_id || '').trim()));
    const linkedProductsByListing = new Map<string, Record<string, any>[]>();
    linkedProducts.forEach((row: Record<string, any>) => {
      const key = String(row.etsy_listing_id || '').trim();
      const rows = linkedProductsByListing.get(key) || [];
      rows.push(row);
      linkedProductsByListing.set(key, rows);
    });
    const processedIds = new Set(Number(priorMetadata.offset) === initialOffset ? list(priorMetadata.processed_listing_ids).map((id) => String(id || '').trim()) : []);
    const actionableListings = listings.filter((listing) => {
      const listingId = String(listing.listing_id || listing.id || '').trim();
      if (!/^\d+$/.test(listingId) || processedIds.has(listingId)) return false;
      if (fullCatalogScan) return true;
      return !knownPageIds.has(listingId) || !linkedProductsByListing.has(listingId);
    });
    const listingsThisRun = actionableListings.slice(0, 5);
    const imported = await concurrentSettled(listingsThisRun, 1, async (listing) => {
      const listingId = String(listing.listing_id || listing.id || '').trim();
      const linked = linkedProductsByListing.get(listingId) || [];
      if (linked.length > 1) throw new Error(`Etsy listing ${listingId} is linked to multiple product pages; no duplicate page was created.`);
      const detail = await fetchEtsyListingDetail(connection, listing);
      return importEtsyListing(connection, batchId, listing, detail, availableCategories, runStartedAt, linked.length === 1);
    });
    const successfulIds = new Set<string>();
    const attemptedIds = new Set(imported.map((entry) => String(entry.item.listing_id || entry.item.id || '').trim()));
    failedPages = priorFailedPages.filter((page) => !attemptedIds.has(String(page.listing_id || '').trim()));
    imported.forEach((entry) => {
      const listingId = String(entry.item.listing_id || entry.item.id || '').trim();
      if (entry.error) {
        failedPages.push({ listing_id: listingId, title: cleanText(entry.item.title || `Etsy listing ${listingId}`), error: entry.error, retry: true });
        return;
      }
      const result = entry.value;
      if (!result) return;
      successfulIds.add(listingId);
      if (result.created) createdPages.push(result);
      else if (result.repaired || result.family_skus?.some((variant: Record<string, any>) => variant.recipe_created || variant.one_pk_sku_existed_before_run === false || variant.pack_sku_existed_before_run === false)) existingPages.push(result);
      else unchangedCount += 1;
    });
    const rowsThisCall = imported.length;
    rows += rowsThisCall;
    const processedForPage = new Set([...processedIds, ...successfulIds]);
    const unprocessedOnPage = actionableListings.filter((listing) => {
      const listingId = String(listing.listing_id || listing.id || '').trim();
      return /^\d+$/.test(listingId) && !processedForPage.has(listingId);
    }).length;
    const reportedCount = Number(page?.count);
    const pageNextOffset = offset + listings.length;
    const endOfCatalog = !listings.length || listings.length < 100 || (Number.isFinite(reportedCount) && pageNextOffset >= reportedCount);
    if (failedPages.length) {
      scanInProgress = true;
      nextOffset = offset;
      warning = 'The scan paused at a listing that could not be imported. Run the import again to retry it and continue.';
    } else if (unprocessedOnPage > 0) {
      scanInProgress = true;
      continueAvailable = true;
      nextOffset = offset;
    } else if (fullCatalogScan) {
      if (endOfCatalog) {
        scanComplete = true;
        scanInProgress = false;
      } else if (pageNextOffset >= 12000) {
        truncated = true;
        scanInProgress = false;
        warning = 'The catalog exceeds Etsy’s 12,000-listing pagination limit; the full historical scan could not reach the end.';
      } else {
        scanInProgress = true;
        continueAvailable = true;
        nextOffset = pageNextOffset;
      }
    } else if (actionableListings.length > 0 && endOfCatalog) {
      scanComplete = true;
      scanInProgress = false;
    } else if (actionableListings.length > 0 && pageNextOffset < 12000) {
      scanInProgress = true;
      continueAvailable = true;
      nextOffset = pageNextOffset;
    } else {
      scanComplete = true;
      scanInProgress = false;
    }
    if (!fullCatalogScan && !actionableListings.length) {
      scanComplete = true;
      scanInProgress = false;
      continueAvailable = false;
      nextOffset = null;
    }
    const processedListingIds = [...processedForPage];
    const importWarning = [warning, failedPages.length ? `${failedPages.length} listing${failedPages.length === 1 ? '' : 's'} need a retry.` : ''].filter(Boolean).join(' ');
    const metadata = { action: 'listings', running: false, listing_scan_in_progress: scanInProgress, full_catalog_scan: fullCatalogScan, historical_scan_complete: scanComplete, run_id: runId, offset, next_offset: nextOffset, listing_page_snapshot: scanInProgress && Number(nextOffset) === offset ? listingPageSnapshot : null, processed_listing_ids: processedListingIds, processed_count: rows, unchanged_count: unchangedCount, created_pages: createdPages, existing_pages: existingPages, failed_pages: failedPages, inactive: true, truncated, warning: importWarning || null };
    await updateImportBatch(batchId, { import_type: 'listings', status: failedPages.length ? 'failed' : 'staged', row_count: rows, matched_count: createdPages.length + existingPages.length, applied_count: createdPages.length, metadata, result: { created: createdPages.length, repaired: existingPages.length, unchanged: unchangedCount, failed: failedPages.length } });
    return { batch_id: batchId, run_id: runId, history_recorded: true, rows: rowsThisCall, processed_count: rows, scanned_count: listings.length, matched: createdPages.length + existingPages.length, created_count: createdPages.length, existing_count: existingPages.length, unchanged_count: unchangedCount, failed_count: failedPages.length, created_pages: createdPages, existing_pages: existingPages, failed_pages: failedPages, truncated, continue_available: continueAvailable, next_offset: nextOffset, warning: importWarning || null, historical_scan_complete: scanComplete, done: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Listing import failed.';
    await updateImportBatch(batchId, { import_type: 'listings', status: 'failed', row_count: rows, metadata: { action: 'listings', running: false, listing_scan_in_progress: scanInProgress || fullCatalogScan, full_catalog_scan: fullCatalogScan, historical_scan_complete: historicalScanComplete, run_id: runId, offset: initialOffset, next_offset: initialOffset, listing_page_snapshot: listingPageSnapshot, processed_listing_ids: list(priorMetadata.processed_listing_ids), processed_count: rows, created_pages: createdPages, existing_pages: existingPages, failed_pages: failedPages, truncated, warning: warning || null, error: message } });
    return { ok: false, error: message, batch_id: batchId, run_id: runId, history_recorded: true, rows, created_pages: createdPages, existing_pages: existingPages, failed_pages: failedPages, done: true };
  }
}
async function repairExistingEtsyListings(rawBatchIds: unknown, startOffset = 0) {
  const batchIds = Array.isArray(rawBatchIds) ? [...new Set(rawBatchIds.map((id) => String(id || '').trim()).filter(Boolean))] : [];
  if (!batchIds.length || batchIds.length > 100 || batchIds.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) throw new Error('Choose a valid Etsy listing import batch to repair.');
  const batchRows = await database(`etsy_import_batches?id=in.(${batchIds.map(encodeURIComponent).join(',')})&select=id,kind,metadata&order=id.asc&limit=100`);
  if (batchRows.length !== batchIds.length || batchRows.some((row: Record<string, any>) => row.kind !== 'listings')) throw new Error('One or more selected batches are missing or are not Etsy listing imports.');
  const pageTargets = new Map<string, { sourceBatchIds: string[] }>();
  for (const batch of batchRows) {
    const metadata = batch.metadata && typeof batch.metadata === 'object' ? batch.metadata : {};
    for (const page of [...list(metadata.created_pages), ...list(metadata.existing_pages)]) {
      const listingId = String(page?.listing_id || '').trim();
      if (!/^\d+$/.test(listingId)) continue;
      const target = pageTargets.get(listingId) || { sourceBatchIds: [] };
      if (!target.sourceBatchIds.includes(String(batch.id))) target.sourceBatchIds.push(String(batch.id));
      pageTargets.set(listingId, target);
    }
  }
  const targets = [...pageTargets.entries()];
  const offset = Math.max(0, Math.floor(Number(startOffset) || 0));
  if (!targets.length || offset >= targets.length) return { processed: 0, repaired: 0, failed: 0, skipped: 0, items: [], next_offset: targets.length, done: true, total: targets.length };
  const connection = await importConnection();
  const categories = await database('categories?select=slug&active=eq.true&limit=100');
  const availableCategories = new Set(categories.map((row: Record<string, any>) => String(row.slug || '').trim()).filter(Boolean));
  const [listingId, target] = targets[offset];
  let item: Record<string, any>;
  try {
    const imports = await database(`etsy_import_listings?external_listing_id=eq.${encodeURIComponent(listingId)}&select=id,title,proposed_product_sku,proposed_product_id&limit=2`);
    if (imports.length !== 1 || !imports[0].proposed_product_id) {
      item = { listing_id: listingId, status: 'skipped', reason: 'There is no single existing imported product record to repair.' };
    } else {
      const products = await database(`products?etsy_listing_id=eq.${encodeURIComponent(listingId)}&select=id&limit=2`);
      if (products.length !== 1 || String(products[0].id) !== String(imports[0].proposed_product_id)) {
        item = { listing_id: listingId, status: 'skipped', reason: 'The imported product page could not be verified as belonging to this Etsy listing.' };
      } else {
        const listing = { listing_id: listingId, title: imports[0].title, sku: imports[0].proposed_product_sku };
        const detail = await fetchEtsyListingDetail(connection, listing);
        const result = await importEtsyListing(connection, undefined, listing, detail, availableCategories, new Date().toISOString(), true);
        item = { listing_id: listingId, product_id: result.product_id, status: 'repaired', family_skus: result.family_skus || [], sku_count: (result.family_skus || []).length, recipes_created: (result.family_skus || []).filter((row: Record<string, any>) => row.recipe_created).length };
        for (const sourceBatchId of target.sourceBatchIds) {
          const source = batchRows.find((row: Record<string, any>) => String(row.id) === sourceBatchId);
          if (!source) continue;
          const metadata = source.metadata && typeof source.metadata === 'object' ? source.metadata : {};
          let changed = false;
          for (const field of ['created_pages', 'existing_pages']) {
            const pages = list(metadata[field]);
            metadata[field] = pages.map((page: Record<string, any>) => {
              if (String(page?.listing_id || '') !== listingId) return page;
              changed = true;
              return { ...page, product_id: result.product_id, family_skus: result.family_skus || [], family_repaired_at: new Date().toISOString() };
            });
          }
          if (changed) {
            source.metadata = metadata;
            await updateImportBatch(sourceBatchId, { metadata });
          }
        }
      }
    }
  } catch (error) {
    item = { listing_id: listingId, status: 'failed', error: error instanceof Error ? error.message : 'Etsy SKU family repair failed.' };
  }
  const nextOffset = offset + 1;
  return { processed: 1, repaired: item.status === 'repaired' ? 1 : 0, failed: item.status === 'failed' ? 1 : 0, skipped: item.status === 'skipped' ? 1 : 0, items: [item], next_offset: nextOffset, done: nextOffset >= targets.length, total: targets.length };
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
    if (existing) await database('etsy_connections?id=eq.true', 'PATCH', row, 'return=minimal');
    else await database('etsy_connections', 'POST', row, 'return=minimal');
    return redirect('connected');
  } catch {
    // Never return provider responses, credentials, or authorization codes to the browser.
    return redirect('failed');
  }
}
Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  let action = '';
  try {
    const missing = Object.entries({ SUPABASE_URL: projectUrl, SUPABASE_SERVICE_ROLE_KEY: serviceKey, ETSY_API_KEY: etsyKey, ETSY_SHARED_SECRET: etsySecret }).filter(([, value]) => !value).map(([name]) => name);
    if (missing.length) return json({ error: 'Missing backend secrets: ' + missing.join(', ') + '.' }, 503);
    if (request.method === 'GET' && new URL(request.url).pathname.endsWith('/callback')) return await callback(request);
    if (request.method !== 'POST') return json({ error: 'Use Connect Etsy in Store Control.' }, 405);
    const adminId = await adminFor(request);
    if (!adminId) return json({ error: 'An active administrator account is required.' }, 403);
    const body = await request.json();
    action = String(body.action || '');
    if (body.action === 'start') {
      const origin = returnOrigin(String(request.headers.get('Origin') || ''));
      const state = random(), verifier = random();
      await database(`etsy_oauth_states?expires_at=lt.${new Date().toISOString()}`, 'DELETE', undefined, 'return=minimal');
      await database(`etsy_oauth_states?admin_id=eq.${adminId}`, 'DELETE', undefined, 'return=minimal');
      await database('etsy_oauth_states', 'POST', { state_hash: await hash(state), admin_id: adminId, code_verifier: verifier, return_origin: origin, expires_at: new Date(Date.now() + 600000).toISOString() }, 'return=minimal');
      const authorize = new URL('https://www.etsy.com/oauth/connect');
      authorize.search = new URLSearchParams({ response_type: 'code', client_id: etsyKey, redirect_uri: callbackUrl, scope: scopes, state, code_challenge: await hash(verifier), code_challenge_method: 'S256' }).toString();
      return json({ authorize_url: authorize.href });
    }
    if (body.action === 'disconnect') {
      await database('etsy_oauth_states?state_hash=not.is.null', 'DELETE', undefined, 'return=minimal');
      await database('etsy_connections?id=eq.true', 'DELETE', undefined, 'return=minimal');
      return json({ connected: false });
    }
    if (body.action === 'preview_orders') return json(await previewOrders(adminId, Math.max(0, Math.floor(Number(body.offset) || 0)), Number(body.min_created)));
    if (body.action === 'import_orders') {
      const offset = Math.max(0, Math.floor(Number(body.offset) || 0));
      const syncStart = offset === 0 && !(Number(body.min_created) > 0) ? await orderSyncStart() : { min_created: Number(body.min_created) > 0 ? Math.floor(Number(body.min_created)) : undefined };
      return json({ ...(await previewOrders(adminId, offset, syncStart.min_created)), min_created: syncStart.min_created || null, scope: 'sales_and_inventory_metrics' });
    }
    if (body.action === 'finalize_order_import') return json(await finalizeOrderImport(adminId, String(body.batch_id || ''), body));
    if (body.action === 'preview_reviews') return json(await previewReviews(adminId, Math.max(0, Math.floor(Number(body.offset) || 0))));
    if (body.action === 'import_listings') return json(await importEtsyListings(adminId, String(body.run_id || '').trim(), Number(body.offset) || 0));
    if (body.action === 'repair_existing_listings') return json(await repairExistingEtsyListings(body.batch_ids, Number(body.offset) || 0));
    if (body.action === 'order_sync_start') return json(await orderSyncStart());
    if (body.action === 'sync_financials' || body.action === 'backfill_historical_fees') {
      let connection = (await database('etsy_connections?id=eq.true'))[0];
      if (!connection) throw new Error('Connect Etsy before importing.');
      connection = await refreshConnection(connection);
      return json(await syncReceiptFees(connection, body.action === 'backfill_historical_fees', String(body.cursor || '')));
    }
    if (!['status', 'verify'].includes(body.action)) return json({ error: 'Unknown connection action.' }, 400);
    let connection = (await database('etsy_connections?id=eq.true'))[0];
    if (!connection) return json({ connected: false, callback_url: callbackUrl });
    if (body.action === 'verify') {
      connection = await refreshConnection(connection);
      await etsy(`shops/${connection.shop_id}/receipts?limit=1`, connection.access_token);
      connection.verified_at = new Date().toISOString();
      await database('etsy_connections?id=eq.true', 'PATCH', { verified_at: connection.verified_at }, 'return=minimal');
    }
    return json({ connected: true, shop_id: connection.shop_id, shop_name: connection.shop_name, connected_at: connection.connected_at, verified_at: connection.verified_at, callback_url: callbackUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (action === 'sync_financials' || action === 'backfill_historical_fees') return json({ ok: false, error: message.slice(0, 500) || 'Etsy financial sync failed.' }, 200);
    if (action === 'import_listings') return json({ ok: false, error: message.slice(0, 500) || 'Etsy listing import failed.' }, 200);
    if (action === 'repair_existing_listings') return json({ ok: false, error: message.slice(0, 500) || 'Etsy SKU family repair failed.' }, 200);
    if (action === 'import_orders' || action === 'finalize_order_import') return json({ ok: false, error: message.slice(0, 500) || 'Etsy order import failed.' }, 200);
    const allowed = ['Connection storage is unavailable.', 'Open the admin on HTTPS or a local preview.', 'Etsy authorization expired or was rejected. Please reconnect.', 'Etsy could not verify this connection. Try reconnecting.', 'Etsy is rate limiting requests. Try again shortly.', 'Another connection check is running. Try again shortly.', 'The connection changed during verification. Try again.', 'Connect Etsy before preparing an import.'];
    return json({ error: allowed.includes(message) ? message : 'Unable to complete the Etsy connection request. Please try again.' }, 400);
  }
});
