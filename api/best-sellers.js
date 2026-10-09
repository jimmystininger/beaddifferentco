const supabaseUrl=process.env.SUPABASE_URL||'https://zejcuqhihbfpuwsjvmhc.supabase.co';
const supabasePublishableKey=process.env.SUPABASE_PUBLISHABLE_KEY||'sb_publishable_f_xtefICK9H7dD7jJghxJQ_7vcEjR-N';

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
    const result=await fetch(`${supabaseUrl}/rest/v1/rpc/get_storefront_best_sellers`,{
      method:'POST',
      headers:{apikey:supabasePublishableKey,'Content-Type':'application/json'},
      body:JSON.stringify({limit_count:25}),
      signal:AbortSignal.timeout(10000)
    });
    if(!result.ok)throw new Error(`Best-seller request failed: ${result.status}`);
    const rows=await result.json();
    if(!Array.isArray(rows))throw new Error('Best-seller response was not a list.');
    const productIds=rows.map((row)=>String(row?.product_external_id||'').trim()).filter(Boolean);
    response.status(200).send(JSON.stringify({productIds}));
  }catch(error){
    response.setHeader('Cache-Control','no-store');
    response.status(503).send(JSON.stringify({error:'Best sellers temporarily unavailable.'}));
  }
};
