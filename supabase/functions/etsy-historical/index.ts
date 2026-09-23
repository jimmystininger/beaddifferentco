const projectUrl=Deno.env.get('SUPABASE_URL')||'';
const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const etsyKey=Deno.env.get('ETSY_API_KEY')||'';
const etsySecret=Deno.env.get('ETSY_SHARED_SECRET')||'';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'};
const json=(v:unknown,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
const network=(url:string,init:RequestInit={})=>fetch(url,{...init,signal:AbortSignal.timeout(25000)});
async function db(path:string,method='GET',body?:unknown,prefer='return=representation'){const r=await network(`${projectUrl}/rest/v1/${path}`,{method,headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,'Content-Type':'application/json',Prefer:prefer},...(body===undefined?{}:{body:JSON.stringify(body)})});if(!r.ok)throw new Error('Historical Etsy storage is unavailable.');return r.status===204?[]:r.json();}
async function adminFor(request:Request){const a=request.headers.get('Authorization');if(!a?.startsWith('Bearer '))return null;const r=await network(`${projectUrl}/auth/v1/user`,{headers:{apikey:serviceKey,Authorization:a}});if(!r.ok){if(r.status===401||r.status===403)return null;throw new Error(`Historical Etsy auth lookup failed (${r.status}).`);}const u=await r.json();if(!u?.id)return null;const rows=await db(`profiles?id=eq.${encodeURIComponent(u.id)}&select=role,status`);return rows[0]?.role==='admin'&&rows[0]?.status==='active'?u.id:null;}
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));let nextRequestAt=0;
async function etsy(path:string,token:string){for(let attempt=0;attempt<5;attempt++){const now=Date.now(),scheduled=Math.max(now,nextRequestAt);nextRequestAt=scheduled+175;if(scheduled>now)await pause(scheduled-now);const r=await network(`https://api.etsy.com/v3/application/${path}`,{headers:{'x-api-key':`${etsyKey}:${etsySecret}`,Authorization:`Bearer ${token}`}});if(r.ok)return r.json();if(r.status===429){const retry=Math.max(1000,(Number(r.headers.get('Retry-After'))||attempt+1)*1000);nextRequestAt=Math.max(nextRequestAt,Date.now()+retry);await pause(retry);continue;}let detail='';try{detail=(await r.text()).slice(0,500);}catch(_){}throw new Error(`ETSY_HTTP_${r.status}: ${path}${detail?` — ${detail}`:''}`);}throw new Error('Etsy is busy. Please try the historical import again later.');}
async function tokenRequest(body:URLSearchParams){const r=await network('https://api.etsy.com/v3/public/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});if(!r.ok)throw new Error('Etsy authorization expired or was rejected. Please reconnect.');const t=await r.json();if(typeof t.access_token!=='string'||typeof t.refresh_token!=='string')throw new Error('Etsy returned an invalid authorization response.');return t;}
async function connection(){let rows=await db('etsy_connections?id=eq.true');let c=rows[0];if(!c)throw new Error('Connect Etsy before running the historical import.');if(Date.parse(c.expires_at)>Date.now()+90000)return c;const token=await tokenRequest(new URLSearchParams({grant_type:'refresh_token',client_id:etsyKey,refresh_token:c.refresh_token}));const changes={access_token:token.access_token,refresh_token:token.refresh_token,expires_at:new Date(Date.now()+Number(token.expires_in)*1000).toISOString()};await db('etsy_connections?id=eq.true','PATCH',changes,'return=minimal');return{...c,...changes};}
const list=(v:unknown):Record<string,any>[]=>Array.isArray(v)?v.filter(x=>x&&typeof x==='object') as Record<string,any>[]:[];
const money=(v:unknown)=>{if(typeof v==='number')return Number.isFinite(v)?v:0;if(typeof v==='string')return Number.isFinite(Number(v))?Number(v):0;if(!v||typeof v!=='object')return 0;const x=v as Record<string,any>,a=Number(x.amount),d=Number(x.divisor);return Number.isFinite(a)?a/(Number.isFinite(d)&&d>0?d:1):0;};
const stamp=(v:unknown)=>{const n=Number(v);return Number.isFinite(n)&&n>0?new Date(n*1000).toISOString():new Date().toISOString();};
async function concurrent<T,R>(items:T[],limit:number,task:(x:T)=>Promise<R>){const out:R[]=[];let i=0;const worker=async()=>{while(i<items.length){const n=i++;out[n]=await task(items[n]);}};await Promise.all(Array.from({length:Math.min(limit,items.length)},worker));return out;}
function statusOf(r:Record<string,any>){if(r.was_canceled===true||r.is_canceled===true)return'cancelled';if(r.was_refunded===true||r.is_refunded===true)return'refunded';const s=String(r.status||'').toLowerCase();return['paid','completed','refunded','returned','cancelled'].includes(s)?s:'paid';}
async function preview(adminId:string,minCreated:number,maxCreated:number,offset:number,probe=false){
  const c=await connection();
  const filter=`&min_created=${Math.floor(minCreated)}&max_created=${Math.floor(maxCreated)}`;
  const page=await etsy(`shops/${c.shop_id}/receipts?limit=100&offset=${Math.max(0,offset)}${filter}`,c.access_token);
  const receipts=list(page.results);
  if(probe)return{window_min_created:minCreated,window_max_created:maxCreated,total_receipts:Number(page.count)||receipts.length};

  // Fetch only the transactions in this receipt page before resolving mappings.
  // The old historical path downloaded every active Etsy mapping on every page.
  const receiptData=await concurrent(receipts,2,async(receipt)=>{
    const id=String(receipt.receipt_id||'');
    let transactions=list(receipt.transactions);
    if(!transactions.length){
      try{transactions=list(await etsy(`shops/${c.shop_id}/receipts/${encodeURIComponent(id)}/transactions`,c.access_token));}
      catch(error){if(String(error).startsWith('ETSY_HTTP_404:'))return{receipt,transactions:[],payments:[]};throw error;}
    }
    let payments:Record<string,any>[]=[];
    try{payments=list(await etsy(`shops/${c.shop_id}/receipts/${encodeURIComponent(id)}/payments`,c.access_token));}
    catch(error){if(!String(error).startsWith('ETSY_HTTP_404:'))throw error;}
    return{receipt,transactions,payments};
  });
  const transactionSkus=[...new Map(receiptData.flatMap(({transactions})=>transactions.map((transaction)=>String(transaction.sku||transaction.listing_sku||'').trim()).filter(Boolean).map((sku)=>[sku.toLowerCase(),sku] as const))).values()];
  const mappings=transactionSkus.length?await db(`product_etsy_mappings?select=etsy_sku,inventory_sku&active=eq.true&etsy_sku=in.(${transactionSkus.map((sku)=>encodeURIComponent(sku)).join(',')})`):[];
  const bySku=new Map(mappings.map((r:Record<string,any>)=>[String(r.etsy_sku||'').trim().toLowerCase(),String(r.inventory_sku||'').trim()]));
  const sales=receiptData.flatMap(({receipt,transactions,payments})=>{
    const id=String(receipt.receipt_id||'');
    const total=transactions.reduce((s,t)=>s+money(t.price)*Math.max(1,Number(t.quantity)||1),0);
    const divisor=total>0?total:Math.max(1,transactions.length);
    const shipping=money(receipt.total_shipping_cost||receipt.total_shipping);
    const tax=money(receipt.total_tax_cost||receipt.total_tax);
    const discount=money(receipt.discount_amt||receipt.discount_amount);
    const fees=payments.reduce((s,p)=>s+money(p.amount_fees||p.fee_amount||p.posted_fees),0);
    const status=statusOf(receipt);
    return transactions.map(t=>{
      const quantity=Math.max(0,Number(t.quantity)||0);
      const gross=money(t.price)*quantity;
      const share=total>0?gross/divisor:1/Math.max(1,transactions.length);
      const sku=String(t.sku||t.listing_sku||'').trim()||`listing:${String(t.listing_id||'unknown')}`;
      const refunded=status==='refunded'||status==='cancelled'?quantity:0;
      return{external_order_id:id,external_line_id:String(t.transaction_id||`${id}:${t.listing_id||sku}`),etsy_sku:sku,listing_id:t.listing_id||null,title:String(t.title||t.product_data?.[0]?.property_name||'Etsy item'),sale_date:stamp(t.paid_timestamp||receipt.paid_timestamp||t.created_timestamp||receipt.create_timestamp),status,quantity,refunded_quantity:refunded,gross_revenue:gross,discount_amount:discount*share,refund_amount:refunded?Math.max(0,gross-discount*share):0,shipping_revenue:shipping*share,sales_tax:tax*share,marketplace_fees:fees*share,currency:String(receipt.currency_code||t.currency_code||'USD'),matched_inventory_sku:bySku.get(sku.toLowerCase())||null};
    });
  });
  const rows=await db('etsy_import_batches','POST',{created_by:adminId,kind:'orders',staged_at:new Date().toISOString(),payload:{sales,historical:true,import_mode:'historical_sales_only',historical_window:{min_created:minCreated,max_created:maxCreated}},expires_at:new Date(Date.now()+24*60*60*1000).toISOString()});
  const batchId=rows[0]?.id;if(!batchId)throw new Error('Unable to create the historical Etsy staging batch.');
  const total=(key:string)=>sales.reduce((s,x)=>s+(Number(x[key])||0),0);
  return{batch_id:batchId,window_min_created:minCreated,window_max_created:maxCreated,total_receipts:Number(page.count)||receipts.length,offset,next_offset:offset+receipts.length,has_more:receipts.length===100,receipts:receipts.length,sales:sales.length,matched:sales.filter(x=>x.matched_inventory_sku).length,unmatched:sales.filter(x=>!x.matched_inventory_sku).length,totals:{revenue:total('gross_revenue'),discounts:total('discount_amount'),shipping:total('shipping_revenue'),tax:total('sales_tax'),fees:total('marketplace_fees'),refunds:total('refund_amount')},rows:sales.slice(0,50)};
}
Deno.serve(async request=>{if(request.method==='OPTIONS')return new Response('ok',{headers:cors});if(request.method!=='POST')return json({error:'POST required.'},405);try{const adminId=await adminFor(request);if(!adminId)return json({error:'Administrator authorization required.'},401);const body=await request.json();if(body?.action!=='preview_orders')return json({error:'Unsupported action.'},400);const min=Number(body.min_created),max=Number(body.max_created),offset=Math.max(0,Number(body.offset)||0);if(!(min>0&&max>min))return json({error:'Historical date window is required.'},400);return json(await preview(adminId,min,max,offset,body.probe===true));}catch(error){return json({error:error instanceof Error?error.message:'Historical Etsy import failed.'},500);}});
