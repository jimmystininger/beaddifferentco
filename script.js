const names={'shop-all':'All','new-arrivals':'New Arrivals','beadable-products':'Beadable Products','beadable-pen-blanks':'Beadable Pen Blanks','mixes-bundles-kits':'Mixes, Bundles & Kits','spacers-accessories':'Spacers/Accessories','acrylic-flatbacks':'Acrylic Flatbacks','rhinestone-beads':'Rhinestone Beads','focal-beads':'Focal Beads','silicone':'Silicone','acrylic':'Acrylic','10-12mm-acrylic-beads':'10/12mm Acrylic Beads','16mm-acrylic-beads':'16mm Acrylic Beads','20mm-acrylic-beads':'20mm Acrylic Beads','cup-charms':'Cup Charms','completed-pens-keychains':'Completed Pens/Keychains','charms-dangles':'Charms/Dangles','clearance-section':'Clearance Section'};
const grid=document.querySelector('#product-grid'),view=document.querySelector('#filter-view'),filtered=document.querySelector('#filtered-items'),title=document.querySelector('#filter-title'),count=document.querySelector('#filter-count');
const categoryGrid=document.querySelector('.category-grid');
document.querySelector('.category-prev')?.addEventListener('click',()=>categoryGrid?.scrollBy({left:-categoryGrid.clientWidth*.8,behavior:'smooth'}));
document.querySelector('.category-next')?.addEventListener('click',()=>categoryGrid?.scrollBy({left:categoryGrid.clientWidth*.8,behavior:'smooth'}));
const categoryLinks=window.storeCategories;
document.querySelectorAll('.category-grid').forEach((grid)=>{const siliconeLinks=[...grid.querySelectorAll('[data-filter="silicone-solid-color"],[data-filter="silicone-printed-style"]')];if(siliconeLinks.length){const silicone=siliconeLinks[0].cloneNode(true);silicone.href='category.html?category=silicone';silicone.dataset.filter='silicone';silicone.querySelector('b').textContent='Silicone';siliconeLinks.forEach((link)=>link.remove());grid.insertBefore(silicone,grid.children[8]||null);}const acrylicLinks=[...grid.querySelectorAll('[data-filter="10-12mm-acrylic-beads"],[data-filter="16mm-acrylic-beads"],[data-filter="20mm-acrylic-beads"]')];if(acrylicLinks.length){const acrylic=acrylicLinks[0].cloneNode(true);acrylic.href='category.html?category=acrylic';acrylic.dataset.filter='acrylic';acrylic.querySelector('b').textContent='Acrylic';acrylicLinks.forEach((link)=>link.remove());grid.insertBefore(acrylic,grid.children[9]||null);}});
document.querySelectorAll('[data-filter="cup-charms"] img').forEach((image)=>{image.src='cup-charms.jpg';image.alt='Cup charms';});
function applyFilter(filter){if(filter==='new-arrivals'||filter==='silicone'||filter==='acrylic'){window.location.href=`category.html?category=${encodeURIComponent(filter)}`;return;}if(!view||!filtered){window.location.href=`category.html?category=${encodeURIComponent(filter)}`;return;}const list=visibleCatalog().filter((item)=>filter==='shop-all'||(item.categorySlugs||[item.category]).includes(filter));title.textContent=names[filter]||'All';count.textContent=`${list.length} ${list.length===1?'item':'items'}`;renderProductCards(list,filtered);view.classList.add('active');view.scrollIntoView({block:'start'});}
(window.catalogMetadataReady||catalogReady).then(()=>{renderProductCards(visibleCatalog().slice(0,6),grid);const filter=new URLSearchParams(location.hash.slice(1)).get('filter');if(filter)applyFilter(filter);});
window.addEventListener('hashchange',()=>{const filter=new URLSearchParams(location.hash.slice(1)).get('filter');if(filter)applyFilter(filter);});

const renderHomepageFeaturedContent=()=>{
  const section=document.querySelector('#featured-products');
  const copy=document.querySelector('#featured-content-copy');
  const grid=document.querySelector('#featured-product-grid');
  if(!section||!copy||!grid)return;
  const source=String(window.productStoreConfig?.featuredText||'');
  const template=document.createElement('template');
  template.innerHTML=source;
  const decoded=template.content.textContent||'';
  const markup=/<(?:h[1-6]|p|strong|em|u|ul|ol|li|blockquote)\b/i.test(decoded)?decoded:source;
  copy.innerHTML=markup?(window.sanitizeRichText?window.sanitizeRichText(markup):markup):'<p class="featured-loading">Loading featured content…</p>';
  const backgroundUrl=String(window.productStoreConfig?.featuredBackgroundImageUrl||'').trim();
  copy.style.setProperty('--featured-copy-background-image',backgroundUrl?`url("${backgroundUrl.replace(/["\\)]/g,'')}")`:'none');
  const previous=section.querySelector('.featured-prev');
  const next=section.querySelector('.featured-next');
  if(!previous||!next||grid.dataset.carouselReady)return;
  grid.dataset.carouselReady='true';
  const scrollAmount=()=>Math.max(grid.clientWidth*.8,260);
  previous.addEventListener('click',()=>grid.scrollBy({left:-scrollAmount(),behavior:'smooth'}));
  next.addEventListener('click',()=>grid.scrollBy({left:scrollAmount(),behavior:'smooth'}));
};
const homepageRecentState={visibleCount:6,pageSize:6,loading:false};
const homepageRecentItems=()=>{
  const recentIds=Array.isArray(window.storefrontHomepageRecentIds)?new Set(window.storefrontHomepageRecentIds.map((id)=>String(id))):null;
  const items=typeof visibleCatalog==='function'?visibleCatalog():[];
  return recentIds?.size?items.filter((item)=>recentIds.has(String(item.databaseId||item.id))):items;
};
const renderHomepageRecent=()=>{
  const grid=document.querySelector('#product-grid');
  if(!grid||typeof visibleCatalog!=='function'||typeof renderProductCards!=='function')return;
  const items=homepageRecentItems();
  renderProductCards(items.slice(0,homepageRecentState.visibleCount),grid);
  const actions=document.querySelector('#homepage-product-actions');
  const loadMore=document.querySelector('#homepage-load-more');
  const browseAll=document.querySelector('#homepage-browse-all');
  if(!actions||!loadMore||!browseAll)return;
  const hasMore=homepageRecentState.visibleCount<items.length||window.storefrontHomepageHasMore===true;
  loadMore.hidden=!hasMore;
  browseAll.hidden=hasMore;
  if(!items.length){loadMore.hidden=true;browseAll.hidden=false;}
};
const renderHomepageFeaturedProducts=()=>{
  const section=document.querySelector('#featured-products');
  const featuredGrid=document.querySelector('#featured-product-grid');
  if(!section||!featuredGrid||typeof visibleCatalog!=='function'||typeof renderProductCards!=='function')return;
  const featured=visibleCatalog().filter((item)=>item.featured===true);
  section.hidden=!featured.length&&window.storefrontHomepageCatalogSettled===true;
  if(featured.length){section.hidden=false;renderProductCards(featured,featuredGrid);}
};
const renderHomepage=()=>{renderHomepageRecent();renderHomepageFeaturedProducts();renderHomepageFeaturedContent();};
const loadMoreButton=document.querySelector('#homepage-load-more');
loadMoreButton?.addEventListener('click',async()=>{
  if(homepageRecentState.loading)return;
  const items=homepageRecentItems();
  const needsMoreRows=homepageRecentState.visibleCount>=items.length&&window.storefrontHomepageHasMore===true;
  homepageRecentState.loading=true;
  loadMoreButton.disabled=true;
  loadMoreButton.textContent=needsMoreRows?'Loading…':'Load more';
  try{
    const loaded=needsMoreRows&&typeof window.loadStorefrontHomepageMore==='function'?await window.loadStorefrontHomepageMore():true;
    if(loaded)homepageRecentState.visibleCount+=homepageRecentState.pageSize;
  }finally{
    homepageRecentState.loading=false;
    loadMoreButton.disabled=false;
    loadMoreButton.textContent='Load more';
    renderHomepageRecent();
  }
});
renderHomepage();
window.siteSettingsReady?.then(renderHomepage);
if(window.catalogReady&&typeof window.catalogReady.then==='function')window.catalogReady.then(()=>{window.storefrontHomepageCatalogSettled=true;renderHomepage();});
if(window.catalogMetadataReady&&typeof window.catalogMetadataReady.then==='function')window.catalogMetadataReady.then(renderHomepage);
window.addEventListener('bead-catalog-enriched',renderHomepage);
