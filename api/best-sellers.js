const supabaseUrl=process.env.SUPABASE_URL||'https://zejcuqhihbfpuwsjvmhc.supabase.co';
const supabasePublishableKey=process.env.SUPABASE_PUBLISHABLE_KEY||'sb_publishable_f_xtefICK9H7dD7jJghxJQ_7vcEjR-N';
let cachedPayload=null;
let cachedAt=0;
let inFlight=null;
const cacheTtlMs=5*60*1000;

async function readBestSellers(){
  const now=Date.now();
  if(cachedPayload&&now-cachedAt<cacheTtlMs)return cachedPayload;
  if(inFlight)return inFlight;
  inFlight=(async()=>{
    const result=await fetch(`${supabaseUrl}/rest/v1/rpc/get_storefront_best_sellers`,{
      method:'POST',
      headers:{apikey:supabasePublishableKey,Authorization:`Bearer ${supabasePublishableKey}`,'Content-Type':'application/json'},
      body:JSON.stringify({limit_count:25}),
      signal:AbortSignal.timeout(10000)
    });
    if(!result.ok){
      const detail=(await result.text()).slice(0,500);
      throw new Error(`Best-seller request failed: ${result.status} ${detail}`);
    }
    const rows=await result.json();
    if(!Array.isArray(rows))throw new Error('Best-seller response was not a list.');
    const productIds=rows.map((row)=>String(row?.product_external_id||'').trim()).filter(Boolean);
    cachedPayload={productIds};
    cachedAt=Date.now();
    return cachedPayload;
  })().finally(()=>{inFlight=null;});
  return inFlight;
}

module.exports=async function bestSellers(request,response){
  if(request.method!=='GET'&&request.method!=='HEAD'){
    response.setHeader('Allow','GET, HEAD');
    response.status(405).end();
    return;
  }
  response.setHeader('Content-Type','application/json; charset=utf-8');
  response.setHeader('Cache-Control','public, max-age=0, s-maxage=300, stale-while-revalidate=900');
  if(request.method==='HEAD'){
    response.status(200).end();
    return;
  }
  try{
    const payload=await readBestSellers();
    response.status(200).send(JSON.stringify(payload));
  }catch(error){
    console.error('Best-seller request failed.',error);
    if(cachedPayload){
      response.setHeader('Cache-Control','public, max-age=0, s-maxage=60, stale-while-revalidate=300');
      response.status(200).send(JSON.stringify(cachedPayload));
      return;
    }
    response.setHeader('Cache-Control','public, max-age=0, s-maxage=30, stale-while-revalidate=120');
    response.status(200).send(JSON.stringify({productIds:[]}));
  }
};
