const storefrontOrigin='https://www.beaddifferentco.com';
const supabaseUrl=process.env.SUPABASE_URL||'https://zejcuqhihbfpuwsjvmhc.supabase.co';
const supabasePublishableKey=process.env.SUPABASE_PUBLISHABLE_KEY||'sb_publishable_f_xtefICK9H7dD7jJghxJQ_7vcEjR-N';

const xmlEscape=(value)=>String(value).replace(/[&<>"']/g,(character)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[character]));
const productUrl=(row)=>`${storefrontOrigin}/product.html?id=${encodeURIComponent(row.external_id||row.id)}`;
const requestRows=async(table,select,filter='')=>{
  const rows=[];
  for(let offset=0;;offset+=1000){
    const query=new URL(`${supabaseUrl}/rest/v1/${table}`);
    query.searchParams.set('select',select);
    query.searchParams.set('limit','1000');
    query.searchParams.set('offset',String(offset));
    query.searchParams.set('order','id.asc');
    if(filter){const [key,value]=filter.split('=');query.searchParams.set(key,value);}
    const response=await fetch(query,{headers:{apikey:supabasePublishableKey},signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error(`Public catalog request failed: ${response.status}`);
    const batch=await response.json();
    if(!Array.isArray(batch))throw new Error('Public catalog response was not a list.');
    rows.push(...batch);
    if(batch.length<1000)break;
  }
  return rows;
};

module.exports=async function sitemap(request,response){
  if(request.method!=='GET'&&request.method!=='HEAD'){
    response.setHeader('Allow','GET, HEAD');
    response.status(405).end();
    return;
  }
  response.setHeader('Content-Type','application/xml; charset=utf-8');
  response.setHeader('Cache-Control','public, max-age=0, s-maxage=900, stale-while-revalidate=3600');
  if(request.method==='HEAD'){
    response.status(200).end();
    return;
  }
  try{
    const [products,categories]=await Promise.all([
      requestRows('products','id,external_id,category_slug,subcategory_slug,product_categories(category_slug)','visible=eq.true'),
      requestRows('categories','id,slug','active=eq.true')
    ]);
    const visibleCategorySlugs=new Set(products.flatMap((product)=>[
      product.category_slug,
      product.subcategory_slug,
      ...(Array.isArray(product.product_categories)?product.product_categories.map((category)=>category.category_slug):[])
    ].filter(Boolean)));
    const pages=['/','/shop-all.html','/category.html?category=new-arrivals','/sale.html','/our-story.html','/contact.html','/faq.html','/shipping-returns.html','/reviews.html'];
    const urls=[...pages.map((path)=>`${storefrontOrigin}${path}`),...categories.filter((category)=>category.slug&&category.slug!=='shop-all'&&visibleCategorySlugs.has(category.slug)).map((category)=>`${storefrontOrigin}/category.html?category=${encodeURIComponent(category.slug)}`),...products.map(productUrl)];
    const body=`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...new Set(urls)].map((url)=>`  <url><loc>${xmlEscape(url)}</loc></url>`).join('\n')}\n</urlset>\n`;
    response.status(200).send(body);
  }catch(error){
    response.setHeader('Cache-Control','no-store');
    response.status(503).send('Sitemap temporarily unavailable');
  }
};
