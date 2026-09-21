import process from 'node:process';

const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const bucket = String(process.env.STORAGE_BUCKET || 'product-media').trim() || 'product-media';

if (!supabaseUrl || !serviceKey) {
  console.error('Storage audit requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exitCode = 2;
} else {
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

  const requestJson = async (url, options = {}) => {
    const response = await fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } });
    const body = await response.text();
    let value = null;
    try { value = body ? JSON.parse(body) : null; } catch { value = null; }
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${String(body).slice(0, 240)}`);
    return value;
  };

  const fetchRows = async (table, select) => {
    const rows = [];
    for (let offset = 0; ; offset += 1000) {
      const params = new URLSearchParams({ select, limit: '1000', offset: String(offset) });
      const page = await requestJson(`${supabaseUrl}/rest/v1/${table}?${params}`);
      if (!Array.isArray(page)) throw new Error(`${table} returned an unexpected response.`);
      rows.push(...page);
      if (page.length < 1000) return rows;
    }
  };

  const listObjects = async () => {
    const objects = [];
    const prefixes = [''];
    while (prefixes.length) {
      const prefix = prefixes.shift();
      const entries = await requestJson(`${supabaseUrl}/storage/v1/object/list/${encodeURIComponent(bucket)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix, limit: 1000, offset: 0, sortBy: { column: 'name', order: 'asc' } }),
      });
      if (!Array.isArray(entries)) throw new Error('Storage list returned an unexpected response.');
      for (const entry of entries) {
        const name = String(entry?.name || '').trim();
        if (!name) continue;
        const fullName = prefix ? `${prefix}${name}` : name;
        if (entry.id) objects.push({ ...entry, name: fullName });
        else prefixes.push(`${fullName}/`);
      }
    }
    return objects;
  };

  const referenceStrings = (rows, field) => rows.flatMap((row) => {
    const value = row?.[field];
    if (Array.isArray(value)) return value.map((entry) => String(entry || '')).filter(Boolean);
    if (value && typeof value === 'object') return [JSON.stringify(value)];
    return value === null || value === undefined ? [] : [String(value)];
  });

  try {
    const [objects, categories, productImages, optionValues, expenses, purchases, reviews, settings] = await Promise.all([
      listObjects(),
      fetchRows('categories', 'cover_photo'),
      fetchRows('product_images', 'url'),
      fetchRows('product_option_values', 'image_url'),
      fetchRows('business_expenses', 'receipt_path'),
      fetchRows('inventory_purchases', 'receipt_path'),
      fetchRows('reviews', 'photos'),
      fetchRows('site_settings', 'value'),
    ]);
    const refs = [
      ...referenceStrings(categories, 'cover_photo'),
      ...referenceStrings(productImages, 'url'),
      ...referenceStrings(optionValues, 'image_url'),
      ...referenceStrings(expenses, 'receipt_path'),
      ...referenceStrings(purchases, 'receipt_path'),
      ...referenceStrings(reviews, 'photos'),
      ...referenceStrings(settings, 'value'),
    ];
    const hasReference = (name) => refs.some((ref) => ref.includes(name) || ref.includes(name.replaceAll('/', '%2F')));
    const classified = objects.map((object) => ({
      name: object.name,
      bytes: Number(object.metadata?.size || object.metadata?.contentLength || 0) || 0,
      mime: String(object.metadata?.mimetype || ''),
      etag: String(object.metadata?.eTag || '').replace(/^"|"$/g, ''),
      referenced: hasReference(object.name),
    }));
    const referenced = classified.filter((object) => object.referenced);
    const unreferenced = classified.filter((object) => !object.referenced);
    const duplicateMap = new Map();
    for (const object of classified) {
      const key = object.etag || `name:${object.name}`;
      const group = duplicateMap.get(key) || [];
      group.push(object);
      duplicateMap.set(key, group);
    }
    const duplicateGroups = [...duplicateMap.values()]
      .filter((group) => group.length > 1)
      .map((group) => ({ etag: group[0].etag, objects: group.length, referenced: group.some((object) => object.referenced), paths: group.map((object) => object.name) }));
    console.log(JSON.stringify({
      bucket,
      totals: {
        objects: classified.length,
        bytes: classified.reduce((sum, object) => sum + object.bytes, 0),
        referencedObjects: referenced.length,
        referencedBytes: referenced.reduce((sum, object) => sum + object.bytes, 0),
        unreferencedObjects: unreferenced.length,
        unreferencedBytes: unreferenced.reduce((sum, object) => sum + object.bytes, 0),
      },
      duplicateGroups,
      unreferenced,
    }, null, 2));
  } catch (error) {
    console.error(`Storage audit failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
