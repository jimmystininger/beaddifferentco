const storefrontSeo=require('../storefront-seo');
const {origin,escapeHtml,serialize,publicRows,applySecurityHeaders}=require('./_storefront-document');

const shell=require('./_category-shell');

const documentFor=(seo,rows,unavailable=false)=>{
  const title=seo?.title||'Shop Beads by Category | Bead Different Co.';
  const description=seo?.description||'Browse bead colors, sizes, and creative supplies by category at Bead Different Co.';
  const head=seo?`<link rel="canonical" href="${origin}${escapeHtml(seo.canonicalPath)}"><script type="application/json" id="storefront-category-bootstrap">${serialize(rows)}</script>`:unavailable?'<meta name="robots" content="noindex,follow">':'';
  return shell.replace('%%LISTING_TITLE%%',escapeHtml(title)).replace('%%LISTING_DESCRIPTION%%',escapeHtml(description)).replace('%%LISTING_HEAD%%',head);
};

module.exports=async function categoryDocument(request,response){
  applySecurityHeaders(response);
  if(request.method!=='GET'&&request.method!=='HEAD'){
    response.setHeader('Allow','GET, HEAD');
    response.status(405).end();
    return;
  }
  const url=new URL(request.url,origin);
  const slug=url.searchParams.get('category')?.trim();
  if(!slug||slug==='shop-all'){
    response.setHeader('Location','/shop-all.html');
    response.status(302).end();
    return;
  }
  response.setHeader('Content-Type','text/html; charset=utf-8');
  if(slug.length>120){
    response.setHeader('Cache-Control','no-store');
    response.status(404).send(request.method==='HEAD'?'':documentFor(null,null,true));
    return;
  }
  try{
    const rows=await publicRows('categories','slug,name,cover_photo',{active:'eq.true',order:'sort_order.asc,name.asc',limit:'100'});
    const category=rows.find((row)=>row.slug===slug);
    const seo=category||slug==='new-arrivals'?storefrontSeo.listing('Category',slug,category?.name||'',url.searchParams):null;
    response.setHeader('Cache-Control',seo?'public, max-age=0, s-maxage=60':'no-store');
    response.status(seo?200:404).send(request.method==='HEAD'?'':documentFor(seo,rows,!seo));
  }catch(error){
    response.setHeader('Cache-Control','no-store');
    response.setHeader('Retry-After','30');
    response.status(503).send(request.method==='HEAD'?'':documentFor(null));
  }
};
