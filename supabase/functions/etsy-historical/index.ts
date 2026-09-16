const projectUrl = Deno.env.get('SUPABASE_URL') || '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
Deno.serve(async(request)=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(request.method!=='POST')return json({error:'POST required.'},405);
  const authorization=request.headers.get('Authorization');
  if(!authorization?.startsWith('Bearer '))return json({error:'Authorization required.'},401);
  try{
    const body=await request.json();
    if(body?.action!=='preview_orders')return json({error:'Unsupported action.'},400);
    const upstream=await fetch(`${projectUrl}/functions/v1/etsy-connect`,{method:'POST',headers:{apikey:serviceKey,Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify({action:'preview_orders',offset:Math.max(0,Number(body.offset)||0),min_created:Number(body.min_created)||undefined})});
    const preview=await upstream.json();
    if(!upstream.ok||preview?.error)return json({error:preview?.error||'Unable to prepare the Etsy historical preview.'},upstream.status||502);
    if(!preview?.batch_id)return json({error:'Etsy did not return an import batch.'},502);
    const batchResponse=await fetch(`${projectUrl}/rest/v1/etsy_import_batches?id=eq.${encodeURIComponent(preview.batch_id)}&select=id,payload`,{headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`}});
    if(!batchResponse.ok)return json({error:'Unable to mark the historical Etsy batch.'},502);
    const batches=await batchResponse.json(),batch=batches[0];
    if(!batch?.id)return json({error:'Historical Etsy batch was not found.'},404);
    const payload={...(batch.payload||{}),historical:true,import_mode:'historical_sales_only'};
    const updateResponse=await fetch(`${projectUrl}/rest/v1/etsy_import_batches?id=eq.${encodeURIComponent(preview.batch_id)}`,{method:'PATCH',headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({payload})});
    if(!updateResponse.ok)return json({error:'Unable to mark the historical Etsy batch.'},502);
    return json(preview);
  }catch(error){return json({error:error instanceof Error?error.message:'Historical Etsy import failed.'},500);}
});
