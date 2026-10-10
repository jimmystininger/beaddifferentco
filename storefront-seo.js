(function(root){
  const fields='id,external_id,sku,category_slug,subcategory_slug,name,seo_title,search_text,short_description,description,item_details,shipping_details,etsy_units_per_sale,price,promo_price,promo_starts_at,promo_ends_at,promo_discount_percent,promo_skus,quantity,visible,waitlist_enabled,added_at,low_stock_threshold,badges,featured,sku_filter_definitions';
  const build=(item)=>{
    const id=item.externalId||item.external_id||item.id;
    const name=item.name||'Product Details';
    const seoTitle=item.seoTitle||item.seo_title||name;
    const productDescription=String(item.shortDescription||item.short_description||item.description||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
    const searchDescription=productDescription||`Shop ${name} at Bead Different Co. Explore beads and creative supplies for your next project.`;
    return{title:`${seoTitle} | Bead Different Co.`,description:searchDescription.slice(0,160),searchDescription,canonicalPath:`/product.html?id=${encodeURIComponent(id)}`};
  };
  const schema=(item)=>{
    const {searchDescription,canonicalPath}=build(item);
    return{'@context':'https://schema.org','@type':'Product',name:item.name,url:new URL(canonicalPath,'https://www.beaddifferentco.com').href,description:searchDescription,brand:{'@type':'Brand',name:'Bead Different Co.'},...(item.sku?{sku:item.sku}:{})};
  };
  const listing=(page,slug,label,query=new URLSearchParams())=>{
    const resolvedLabel=label||{'new-arrivals':'New Arrivals','shop-all':'Shop All'}[slug]||page;
    const pageNumber=Math.max(1,Math.floor(Number(query.get('page'))||1));
    const path=page==='Shop All'?'/shop-all.html':`/category.html?category=${encodeURIComponent(slug)}`;
    const filtered=['filters','filterKey','filterValues','style'].some((key)=>query.has(key));
    const canonicalPath=pageNumber>1&&!filtered?`${path}${path.includes('?')?'&':'?'}page=${pageNumber}`:path;
    const title=slug==='shop-all'?'Shop All Beads & Craft Supplies':resolvedLabel;
    const description=slug==='shop-all'?'Explore beads, charms, and creative supplies at Bead Different Co.':`Shop ${resolvedLabel.toLowerCase()} at Bead Different Co. Explore beads and creative supplies for your next project.`;
    return{title:`${title}${pageNumber>1?` — Page ${pageNumber}`:''} | Bead Different Co.`,description,canonicalPath,label:resolvedLabel,path};
  };
  const api={fields,build,schema,listing};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.storefrontSeo=api;
})(typeof window==='undefined'?globalThis:window);
