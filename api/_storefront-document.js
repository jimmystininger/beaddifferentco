const origin='https://www.beaddifferentco.com';
const deployment=require('../vercel.json');
const supabaseUrl=process.env.SUPABASE_URL||'https://zejcuqhihbfpuwsjvmhc.supabase.co';
const supabasePublishableKey=process.env.SUPABASE_PUBLISHABLE_KEY||'sb_publishable_f_xtefICK9H7dD7jJghxJQ_7vcEjR-N';
const securityHeaders=deployment.headers.find((rule)=>rule.source==='/(.*)').headers;

const escapeHtml=(value)=>String(value).replace(/[&<>"']/g,(character)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const serialize=(value)=>JSON.stringify(value).replace(/</g,'\\u003c');
const applySecurityHeaders=(response)=>securityHeaders.forEach(({key,value})=>response.setHeader(key,value));
const publicRows=async(table,select,filters)=>{
  const query=new URL(`${supabaseUrl}/rest/v1/${table}`);
  query.searchParams.set('select',select);
  Object.entries(filters).forEach(([key,value])=>query.searchParams.set(key,value));
  const result=await fetch(query,{headers:{apikey:supabasePublishableKey},signal:AbortSignal.timeout(10000)});
  if(!result.ok)throw new Error(`Public ${table} request failed: ${result.status}`);
  const rows=await result.json();
  if(!Array.isArray(rows))throw new Error(`Public ${table} response was not a list.`);
  return rows;
};

module.exports={origin,escapeHtml,serialize,publicRows,applySecurityHeaders};
