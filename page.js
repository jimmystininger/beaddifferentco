const page=document.body.dataset.page||'Page';
document.title=`${page} | Bead Different Co.`;
const categoryLabels={'shop-all':'All','beadable-products':'Beadable Products','beadable-pen-blanks':'Beadable Pen Blanks','mixes-bundles-kits':'Mixes, Bundles & Kits','spacers-accessories':'Spacers/Accessories','acrylic-flatbacks':'Acrylic Flatbacks','rhinestone-beads':'Rhinestone Beads','focal-beads':'Focal Beads','silicone':'Silicone','acrylic':'Acrylic','10-12mm-acrylic-beads':'10/12mm Acrylic Beads','16mm-acrylic-beads':'16mm Acrylic Beads','20mm-acrylic-beads':'20mm Acrylic Beads','cup-charms':'Cup Charms','completed-pens-keychains':'Completed Pens/Keychains','charms-dangles':'Charms/Dangles','clearance-section':'Clearance Section'};
const legacyCategory={'Shop All':['shop-all'],'Acrylic Beads':['10-12mm-acrylic-beads','16mm-acrylic-beads','20mm-acrylic-beads'],'Silicone Beads':['silicone-solid-color','silicone-printed-style'],'Rhinestones':['rhinestone-beads'],'Flatbacks':['acrylic-flatbacks'],'Pen Supplies':['beadable-pen-blanks'],'Mixes & Kits':['mixes-bundles-kits'],'Clearance':['clearance-section'],'Focal Beads':['focal-beads']};
const main=document.querySelector('main');
main.classList.remove('blank-page');
catalogReady.then(async()=>{
  const productId=document.body.dataset.productId||new URLSearchParams(location.search).get('id');
  const requestedCategory=new URLSearchParams(location.search).get('category');
  if(productId&&page!=='Product'){
    const item=findProduct(productId);
    if(!item){main.innerHTML='<section class="store-page"><h1>Product Not Found</h1></section>';return;}
    main.innerHTML=`<section class="store-page product-detail-page"><p class="kicker">${item.category.replaceAll('-',' ').toUpperCase()}</p><div class="product-detail"><div class="product-gallery">${item.images.map((image,index)=>`<img loading="lazy" src="${image}" alt="${item.name} image ${index+1}">`).join('')}</div><div><h1>${item.name}</h1><strong>$${item.price.toFixed(2)}</strong><p>${item.description.replace(/\n/g,'<br>')}</p><div class="product-actions"><button type="button" class="cart-toggle${isInBag(item.id)?' in-cart':''}" data-cart-toggle="${item.id}">${isInBag(item.id)?'Remove from Cart':'Add to Cart'}</button><button type="button" class="wishlist-button${wishlistItems().includes(item.id)?' active':''}" data-wishlist="${item.id}">♡</button></div></div></div></section>`;
    const cartButton=main.querySelector('[data-cart-toggle]');
    cartButton.addEventListener('click',()=>{if(isInBag(item.id)){removeFromBag(item.id);cartButton.textContent='Add to Cart';cartButton.classList.remove('in-cart');}else{addToBag(item.id);cartButton.textContent='Remove from Cart';cartButton.classList.add('in-cart');}});
    main.querySelector('[data-wishlist]').addEventListener('click',()=>{const active=toggleWishlist(item.id);main.querySelector('[data-wishlist]').classList.toggle('active',active);});
    return;
  }
  if(page==='Shopping Bag'||page==='Wishlist'){
    if(page==='Shopping Bag'&&window.storePromosReady)await window.storePromosReady;
    const isBag=page==='Shopping Bag';const selected=isBag?bagItems():wishlistItems().map((id)=>({id,quantity:1}));
    main.innerHTML=`<section class="store-page"><p class="kicker">${isBag?'YOUR PICKS':'SAVED FOR LATER'}</p><h1>${page}</h1><div class="product-grid" id="page-products"></div><p class="store-empty" id="store-empty">${isBag?'Your shopping bag is empty.':'Your wishlist is empty.'}</p>${isBag?'<a class="cta" href="shop-all.html">Continue Shopping</a>':''}</section>`;
    const products=selected.map((entry)=>findProduct(entry.id)).filter(Boolean).filter(isProductVisible);renderProductCards(products,document.querySelector('#page-products'),{cart:isBag});document.querySelector('#store-empty').hidden=products.length>0;if(isBag&&window.storePromos){const subtotal=selected.reduce((sum,entry)=>{const item=findProduct(entry.id);return sum+(item?.price||0)*entry.quantity;},0);const summary=document.createElement('section');summary.className='bag-summary';summary.innerHTML='<h2>Order summary</h2><p>Subtotal <strong data-bag-subtotal></strong></p><label>Promo code<input data-promo-code placeholder="Enter code"><button type="button" data-apply-promo>Apply</button></label><p data-promo-message></p><p>Discount <strong data-bag-discount>$0.00</strong></p><p class="bag-total">Total <strong data-bag-total></strong></p><button class="cta" type="button">Continue to checkout</button>';main.querySelector('.store-page').append(summary);const codeInput=summary.querySelector('[data-promo-code]');const message=summary.querySelector('[data-promo-message]');const subtotalEl=summary.querySelector('[data-bag-subtotal]');const discountEl=summary.querySelector('[data-bag-discount]');const totalEl=summary.querySelector('[data-bag-total]');const auto=window.storePromos.auto();let activePromo=auto;const draw=()=>{const discount=window.storePromos.discount(activePromo,subtotal);subtotalEl.textContent=`$${subtotal.toFixed(2)}`;discountEl.textContent=`-$${discount.toFixed(2)}`;totalEl.textContent=`$${(subtotal-discount).toFixed(2)}`;};summary.querySelector('[data-apply-promo]').addEventListener('click',()=>{const promo=window.storePromos.find(codeInput.value);if(!promo||promo.mode!=='manual'){message.textContent='That promo code is not available.';return;}activePromo=promo;message.textContent=`${promo.code} applied.`;draw();});draw();}return;
  }
  if(page==='Search'){
    const query=new URLSearchParams(location.search).get('q')||'';
    main.innerHTML=`<section class="store-page"><p class="kicker">FIND YOUR FAVORITES</p><h1>Search</h1><form class="store-search-form"><input name="q" value="${query.replace(/"/g,'&quot;')}" placeholder="Search beads, charms, supplies..." aria-label="Search products"><button class="cta" type="submit">Search</button></form><div class="product-grid" id="page-products"></div><p class="store-empty" id="store-empty">No products matched your search.</p></section>`;
    const form=main.querySelector('.store-search-form');const products=searchCatalog(query);renderProductCards(products,document.querySelector('#page-products'));document.querySelector('#store-empty').hidden=products.length>0;form.addEventListener('submit',(event)=>{event.preventDefault();const value=new FormData(form).get('q')||'';window.location.href=`search.html?q=${encodeURIComponent(value)}`;});return;
  }
  if(page==='New Arrivals'||requestedCategory==='new-arrivals'){
    const cutoff=Date.now()-30*24*60*60*1000;
    const products=visibleCatalog().filter((item)=>item.addedAt&&Date.parse(item.addedAt)>=cutoff);
    main.innerHTML=`<section class="store-page"><p class="kicker">JUST ADDED</p><h1>New Arrivals</h1><p class="store-page-note">Items added to our website within the last 30 days.</p><div class="product-grid" id="page-products"></div><div class="pagination" id="page-pagination" aria-label="Product pages"></div><p class="store-empty" id="store-empty">No new arrivals have been added in the last 30 days.</p></section>`;
    renderPaginatedProducts(products,document.querySelector('#page-products'),document.querySelector('#page-pagination'));
    document.querySelector('#store-empty').hidden=products.length>0;
    return;
  }
  const category=requestedCategory==='silicone'?['silicone-solid-color','silicone-printed-style']:requestedCategory==='acrylic'?['10-12mm-acrylic-beads','16mm-acrylic-beads','20mm-acrylic-beads']:(requestedCategory? [requestedCategory] : (legacyCategory[page]||null));
  if(category){
    const products=visibleCatalog().filter((item)=>category.includes('shop-all')||category.includes(item.category));
    const heading=requestedCategory?(categoryLabels[requestedCategory]||page):(page==='Acrylic Beads'?'Acrylic Beads':page);
    const style=new URLSearchParams(location.search).get('style');
    const categoryFilters=requestedCategory==='silicone'?`<nav class="category-filters" aria-label="Silicone styles"><a class="${style?'':'active'}" href="category.html?category=silicone">All Silicone</a><a class="${style==='solid'?'active':''}" href="category.html?category=silicone&style=solid">Solid Color</a><a class="${style==='printed'?'active':''}" href="category.html?category=silicone&style=printed">Printed Style</a></nav>`:requestedCategory==='acrylic'?`<nav class="category-filters" aria-label="Acrylic bead sizes"><a class="${style?'':'active'}" href="category.html?category=acrylic">All Acrylic</a><a class="${style==='10-12mm'?'active':''}" href="category.html?category=acrylic&style=10-12mm">10/12mm</a><a class="${style==='16mm'?'active':''}" href="category.html?category=acrylic&style=16mm">16mm</a><a class="${style==='20mm'?'active':''}" href="category.html?category=acrylic&style=20mm">20mm</a></nav>`:'';
    const filteredProducts=requestedCategory==='silicone'?(style==='solid'?products.filter((item)=>item.category==='silicone-solid-color'):style==='printed'?products.filter((item)=>item.category==='silicone-printed-style'):products):requestedCategory==='acrylic'?(style==='10-12mm'?products.filter((item)=>item.category==='10-12mm-acrylic-beads'):style==='16mm'?products.filter((item)=>item.category==='16mm-acrylic-beads'):style==='20mm'?products.filter((item)=>item.category==='20mm-acrylic-beads'):products):products;
    main.innerHTML=`<section class="store-page"><h1>${heading}</h1>${categoryFilters}<div class="product-grid" id="page-products"></div><div class="pagination" id="page-pagination" aria-label="Product pages"></div></section>`;
    renderPaginatedProducts(filteredProducts,document.querySelector('#page-products'),document.querySelector('#page-pagination'));return;
  }
  const heading=document.querySelector('#page-title');if(heading)heading.textContent=page;
});
