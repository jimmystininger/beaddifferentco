function shortProductTitle(title){const parts=title.split(',').map((part)=>part.trim()).filter(Boolean);const first=parts[0]||'Bead';const generic=/^(beads?|3d beads|printed beads|silicone beads|focal beads)$/i;if(generic.test(first)&&parts[1]&&!/^(diy|beads? for|beads? in bulk|bead supplies?|loose beads?|small beads?)/i.test(parts[1]))return`${first.replace(/s$/i,'')} ${parts[1]}`.replace(/\s+/g,' ').trim();return first.replace(/\s+/g,' ').trim();}
let catalog=[];
let storeControls={salesFrozen:false,etsyImportsFrozen:false};
let storefrontBestSellerIds=new Set();
let storefrontInventoryAvailability=new Map();
let storefrontAncillaryPromise=null;
const storefrontInventoryById=new Map();
const storefrontInventoryBySku=new Map();
const storefrontProductIdByExternalId=new Map();
window.storefrontBestSellerIds=storefrontBestSellerIds;
window.storefrontInventoryAvailability=storefrontInventoryAvailability;
window.storeControls=storeControls;
const storeKeys={bag:'beadDifferentBag',wishlist:'beadDifferentWishlist',cartOwner:'beadDifferentCartOwner',cartId:'beadDifferentCartId',cartToken:'beadDifferentCartToken',cartDirty:'beadDifferentCartDirty',cartHoldSnapshot:'beadDifferentCartHoldSnapshot',cartHoldUser:'beadDifferentCartHoldUser',promo:'beadDifferentCartPromo'};
const normalizeCartOptions=(options)=>{const values=Array.isArray(options)?options:(options&&typeof options==='object'?[options]:[]);return values.map((option)=>{if(typeof option==='string')return{label:option};return{label:String(option?.label||'').trim(),sku:String(option?.sku||'').trim(),inventorySku:String(option?.inventorySku||'').trim(),inventoryUnits:Math.max(1,Number(option?.inventoryUnits)||1)};}).filter((option)=>option.label||option.sku||option.inventorySku);};
const cartOptionIdentityKey=(options)=>{const normalized=normalizeCartOptions(options);const skuKeys=normalized.map((option)=>String(option.inventorySku||option.sku||'').trim().toLowerCase()).filter(Boolean).sort();return skuKeys.length?`sku:${skuKeys.join('|')}`:`options:${JSON.stringify(normalized)}`;};
const cartLineIdentityKey=(entry)=>`${String(entry?.id||'').trim()}:${cartOptionIdentityKey(entry?.selectedOptions)}`;
const mergeCartEntries=(items=[])=>{const merged=new Map();(Array.isArray(items)?items:[]).forEach((item)=>{if(!item||!String(item.id||'').trim())return;const selectedOptions=normalizeCartOptions(item.selectedOptions);const lineKey=cartLineIdentityKey({...item,selectedOptions});const existing=merged.get(lineKey);if(existing){existing.quantity+=Math.max(1,Number(item.quantity)||1);if(!existing.selectedOptions.some((option)=>option.inventorySku||option.sku)&&selectedOptions.some((option)=>option.inventorySku||option.sku))existing.selectedOptions=selectedOptions;}else merged.set(lineKey,{id:item.id,quantity:Math.max(1,Number(item.quantity)||1),selectedOptions});});return[...merged.values()];};
const readStore=(key)=>JSON.parse(localStorage.getItem(key)||'[]');
const writeStore=(key,value)=>localStorage.setItem(key,JSON.stringify(value));
const readCartPromo=()=>String(localStorage.getItem(storeKeys.promo)||'').trim();
const writeCartPromo=(code)=>{const normalized=String(code||'').trim();if(normalized)localStorage.setItem(storeKeys.promo,normalized);else localStorage.removeItem(storeKeys.promo);};
const storefrontSessionCacheRead=(key,ttlMs)=>{try{const record=JSON.parse(sessionStorage.getItem(key)||'null');if(record?.at&&Date.now()-Number(record.at)<ttlMs)return record.data;}catch(error){}return null;};
const storefrontSessionCacheWrite=(key,data)=>{try{sessionStorage.setItem(key,JSON.stringify({at:Date.now(),data}));}catch(error){}};
// Keep a local handoff snapshot so logging out and back in does not re-merge the same account cart.
const cartSnapshot=(items=[])=>JSON.stringify((Array.isArray(items)?items:[]).map((item)=>{const product=typeof findProduct==='function'?findProduct(item?.id):null;return{id:String(product?.externalId||product?.id||item?.id||''),quantity:Math.max(1,Number(item?.quantity)||1),selectedOptions:normalizeCartOptions(item?.selectedOptions)};}).filter((item)=>item.id).sort((first,second)=>`${first.id}:${JSON.stringify(first.selectedOptions)}`.localeCompare(`${second.id}:${JSON.stringify(second.selectedOptions)}`)));
function parseCsv(text){const rows=[];let row=[],cell='',quoted=false;for(let index=0;index<text.length;index+=1){const char=text[index],next=text[index+1];if(char==='"'&&quoted&&next==='"'){cell+='"';index+=1;}else if(char==='"'){quoted=!quoted;}else if(char===','&&!quoted){row.push(cell);cell='';}else if((char==='\n'||char==='\r')&&!quoted){if(char==='\r'&&next==='\n')index+=1;row.push(cell);if(row.some((value)=>value!==''))rows.push(row);row=[];cell='';}else cell+=char;}if(cell||row.length){row.push(cell);rows.push(row);}const headers=rows.shift().map((header)=>header.replace(/^\uFEFF/,''));return rows.map((values)=>Object.fromEntries(headers.map((header,index)=>[header,values[index]||''])));}
async function ensureSupabaseClient(){if(window.beadSupabase)return window.beadSupabase;if(window.beadSupabaseReady)return window.beadSupabaseReady;const loadScript=(source)=>new Promise((resolve)=>{const script=document.createElement('script');script.src=source;script.onload=resolve;script.onerror=()=>resolve();document.head.append(script);});const librarySource='/vendor/supabase.min.js';window.beadSupabaseReady=(window.supabase?Promise.resolve():loadScript(librarySource)).then(()=>window.beadSupabase?window.beadSupabase:loadScript('supabase-client.js?v=20260920-canonical44').then(()=>window.beadSupabase||window.supabase?.createClient(window.beadSupabaseUrl,window.beadSupabasePublishableKey)));return window.beadSupabaseReady;}
async function loadStoreControls(){const cached=storefrontSessionCacheRead('beadStoreControlsV1',60000);if(cached&&typeof cached==='object'){storeControls.salesFrozen=cached.salesFrozen===true;storeControls.etsyImportsFrozen=cached.etsyImportsFrozen===true;return storeControls;}const client=await ensureSupabaseClient();if(!client)return storeControls;const result=await withStoreTimeout(client.from('storefront_store_controls').select('sales_frozen,etsy_imports_frozen').maybeSingle(),'Store controls request');if(!result.error&&result.data){storeControls.salesFrozen=result.data.sales_frozen===true;storeControls.etsyImportsFrozen=result.data.etsy_imports_frozen===true;storefrontSessionCacheWrite('beadStoreControlsV1',{salesFrozen:storeControls.salesFrozen,etsyImportsFrozen:storeControls.etsyImportsFrozen});}return storeControls;}async function loadPublicRewardSettings(){const cached=storefrontSessionCacheRead('beadStoreRewardSettingsV1',300000);if(cached&&typeof cached==='object'&&window.productStoreConfig){window.productStoreConfig.rewardThreshold=Math.max(0.01,Number(cached.threshold)||35);window.productStoreConfig.rewardDiscountPercent=Math.min(100,Math.max(0.01,Number(cached.discountPercent)||5));return window.productStoreConfig;}const client=await ensureSupabaseClient();if(!client||!window.productStoreConfig)return window.productStoreConfig;const result=await withStoreTimeout(client.rpc('get_storefront_reward_settings'),'Reward settings request');if(!result.error&&result.data){window.productStoreConfig.rewardThreshold=Math.max(0.01,Number(result.data.threshold)||35);window.productStoreConfig.rewardDiscountPercent=Math.min(100,Math.max(0.01,Number(result.data.discountPercent)||5));storefrontSessionCacheWrite('beadStoreRewardSettingsV1',{threshold:window.productStoreConfig.rewardThreshold,discountPercent:window.productStoreConfig.rewardDiscountPercent});}return window.productStoreConfig;}
const storeRequestTimeoutMs=12000;const withStoreTimeout=(request,label)=>Promise.race([request,new Promise((_,reject)=>setTimeout(()=>reject(new Error(label+' timed out.')),storeRequestTimeoutMs))]);const fetchStorePages=async(buildQuery,pageSize=1000)=>{const rows=[];for(let page=0;;page+=1){const result=await withStoreTimeout(buildQuery().range(page*pageSize,page*pageSize+pageSize-1),'Store data request');if(result.error)return result;rows.push(...(result.data||[]));if((result.data||[]).length<pageSize)return{data:rows,error:null};}};
const fetchStoreBatches=async(values,buildQuery,batchSize=500)=>{const rows=[];for(let start=0;start<values.length;start+=batchSize){const result=await withStoreTimeout(buildQuery(values.slice(start,start+batchSize)),'Store data request');if(result.error)return result;rows.push(...(result.data||[]));}return{data:rows,error:null};};
const cacheStorefrontInventoryRecords=(rows=[])=>{(rows||[]).forEach((record)=>{if(!record||typeof record!=='object')return;const normalizedSku=String(record.sku||'').trim().toLowerCase();if(record.id)storefrontInventoryById.set(String(record.id),record);if(normalizedSku)storefrontInventoryBySku.set(normalizedSku,{...(storefrontInventoryBySku.get(normalizedSku)||{}),...record});});};
const storefrontInventoryForSku=(sku)=>storefrontInventoryBySku.get(String(sku||'').trim().toLowerCase())||null;
async function loadStorefrontBestSellers(){const cached=storefrontSessionCacheRead('beadStoreBestSellersV1',300000);if(Array.isArray(cached)){storefrontBestSellerIds=new Set(cached.map((value)=>String(value||'').trim()).filter(Boolean));window.storefrontBestSellerIds=storefrontBestSellerIds;return storefrontBestSellerIds;}const client=await ensureSupabaseClient();if(!client){window.storefrontBestSellerIds=storefrontBestSellerIds;return storefrontBestSellerIds;}try{const result=await withStoreTimeout(client.rpc('get_storefront_best_sellers',{limit_count:25}),'Best sellers request');if(!result.error){const ids=(result.data||[]).map((row)=>String(row.product_external_id||'').trim()).filter(Boolean);storefrontBestSellerIds=new Set(ids);storefrontSessionCacheWrite('beadStoreBestSellersV1',ids);}}catch(error){}window.storefrontBestSellerIds=storefrontBestSellerIds;return storefrontBestSellerIds;}

const storefrontCategoryRequest=()=>{
  const query=new URLSearchParams(location.search);
  const requested=query.get('category')||'';
  const style=query.get('style')||'';
  let filters={};
  try{const parsed=JSON.parse(query.get('filters')||'{}');if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))filters=parsed;}catch(error){}
  const filterKey=query.get('filterKey')||'';
  const filterValues=(query.get('filterValues')||'').split(',').map((value)=>value.trim()).filter(Boolean);
  const page=document.body.dataset.page||'';
  const categorySlugs=requested&&requested!=='shop-all'&&requested!=='new-arrivals'?[requested]:[];
  let selectedFilterKey=filterKey||null;
  let selectedFilterValues=filterValues;
  if(requested==='silicone'&&style)filters.style=[style];
  if(requested==='acrylic'&&style)filters.size=[style];
  if(!selectedFilterKey){const firstKey=Object.keys(filters).find((key)=>Array.isArray(filters[key])&&filters[key].length);if(firstKey){selectedFilterKey=firstKey;selectedFilterValues=filters[firstKey].map((value)=>String(value));}}
  if(selectedFilterKey&&selectedFilterValues.length&&!Object.keys(filters).length)filters[selectedFilterKey]=selectedFilterValues;
  const recentSince=(requested==='new-arrivals'||page==='New Arrivals')?new Date(Date.now()-30*24*60*60*1000).toISOString():null;
  return{categorySlugs:Array.isArray(categorySlugs)?categorySlugs:[],recentSince,filterKey:selectedFilterKey,filterValues:selectedFilterValues,filters};
};
const storefrontListingPage=()=>document.body.dataset.categoryLayout==='true'||['Category','Shop All','New Arrivals','Acrylic Beads','Silicone Beads','Rhinestones','Flatbacks','Pen Supplies','Mixes & Kits','Clearance','Focal Beads'].includes(document.body.dataset.page||'');
const storefrontCategoryListing={page:1,pageSize:24,total:0,request:storefrontCategoryRequest()};
const mapStorefrontListingRows=(rows,optionRows=[])=>rows.map((item)=>({
  ...item,
  id:item.external_id||item.id,
  databaseId:item.id,
  externalId:item.external_id,
  seoTitle:item.seo_title||item.name,
  searchText:item.search_text||item.seo_title||item.name,
  category:item.subcategory_slug||item.category_slug,
  categorySlugs:[...new Set([item.category_slug,item.subcategory_slug].filter(Boolean))],
  image:item.lead_image_url||'',
  images:item.lead_image_url?[item.lead_image_url]:[],
  media:item.lead_image_url?[{url:item.lead_image_url,type:'image'}]:[],
  options:optionRows.filter((option)=>option.product_id===item.id).map((option)=>({name:option.name,required:option.required,values:(option.product_option_values||[]).sort((a,b)=>a.sort_order-b.sort_order).map((value)=>({label:value.inventory_skus?.name||'',price:value.inventory_skus?.price===null||value.inventory_skus?.price===undefined?Number(item.price||0):Number(value.inventory_skus.price)||0,sku:value.inventory_skus?.sku||'',inventorySku:value.inventory_skus?.sku||'',inventoryUnits:1,imageUrl:'',unitType:value.inventory_skus?.unit_type||'Each',quantity:value.inventory_skus?.quantity_available===null||value.inventory_skus?.quantity_available===undefined?0:Number(value.inventory_skus.quantity_available)||0,lowStockThreshold:0}))})),
  price:Number(item.price)||0,
  promoPrice:item.promo_price===null||item.promo_price===undefined?null:Number(item.promo_price),
  displayPrice:Number(item.price)||0,
  promoDiscountPercent:Number(item.promo_discount_percent)||0,
  promoSkus:Array.isArray(item.promo_skus)?item.promo_skus:[],
  addedAt:item.added_at,
  waitlist:item.waitlist_enabled,
  description:item.description||'',
  shortDescription:item.short_description||'',
  itemDetails:item.item_details||'',
  shippingDetails:item.shipping_details||'',
  etsyUnitsPerSale:Number(item.etsy_units_per_sale)||1,
  quantity:Number(item.quantity)||0,
  lowStockThreshold:Number(item.low_stock_threshold)||0,
  badges:Array.isArray(item.badges)?item.badges:[]
}));
async function loadStorefrontCategoryPage(pageNumber=1){
  const client=await ensureSupabaseClient();
  if(!client){catalog=[];window.storeCatalogError=new Error('The live store catalog could not be connected.');return catalog;}
  const page=Math.max(1,Math.floor(Number(pageNumber)||1));
  let result=await withStoreTimeout(client.rpc('get_storefront_category_products_v2',{
    category_slugs:storefrontCategoryListing.request.categorySlugs,
    page_size:storefrontCategoryListing.pageSize,
    page_offset:(page-1)*storefrontCategoryListing.pageSize,
    recent_since:storefrontCategoryListing.request.recentSince,
    filter_selections:storefrontCategoryListing.request.filters
  }),'Category products request');
  if(result.error){catalog=[];window.storeCatalogError=result.error;return catalog;}
  const rows=result.data||[];
  catalog=mapStorefrontListingRows(rows);
  try{
    const optionResult=await fetchStoreBatches(rows.map((item)=>item.id),(batch)=>client.from('product_options').select('id,product_id,name,required,sort_order,product_option_values(id,inventory_sku_id,sort_order)').in('product_id',batch).order('sort_order'));
    if(!optionResult.error){
      const hydratedOptionRows=await hydrateStorefrontOptionInventory(client,optionResult.data||[]);
      catalog=mapStorefrontListingRows(rows,hydratedOptionRows);
    }else window.storeCatalogOptionsError=optionResult.error;
  }catch(error){window.storeCatalogOptionsError=error;}
  storefrontCategoryListing.page=page;
  storefrontCategoryListing.total=Number(rows[0]?.total_count)||0;
  window.storeCategoryPagination={
    page:()=>storefrontCategoryListing.page,
    pageSize:()=>storefrontCategoryListing.pageSize,
    total:()=>storefrontCategoryListing.total,
    load:loadStorefrontCategoryPage
  };
  return catalog;
}
async function loadStorefrontCategoryFilters(categorySlug){
  const client=await ensureSupabaseClient();
  if(!client||!categorySlug)return[];
  const result=await withStoreTimeout(client.rpc('get_storefront_category_filters',{p_category_slug:categorySlug,p_filter_selections:storefrontCategoryListing.request.filters||{}}),'Category filters request');
  if(result.error){window.storefrontCategoryFiltersError=result.error;return[];}
  let filters=Array.isArray(result.data)?result.data:[];
  const allowed=new Map(filters.map((filter)=>[String(filter.key||''),new Set((Array.isArray(filter.values)?filter.values:[]).map((value)=>String(value.key||'')))]));
  const current=storefrontCategoryListing.request.filters||{};
  const sanitized=Object.fromEntries(Object.entries(current).map(([key,values])=>[key,(Array.isArray(values)?values:[]).map(String).filter((value)=>allowed.get(key)?.has(value))]).filter(([,values])=>values.length));
  window.storefrontCategoryFiltersChanged=JSON.stringify(current)!==JSON.stringify(sanitized);
  storefrontCategoryListing.request.filters=sanitized;
  window.storefrontCategoryFilters=filters;
  window.dispatchEvent(new CustomEvent('bead-category-filters-ready',{detail:{categorySlug,filters}}));
  return filters;
}
window.loadStorefrontCategoryFilters=loadStorefrontCategoryFilters;
async function hydrateStorefrontOptionInventory(client,optionRows){
  const inventoryIds=[...new Set((optionRows||[]).flatMap((option)=>option.product_option_values||[]).map((value)=>String(value.inventory_sku_id||'').trim()).filter(Boolean))];
  if(!inventoryIds.length)return optionRows||[];
  const result=await fetchStoreBatches(inventoryIds,(batch)=>client.from('storefront_inventory_skus').select('id,sku,name,quantity_available,price,unit_type,weight_value,weight_unit').in('id',batch));
  if(result.error){window.storeCatalogOptionsError=result.error;return optionRows||[];}
  cacheStorefrontInventoryRecords(result.data||[]);
  return (optionRows||[]).map((option)=>({...option,product_option_values:(option.product_option_values||[]).map((value)=>({...value,inventory_skus:storefrontInventoryById.get(String(value.inventory_sku_id||''))||null}))}));
}
async function loadCatalog(){
  const client=await ensureSupabaseClient();
  if(!client){catalog=[];window.storeCatalogError=new Error('The live store catalog could not be connected.');return catalog;}
  if(storefrontListingPage())return loadStorefrontCategoryPage(1);
  const pageName=document.body.dataset.page||'';
  // Static content pages do not render product cards. Avoid loading the full
  // catalog, images, and option graph merely to render their shared header.
  if(!['Home','Product','Search','Sale Collection','Wishlist','Account'].includes(pageName)){catalog=[];return catalog;}
  const homepage=document.body.dataset.page==='Home';
  const productPageId=document.body.dataset.page==='Product'?(document.body.dataset.productId||new URLSearchParams(location.search).get('id')||''):'';
  const productQueryFor=()=>{
    let productQuery=client.from('products').select('id,external_id,sku,category_slug,subcategory_slug,name,seo_title,search_text,description,item_details,shipping_details,etsy_units_per_sale,price,promo_price,promo_starts_at,promo_ends_at,promo_discount_percent,promo_skus,quantity,visible,waitlist_enabled,added_at,low_stock_threshold,badges,sku_filter_definitions');
    if(document.body.dataset.page!=='Admin')productQuery=productQuery.eq('visible',true);
    if(productPageId){const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;productQuery=productQuery.eq(uuidPattern.test(productPageId)?'id':'external_id',productPageId).neq('id',crypto.randomUUID());}
    return productQuery;
  };
  let data=[],error=null;
  try{
    if(productPageId){
      // Detail pages must never accept an unrelated row returned by an
      // intermediary cache. Read the exact public row through REST with a
      // unique discriminator and validate the identifier before mapping it.
      const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const filterField=uuidPattern.test(productPageId)?'id':'external_id';
      const select='id,external_id,sku,category_slug,subcategory_slug,name,seo_title,search_text,description,item_details,shipping_details,etsy_units_per_sale,price,promo_price,promo_starts_at,promo_ends_at,promo_discount_percent,promo_skus,quantity,visible,waitlist_enabled,added_at,low_stock_threshold,badges,sku_filter_definitions';
      const nonce=crypto.randomUUID();
      const response=await withStoreTimeout(fetch(`${window.beadSupabaseUrl}/rest/v1/products?select=${encodeURIComponent(select)}&visible=eq.true&${filterField}=eq.${encodeURIComponent(productPageId)}&id=neq.${nonce}&limit=1`,{headers:{apikey:window.beadSupabasePublishableKey,Authorization:`Bearer ${window.beadSupabasePublishableKey}`,'Cache-Control':'no-cache','Pragma':'no-cache'},cache:'no-store'}),'Product request');
      const responseData=await response.json();
      const exactRow=Array.isArray(responseData)?responseData.find((row)=>String(row?.id||'')===productPageId||String(row?.external_id||'')===productPageId):null;
      if(!response.ok)error=new Error(`Product request failed (${response.status}).`);
      else if(exactRow)data=[exactRow];
      else error=new Error('The product request returned an unrelated row.');
    }else if(document.body.dataset.page==='Search'){
      const query=new URLSearchParams(location.search).get('q')||'';
      const page=Math.max(1,Number(new URLSearchParams(location.search).get('page')||1));
      const result=await withStoreTimeout(client.rpc('search_storefront_products',{search_query:query,page_size:24,page_offset:(page-1)*24}),'Search products request');
      data=result.data||[];error=result.error||null;
      window.storeSearchPagination={page,total:Number(data[0]?.total_count)||0,pageSize:24};
    }else if(document.body.dataset.page==='Wishlist'){
      let saved=[];
      try{saved=JSON.parse(localStorage.getItem(storeKeys.wishlist)||'[]').map((value)=>String(value||'').trim()).filter(Boolean);}catch(error){saved=[];}
      saved=[...new Set(saved)].slice(0,100);
      if(!saved.length){data=[];}else{
        const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const externalIds=saved.filter((value)=>!uuidPattern.test(value));
        const databaseIds=saved.filter((value)=>uuidPattern.test(value));
        const results=await Promise.all([
          externalIds.length?productQueryFor().in('external_id',externalIds):Promise.resolve({data:[],error:null}),
          databaseIds.length?productQueryFor().in('id',databaseIds):Promise.resolve({data:[],error:null})
        ]);
        const failed=results.find((result)=>result.error);data=results.flatMap((result)=>result.data||[]);error=failed?.error||null;
      }
    }else if(document.body.dataset.page==='Sale Collection'){
      const page=Math.max(1,Number(new URLSearchParams(location.search).get('page')||1));
      const result=await withStoreTimeout(client.rpc('get_storefront_sale_products',{page_size:24,page_offset:(page-1)*24}),'Sale products request');
      data=result.data||[];error=result.error||null;
      window.storeSalePagination={page,total:Number(data[0]?.total_count)||0,pageSize:24};
    }else if(document.body.dataset.page==='Account'){
      // Account data has bounded, user-scoped queries in account.js. Only
      // hydrate locally saved favorites when the offline account needs them.
      let saved=[];
      try{
        saved=JSON.parse(localStorage.getItem(storeKeys.wishlist)||'[]');
        const session=JSON.parse(localStorage.getItem('beadDifferentAccount')||'null');
        const profiles=JSON.parse(localStorage.getItem('beadDifferentProfiles')||'[]');
        saved=[...saved,...(profiles.find((profile)=>profile.id===session?.id)?.favorites||[])].map((value)=>String(value||'').trim()).filter(Boolean);
      }catch(error){saved=[];}
      saved=[...new Set(saved)].slice(0,100);
      if(!saved.length){data=[];}else{
        const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const externalIds=saved.filter((value)=>!uuidPattern.test(value));
        const databaseIds=saved.filter((value)=>uuidPattern.test(value));
        const results=await Promise.all([
          externalIds.length?productQueryFor().in('external_id',externalIds):Promise.resolve({data:[],error:null}),
          databaseIds.length?productQueryFor().in('id',databaseIds):Promise.resolve({data:[],error:null})
        ]);
        const failed=results.find((result)=>result.error);data=results.flatMap((result)=>result.data||[]);error=failed?.error||null;
      }
    }else{
      const result=await fetchStorePages(()=>productQueryFor().order('added_at',{ascending:false}).limit(homepage?12:1000));
      data=result.data||[];error=result.error||null;
    }
  }catch(requestError){error=requestError;window.storeCatalogError=requestError;}
  if(error){catalog=[];window.storeCatalogError=error;return catalog;}
  if(!data?.length){catalog=[];return catalog;}
  const mapRows=(sourceRows,imagesByProduct=new Map(),optionRows=[])=>sourceRows.map((item)=>{
    const media=imagesByProduct.get(item.id)||[];
    return{...item,id:item.external_id||item.id,databaseId:item.id,externalId:item.external_id,seoTitle:item.seo_title||item.name,searchText:item.search_text||item.seo_title||item.name,category:item.subcategory_slug||item.category_slug,image:media.find((entry)=>entry.media_type!=='video')?.url||item.lead_image_url||'product-mix.jpg',images:media.filter((entry)=>entry.media_type!=='video').map((entry)=>entry.url),media:media.map((entry)=>({url:entry.url,type:entry.media_type||'image'})),options:optionRows.filter((option)=>option.product_id===item.id).map((option)=>({name:option.name,required:option.required,values:(option.product_option_values||[]).sort((a,b)=>a.sort_order-b.sort_order).map((value)=>({label:value.inventory_skus?.name||'',price:value.inventory_skus?.price===null||value.inventory_skus?.price===undefined?Number(item.price||0):Number(value.inventory_skus.price)||0,sku:value.inventory_skus?.sku||'',inventorySku:value.inventory_skus?.sku||'',inventoryUnits:1,imageUrl:'',unitType:value.inventory_skus?.unit_type||'Each',quantity:value.inventory_skus?.quantity_available===null||value.inventory_skus?.quantity_available===undefined?0:Number(value.inventory_skus.quantity_available)||0,lowStockThreshold:0}))})),price:Number(item.price)||0,promoPrice:null,displayPrice:Number(item.price)||0,promoDiscountPercent:Number(item.promo_discount_percent)||0,promoSkus:Array.isArray(item.promo_skus)?item.promo_skus:[],addedAt:item.added_at,waitlist:item.waitlist_enabled,description:item.description||'',itemDetails:item.item_details||'',shippingDetails:item.shipping_details||'',etsyUnitsPerSale:Number(item.etsy_units_per_sale)||1,quantity:Number(item.quantity)||0,lowStockThreshold:Number(item.low_stock_threshold)||0,badges:Array.isArray(item.badges)?item.badges:[]};
  });
  const productIds=data.map((item)=>item.id);
  const enrichCatalog=async()=>{
    // Product visibility must not depend on optional media/option enrichment.
    // A slow or restricted child request used to reject loadCatalog entirely,
    // leaving the otherwise public product looking like an unavailable item.
    const [imageResult,optionResult]=await Promise.all([
      fetchStoreBatches(productIds,(batch)=>client.from('product_images').select('id,product_id,url,alt_text,sort_order,media_type').in('product_id',batch).order('sort_order').order('id')).catch((error)=>({data:[],error})),
      fetchStoreBatches(productIds,(batch)=>client.from('product_options').select('id,product_id,name,required,sort_order,product_option_values(id,inventory_sku_id,sort_order)').in('product_id',batch).order('sort_order')).catch((error)=>({data:[],error}))
    ]);
    if(imageResult.error)window.storeCatalogImagesError=imageResult.error;
    if(optionResult.error)window.storeCatalogOptionsError=optionResult.error;
    const imagesByProduct=new Map();
    (imageResult.data||[]).forEach((image)=>{const images=imagesByProduct.get(image.product_id)||[];images.push(image);imagesByProduct.set(image.product_id,images);});
    let hydratedOptionRows=optionResult.data||[];
    try{hydratedOptionRows=await hydrateStorefrontOptionInventory(client,hydratedOptionRows);}catch(error){window.storeCatalogOptionsError=error;}
    catalog=mapRows(data,imagesByProduct,hydratedOptionRows);
    window.dispatchEvent(new Event('bead-catalog-enriched'));
    return catalog;
  };
  const applyPageScopedSkuOptions=async()=>{
    const skus=[...new Set(catalog.flatMap((item)=>(item.options||[]).flatMap((option)=>option.values||[])).map((value)=>String(value?.inventorySku||value?.sku||'').trim()).filter(Boolean))];
    if(!skus.length)return;
    let result;
    try{result=await fetchStoreBatches(skus,(batch)=>client.from('storefront_inventory_skus').select('sku,name,product_pages').in('sku',batch));}catch(error){window.storeCatalogOptionsError=error;window.dispatchEvent(new CustomEvent('bead-catalog-options-error',{detail:{error}}));return;}
    if(result.error){
      window.storeCatalogOptionsError=result.error;
      window.dispatchEvent(new CustomEvent('bead-catalog-options-error',{detail:{error:result.error}}));
      return;
    }
    window.storeCatalogOptionsError=null;
    cacheStorefrontInventoryRecords(result.data||[]);
    const bySku=new Map((result.data||[]).map((row)=>[String(row.sku||'').trim().toLowerCase(),row]));
    catalog.forEach((item)=>{
      const values=(item.options||[]).flatMap((option)=>option.values||[]).filter((value)=>typeof value==='object');
      const pageKey=String(item.databaseId||'');
      item.options=(item.options||[]).map((option)=>({...option,values:(option.values||[]).map((value)=>{const sku=String(value.inventorySku||value.sku||'').trim();const record=bySku.get(sku.toLowerCase());return record?.name?{...value,label:String(record.name).trim()}:value;})}));
      item.sku_filter_definitions=(Array.isArray(item.sku_filter_definitions)?item.sku_filter_definitions:[]).map((definition)=>{const label=String(definition?.label||'').trim();const options={};values.forEach((value)=>{const sku=String(value.inventorySku||value.sku||'').trim();const page=bySku.get(sku.toLowerCase())?.product_pages?.[pageKey];const answers=Array.isArray(page?.options)?page.options:[];const answer=answers.find((entry)=>String(entry?.name||'').trim().toLowerCase()===label.toLowerCase());if(answer&&String(answer.value||'').trim())options[sku]=String(answer.value).trim();});return{label,options};});
    });
  };
  const fastCategoryRender=document.body.dataset.categoryLayout==='true';
  catalog=mapRows(data);
  if(fastCategoryRender)void enrichCatalog().then(applyPageScopedSkuOptions).catch((enrichmentError)=>{window.storeCatalogAncillaryError=enrichmentError;});
  else {await enrichCatalog();await applyPageScopedSkuOptions();}
  return catalog;
}
async function applyCanonicalInventory(){
  if(!window.beadSupabase||!catalog.length)return catalog;
  const skus=[...new Set(catalog.flatMap((item)=>[item.sku||'',...(item.options||[]).flatMap((option)=>option.values||[])]).map((value)=>typeof value==='object'?(value.inventorySku||value.sku):value).map((sku)=>String(sku||'').trim()).filter(Boolean))];
  if(!skus.length)return catalog;
  const missingSkus=skus.filter((sku)=>!storefrontInventoryForSku(sku));
  if(missingSkus.length){
    const result=await fetchStoreBatches(missingSkus,(batch)=>window.beadSupabase.from('storefront_inventory_skus').select('id,sku,name,quantity_available,price,unit_type,weight_value,weight_unit').in('sku',batch));
    if(result.error)return catalog;
    cacheStorefrontInventoryRecords(result.data||[]);
  }
  catalog.forEach((item)=>{
    item.options=(item.options||[]).map((option)=>({...option,values:(option.values||[]).map((value)=>{
      if(typeof value!=='object')return value;
      const record=storefrontInventoryForSku(value.inventorySku||value.sku);
      if(!record)return value;
      return {...value,sku:record.sku,inventorySku:record.sku,price:record.price===null?value.price:Number(record.price),unitType:record.unit_type||value.unitType||'Each',weight:record.weight_value===null||record.weight_value===undefined?null:Number(record.weight_value),weightUnit:record.weight_unit||value.weightUnit||'oz',quantity:Math.max(0,Number(record.quantity_available)||0)};
    })}));
    const variants=(item.options||[]).flatMap((option)=>option.values||[]).filter((value)=>typeof value==='object'&&value.sku);
    const itemRecord=storefrontInventoryForSku(item.sku);
    if(itemRecord){item.price=itemRecord.price===null||itemRecord.price===undefined?item.price:Number(itemRecord.price);item.displayPrice=item.price;item.unitType=itemRecord.unit_type||item.unitType||'Each';item.weight=itemRecord.weight_value===null||itemRecord.weight_value===undefined?null:Number(itemRecord.weight_value);item.weightUnit=itemRecord.weight_unit||'oz';}
    if(variants.length)item.quantity=variants.reduce((total,value)=>total+Number(value.quantity||0),0);else if(itemRecord)item.quantity=Math.max(0,Number(itemRecord.quantity_available)||0);
  });
  (skus||[]).forEach((sku)=>{const record=storefrontInventoryForSku(sku);if(record)storefrontInventoryAvailability.set(String(sku).trim().toLowerCase(),Math.max(0,Number(record.quantity_available)||0));});
  window.storefrontInventoryAvailability=storefrontInventoryAvailability;
  return catalog;
}
async function applyCanonicalInventoryNames(){
  if(!window.beadSupabase||!catalog.length)return catalog;
  const skus=[...new Set(catalog.flatMap((item)=>[item.sku||'',...(item.options||[]).flatMap((option)=>option.values||[])]).map((value)=>typeof value==='object'?(value.inventorySku||value.sku):value).map((sku)=>String(sku||'').trim()).filter(Boolean))];
  if(!skus.length)return catalog;
  const missingSkus=skus.filter((sku)=>!storefrontInventoryForSku(sku)?.name);
  if(missingSkus.length){
    const result=await fetchStoreBatches(missingSkus,(batch)=>window.beadSupabase.from('storefront_inventory_skus').select('sku,name').in('sku',batch));
    if(result.error)return catalog;
    cacheStorefrontInventoryRecords(result.data||[]);
  }
  catalog.forEach((item)=>{item.options=(item.options||[]).map((option)=>({...option,values:(option.values||[]).map((value)=>{if(typeof value!=='object')return value;const record=storefrontInventoryForSku(value.inventorySku||value.sku);return record?.name?{...value,label:String(record.name).trim()}:value;})}));});
  return catalog;
}
let storefrontBundleComponentsPromise=null;
const loadStorefrontBundleComponents=()=>{
  if(storefrontBundleComponentsPromise)return storefrontBundleComponentsPromise;
  storefrontBundleComponentsPromise=(async()=>{
  if(!window.beadSupabase||!catalog.length)return catalog;
  // Bundle recipes are needed only for SKUs on this catalog page. Loading the
  // entire recipe table on every storefront route was a large, repeated read.
  const currentSkus=[...new Set(catalog.flatMap((item)=>[item.sku||'',...(item.options||[]).flatMap((option)=>option.values||[]).map((value)=>typeof value==='object'?(value.inventorySku||value.sku):value)]).map((sku)=>String(sku||'').trim()).filter(Boolean))];
  const missingSkus=currentSkus.filter((sku)=>!storefrontInventoryForSku(sku)?.id);
  if(missingSkus.length){
    const skuResult=await fetchStoreBatches(missingSkus,(batch)=>window.beadSupabase.from('storefront_inventory_skus').select('id,sku,quantity_available').in('sku',batch));
    if(skuResult.error)return catalog;
    cacheStorefrontInventoryRecords(skuResult.data||[]);
  }
  const bundleIds=currentSkus.map((sku)=>storefrontInventoryForSku(sku)?.id).filter(Boolean);
  const result=bundleIds.length?await fetchStoreBatches(bundleIds,(batch)=>window.beadSupabase.from('inventory_bundle_components').select('bundle_sku_id,component_sku_id,quantity,sort_order').in('bundle_sku_id',batch).order('sort_order')):{data:[],error:null};
  if(result.error)return catalog;
  const ids=[...new Set((result.data||[]).flatMap((entry)=>[entry.bundle_sku_id,entry.component_sku_id]).filter(Boolean))];
  const lookup=ids.length?await fetchStorePages(()=>window.beadSupabase.from('storefront_inventory_skus').select('id,sku,quantity_available').in('id',ids)):{data:[],error:null};
  if(lookup.error)return catalog;
  cacheStorefrontInventoryRecords(lookup.data||[]);
  const skuById=new Map((lookup.data||[]).map((entry)=>[entry.id,entry.sku]));
  (lookup.data||[]).forEach((entry)=>storefrontInventoryAvailability.set(String(entry.sku||'').trim().toLowerCase(),Math.max(0,Number(entry.quantity_available)||0)));
  window.storefrontInventoryAvailability=storefrontInventoryAvailability;
  const byBundle=new Map();
  (result.data||[]).forEach((entry)=>{const bundleSku=skuById.get(entry.bundle_sku_id);if(!bundleSku)return;const key=String(bundleSku).trim().toLowerCase();const rows=byBundle.get(key)||[];rows.push({componentSku:skuById.get(entry.component_sku_id)||'',quantity:Math.max(1,Number(entry.quantity)||1),sortOrder:Number(entry.sort_order)||0});byBundle.set(key,rows);});
  catalog.forEach((item)=>{const skus=[item.sku||'',...(item.options||[]).flatMap((option)=>option.values||[]).map((value)=>typeof value==='object'?(value.inventorySku||value.sku):value)].filter(Boolean);item.bundleComponents=skus.flatMap((sku)=>byBundle.get(String(sku).trim().toLowerCase())||[]);});
window.storefrontBundleRecipes=byBundle;
  window.dispatchEvent(new Event('bead-inventory-recipes-ready'));
  return catalog;
  })();
  return storefrontBundleComponentsPromise;
};
async function loadCartCatalog(additionalIds=[]){
  const client=await ensureSupabaseClient();
  if(!client){catalog=[];window.storeCatalogError=new Error('The live shopping bag could not be connected.');window.storeCartCatalogState='error';return catalog;}
  let storedBag=[];
  try{storedBag=JSON.parse(localStorage.getItem(storeKeys.bag)||'[]');}catch(error){}
  let ids=[...new Set(storedBag.map((entry)=>String(entry?.id||'').trim()).filter(Boolean))];
  ids=[...new Set(ids.concat((Array.isArray(additionalIds)?additionalIds:[]).map((id)=>String(id||'').trim()).filter(Boolean)))];
    const productFields='id,external_id,sku,category_slug,subcategory_slug,name,seo_title,search_text,description,item_details,shipping_details,etsy_units_per_sale,price,promo_price,promo_starts_at,promo_ends_at,promo_discount_percent,promo_skus,quantity,visible,waitlist_enabled,added_at,low_stock_threshold,badges,sku_filter_definitions';
  const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const loadRows=async(productIds)=>{
    const externalIds=productIds.filter((id)=>!uuidPattern.test(id));
    const databaseIds=productIds.filter((id)=>uuidPattern.test(id));
    const requests=[];
    if(externalIds.length)requests.push(fetchStoreBatches(externalIds,(batch)=>client.from('products').select(productFields).in('external_id',batch)));
    if(databaseIds.length)requests.push(fetchStoreBatches(databaseIds,(batch)=>client.from('products').select(productFields).in('id',batch)));
    if(!requests.length)return{data:[],error:null};
    const results=await Promise.all(requests);
    const failed=results.find((result)=>result.error);
    if(failed)return{data:[],error:failed.error};
    return{data:[...new Map(results.flatMap((result)=>result.data||[]).map((row)=>[row.id,row])).values()],error:null};
  };
  const resolveParentProductIds=async(identifiers)=>{
    const values=[...new Set(identifiers.map((value)=>String(value||'').trim()).filter(Boolean))];
    if(!values.length)return[];
    const uuidValues=values.filter((value)=>uuidPattern.test(value));
    const valueRequests=[
      fetchStoreBatches(values,(batch)=>client.from('product_option_values').select('id,option_id').in('sku',batch)),
      fetchStoreBatches(values,(batch)=>client.from('product_option_values').select('id,option_id').in('inventory_sku',batch))
    ];
    if(uuidValues.length)valueRequests.push(fetchStoreBatches(uuidValues,(batch)=>client.from('product_option_values').select('id,option_id,inventory_sku_id').in('inventory_sku_id',batch)));
    if(uuidValues.length)valueRequests.push(fetchStoreBatches(uuidValues,(batch)=>client.from('product_option_values').select('id,option_id').in('id',batch)));
    const valueResults=await Promise.all(valueRequests);
    if(valueResults.some((result)=>result.error))return[];
    const optionIds=[...new Set(valueResults.flatMap((result)=>result.data||[]).map((row)=>row.option_id).filter(Boolean))];
    if(!optionIds.length)return[];
    const optionResult=await withStoreTimeout(client.from('product_options').select('id,product_id').in('id',optionIds),'Cart product resolution request');
    if(optionResult.error)return[];
    return[...new Set((optionResult.data||[]).map((option)=>option.product_id).filter(Boolean))];
  };
  let rowsResult=await loadRows(ids);
  if(rowsResult.error){catalog=[];window.storeCatalogError=rowsResult.error;window.storeCartCatalogState='error';return catalog;}
  let rows=rowsResult.data||[];
  const directIdentifiers=new Set(rows.flatMap((row)=>[row.id,row.external_id,row.sku]).filter(Boolean).map((value)=>String(value).trim().toLowerCase()));
  const unresolvedIds=ids.filter((id)=>!directIdentifiers.has(String(id).trim().toLowerCase()));
  if(unresolvedIds.length){
    const parentIds=await resolveParentProductIds(unresolvedIds);
    if(parentIds.length){
      const parentRowsResult=await loadRows([...new Set(ids.concat(parentIds))]);
      if(parentRowsResult.error){catalog=[];window.storeCatalogError=parentRowsResult.error;window.storeCartCatalogState='error';return catalog;}
      rows=parentRowsResult.data||[];
    }
  }
  if(!rows.length){catalog=[];window.storeCartCatalogState='empty';return catalog;}
  const imageResult=await fetchStoreBatches(rows.map((item)=>item.id),(batch)=>client.from('product_images').select('id,product_id,url,alt_text,sort_order,media_type').in('product_id',batch).order('sort_order').order('id'));
  const imagesByProduct=new Map();(imageResult.data||[]).forEach((image)=>{const images=imagesByProduct.get(image.product_id)||[];images.push(image);imagesByProduct.set(image.product_id,images);});
   const cartProducts=rows.map((item)=>{const media=imagesByProduct.get(item.id)||[];return{...item,id:item.external_id||item.id,databaseId:item.id,externalId:item.external_id,seoTitle:item.seo_title||item.name,searchText:item.search_text||item.seo_title||item.name,category:item.subcategory_slug||item.category_slug,image:media.find((entry)=>entry.media_type!=='video')?.url||'product-mix.jpg',images:media.filter((entry)=>entry.media_type!=='video').map((entry)=>entry.url),media:media.map((entry)=>({url:entry.url,type:entry.media_type||'image'})),options:[],price:Number(item.price)||0,promoPrice:item.promo_price===null||item.promo_price===undefined?null:Number(item.promo_price),promoStartsAt:item.promo_starts_at||null,promoEndsAt:item.promo_ends_at||null,displayPrice:Number(item.price)||0,promoDiscountPercent:Number(item.promo_discount_percent)||0,promoSkus:Array.isArray(item.promo_skus)?item.promo_skus:[],addedAt:item.added_at,waitlist:item.waitlist_enabled,description:item.description||'',itemDetails:item.item_details||'',shippingDetails:item.shipping_details||'',etsyUnitsPerSale:Number(item.etsy_units_per_sale)||1,quantity:Number(item.quantity)||0,lowStockThreshold:Number(item.low_stock_threshold)||0,badges:Array.isArray(item.badges)?item.badges:[]};});
   if(document.body.dataset.page==='Product'&&catalog.length){const merged=new Map(catalog.map((item)=>[String(item.id||item.externalId||item.databaseId),item]));cartProducts.forEach((item)=>merged.set(String(item.id||item.externalId||item.databaseId),item));catalog=[...merged.values()];}else catalog=cartProducts;
  window.storeCartCatalogState='ready';
  return catalog;
}
const bagHasItems=()=>{try{return JSON.parse(localStorage.getItem('beadDifferentBag')||'[]').some((entry)=>entry&&String(entry.id||'').trim()&&Number(entry.quantity)>0);}catch(error){return false;}};
const loadStorefrontAncillary=()=>{
  if(storefrontAncillaryPromise)return storefrontAncillaryPromise;
  storefrontAncillaryPromise=Promise.all([loadStoreControls(),loadPublicRewardSettings(),loadStorefrontBestSellers()]).then(()=>applyCanonicalInventory()).then(()=>loadStorefrontBundleComponents()).catch((error)=>{window.storeCatalogAncillaryError=error;return catalog;});
  return storefrontAncillaryPromise;
};
const catalogReady=document.body.dataset.page==='Admin'?Promise.resolve([]):(document.body.dataset.page==='Shopping Bag'?loadCartCatalog():loadCatalog()).then(()=>{const pageName=document.body.dataset.page||'';const needsStorefrontAncillary=storefrontListingPage()||['Home','Product','Search','Sale Collection','Wishlist','Account','Shopping Bag'].includes(pageName);const ancillary=needsStorefrontAncillary?loadStorefrontAncillary():Promise.resolve(catalog);window.storefrontInventoryReady=ancillary;return catalog;}).catch((error)=>{window.storeCatalogError=error;return catalog;});
window.catalogReady=catalogReady;window.storeCatalog=()=>catalog;
const productIdentifierMatches=(item,needle)=>{const normalizedNeedle=String(needle||'').trim().toLowerCase();return [item.id,item.externalId,item.databaseId,item.sku].filter(Boolean).some((value)=>String(value).trim().toLowerCase()===normalizedNeedle)||(item.options||[]).some((option)=>(option.values||[]).some((value)=>typeof value==='object'&&[value.sku,value.inventorySku].filter(Boolean).some((identifier)=>String(identifier).trim().toLowerCase()===normalizedNeedle)));};
const findProduct=(id)=>{const needle=String(id||'').trim();if(!needle)return null;return catalog.find((item)=>productIdentifierMatches(item,needle))||null;};
let searchCatalog=(query)=>{const needle=String(query||'').trim().toLowerCase();const visible=visibleCatalog();if(!needle)return visible;return visible.filter((item)=>`${item.searchText} ${(item.badges||[]).join(' ')}`.toLowerCase().includes(needle));};
window.searchCatalog=searchCatalog;
const badgeCatalogReady=catalogReady;
async function cloudStoreUser(){if(!window.beadSupabase)return null;const {data}=await window.beadSupabase.auth.getUser();return data?.user||null;}
const durableCartToken=()=>{let token=localStorage.getItem(storeKeys.cartToken)||'';if(!token){token=crypto.randomUUID();localStorage.setItem(storeKeys.cartToken,token);}return token;};
const durableCartId=()=>String(localStorage.getItem(storeKeys.cartId)||'').trim();
const setDurableCartId=(id)=>{if(id)localStorage.setItem(storeKeys.cartId,String(id));};
async function ensureDurableCart(){const client=await ensureSupabaseClient();if(!client)return null;const token=durableCartToken();const result=await withStoreTimeout(client.rpc('get_or_create_storefront_cart',{p_guest_token:token}),'Cart identity request');if(result.error)throw result.error;const cart=result.data||{};setDurableCartId(cart.id);return{...cart,guestToken:cart.guestToken||token};}
async function resolveProductId(id){const item=findProduct(id);const key=String(id||'').trim();if(item?.databaseId){if(key)storefrontProductIdByExternalId.set(key,item.databaseId);return item.databaseId;}if(!key)return id;const cached=storefrontProductIdByExternalId.get(key);if(cached)return cached;const {data}=await window.beadSupabase.from('products').select('id').eq('external_id',key).maybeSingle();if(data?.id)storefrontProductIdByExternalId.set(key,data.id);return data?.id||id;}
const notifyStoreSyncError=(error)=>window.dispatchEvent(new CustomEvent('bead-store-sync-error',{detail:{message:error?.message||'Unable to sync saved store data.'}}));
let storeSyncPending=Promise.resolve();
const queueStoreSync=(operation)=>{storeSyncPending=storeSyncPending.then(()=>operation()).catch((error)=>{notifyStoreSyncError(error);});return storeSyncPending;};
async function persistCloudCart(){const cart=await ensureDurableCart();if(!cart)return;const items=bagItems();const result=await window.beadSupabase.rpc('replace_storefront_cart',{p_cart_id:cart.id,p_guest_token:cart.guestToken,p_items:await Promise.all(items.map(async(item)=>({product_id:await resolveProductId(item.id),line_key:storeCartLineKey(item),quantity:item.quantity,selected_options:normalizeCartOptions(item.selectedOptions)})))});if(result.error)throw result.error;localStorage.setItem(storeKeys.cartOwner,cart.id);localStorage.removeItem(storeKeys.cartDirty);}
async function clearCheckoutCart(){
  writeStore(storeKeys.bag,[]);
  writeCartPromo('');
  localStorage.removeItem(storeKeys.cartDirty);
  localStorage.removeItem(storeKeys.cartHoldSnapshot);
  localStorage.removeItem(storeKeys.cartHoldUser);
  updateBagCount();
  window.dispatchEvent(new Event('bead-cart-changed'));
  if(!window.beadSupabase)return;
  try{
    const cart=await ensureDurableCart();
    if(!cart)return;
    const result=await window.beadSupabase.rpc('replace_storefront_cart',{p_cart_id:cart.id,p_guest_token:cart.guestToken,p_items:[]});
    if(result.error)throw result.error;
    localStorage.setItem(storeKeys.cartOwner,cart.id);
  }catch(error){console.warn('Checkout cart cleanup unavailable.',error);}
}
async function persistCloudFavorite(id,active){const user=await cloudStoreUser();if(!user)return;const productId=await resolveProductId(id);const result=active?await window.beadSupabase.from('customer_favorites').upsert({user_id:user.id,product_id:productId},{onConflict:'user_id,product_id'}):await window.beadSupabase.from('customer_favorites').delete().eq('user_id',user.id).eq('product_id',productId);if(result.error)throw result.error;try{sessionStorage.removeItem(`beadStoreFavoritesV1:${user.id}`);}catch(error){}}
async function syncCloudStore(){
  const user=await cloudStoreUser();
  if(!user&&!bagHasItems()&&!durableCartId())return;
  const localBag=bagItems();
  const cartDirty=localStorage.getItem(storeKeys.cartDirty)==='1';
  const heldSnapshot=localStorage.getItem(storeKeys.cartHoldSnapshot)||'';
  const heldUser=localStorage.getItem(storeKeys.cartHoldUser)||'';
  const holdApplies=Boolean(heldSnapshot)&&(!user||heldUser===String(user.id||''));
  const heldCartUnchanged=holdApplies&&!cartDirty&&cartSnapshot(localBag)===heldSnapshot;
  if(!user&&heldCartUnchanged){updateBagCount();return;}
  const cart=await ensureDurableCart();
  if(!cart)return;
  const cartOwner=localStorage.getItem(storeKeys.cartOwner);
  const cartResult=await withStoreTimeout(window.beadSupabase.rpc('get_storefront_cart',{p_cart_id:cart.id,p_guest_token:cart.guestToken}),'Cart sync request');
  if(cartResult.error)throw cartResult.error;
  const cloudItems=Array.isArray(cartResult.data)?cartResult.data:[];
  const cloudProductIds=cloudItems.map((item)=>String(item.product_id||'').trim()).filter(Boolean);
  if(cloudProductIds.some((id)=>!findProduct(id))){
    await loadCartCatalog(cloudProductIds);
    await loadCartProductOptions();
    await applyCanonicalInventory();
  }
  const cloudBagEntries=cloudItems.map((item)=>{
    const product=findProduct(item.product_id);
    if(!product)return null;
    return{id:product.externalId||product.id,quantity:Number(item.quantity)||1,selectedOptions:normalizeCartOptions(item.selected_options)};
  }).filter(Boolean);
  const cloudBag=mergeCartLines(cloudBagEntries);
  const cloudCartNeedsNormalization=cloudBag.length<cloudBagEntries.length;
  // A sign-out keeps a local handoff snapshot so the cart survives the auth
  // transition.  When the same snapshot is already present in the cloud
  // cart, do not merge it a second time on the next sign-in.  Only merge
  // local lines that are genuinely different (for example, guest additions
  // made while signed out).
  const localBagToMerge=!holdApplies&&!cartOwner&&!cartDirty&&localBag.length&&cartSnapshot(localBag)!==cartSnapshot(cloudBag)?localBag:[];
  const heldCartChanged=holdApplies&&cartSnapshot(localBag)!==heldSnapshot;
  const mergedBag=holdApplies?(heldCartChanged?localBag:cloudBag):cartDirty&&localBag.length?mergeCartLines(localBag):mergeCartLines([...cloudBag,...localBagToMerge]);
  writeStore(storeKeys.bag,mergedBag);
  localStorage.setItem(storeKeys.cartOwner,cart.id);
  if((cartDirty&&localBag.length)||localBagToMerge.length||(user&&heldCartChanged)||cloudCartNeedsNormalization)await persistCloudCart();
  if(user){localStorage.setItem(storeKeys.cartHoldUser,String(user.id||''));if(heldSnapshot){localStorage.removeItem(storeKeys.cartHoldSnapshot);localStorage.removeItem(storeKeys.cartHoldUser);}}
  if(user){
    const favoriteCacheKey=`beadStoreFavoritesV1:${user.id}`;
    const cachedFavorites=storefrontSessionCacheRead(favoriteCacheKey,60000);
    if(Array.isArray(cachedFavorites))writeStore(storeKeys.wishlist,cachedFavorites);
    else await window.beadSupabase.from('customer_favorites').select('product_id,products!inner(id,external_id,visible)').eq('user_id',user.id).eq('products.visible',true).order('created_at',{ascending:false}).range(0,99).then((favoriteResult)=>{
         if(favoriteResult.error)throw favoriteResult.error;
         const favoriteIds=[...new Set((favoriteResult.data||[]).map((item)=>findProduct(item.products?.external_id||item.products?.id||item.product_id)?.id||item.products?.external_id||item.product_id).filter(Boolean))];
         writeStore(storeKeys.wishlist,favoriteIds);
         storefrontSessionCacheWrite(favoriteCacheKey,favoriteIds);
       }).catch(notifyStoreSyncError);
  }
  updateBagCount();
  window.dispatchEvent(new Event('bead-store-synced'));
}
const initializeCloudStoreSync=async()=>{
  const client=await ensureSupabaseClient();
  if(!client)return;
  client.auth.onAuthStateChange(()=>{setTimeout(()=>queueStoreSync(()=>syncCloudStore()),0);});
  await queueStoreSync(()=>syncCloudStore());
};
window.customerStoreReady=initializeCloudStoreSync();
function clearLocalCart(userId=''){const localBag=bagItems();if(localBag.length){localStorage.setItem(storeKeys.cartHoldSnapshot,cartSnapshot(localBag));localStorage.setItem(storeKeys.cartHoldUser,String(userId||''));}else{localStorage.removeItem(storeKeys.cartHoldSnapshot);localStorage.removeItem(storeKeys.cartHoldUser);}localStorage.removeItem(storeKeys.cartOwner);localStorage.removeItem(storeKeys.cartDirty);writeStore(storeKeys.wishlist,[]);if(typeof updateBagCount==='function')updateBagCount();window.dispatchEvent(new Event('bead-cart-changed'));}
window.customerStore={sync:syncCloudStore,clearForSignOut:clearLocalCart};
const bagItems=()=>{const items=readStore(storeKeys.bag);const normalized=mergeCartEntries(items);if(JSON.stringify(items)!==JSON.stringify(normalized))writeStore(storeKeys.bag,normalized);return normalized;};
const wishlistItems=()=>readStore(storeKeys.wishlist);
const cartOptionsMatch=(first,second)=>cartOptionIdentityKey(first)===cartOptionIdentityKey(second);
const isInBag=(id,selectedOptions=null)=>bagItems().some((item)=>item.id===id&&(selectedOptions===null||cartOptionsMatch(item.selectedOptions,selectedOptions)));
const validBagItems=()=>bagItems().filter((entry)=>entry&&String(entry.id||'').trim()&&Number(entry.quantity)>0);const resolvedBagItems=()=>{const entries=validBagItems();return catalog.length?entries.filter((entry)=>findProduct(entry.id)):entries;};const normalizeBagProductIds=()=>{const entries=bagItems();let changed=false;const normalized=entries.map((entry)=>{const item=findProduct(entry.id);if(!item||item.id===entry.id)return entry;changed=true;return{...entry,id:item.id};});if(changed)writeStore(storeKeys.bag,normalized);return normalized;};const pruneBagItems=()=>{const items=bagItems();const valid=validBagItems();if(valid.length!==items.length)writeStore(storeKeys.bag,valid);return valid;};function updateBagCount(){const entries=resolvedBagItems();const count=entries.reduce((total,item)=>total+Math.max(0,Number(item.quantity)||0),0);document.querySelectorAll('#bag-count,.bag i').forEach((element)=>{element.textContent=count;});}catalogReady.then(()=>{if(!window.storeCatalogError){normalizeBagProductIds();pruneBagItems();}updateBagCount();if(window.beadSupabase)queueStoreSync(()=>syncCloudStore());});
const shippingWeightToOz=(value,unit)=>{const amount=Number(value)||0;return unit==='lb'?amount*16:unit==='g'?amount/28.349523125:unit==='kg'?amount*35.27396195:amount;};
const shippingCartOption=(item,entry)=>{const selected=normalizeCartOptions(entry?.selectedOptions);const currentValues=(item?.options||[]).flatMap((option)=>option.values||[]).filter((value)=>typeof value==='object');const stored=selected.find((option)=>option.inventorySku||option.sku)||selected[0]||null;if(!stored)return null;const current=currentValues.find((value)=>[value.inventorySku,value.sku,value.label].filter(Boolean).some((identifier)=>String(identifier).trim().toLowerCase()===String(stored.inventorySku||stored.sku||stored.label||'').trim().toLowerCase()));return current||stored;};
const mergeInventoryRequirements=(target,source,multiplier=1)=>{source.forEach((quantity,sku)=>target.set(sku,(target.get(sku)||0)+quantity*multiplier));return target;};
const storefrontSkuRequirements=(sku,units=1,path=[])=>{const key=String(sku||'').trim().toLowerCase();const requirements=new Map();if(!key||path.includes(key))return requirements;const packMatch=key.match(/-(\d+)pk$/i);const singleSku=packMatch?key.replace(/-\d+pk$/i,'-1pk'):'';if(packMatch&&storefrontInventoryAvailability.has(singleSku)){requirements.set(singleSku,Math.max(1,Number(units)||1)*Math.max(1,Number(packMatch[1])||1));return requirements;}const recipe=window.storefrontBundleRecipes?.get(key)||[];if(!recipe.length){requirements.set(key,Math.max(1,Number(units)||1));return requirements;}recipe.forEach((component)=>mergeInventoryRequirements(requirements,storefrontSkuRequirements(component.componentSku,Math.max(1,Number(units)||1)*Math.max(1,Number(component.quantity)||1),[...path,key])));return requirements;};
const cartEntryInventoryRequirements=(entry,quantity=entry?.quantity)=>{const item=findProduct(entry?.id);if(!item)return new Map();const option=shippingCartOption(item,entry);const sku=option?.inventorySku||option?.sku||item.sku||'';const units=Math.max(1,Number(option?.inventoryUnits)||1)*Math.max(1,Math.floor(Number(quantity)||1));return storefrontSkuRequirements(sku,units);};
const cartInventoryMaximum=(id,selectedOptions=[],entries=bagItems())=>{const item=findProduct(id);if(!item)return Infinity;const target={id,selectedOptions:normalizeCartOptions(selectedOptions),quantity:1};const perUnit=cartEntryInventoryRequirements(target,1);if(!perUnit.size||[...perUnit.keys()].some((sku)=>!storefrontInventoryAvailability.has(sku)))return Infinity;const otherDemand=new Map();entries.filter((entry)=>!(entry.id===id&&cartOptionsMatch(entry.selectedOptions,target.selectedOptions))).forEach((entry)=>mergeInventoryRequirements(otherDemand,cartEntryInventoryRequirements(entry)));let maximum=Infinity;perUnit.forEach((required,sku)=>{const remaining=Math.max(0,(storefrontInventoryAvailability.get(sku)||0)-(otherDemand.get(sku)||0));maximum=Math.min(maximum,Math.floor(remaining/required));});return Math.max(0,maximum);};
const defaultShippingBox={name:'Smallest USPS parcel',maxWeightOz:70,lengthIn:6,widthIn:4,heightIn:1,fallbackRate:0};
const shippingBoxForWeight=(weightOz,config=window.productStoreConfig||{})=>{const boxes=(Array.isArray(config.shippingBoxes)?config.shippingBoxes:[]).map((box,index)=>({...box,index,maxWeightOz:Number(box.maxWeightOz),lengthIn:Number(box.lengthIn),widthIn:Number(box.widthIn),heightIn:Number(box.heightIn)})).filter((box)=>box.name&&Number.isFinite(box.maxWeightOz)&&box.maxWeightOz>=0&&box.lengthIn>0&&box.widthIn>0&&box.heightIn>0).sort((a,b)=>a.maxWeightOz-b.maxWeightOz);return boxes.find((box)=>box.maxWeightOz>=weightOz)||boxes.at(-1)||defaultShippingBox;};
const validShippingPostalCode=(value)=>/^\d{5}(?:-\d{4})?$/.test(String(value||'').trim());
const dateOnly=(date)=>{const year=date.getFullYear();const month=String(date.getMonth()+1).padStart(2,'0');const day=String(date.getDate()).padStart(2,'0');return`${year}-${month}-${day}`;};
const addBusinessDays=(date,days)=>{const result=new Date(date);let remaining=Math.max(0,Number(days)||0);while(remaining>0){result.setDate(result.getDate()+1);if(![0,6].includes(result.getDay()))remaining-=1;}return result;};
const readShippingRateError=async(result)=>{let message=result.data?.error||'';if(!message&&result.error?.context){try{const body=await result.error.context.clone().json();message=body?.error||body?.message||'';}catch(error){}}return message||result.error?.message||'';};
function cartLinePricing(item,entry={}){const option=shippingCartOption(item,entry);const originalUnitPrice=Math.max(0,Number(option?.price??item?.price)||0);const sku=option?.inventorySku||option?.sku||item?.sku||'';const productPromo=window.storefrontPromoForSku?.(item,originalUnitPrice,sku)||{originalPrice:originalUnitPrice,price:originalUnitPrice,discounted:false};return{option,sku,originalUnitPrice,unitPrice:Math.max(0,Number(productPromo.price)||originalUnitPrice),productPromoApplied:productPromo.discounted===true,promoDetails:window.storefrontPromoDetails?.(item,originalUnitPrice,sku)||''};}
const requestUspsRates=async({postalCode='',weightOz=1,box=null}={})=>{const config=window.productStoreConfig||{};const destination=String(postalCode||'').trim();const origin=String(config.shippingOriginPostalCode||'').trim();if(!validShippingPostalCode(destination))return{error:'Enter a valid ZIP code before choosing shipping.'};if(!validShippingPostalCode(origin))return{error:'USPS shipping needs the store origin ZIP configured in Store settings.'};if(!window.beadSupabase?.functions?.invoke)return{error:'USPS shipping is unavailable because the store API connection is not loaded.'};const parcel=box||shippingBoxForWeight(weightOz,config);const dimensions={weightOz:Math.max(0.01,Number(weightOz)||0.01),lengthIn:Number(parcel.lengthIn),widthIn:Number(parcel.widthIn),heightIn:Number(parcel.heightIn)};if(!Object.values(dimensions).every((value)=>Number.isFinite(value)&&value>0))return{error:'USPS shipping needs a valid package size and weight.'};const acceptanceDate=addBusinessDays(new Date(),config.processingDays);try{const result=await window.beadSupabase.functions.invoke('shipping-rates',{body:{provider:'usps',from:{postalCode:origin},to:{postalCode:destination},package:dimensions,acceptanceDate:dateOnly(acceptanceDate)}});const error=await readShippingRateError(result);if(error)return{error:`USPS shipping failed: ${error}`};const rates=Array.isArray(result.data?.rates)?result.data.rates:[];if(!rates.length)return{error:'USPS did not return rates for this destination.'};return{...result.data,rates,box:parcel,acceptanceDate,processingDays:Math.max(0,Number(config.processingDays)||0)};}catch(error){return{error:`USPS shipping failed: ${error?.message||'Unknown error'}`};}};
const shippingCartTotals=(items=bagItems())=>{const totals=items.reduce((totals,entry)=>{
  const item=findProduct(entry?.id);
  if(!item)return totals;
  const pricing=cartLinePricing(item,entry);
  const quantity=Math.max(1,Number(entry.quantity)||1);
  const unitPrice=pricing.unitPrice;
  const unitWeight=shippingWeightToOz(pricing.option?.weight??item.weight,pricing.option?.weightUnit??(item.weightUnit||'oz'));
  const lineSubtotal=unitPrice*quantity;
  totals.subtotal+=lineSubtotal;
  totals.promoEligibleSubtotal+=(pricing.productPromoApplied?0:lineSubtotal);
  totals.productPromoSavings+=(pricing.productPromoApplied?Math.max(0,pricing.originalUnitPrice-pricing.unitPrice)*quantity:0);
  totals.weightOz+=Math.max(0,unitWeight)*quantity;
  return totals;
},{subtotal:0,promoEligibleSubtotal:0,productPromoSavings:0,weightOz:0});window.storeCartPricingSnapshot=totals;return totals;};
const retryableShippingError=(message)=>/failed to fetch|failed to send a request to the edge function|network|timed? ?out/i.test(String(message||''));
const estimateDeliveryWithRetry=async(args={})=>{let result;for(let attempt=0;attempt<3;attempt+=1){result=await requestUspsRates(args);if(!result?.error||!retryableShippingError(result.error)||attempt===2)return result;await new Promise((resolve)=>setTimeout(resolve,500*(attempt+1)));}return result;};
const storeShipping={
  totals:shippingCartTotals,
  boxForWeight:shippingBoxForWeight,
  estimateDelivery:({postalCode='',weightOz=1,box=null}={})=>estimateDeliveryWithRetry({postalCode,weightOz,box}),
  quote:async(items=bagItems(),postalCode='')=>{const totals=shippingCartTotals(items);const quote=await estimateDeliveryWithRetry({postalCode,weightOz:totals.weightOz,box:shippingBoxForWeight(totals.weightOz)});if(quote.error)return{...totals,amount:null,free:false,error:quote.error,box:quote.box||shippingBoxForWeight(totals.weightOz)};const config=window.productStoreConfig||{};const free=totals.subtotal>=Math.max(0,Number(config.freeShippingThreshold??35));const rates=quote.rates.map((rate)=>({...rate,amount:Number(rate.amount??rate.price),serviceName:rate.serviceName||rate.serviceCode}));const standard=rates.find((rate)=>String(rate.serviceCode||'').toUpperCase()==='USPS_GROUND_ADVANTAGE');const priority=rates.find((rate)=>String(rate.serviceCode||'').toUpperCase()==='PRIORITY_MAIL');if(!standard||!priority)return{...totals,amount:null,free:false,error:'USPS did not return both Ground Advantage and Priority Mail rates.',rates,box:quote.box};return{...totals,amount:free?0:Number(standard.amount),free,box:quote.box,rates,standard,priority,acceptanceDate:quote.acceptanceDate,processingDays:quote.processingDays,postalCode};}
};
window.storeShipping=storeShipping;
window.storeCartPricing=cartLinePricing;
const storefrontSkuWeight=(sku,path=[])=>{const needle=String(sku||'').trim();if(!needle||path.map((value)=>value.toLowerCase()).includes(needle.toLowerCase()))return 0;const recipes=window.storefrontBundleRecipes?.get(needle.toLowerCase())||[];if(recipes.length)return recipes.reduce((total,recipe)=>total+storefrontSkuWeight(recipe.componentSku,[...path,needle])*recipe.quantity,0);for(const item of catalog){for(const option of item.options||[]){for(const value of option.values||[]){if(typeof value==='object'&&String(value.inventorySku||value.sku||'').trim().toLowerCase()===needle.toLowerCase())return shippingWeightToOz(value.weight,value.weightUnit||'oz');}}if(String(item.sku||'').trim().toLowerCase()===needle.toLowerCase())return shippingWeightToOz(item.weight,item.weightUnit||'oz');}return 0;};
async function trackProductEvent(id,eventType,searchTerm='',selectedOptions=[]){try{const client=await ensureSupabaseClient();if(!client)return;const payload={product_id:null,inventory_sku_id:null,event_type:eventType,search_term:eventType==='search'?String(searchTerm||'').trim().slice(0,200):null};const item=id?findProduct(id):null;if(item?.databaseId)payload.product_id=item.databaseId;else if(id&&eventType!=='search'){const key=String(id).trim();const cachedProductId=storefrontProductIdByExternalId.get(key);if(cachedProductId)payload.product_id=cachedProductId;else{const {data:product}=await client.from('products').select('id').eq('external_id',key).maybeSingle();if(product?.id){storefrontProductIdByExternalId.set(key,product.id);payload.product_id=product.id;}else return;}}const fallbackEntry=eventType==='cart_add'?bagItems().find((entry)=>entry.id===id):null;const selected=normalizeCartOptions(selectedOptions?.length?selectedOptions:fallbackEntry?.selectedOptions||[]);const sku=selected.find((option)=>option?.inventorySku||option?.sku)?.inventorySku||selected.find((option)=>option?.sku)?.sku||'';if(sku){const cached=storefrontInventoryForSku(sku);if(cached?.id)payload.inventory_sku_id=cached.id;else{const {data:inventory}=await client.from('storefront_inventory_skus').select('id,sku').eq('sku',String(sku).trim()).maybeSingle();if(inventory?.id){cacheStorefrontInventoryRecords([inventory]);payload.inventory_sku_id=inventory.id;}}}await client.from('analytics_events').insert(payload);}catch(error){return null;}}
function addToBag(id,selectedOptions=[]){if(storeControls.salesFrozen)return false;const item=findProduct(id);if(!item||!isProductVisible(item))return false;const normalizedOptions=normalizeCartOptions(selectedOptions);const items=bagItems();const existing=items.find((entry)=>entry.id===id&&cartOptionsMatch(entry.selectedOptions,normalizedOptions));const maximum=cartInventoryMaximum(id,normalizedOptions,items);if((existing?.quantity||0)>=maximum){window.dispatchEvent(new CustomEvent('bead-cart-stock-limited',{detail:{id,selectedOptions:normalizedOptions,maximum}}));return false;}if(existing)existing.quantity+=1;else items.push({id,quantity:1,selectedOptions:normalizedOptions});writeStore(storeKeys.bag,items);localStorage.setItem(storeKeys.cartDirty,'1');updateBagCount();trackProductEvent(id,'cart_add','',normalizedOptions);queueStoreSync(()=>persistCloudCart());window.dispatchEvent(new Event('bead-cart-changed'));return true;}
window.etsyImportsFrozen=()=>storeControls.etsyImportsFrozen===true;
function removeFromBag(id,selectedOptions=null){writeStore(storeKeys.bag,bagItems().filter((item)=>item.id!==id||(selectedOptions!==null&&!cartOptionsMatch(item.selectedOptions,selectedOptions))));localStorage.setItem(storeKeys.cartDirty,'1');updateBagCount();queueStoreSync(()=>persistCloudCart());window.dispatchEvent(new Event('bead-cart-changed'));}
function toggleWishlist(id){const items=wishlistItems();const index=items.indexOf(id);if(index===-1)items.push(id);else items.splice(index,1);writeStore(storeKeys.wishlist,items);queueStoreSync(()=>persistCloudFavorite(id,index===-1));return index===-1;}
document.addEventListener('click',(event)=>{const button=event.target.closest?.('[data-cart-toggle],.product-page-actions .cart-toggle,.product-quick-actions .cart-toggle');if(button&&storeControls.salesFrozen){event.preventDefault();event.stopImmediatePropagation();button.disabled=true;button.textContent='Sales paused for inventory audit';}},true);
function openProductDetails(id){const item=findProduct(id);if(!item)return;let modal=document.querySelector('#product-modal');if(!modal){modal=document.createElement('dialog');modal.id='product-modal';document.body.append(modal);}modal.innerHTML=`<button class="modal-close" type="button" aria-label="Close">×</button><div class="product-detail product-modal-detail"><div class="product-gallery">${item.images.map((image,index)=>`<img loading="lazy" src="${image}" alt="${item.name} image ${index+1}">`).join('')}</div><div><p class="kicker">${item.category.replaceAll('-',' ').toUpperCase()}</p><h2>${item.name}</h2><strong>$${item.price.toFixed(2)}</strong><p>${item.description.replace(/\n/g,'<br>')}</p><a class="cta" href="product.html?id=${encodeURIComponent(item.id)}">View All Details</a></div></div>`;modal.querySelector('.modal-close').addEventListener('click',()=>modal.close());modal.addEventListener('click',(event)=>{if(event.target===modal)modal.close();},{once:true});modal.showModal();}
document.addEventListener('DOMContentLoaded',updateBagCount);
function renderPaginatedProducts(list,target,controls,options={}){if(!target)return;const pageSize=24;let currentPage=1;const draw=()=>{const pageCount=Math.max(1,Math.ceil(list.length/pageSize));currentPage=Math.min(currentPage,pageCount);renderProductCards(list.slice((currentPage-1)*pageSize,currentPage*pageSize),target,options);if(!controls)return;controls.replaceChildren();if(pageCount<2)return;for(let page=1;page<=pageCount;page+=1){const button=document.createElement('button');button.type='button';button.textContent=page;button.className=page===currentPage?'active':'';button.addEventListener('click',()=>{currentPage=page;draw();target.scrollIntoView({block:'start'});});controls.append(button);}};draw();}
window.renderProductCards=renderProductCards;
async function loadProductCatalogMetadata(){
  if(!window.beadSupabase||!catalog.length)return catalog;
  const ids=catalog.map((item)=>item.databaseId).filter(Boolean);
  if(!ids.length)return catalog;
  const [featuredResult,categoryResult]=await Promise.all([
    withStoreTimeout(window.beadSupabase.from('products').select('id,featured').in('id',ids),'Featured products request').catch(()=>({data:[]})),
    withStoreTimeout(window.beadSupabase.from('product_categories').select('product_id,category_slug').in('product_id',ids),'Product categories request').catch(()=>({data:[]}))
  ]);
  const featuredById=new Map((featuredResult.data||[]).map((row)=>[row.id,row.featured===true]));
  const categoriesById=new Map();
  (categoryResult.data||[]).forEach((row)=>{
    const values=categoriesById.get(row.product_id)||[];
    if(row.category_slug&&!values.includes(row.category_slug))values.push(row.category_slug);
    categoriesById.set(row.product_id,values);
  });
  catalog.forEach((item)=>{
    item.categorySlugs=[...new Set([item.category_slug,item.subcategory_slug,item.category,...(categoriesById.get(item.databaseId)||[])].filter(Boolean))];
    item.featured=featuredById.get(item.databaseId)===true;
  });
  return catalog;
}
async function loadCartProductOptions(){
  if(document.body.dataset.page!=='Shopping Bag'||!window.beadSupabase||!catalog.length)return catalog;
  const ids=[...new Set(catalog.map((item)=>item.databaseId).filter(Boolean))];
  if(!ids.length)return catalog;
  const result=await fetchStoreBatches(ids,(batch)=>window.beadSupabase.from('product_options').select('id,product_id,name,required,sort_order,product_option_values(id,inventory_sku_id,sort_order)').in('product_id',batch).order('sort_order'));
  if(result.error){window.storeCartOptionsError=result.error;window.dispatchEvent(new CustomEvent('bead-catalog-options-error',{detail:{error:result.error}}));return catalog;}
  window.storeCartOptionsError=null;
  const hydratedOptionRows=await hydrateStorefrontOptionInventory(window.beadSupabase,result.data||[]);
  catalog.forEach((item)=>{item.options=(hydratedOptionRows||[]).filter((option)=>option.product_id===item.databaseId).map((option)=>({name:option.name,required:option.required,values:(option.product_option_values||[]).sort((a,b)=>a.sort_order-b.sort_order).map((value)=>({label:value.inventory_skus?.name||'',price:value.inventory_skus?.price===null||value.inventory_skus?.price===undefined?Number(item.price||0):Number(value.inventory_skus.price)||0,sku:value.inventory_skus?.sku||'',inventorySku:value.inventory_skus?.sku||'',inventoryUnits:1,imageUrl:'',unitType:value.inventory_skus?.unit_type||'Each',quantity:value.inventory_skus?.quantity_available===null||value.inventory_skus?.quantity_available===undefined?0:Number(value.inventory_skus.quantity_available)||0,lowStockThreshold:0}))}));});
  await applyCanonicalInventoryNames();
  window.dispatchEvent(new Event('bead-catalog-options-ready'));
  return catalog;
}
const normalizeCatalogPromoFields=()=>{catalog.forEach((item)=>{item.promoPrice=item.promo_price===null||item.promo_price===undefined?null:Number(item.promo_price);item.promoStartsAt=item.promo_starts_at||null;item.promoEndsAt=item.promo_ends_at||null;item.promoDiscountPercent=Number(item.promo_discount_percent)||0;item.promoSkus=Array.isArray(item.promo_skus)?item.promo_skus:[];});return catalog;};
window.catalogMetadataReady=catalogReady.then(async()=>{normalizeCatalogPromoFields();await loadProductCatalogMetadata();await window.storefrontInventoryReady?.catch?.(()=>{});await loadCartProductOptions();if(document.body.dataset.page==='Shopping Bag'){await applyCanonicalInventory();await loadStorefrontBundleComponents();}normalizeCatalogPromoFields();return catalog;}).catch((error)=>{window.storeCartOptionsError=error;window.dispatchEvent(new CustomEvent('bead-catalog-options-error',{detail:{error}}));return catalog;});
window.renderPaginatedProducts=renderPaginatedProducts;
const storeCartLineKey=(entry)=>cartLineIdentityKey(entry);
const mergeCartLines=(items)=>mergeCartEntries(items);
const storeCheckout=async({shippingName='',shippingAddress={},customerEmail='',promoCode='',shippingAmount=0,shippingCost=0,shippingMethod='Fixed test shipping',taxAmount=0,taxRate=0,taxState='',taxJurisdiction='',testOrder=false}={})=>{const items=bagItems();if(!items.length)throw new Error('Your cart is empty.');const normalizedCustomerEmail=String(customerEmail||'').trim().toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedCustomerEmail))throw new Error('A valid email address is required for order updates.');const lines=items.map((entry)=>{const item=findProduct(entry.id);const option=shippingCartOption(item,entry);const sku=option?.inventorySku||option?.sku||item?.sku||'';return{product_id:item?.databaseId||'',sku,quantity:Math.max(1,Number(entry.quantity)||1),inventory_units:Math.max(1,Number(option?.inventoryUnits)||1),selected_options:entry.selectedOptions||[]};});if(lines.some((line)=>!line.product_id||!line.sku))throw new Error('Every cart item must have a linked product and inventory SKU.');if(window.beadSupabase){const {data:{user}}=await window.beadSupabase.auth.getUser();const result=await window.beadSupabase.rpc('create_test_order',{order_payload:{lines,shipping_name:String(shippingName||'').trim(),shipping_address:shippingAddress,customer_email:normalizedCustomerEmail,shipping_amount:Number(shippingAmount)||0,shipping_cost:Number(shippingCost)||0,shipping_method:shippingMethod,promo_code:String(promoCode||'').trim(),tax_amount:Number(taxAmount)||0,tax_rate:Number(taxRate)||0,tax_state:String(taxState||'').trim(),tax_jurisdiction:String(taxJurisdiction||'').trim(),test_order:Boolean(testOrder)}});if(result.error)throw result.error;writeStore(storeKeys.bag,[]);writeCartPromo('');updateBagCount();window.dispatchEvent(new Event('bead-order-created'));if(result.data?.id&&window.beadSupabase.functions?.invoke){try{await window.beadSupabase.functions.invoke('send-order-email',{body:{action:'confirmation',orderId:result.data.id,guestOrderToken:user?undefined:result.data.guest_order_token}});}catch(error){console.warn('Order confirmation email unavailable.',error);}}return result.data;}const account=JSON.parse(localStorage.getItem('beadDifferentAccount')||'null');const subtotal=shippingCartTotals(items).subtotal;const localPromo=String(promoCode||'').trim()?window.storePromos?.find?.(promoCode):null;if(String(promoCode||'').trim()&&!localPromo)throw new Error('That promo code is not available.');const discount=window.storePromos?.discount?.(localPromo,subtotal)||0;const order={id:`test-${Date.now()}`,status:'paid',subtotal,discount,shipping_amount:Number(shippingAmount)||0,shipping_cost:Number(shippingCost)||0,tax_amount:Number(taxAmount)||0,tax_rate:Number(taxRate)||0,tax_state:String(taxState||'').trim(),tax_jurisdiction:String(taxJurisdiction||'').trim(),total:Math.max(0,subtotal-discount+(Number(shippingAmount)||0)+(Number(taxAmount)||0)),shipping_name:shippingName,shipping_address:shippingAddress,customer_email:normalizedCustomerEmail,carrier:String(shippingMethod||'Standard shipping'),tracking_number:null,created_at:new Date().toISOString(),order_items:items.map((entry)=>{const item=findProduct(entry.id);const option=shippingCartOption(item,entry);return{product_id:item.id,product_name:item.name,sku:option?.sku||item.sku,quantity:entry.quantity,unit_price:Number(option?.price??item.price)||0,selected_options:entry.selectedOptions||[]};})};const profiles=JSON.parse(localStorage.getItem('beadDifferentProfiles')||'[]');const profile=account&&profiles.find((entry)=>entry.id===account.id);if(profile){profile.orders=profile.orders||[];profile.orders.unshift(order);localStorage.setItem('beadDifferentProfiles',JSON.stringify(profiles));}if(localPromo&&account){try{const rewards=JSON.parse(localStorage.getItem('beadDifferentRewardCodes')||'[]');const rewardIndex=rewards.findIndex((entry)=>entry.accountId===account.id&&(entry.code||'').toUpperCase()===localPromo.code.toUpperCase()&&!entry.redeemedAt);if(rewardIndex>=0){rewards[rewardIndex].redeemedAt=new Date().toISOString();localStorage.setItem('beadDifferentRewardCodes',JSON.stringify(rewards));}}catch(error){}}const guestOrders=JSON.parse(localStorage.getItem('beadDifferentGuestOrders')||'[]');guestOrders.unshift(order);localStorage.setItem('beadDifferentGuestOrders',JSON.stringify(guestOrders.slice(0,20)));writeStore(storeKeys.bag,[]);writeCartPromo('');updateBagCount();return order;};
window.storeCheckout=storeCheckout;
const checkoutWithCartCleanup=window.storeCheckout;
window.storeCheckout=async(...args)=>{const order=await checkoutWithCartCleanup(...args);await queueStoreSync(clearCheckoutCart);return order;};
const setBagLineQuantity=(id,selectedOptions,quantity)=>{const items=bagItems();const requestedQuantity=Math.max(0,Math.floor(Number(quantity)||0));const maximum=cartInventoryMaximum(id,selectedOptions,items);const nextQuantity=Math.min(requestedQuantity,maximum);const index=items.findIndex((entry)=>entry.id===id&&cartOptionsMatch(entry.selectedOptions,selectedOptions));if(index<0)return false;if(nextQuantity)items[index].quantity=nextQuantity;else items.splice(index,1);writeStore(storeKeys.bag,items);localStorage.setItem(storeKeys.cartDirty,'1');updateBagCount();queueStoreSync(()=>persistCloudCart());window.dispatchEvent(new Event('bead-cart-changed'));if(nextQuantity<requestedQuantity)window.dispatchEvent(new CustomEvent('bead-cart-stock-limited',{detail:{id,selectedOptions:normalizeCartOptions(selectedOptions),maximum}}));return true;};
const removeBagLine=(id,selectedOptions)=>setBagLineQuantity(id,selectedOptions,0);
window.storeCart={lineKey:storeCartLineKey,id:durableCartId,setQuantity:setBagLineQuantity,removeLine:removeBagLine,entries:()=>pruneBagItems(),maxQuantity:cartInventoryMaximum,promo:readCartPromo,setPromo:writeCartPromo,clearPromo:()=>writeCartPromo('')};
const beadableProductPatterns=[/^pen ink refills/,/^rod extender/,/^beadable earrings/,/^beadable pen packaging bags/,/^beadable garden tool set/,/^wine stopper/,/^beadable ornament/,/^beadable bar keychain/,/^beadable keychain,/,/^makeup brushes/,/^carabiner,/,/^beadable box cutter/,/^beadable stylus/,/^beaded pencil blank/,/^beadable bookmarks/,/^beadable crochet hook/,/^beadable cup straw keychain/,/^pack of keychain blanks/,/^beadable bar,/,/^beadable cup straw attachment/,/^cup charm wire/,/^dog paw keychain bars/,/^sticker heart beadable cup charm blank/,/^badge reel,/,/^beadable mirrors/,/^beadable bars,/,/^pack of pencils/,/^beadable keychain blanks/,/^box cutters/,/^diy snowflake keychains/,/^beadable blanks, teacher id holder/,/^beadable dog poop bag holder/,/^plastic comb/,/^full set of beadable keychains/,/^bottle opener/,/^bullet earrings/,/^beadable badge reel pens/,/^badge reels,/];
function categoryFor(row){const titleTags=`${row.TITLE} ${row.TAGS}`.toLowerCase();if(/^(crayon beaded pen|snowman beaded pen|st\. patrick.?s day beadable pen set)/.test(titleTags))return'beadable-pen-blanks';if(beadableProductPatterns.some((pattern)=>pattern.test(titleTags)))return'beadable-products';if(titleTags.includes('clearance'))return'clearance-section';if(/completed.*(pen|keychain)|finished.*(pen|keychain)/.test(titleTags))return'completed-pens-keychains';if(/cup accessories, cup charm,/.test(titleTags))return'cup-charms';if((titleTags.includes('charm')||titleTags.includes('dangle'))&&!titleTags.includes('cup charm'))return'charms-dangles';if(titleTags.includes('focal'))return'focal-beads';if(titleTags.includes('flatback'))return'acrylic-flatbacks';if(titleTags.includes('rhinestone'))return'rhinestone-beads';if((titleTags.includes('spacer')||titleTags.includes('accessor'))&&!titleTags.includes('cup charm')&&!titleTags.includes('cup accessor'))return'spacers-accessories';if(titleTags.includes('mix')||titleTags.includes('bundle')||titleTags.includes('kit'))return'mixes-bundles-kits';if(/beadable.*pen.*blank|beaded.*pen.*blank|pen.*blank/.test(titleTags))return'beadable-pen-blanks';if(/10\s*(\/|or)\s*12\s*mm|10mm|12mm/.test(titleTags)&&titleTags.includes('acrylic'))return'10-12mm-acrylic-beads';if(/16\s*mm/.test(titleTags)&&titleTags.includes('acrylic'))return'16mm-acrylic-beads';if(/20\s*mm/.test(titleTags)&&titleTags.includes('acrylic'))return'20mm-acrylic-beads';if(titleTags.includes('silicone'))return(/print|paw|letter|face|pattern|design|swirl/.test(titleTags)?'silicone-printed-style':'silicone-solid-color');return'uncategorized';}
const penBlankOverrides=[/^crayon beaded pen/,/^snowman beaded pen/,/^st\. patrick.?s day beadable pen set/];
const escapeProductText=(value)=>String(value||'').replace(/[&<>"']/g,(character)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
function isProductVisible(item){return Boolean(item)&&item.visible!==false;}

function visibleCatalog(){return catalog.filter(isProductVisible);}
window.isProductVisible=isProductVisible;
window.visibleCatalog=visibleCatalog;
window.badgeCatalogReady=badgeCatalogReady;
const skuInventory=(item)=>{const values=(item.options||[]).flatMap((option)=>option.values||[]).filter((value)=>typeof value==='object'&&value.sku);return values.length?values.map((value)=>({quantity:Number(value.quantity)||0,threshold:Number(value.lowStockThreshold)||0})): [{quantity:Number(item.quantity)||0,threshold:Number(item.lowStockThreshold)||0}];};
const storefrontInventoryStatus=(item)=>{const inventory=skuInventory(item);const hasStock=inventory.some((value)=>value.quantity>0);const hasLowStock=inventory.some((value)=>value.quantity>0&&value.threshold>0&&value.quantity<=value.threshold);return hasStock?(hasLowStock?'Low Stock':'In Stock'):'Out of Stock';};
const storefrontStatusBadges=(item)=>{const status=storefrontInventoryStatus(item);return status==='In Stock'?[]:[status];};
const storefrontPromoActive=(item)=>{const percent=Number(item.promoDiscountPercent??item.promo_discount_percent)||0;const promoPrice=Number(item.promoPrice??item.promo_price);const hasPromoPrice=Number.isFinite(promoPrice)&&promoPrice>0&&promoPrice<Number(item.price||0);const starts=item.promoStartsAt||item.promo_starts_at;const ends=item.promoEndsAt||item.promo_ends_at;const startsAt=starts?Date.parse(starts):NaN;const endsAt=ends?Date.parse(ends):NaN;return (percent>0||hasPromoPrice)&&(!Number.isNaN(startsAt)&&startsAt>Date.now()?false:true)&&(!Number.isNaN(endsAt)&&endsAt<Date.now()?false:true);};
const storefrontPromoForSku=(item,originalPrice,sku='')=>{const basePrice=Math.max(0,Number(originalPrice)||0);const percent=Math.min(100,Math.max(0,Number(item.promoDiscountPercent??item.promo_discount_percent)||0));const fixedPrice=Number(item.promoPrice??item.promo_price);const promoSkus=Array.isArray(item.promoSkus)?item.promoSkus:(Array.isArray(item.promo_skus)?item.promo_skus:[]);const normalizedSku=String(sku||'').trim().toLowerCase();const appliesToSku=!promoSkus.length||promoSkus.some((value)=>String(value||'').trim().toLowerCase()===normalizedSku);const starts=item.promoStartsAt||item.promo_starts_at;const ends=item.promoEndsAt||item.promo_ends_at;const startsAt=starts?Date.parse(starts):NaN;const endsAt=ends?Date.parse(ends):NaN;const hasDiscount=percent>0||Number.isFinite(fixedPrice)&&fixedPrice>0&&fixedPrice<basePrice;const active=appliesToSku&&hasDiscount&&(!Number.isNaN(startsAt)&&startsAt>Date.now()?false:true)&&(!Number.isNaN(endsAt)&&endsAt<Date.now()?false:true);if(!active)return{originalPrice:basePrice,price:basePrice,discounted:false};const price=Number.isFinite(fixedPrice)&&fixedPrice>0&&fixedPrice<basePrice?fixedPrice:basePrice*(1-percent/100);return{originalPrice:basePrice,price:Math.max(0,Math.min(basePrice,price)),discounted:price<basePrice};};
window.storefrontPromoForSku=storefrontPromoForSku;
const storefrontPromoDetails=(item,originalPrice,sku='')=>{const pricing=storefrontPromoForSku(item,originalPrice,sku);if(!pricing.discounted)return'';const formatDate=(value)=>{const time=Date.parse(value||'');return Number.isFinite(time)?new Date(time).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'';};const percent=Math.min(100,Math.max(0,Number(item.promoDiscountPercent??item.promo_discount_percent)||0));const ends=formatDate(item.promoEndsAt||item.promo_ends_at);return[percent>0?`${percent}% off`:'Sale',ends?`Sale Ends ${ends}`:''].filter(Boolean).join(' · ');};
window.storefrontPromoDetails=storefrontPromoDetails;
const storefrontBrowseBadges=(item)=>[...new Set([...(item.badges||[])].filter((badge)=>['Fits on Beadable Pen','Clearance'].includes(badge)).concat(storefrontPromoActive(item)?['On Sale']:[],storefrontBestSellerIds.has(item.externalId||item.id)?['Best Seller']:[],storefrontStatusBadges(item).filter((badge)=>badge!=='In Stock')))];
window.storefrontStatusBadges=storefrontStatusBadges;
window.storefrontInventoryStatus=storefrontInventoryStatus;
const productCardPricing=(item)=>{const variants=(item.options||[]).flatMap((option)=>option.values||[]).filter((value)=>typeof value==='object'&&String(value.sku||value.inventorySku||'').trim()&&Number.isFinite(Number(value.price)));const lowest=variants.reduce((current,value)=>Number(value.price)<Number(current.price)?value:current,variants[0]);const basePrice=Number(lowest?.price??item.displayPrice??item.price);const sku=lowest?.sku||lowest?.inventorySku||item.sku||item.promoSkus?.[0]||'';const promo=storefrontPromoForSku(item,basePrice,sku);const unit=String(lowest?.unitType||item.unitType||'Each').trim()||'Each';const multiple=variants.length>1||(!variants.length&&!item.sku);const prefix=multiple?'Starting at ':'';const original=`$${basePrice.toFixed(2)} / ${unit}`;const current=`$${promo.price.toFixed(2)} / ${unit}`;const prefixMarkup=prefix?`<span class="product-card-price-prefix">${prefix}</span>`:'';return {multiple,label:promo.discounted?`${prefixMarkup}<span class="product-card-price-original"><s class="product-card-original-price">${original}</s></span><span class="product-card-price-current product-card-promo-price">${current}</span>`:`${prefixMarkup}<span class="product-card-price-current">${current}</span>`};};
function renderProductCards(list,target,options={}){if(!target)return;const wished=wishlistItems();target.replaceChildren(...list.map((item)=>{const pricing=productCardPricing(item);const hasMultipleSkus=pricing.multiple;const inBag=!hasMultipleSkus&&isInBag(item.id);const badges=storefrontBrowseBadges(item);const topBadges=badges.filter((badge)=>['Single Bead','Multi-Pack','Single Bead & Multi-Pack','Fits on Beadable Pen','Best Seller'].includes(badge));const bottomBadges=badges.filter((badge)=>['On Sale','Clearance','Low Stock','Out of Stock'].includes(badge));const badgeSpan=(badge)=>`<span class="product-badge product-badge-${badge.toLowerCase().replace(/[^a-z0-9]+/g,'-')}">${escapeProductText(badge)}</span>`;const topMarkup=topBadges.length?`<div class="product-badges product-card-badges product-card-badges-top">${topBadges.map(badgeSpan).join('')}</div>`:'';const bottomMarkup=bottomBadges.length?`<div class="product-badges product-card-badges product-card-badges-bottom">${bottomBadges.map(badgeSpan).join('')}</div>`:'';const imageMarkup=item.image?`<img loading="lazy" class="product-card-image" src="${escapeProductText(item.image)}" alt="${escapeProductText(item.name)}">`:'<div class="product-card-image product-card-image-placeholder" aria-hidden="true"></div>';const card=document.createElement('article');card.className='product-card';card.dataset.seoTitle=item.seoTitle;card.dataset.searchText=item.searchText;card.innerHTML=`<a class="product-card-link" href="product.html?id=${encodeURIComponent(item.id)}">${topMarkup}<div class="product-card-image-wrap">${imageMarkup}${bottomMarkup}</div><h3>${escapeProductText(item.name)}</h3></a><div class="product-card-pricing"><strong>${pricing.label}</strong></div><div class="product-actions"><button type="button" class="cart-toggle${inBag?' in-cart':''}" data-cart-toggle="${item.id}" data-choose-options="${hasMultipleSkus?'true':'false'}">${hasMultipleSkus?'Choose Options':inBag?'Remove from Cart':'Add to Cart'}</button><button type="button" class="wishlist-button${wished.includes(item.id)?' active':''}" data-wishlist="${item.id}" aria-label="${wished.includes(item.id)?'Remove from':'Add to'} wishlist">♡</button>${options.cart?`<button type="button" class="remove-cart" data-remove="${item.id}">Remove</button>`:''}</div>`;return card;}));target.querySelectorAll('[data-cart-toggle]').forEach((button)=>button.addEventListener('click',()=>{if(button.dataset.chooseOptions==='true'){window.location.href='product.html?id='+encodeURIComponent(button.dataset.cartToggle);return;}if(isInBag(button.dataset.cartToggle)){removeFromBag(button.dataset.cartToggle);button.textContent='Add to Cart';button.classList.remove('in-cart');}else{addToBag(button.dataset.cartToggle);button.textContent='Remove from Cart';button.classList.add('in-cart');}}));target.querySelectorAll('[data-remove]').forEach((button)=>button.addEventListener('click',()=>{removeFromBag(button.dataset.remove);button.closest('.product-card').remove();}));target.querySelectorAll('[data-wishlist]').forEach((button)=>button.addEventListener('click',()=>{button.classList.toggle('active',toggleWishlist(button.dataset.wishlist));}));};

// Product-page photos live in canonical inventory source_metadata.  Apply them
// after the catalog's normal option load so admin and storefront share the
// same page-scoped selection.
const applyCanonicalProductPageMedia=async()=>{
  if(!window.beadSupabase||!catalog.length)return catalog;
  const skus=[...new Set(catalog.flatMap((item)=>(item.options||[]).flatMap((option)=>option.values||[])).map((value)=>String(value?.inventorySku||value?.sku||'').trim()).filter(Boolean))];
  if(!skus.length)return catalog;
  const missingSkus=skus.filter((sku)=>!storefrontInventoryForSku(sku)?.product_pages);
  const result=missingSkus.length?await fetchStoreBatches(missingSkus,(batch)=>window.beadSupabase.from('storefront_inventory_skus').select('sku,product_pages').in('sku',batch)):{data:[],error:null};
  if(result.error)return catalog;
  cacheStorefrontInventoryRecords(result.data||[]);
  catalog.forEach((item)=>{const pageKey=String(item.databaseId||'');item.options=(item.options||[]).map((option)=>({...option,values:(option.values||[]).map((value)=>{const record=storefrontInventoryForSku(value.inventorySku||value.sku);const imageUrl=record?.product_pages?.[pageKey]?.image_url;return imageUrl?{...value,imageUrl:String(imageUrl)}:value;})}));});
  return catalog;
};
if(window.catalogMetadataReady)window.catalogMetadataReady=window.catalogMetadataReady.then(applyCanonicalProductPageMedia);
const addToBagQuantity=(id,selectedOptions=[],quantity=1)=>{const count=Math.max(1,Math.floor(Number(quantity)||1));let added=0;for(let index=0;index<count;index+=1){if(!addToBag(id,selectedOptions))break;added+=1;}return added===count;};
window.storeCart.addLine=(id,selectedOptions=[],quantity=1)=>addToBagQuantity(id,selectedOptions,quantity);
