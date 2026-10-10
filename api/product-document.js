const productSeo=require('../storefront-seo');
const {origin,escapeHtml,serialize,publicRows,applySecurityHeaders}=require('./_storefront-document');

const shell=require('./_product-shell');

const documentFor=(product,unavailable=false)=>{
  const seo=product?productSeo.build(product):{title:'Product Details | Bead Different Co.',description:'Shop beads and creative supplies at Bead Different Co.'};
  const head=product?`<link rel="canonical" href="${origin}${escapeHtml(seo.canonicalPath)}"><script type="application/ld+json" data-product-structured-data>${serialize(productSeo.schema(product))}</script><script type="application/json" id="storefront-product-bootstrap">${serialize(product)}</script>`:unavailable?'<meta name="robots" content="noindex,follow">':'';
  return shell.replace('%%PRODUCT_TITLE%%',escapeHtml(seo.title)).replace('%%PRODUCT_DESCRIPTION%%',escapeHtml(seo.description)).replace('%%PRODUCT_HEAD%%',head);
};

module.exports=async function productDocument(request,response){
  applySecurityHeaders(response);
  if(request.method!=='GET'&&request.method!=='HEAD'){
    response.setHeader('Allow','GET, HEAD');
    response.status(405).end();
    return;
  }
  response.setHeader('Content-Type','text/html; charset=utf-8');
  const requestedId=new URL(request.url,origin).searchParams.get('id')?.trim();
  if(!requestedId||requestedId.length>200){
    response.setHeader('Cache-Control','no-store');
    response.status(404).send(request.method==='HEAD'?'':documentFor(null,true));
    return;
  }
  try{
    const filterField=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestedId)?'id':'external_id';
    const rows=await publicRows('products',productSeo.fields,{[filterField]:`eq.${requestedId}`,visible:'eq.true',limit:'1'});
    const product=rows.find((row)=>row?.visible===true&&String(row[filterField]||'')===requestedId);
    response.setHeader('Cache-Control',product?'public, max-age=0, s-maxage=60':'no-store');
    response.status(product?200:404).send(request.method==='HEAD'?'':documentFor(product,!product));
  }catch(error){
    response.setHeader('Cache-Control','no-store');
    response.setHeader('Retry-After','30');
    response.status(503).send(request.method==='HEAD'?'':documentFor(null));
  }
};
