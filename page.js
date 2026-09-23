const page=document.body.dataset.page||'Page';
document.title=`${page} | Bead Different Co.`;
const currentRequestedCategory=()=>new URLSearchParams(location.search).get('category')||'';
if(page==='Category'&&currentRequestedCategory()==='shop-all')window.location.replace('shop-all.html');
const categoryLabelFor=(slug)=>(window.storeCategories||[]).find(([value])=>value===slug)?.[1]||'';
const main=document.querySelector('main');
main.classList.remove('blank-page');
window.addEventListener('bead-categories-ready',()=>{const category=currentRequestedCategory();const heading=document.querySelector('.store-page>h1');if(heading&&category)heading.textContent=categoryLabelFor(category);});

const shoppingBagShell=(auditNotice='')=>`<section class="store-page shopping-bag-page"><p class="kicker">YOUR PICKS</p><h1>Shopping Bag</h1>${auditNotice}<div class="product-grid" id="page-products"></div><p class="store-empty" id="store-empty" role="status">Loading your shopping bag…</p><a class="cta cart-continue" href="shop-all.html" hidden>Continue shopping</a></section>`;
const categoryLoadingHeading=currentRequestedCategory()?categoryLabelFor(currentRequestedCategory()):page;
if(storefrontListingPage())main.innerHTML=`<section class="store-page"><h1>${categoryLoadingHeading}</h1><div id="category-filter-region" class="category-filter-region" aria-live="polite"></div><div class="product-grid" id="page-products"></div><div class="pagination" id="page-pagination" aria-label="Product pages"></div><p class="store-empty" id="store-empty" role="status">Loading products…</p></section>`;
if(page==='Shopping Bag')main.innerHTML=shoppingBagShell();

const drawStorefrontPagination=()=>{
  const controls=document.querySelector('#page-pagination');
  const listing=window.storeCategoryPagination;
  if(!controls||!listing)return;
  const pageCount=Math.ceil(listing.total()/listing.pageSize());
  controls.replaceChildren();
  if(pageCount<2)return;
  for(let pageNumber=1;pageNumber<=pageCount;pageNumber+=1){
    const button=document.createElement('button');
    button.type='button';
    button.textContent=String(pageNumber);
    button.className=pageNumber===listing.page()?'active':'';
    button.addEventListener('click',async()=>{
      button.disabled=true;
      await loadStorefrontCategoryPage(pageNumber);
      renderProductCards(visibleCatalog(),document.querySelector('#page-products'));
      drawStorefrontPagination();
      document.querySelector('#page-products')?.scrollIntoView({block:'start'});
    });
    controls.append(button);
  }
};

const renderCategoryFilters=(filters)=>{
  const region=document.querySelector('#category-filter-region');
  if(!region)return;
  region.replaceChildren();
  const request=storefrontCategoryListing.request;
  (Array.isArray(filters)?filters:[]).filter((filter)=>Array.isArray(filter.values)&&filter.values.length>0).forEach((filter)=>{
    const wrapper=document.createElement('label');
    wrapper.className='category-filter';
    const select=document.createElement('select');
    select.dataset.categoryFilter=filter.key;
    select.setAttribute('aria-label',filter.label||filter.key);
    select.title=filter.label||filter.key;
    const all=document.createElement('option');
    all.value='';
    all.textContent=`All ${String(filter.label||filter.key).toLowerCase()}`;
    select.append(all);
    (Array.isArray(filter.values)?filter.values:[]).forEach((value)=>{
      const option=document.createElement('option');
      option.value=value.key||'';
      option.textContent=value.label||value.key||'';
      option.selected=Array.isArray(request.filters?.[filter.key])&&request.filters[filter.key].includes(option.value);
      select.append(option);
    });
    select.addEventListener('change',async()=>{
      const nextUrl=new URL(location.href);
      nextUrl.searchParams.delete('style');
      let nextFilters={};
      try{const parsed=JSON.parse(nextUrl.searchParams.get('filters')||'{}');if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))nextFilters=parsed;}catch(error){}
      const value=select.value;
      if(value)nextFilters[filter.key]=[value];else delete nextFilters[filter.key];
      nextUrl.searchParams.delete('filterKey');
      nextUrl.searchParams.delete('filterValues');
      if(Object.keys(nextFilters).length)nextUrl.searchParams.set('filters',JSON.stringify(nextFilters));else nextUrl.searchParams.delete('filters');
      history.pushState({},'',nextUrl);
      storefrontCategoryListing.request=storefrontCategoryRequest();
      const updatedFilters=await loadStorefrontCategoryFilters(currentRequestedCategory()||'shop-all');
      region.setAttribute('aria-busy','true');
      const grid=document.querySelector('#page-products');
      grid?.setAttribute('aria-busy','true');
      await loadStorefrontCategoryPage(1);
      renderProductCards(visibleCatalog(),grid);
      drawStorefrontPagination();
      const empty=document.querySelector('#store-empty');
      if(empty)empty.hidden=visibleCatalog().length>0;
      region.setAttribute('aria-busy','false');
      grid?.setAttribute('aria-busy','false');
      renderCategoryFilters(updatedFilters);
    });
    wrapper.append(select);
    region.append(wrapper);
  });
  const hasSelections=Object.values(request.filters||{}).some((values)=>Array.isArray(values)&&values.length>0);
  const clear=document.createElement('button');
  clear.type='button';
  clear.className='category-filter-clear';
  clear.textContent='Clear filters';
  clear.hidden=!hasSelections;
  clear.addEventListener('click',async()=>{
    const nextUrl=new URL(location.href);
    nextUrl.searchParams.delete('style');
    nextUrl.searchParams.delete('filters');
    nextUrl.searchParams.delete('filterKey');
    nextUrl.searchParams.delete('filterValues');
    history.pushState({},'',nextUrl);
    storefrontCategoryListing.request=storefrontCategoryRequest();
    region.setAttribute('aria-busy','true');
    const grid=document.querySelector('#page-products');
    grid?.setAttribute('aria-busy','true');
    await loadStorefrontCategoryPage(1);
    renderProductCards(visibleCatalog(),grid);
    drawStorefrontPagination();
    const empty=document.querySelector('#store-empty');
    if(empty)empty.hidden=visibleCatalog().length>0;
    region.setAttribute('aria-busy','false');
    grid?.setAttribute('aria-busy','false');
    const updatedFilters=await loadStorefrontCategoryFilters(currentRequestedCategory()||'shop-all');
    renderCategoryFilters(updatedFilters);
  });
  region.append(clear);
};

const renderCategoryPage=async()=>{
  const storePage=document.querySelector('.store-page');
  const grid=document.querySelector('#page-products');
  const empty=document.querySelector('#store-empty');
  if(!storePage||!grid)return;
  const products=visibleCatalog();
  renderProductCards(products,grid);
  drawStorefrontPagination();
  if(empty){empty.textContent=window.storeCatalogError?'The store catalog is temporarily unavailable. Please refresh and try again.':'No products are currently available in this category.';empty.hidden=products.length>0;}
  const slug=currentRequestedCategory()||storefrontCategoryListing.request.categorySlugs[0]||(page==='Shop All'?'shop-all':'');
  const heading=storePage.querySelector('h1');if(heading)heading.textContent=categoryLabelFor(slug)||page;
  if(slug){try{const filters=await loadStorefrontCategoryFilters(slug);if(window.storefrontCategoryFiltersChanged){window.storefrontCategoryFiltersChanged=false;await loadStorefrontCategoryPage(1);renderProductCards(visibleCatalog(),grid);drawStorefrontPagination();if(empty)empty.hidden=visibleCatalog().length>0;}renderCategoryFilters(filters);}catch(error){renderCategoryFilters([]);}}
  storePage.dataset.categoryRendered='true';
};

const renderSearchPage=()=>{
  const query=new URLSearchParams(location.search).get('q')||'';
  main.innerHTML=`<section class="store-page"><p class="kicker">FIND YOUR FAVORITES</p><h1>Search</h1><form class="store-search-form"><input name="q" value="${query.replace(/"/g,'&quot;')}" placeholder="Search beads, charms, supplies..." aria-label="Search products"><button class="cta" type="submit">Search</button></form><div class="product-grid" id="page-products"></div><p class="store-empty" id="store-empty">No products found.</p></section>`;
  const form=main.querySelector('.store-search-form');
  const products=searchCatalog(query);
  renderProductCards(products,document.querySelector('#page-products'));
  document.querySelector('#store-empty').hidden=products.length>0;
  const pagination=document.createElement('div');
  pagination.className='pagination';
  const searchState=window.storeSearchPagination;
  const pageNumber=Number(searchState?.page||1);
  const pageCount=Math.ceil(Number(searchState?.total||0)/Number(searchState?.pageSize||24));
  if(pageCount>1){
    for(let nextPage=1;nextPage<=pageCount;nextPage+=1){
      const button=document.createElement('button');
      button.type='button';button.textContent=String(nextPage);button.className=nextPage===pageNumber?'active':'';
      button.addEventListener('click',()=>{const next=new URL(location.href);next.searchParams.set('page',String(nextPage));location.href=next.toString();});
      pagination.append(button);
    }
    main.querySelector('#page-products').after(pagination);
  }
  form.addEventListener('submit',(event)=>{event.preventDefault();location.href=`search.html?q=${encodeURIComponent(String(form.elements.q.value||'').trim())}`;});
};

const saleCollectionVariants=(item)=>{
  const values=(item.options||[]).flatMap((option)=>option.values||[]).filter((value)=>typeof value==='object'&&String(value.sku||value.inventorySku||'').trim());
  const candidates=values.length?values:[{label:item.name,sku:item.sku||'',inventorySku:item.sku||'',price:Number(item.price)||0,imageUrl:item.image||'',quantity:item.quantity}];
  return candidates.map((value)=>{
    const sku=String(value.sku||value.inventorySku||item.sku||'').trim();
    const originalPrice=Number(value.price??item.price)||0;
    const pricing=window.storefrontPromoForSku?.(item,originalPrice,sku);
    return{item,value,sku,originalPrice,pricing,variantLabel:String(value.label||sku||item.name).trim()};
  }).filter((entry)=>entry.sku&&entry.pricing?.discounted);
};

const renderSaleCollection=async()=>{
  if(window.catalogMetadataReady)await window.catalogMetadataReady;
  main.innerHTML='<section class="store-page sale-collection-page"><p class="kicker">SHOP THE SAVINGS</p><h1>Sale Collection</h1><p class="sale-collection-intro">Only individual items currently on sale are shown here. Choose the exact color or pack size to see its sale price.</p><div class="product-grid sale-collection-grid" id="sale-collection-products"></div><p class="store-empty" id="sale-collection-empty" role="status">No sale items are currently available.</p></section>';
  const grid=main.querySelector('#sale-collection-products');
  const empty=main.querySelector('#sale-collection-empty');
  const rows=visibleCatalog().flatMap(saleCollectionVariants);
  grid.replaceChildren(...rows.map(({item,value,sku,originalPrice,pricing,variantLabel})=>{
    const card=document.createElement('article');
    card.className='product-card sale-collection-card';
    const href=`product.html?id=${encodeURIComponent(item.id)}&sku=${encodeURIComponent(sku)}&sale=1`;
    const link=document.createElement('a');
    link.className='product-card-link';link.href=href;
    const imageWrap=document.createElement('div');imageWrap.className='product-card-image-wrap';
    const image=value.imageUrl||item.image;
    if(image){const imageElement=document.createElement('img');imageElement.loading='lazy';imageElement.className='product-card-image';imageElement.src=image;imageElement.alt=`${item.name} — ${variantLabel}`;imageWrap.append(imageElement);}
    const badges=document.createElement('div');badges.className='product-badges product-card-badges product-card-badges-bottom';
    const saleBadge=document.createElement('span');saleBadge.className='product-badge product-badge-on-sale';saleBadge.textContent='On Sale';badges.append(saleBadge);imageWrap.append(badges);
    link.append(imageWrap);
    const title=document.createElement('h3');title.textContent=item.name;link.append(title);
    const variant=document.createElement('p');variant.className='sale-collection-variant';variant.textContent=variantLabel;link.append(variant);
    const price=document.createElement('strong');
    const original=document.createElement('s');original.className='product-card-original-price';original.textContent=`$${originalPrice.toFixed(2)}`;
    const current=document.createElement('span');current.className='product-card-promo-price';current.textContent=`$${Number(pricing.price).toFixed(2)}`;
    price.append(original,' ',current);
    const actions=document.createElement('div');actions.className='product-actions';
    const view=document.createElement('a');view.className='cta';view.href=href;view.textContent='View sale option';
    const wishlist=document.createElement('button');wishlist.type='button';wishlist.className='wishlist-button';wishlist.dataset.wishlist=item.id;wishlist.setAttribute('aria-label','Add to favorites');wishlist.textContent='♡';
    actions.append(view,wishlist);card.append(link,price,actions);return card;
  }));
  empty.hidden=rows.length>0;
  const salePagination=window.storeSalePagination;
  if(salePagination?.total>salePagination.pageSize){
    const pagination=document.createElement('nav');
    pagination.className='store-pagination';
    const totalPages=Math.max(1,Math.ceil(salePagination.total/salePagination.pageSize));
    const pageLink=(label,page,disabled)=>{const button=document.createElement('a');button.className='cta';button.textContent=label;button.href=`sale.html?page=${page}`;if(disabled){button.setAttribute('aria-disabled','true');button.addEventListener('click',(event)=>event.preventDefault());}return button;};
    pagination.append(pageLink('Previous',Math.max(1,salePagination.page-1),salePagination.page<=1));
    const summary=document.createElement('span');summary.textContent=`Page ${salePagination.page} of ${totalPages} · ${salePagination.total} sale products`;pagination.append(summary);
    pagination.append(pageLink('Next',Math.min(totalPages,salePagination.page+1),salePagination.page>=totalPages));
    main.querySelector('.sale-collection-page').append(pagination);
  }
  const wished=wishlistItems();
  grid.querySelectorAll('[data-wishlist]').forEach((button)=>{const active=wished.includes(button.dataset.wishlist);button.classList.toggle('active',active);button.setAttribute('aria-label',active?'Remove from favorites':'Add to favorites');button.addEventListener('click',()=>{const next=toggleWishlist(button.dataset.wishlist);button.classList.toggle('active',next);button.setAttribute('aria-label',next?'Remove from favorites':'Add to favorites');});});
};

const guestAccountPrompt=(storePage,email)=>{
  if(!email||storePage.querySelector('[data-guest-account-prompt]'))return;
  const prompt=document.createElement('aside');
  prompt.className='guest-account-prompt';
  prompt.dataset.guestAccountPrompt='true';
  prompt.innerHTML=`<h2>Track this order</h2><p>Create an account with ${escapeProductText(email)} to track this order and future orders.</p><a class="cta" href="account.html?signup=1&email=${encodeURIComponent(email)}">Create an account</a>`;
  storePage.append(prompt);
};

const hydrateConfirmationRewards=async(storePage,account)=>{
  if(!account||!window.customerAccounts?.rewardStatus)return;
  try{
    const reward=await window.customerAccounts.rewardStatus();
    const host=storePage.querySelector('[data-confirmation-rewards]');
    if(!host||!reward)return;
    const threshold=Math.max(.01,Number(reward.threshold)||35);
    const spend=Math.max(0,Number(reward.spend)||0);
    const progress=Math.min(threshold,Math.max(0,Number(reward.progress)||0));
    const discount=Math.min(100,Math.max(.01,Number(reward.discountPercent)||5));
    const remaining=Math.max(0,threshold-spend);
    const message=reward.available?'Reward unlocked. It will apply automatically in your cart.':spend>=threshold?'This reward was redeemed. Keep spending to unlock the next one.':`Spend $${remaining.toFixed(2)} more to unlock your reward.`;
    host.innerHTML=`<p class="kicker">MEMBER REWARDS</p><h2>Your rewards progress</h2><p>Spend <strong>$${spend.toFixed(2)}</strong> of <strong>$${threshold.toFixed(2)}</strong> before tax and shipping to unlock <strong>${discount}% off</strong>.</p><progress max="${threshold}" value="${progress}" aria-label="Reward progress"></progress><p class="order-confirmation-rewards-message">${escapeProductText(message)}</p>`;
    host.hidden=false;
  }catch(error){console.warn('Confirmation rewards unavailable.',error);}
};
const publicOrderNumber=(order)=>order?.order_number?`BD-${String(order.order_number).padStart(6,'0')}`:String(order?.id||'created');

const syncCheckoutAccountField=(form)=>{
  const account=window.customerAccounts?.current?.();
  const existing=form.querySelector('.checkout-customer-email');
  if(account){
    existing?.remove();
    form.querySelector('.checkout-signin-note')?.remove();
    return account;
  }
  let note=form.querySelector('.checkout-signin-note');
  if(!note){
    note=document.createElement('p');
    note.className='checkout-signin-note';
    form.querySelector('.checkout-shipping h3')?.after(note);
  }
  if(!existing){
    const wrapper=document.createElement('label');
    wrapper.className='checkout-customer-email';
    wrapper.innerHTML='Email for order updates<input name="customer_email" type="email" autocomplete="email" required placeholder="you@example.com">';
    form.querySelector('.checkout-signin-note')?.after(wrapper);
  }
  note.innerHTML='Sign in to track orders and save your address. Guest checkout is available; order updates are sent by email. <a href="account.html">Sign in</a>.';
  return null;
};

const setupShoppingBag=async()=>{
  if(page!=='Shopping Bag')return;
  const storePage=document.querySelector('.shopping-bag-page');
  const grid=document.querySelector('#page-products');
  const empty=document.querySelector('#store-empty');
  if(!storePage||!grid||storePage.dataset.shoppingBagSetup)return;
  storePage.dataset.shoppingBagSetup='ready';
  const optionSummary=(entry)=>normalizeCartOptions(entry.selectedOptions).map((option)=>option.label).filter(Boolean).join(' · ');
  const packCountForCart=(pricing)=>{const label=String(pricing?.option?.label||'');const countLabel=label.match(/\((\d+)\s*(?:ct|count|pcs?|pack)\)/i);if(countLabel)return Math.max(1,Number(countLabel[1])||1);const packMatch=String(pricing?.sku||'').match(/-(\d+)PK$/i);return packMatch?Math.max(1,Number(packMatch[1])||1):1;};
  const linePricing=(entry,item)=>window.storeCartPricing(item,entry);
  const lineNeedsOption=(entry,item,pricing)=>Boolean(item?.options?.some((option)=>option.required)&&!pricing?.option);
  const invalidEntries=()=>validBagItems().filter((entry)=>{const item=findProduct(entry.id);return item&&lineNeedsOption(entry,item,linePricing(entry,item));});
  const currentEntries=()=>validBagItems().filter((entry)=>findProduct(entry.id));
  const renderCart=()=>{
    const allEntries=validBagItems();
    const entries=allEntries.filter((entry)=>findProduct(entry.id));
    grid.replaceChildren(...entries.map((entry)=>{
      const item=findProduct(entry.id);
      const pricing=linePricing(entry,item);
      const invalidOption=lineNeedsOption(entry,item,pricing);
      const quantity=Math.max(1,Number(entry.quantity)||1);
      const inventoryMaximum=window.storeCart?.maxQuantity?.(entry.id,entry.selectedOptions,entries);
      const finiteInventoryMaximum=Number.isFinite(inventoryMaximum);
      const row=document.createElement('article');
      row.className='cart-line'+(invalidOption?' cart-line-invalid':'');
      const image=pricing.option?.imageUrl||item.image||'product-mix.jpg';
      const productHref=`product.html?id=${encodeURIComponent(item.id)}`;
      const priceMarkup=pricing.productPromoApplied?`<s class="cart-line-original-price">$${pricing.originalUnitPrice.toFixed(2)}</s> <span class="cart-line-promo-price">$${pricing.unitPrice.toFixed(2)}</span>`:`$${pricing.unitPrice.toFixed(2)}`;
      const totalMarkup=pricing.productPromoApplied?`<s class="cart-line-original-price">$${(pricing.originalUnitPrice*quantity).toFixed(2)}</s> <span class="cart-line-promo-price">$${(pricing.unitPrice*quantity).toFixed(2)}</span>`:`$${(pricing.unitPrice*quantity).toFixed(2)}`;
      const packCount=packCountForCart(pricing);
      const wished=wishlistItems().includes(entry.id);
      const promoDetails=pricing.promoDetails?`<small class="cart-line-promo-disclaimer">${escapeProductText(pricing.promoDetails)}</small>`:'';
      row.innerHTML=`<a class="cart-line-image-link" href="${productHref}" aria-label="View ${escapeProductText(item.name)}"><img class="product-card-image" src="${escapeProductText(image)}" alt="${escapeProductText(item.name)}"></a><div class="cart-line-copy"><h3>${escapeProductText(item.name)}</h3>${optionSummary(entry)?`<p>${escapeProductText(optionSummary(entry))}</p>`:''}<p class="cart-line-sku">SKU: ${escapeProductText(pricing.sku||item.sku||'—')}</p>${invalidOption?`<p class="cart-line-warning" role="alert">This saved line is missing its pack option. Reopen the product to choose an option, or remove this line before checkout.</p>`:''}</div><div class="cart-line-unit"><span>Price / unit</span><strong>${priceMarkup}</strong>${promoDetails}</div><label class="cart-line-quantity">Quantity<input type="number" min="1" ${finiteInventoryMaximum?`max="${Math.max(1,inventoryMaximum)}"`:''} step="1" value="${quantity}" data-cart-quantity></label><div class="cart-line-total"><span>Line total</span><strong>${totalMarkup}</strong></div><div class="cart-line-actions"><a href="#" class="cart-line-favorite${wished?' active':''}" data-cart-favorite aria-label="${wished?'Remove from':'Add to'} favorites">${wished?'Remove from Favorites':'Add to Favorites'}</a><a href="#" class="cart-line-remove" data-remove-cart-line>Remove</a></div>`;
      const unitLabel=row.querySelector('.cart-line-unit span');
      if(unitLabel)unitLabel.textContent=packCount>1?`Price / ${packCount} Pack`:'Price / unit';
      if(packCount>1){const bulkNote=document.createElement('small');bulkNote.className='cart-line-bulk-pricing';bulkNote.textContent=`Bulk pricing · $${(pricing.unitPrice/packCount).toFixed(2)} per bead`;row.querySelector('.cart-line-unit')?.append(bulkNote);}
      row.querySelector('[data-cart-quantity]').addEventListener('change',(event)=>window.storeCart.setQuantity(entry.id,entry.selectedOptions,event.target.value));
      row.querySelector('[data-remove-cart-line]').addEventListener('click',(event)=>{event.preventDefault();window.storeCart.removeLine(entry.id,entry.selectedOptions);});
      row.querySelector('[data-cart-favorite]').addEventListener('click',(event)=>{event.preventDefault();const active=toggleWishlist(entry.id);event.currentTarget.classList.toggle('active',active);event.currentTarget.textContent=active?'Remove from Favorites':'Add to Favorites';event.currentTarget.setAttribute('aria-label',active?'Remove from favorites':'Add to favorites');});
      return row;
    }));
    const unresolved=window.storeCartCatalogState==='ready'&&allEntries.length>entries.length;
    storePage.dataset.invalidCartLines=String(invalidEntries().length);
    storePage.classList.toggle('bag-is-empty',entries.length===0);
    empty.hidden=entries.length>0;
    empty.textContent=unresolved?'Some saved items are no longer available.':'Your shopping bag is empty.';
    const continueLink=storePage.querySelector('.cart-continue');
    if(continueLink)continueLink.hidden=entries.length>0;
  };

  const summary=document.createElement('section');
  summary.className='bag-summary';
  summary.innerHTML='<h2>Order summary</h2><form class="checkout-form"><section class="checkout-shipping"><h3>Shipping information</h3><p class="checkout-signin-note"></p><label>Saved shipping address<select data-shipping-address><option value="">New address</option></select></label><div data-address-summary class="checkout-address-summary" hidden></div><button type="button" data-edit-address hidden>Edit address</button><fieldset data-address-fields><label>Recipient name<input name="shipping_name" autocomplete="name" required></label><label>Address<input name="address_line1" autocomplete="street-address" required></label><label>Apartment, suite, etc.<input name="address_line2" autocomplete="address-line2"></label><div class="admin-form-grid"><label>City<input name="city" autocomplete="address-level2" required></label><label>State<input name="state" autocomplete="address-level1" maxlength="2" required></label></div><label>ZIP code<input name="postal_code" inputmode="numeric" autocomplete="postal-code" required></label></fieldset></section><section class="checkout-calculator"><section class="checkout-promo-section"><h4>Promotion</h4><div class="checkout-promo-entry"><label>Promo code<input name="promo_code" placeholder="Enter a manual promo code"></label><button type="button" data-apply-checkout-promo>Apply</button></div><p data-checkout-promo-status role="status"></p></section><div data-order-summary></div><button class="cta" type="submit">Place order</button><p data-checkout-status role="status"></p></section></form>';
  storePage.append(summary);
  const form=summary.querySelector('form');
  const orderSummary=summary.querySelector('[data-order-summary]');
  const promoEntry=summary.querySelector('.checkout-promo-entry');
  const promoStatus=summary.querySelector('[data-checkout-promo-status]');
  const status=summary.querySelector('[data-checkout-status]');
  const addressSelect=summary.querySelector('[data-shipping-address]');
  const addressSummary=summary.querySelector('[data-address-summary]');
  const addressFields=summary.querySelector('[data-address-fields]');
  const editAddress=summary.querySelector('[data-edit-address]');
  let addresses=[];
  let activePromo=null;
  let savedPromoCode=window.storeCart?.promo?.()||'';
  let shippingMethod='standard';
  let shippingQuote=null;
  let taxQuote=null;
  let quoteToken=0;
  let quoteTimer=0;
  const quoteCache=new Map();
  const quoteRequests=new Map();
  const taxCache=new Map();
  const taxRequests=new Map();
  const setAddressExpanded=(expanded)=>{addressFields.hidden=!expanded;editAddress.hidden=expanded||!addressSelect.value;addressSummary.hidden=expanded||!addressSelect.value;};
  const addressValue=()=>({recipient_name:String(form.elements.shipping_name.value||'').trim(),address_line1:String(form.elements.address_line1.value||'').trim(),address_line2:String(form.elements.address_line2.value||'').trim(),city:String(form.elements.city.value||'').trim(),state:String(form.elements.state.value||'').trim().toUpperCase(),postal_code:String(form.elements.postal_code.value||'').trim(),country:'US'});
  const addressValid=(address)=>Boolean(address.recipient_name&&address.address_line1&&address.city&&/^[A-Z]{2}$/.test(address.state)&&/^\d{5}(?:-\d{4})?$/.test(address.postal_code));
  const showAddress=(address)=>{addressSummary.replaceChildren();[address.recipient_name,address.address_line1,address.address_line2,address.city&&address.state?`${address.city}, ${address.state}`:address.city||address.state,address.postal_code].filter(Boolean).forEach((value)=>{const line=document.createElement('span');line.textContent=value;addressSummary.append(line);});};
  const applyAddress=(address)=>{form.elements.shipping_name.value=address.recipient_name||'';form.elements.address_line1.value=address.address_line1||'';form.elements.address_line2.value=address.address_line2||'';form.elements.city.value=address.city||'';form.elements.state.value=address.state||'';form.elements.postal_code.value=address.postal_code||'';showAddress(address);};
  const currentTotals=()=>window.storeShipping.totals(currentEntries());
  const promoDiscount=(totals)=>window.storePromos.discount(activePromo,totals.promoEligibleSubtotal);
  const promoLabel=(promo)=>window.storePromos.discountLabel?.(promo)||'';
  const drawSummary=()=>{
    const totals=currentTotals();
    const invalid=invalidEntries();
    const discount=promoDiscount(totals);
    const standard=shippingQuote?.standard;
    const priority=shippingQuote?.priority;
    const selectedRate=shippingMethod==='priority'?priority:standard;
    const shippingAmount=selectedRate?(shippingMethod==='standard'&&shippingQuote.free?0:Number(selectedRate.amount)||0):0;
    const taxAmount=Number(taxQuote?.amount)||0;
    const total=Math.max(0,totals.subtotal-discount+shippingAmount+taxAmount);
    const eta=selectedRate?.scheduledDeliveryDate;
    const dateLabel=eta?new Date(eta+'T12:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):'Quote pending';
    const promoMarkup=activePromo?`<div class="checkout-promo-applied"><span>Promo code · ${escapeProductText(activePromo.code||'Automatic promotion')} · ${escapeProductText(promoLabel(activePromo))}</span><strong>-$${discount.toFixed(2)}</strong><button type="button" data-remove-checkout-promo>Remove</button></div>`:'';
    orderSummary.innerHTML=`${invalid.length?`<p class="cart-checkout-warning" role="alert">Remove or reselect ${invalid.length===1?'the highlighted item':'the highlighted items'} before checkout.</p>`:''}<section class="checkout-summary-section checkout-summary-subtotal"><h4>Items</h4><div class="checkout-summary-line"><span>Subtotal</span><strong>$${totals.subtotal.toFixed(2)}</strong></div></section>${promoMarkup?`<section class="checkout-summary-section checkout-summary-promotion"><h4>Promotion</h4>${promoMarkup}</section>`:''}<section class="checkout-summary-section checkout-summary-shipping"><h4>Shipping</h4><div class="checkout-summary-shipping-method"><label>Shipping method<select data-checkout-shipping-method ${standard&&priority?'':'disabled'}><option value="standard" ${shippingMethod==='standard'?'selected':''}>${escapeProductText(standard?(shippingQuote.free?'USPS Ground Advantage — Free':'USPS Ground Advantage — $'+Number(standard.amount).toFixed(2)):'USPS Ground Advantage — unavailable')}</option><option value="priority" ${shippingMethod==='priority'?'selected':''}>${escapeProductText(priority?'USPS Priority Mail — $'+Number(priority.amount).toFixed(2):'USPS Priority Mail — unavailable')}</option></select></label><div class="checkout-summary-line"><span>Shipping</span><strong>${selectedRate?(shippingMethod==='standard'&&shippingQuote.free?'Free':'$'+shippingAmount.toFixed(2)):'Quote pending'}</strong></div><div class="checkout-summary-line checkout-estimated-arrival"><span>Estimated arrival</span><strong>${escapeProductText(dateLabel)}</strong></div></div></section><section class="checkout-summary-section checkout-summary-tax"><h4>Taxes</h4><div class="checkout-summary-line"><span>Sales tax</span><strong>${taxQuote?'$'+taxAmount.toFixed(2):'Pending'}</strong></div></section><section class="checkout-summary-section checkout-summary-total"><div class="checkout-summary-line bag-total"><span>Total</span><strong>$${total.toFixed(2)}</strong></div></section>`;
    const checkoutButton=form.querySelector('button[type="submit"]');
    if(checkoutButton){checkoutButton.disabled=invalid.length>0;checkoutButton.title=invalid.length?'Resolve highlighted cart items before checkout.':'';}
    orderSummary.querySelector('[data-checkout-shipping-method]')?.addEventListener('change',(event)=>{shippingMethod=event.target.value==='priority'?'priority':'standard';void refreshQuote();});
    orderSummary.querySelector('[data-remove-checkout-promo]')?.addEventListener('click',()=>{activePromo=window.storePromos.auto(currentTotals().subtotal);savedPromoCode='';window.storeCart?.clearPromo?.();form.elements.promo_code.value='';promoStatus.textContent=activePromo?'Automatic promotion reapplied.':'Promotion removed.';drawSummary();});
  };
  const refreshTax=async()=>{
    const address=addressValue();
    if(address.state!=='OH'||!addressValid(address)){taxQuote=address.state==='OH'?{amount:0}:{amount:0,rate:0,state:''};return;}
    const totals=currentTotals();
    const discount=promoDiscount(totals);
    const rate=shippingMethod==='priority'?shippingQuote?.priority:shippingQuote?.standard;
    const shippingAmount=rate?(shippingMethod==='standard'&&shippingQuote.free?0:Number(rate.amount)||0):0;
    if(!window.beadSupabase?.functions?.invoke){taxQuote={amount:0,rate:0,state:'OH'};return;}
    const taxableAmount=Math.max(0,totals.subtotal-discount+shippingAmount);
    const taxKey=JSON.stringify({line1:address.address_line1,city:address.city,postalCode:address.postal_code,taxableAmount});
    const cached=taxCache.get(taxKey);
    if(cached){taxQuote=cached;return;}
    let request=taxRequests.get(taxKey);
    if(!request){
      request=window.beadSupabase.functions.invoke('ohio-sales-tax',{body:{address:{addressLine1:address.address_line1,city:address.city,state:'OH',postalCode:address.postal_code},taxableAmount}}).then((result)=>{
        if(result.error||result.data?.error||result.data?.amount===undefined)return{amount:0,rate:0,state:'OH'};
        return{amount:Number(result.data.amount)||0,rate:Number(result.data.rate)||0,state:'OH',jurisdiction:result.data.jurisdiction||'Ohio'};
      }).catch(()=>({amount:0,rate:0,state:'OH'})).finally(()=>taxRequests.delete(taxKey));
      taxRequests.set(taxKey,request);
    }
    taxQuote=await request;
    taxCache.set(taxKey,taxQuote);
    if(taxCache.size>20)taxCache.delete(taxCache.keys().next().value);
  };
  const refreshQuote=async()=>{
    const token=++quoteToken;
    const address=addressValue();
    if(!addressValid(address)){shippingQuote=null;taxQuote=null;drawSummary();return;}
    const totals=currentTotals();
    const cacheKey=JSON.stringify({postalCode:address.postal_code,weightOz:totals.weightOz,subtotal:totals.subtotal});
    const cached=quoteCache.get(cacheKey);
    if(cached){shippingQuote=cached;await refreshTax();if(token===quoteToken)drawSummary();return;}
    let request=quoteRequests.get(cacheKey);
    if(!request){
      request=window.storeShipping.quote(currentEntries(),address.postal_code).finally(()=>quoteRequests.delete(cacheKey));
      quoteRequests.set(cacheKey,request);
    }
    const result=await request;
    if(token!==quoteToken)return;
    shippingQuote=result;
    quoteCache.set(cacheKey,result);
    await refreshTax();
    if(token===quoteToken)drawSummary();
  };
  const restoreSavedPromo=async()=>{
    const automatic=window.storePromos.auto(currentTotals().subtotal);
    if(!savedPromoCode){activePromo=automatic;drawSummary();return;}
    try{
      const promo=await window.storePromos.findAsync(savedPromoCode);
      if(promo?.mode==='manual'){activePromo=promo;form.elements.promo_code.value=promo.code||savedPromoCode;}
      else{activePromo=automatic;savedPromoCode='';window.storeCart?.clearPromo?.();}
    }catch(error){activePromo=automatic;savedPromoCode='';window.storeCart?.clearPromo?.();form.elements.promo_code.value='';}
    drawSummary();
  };
  const hydrateAddresses=async()=>{
    try{
      const result=await Promise.race([window.customerAccounts?.addresses?.()||Promise.resolve([]),new Promise((resolve)=>window.setTimeout(()=>resolve([]),2500))]);
      addresses=Array.isArray(result)?result:[];
      addresses.forEach((address,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=String(address.label||address.recipient_name||`Saved address ${index+1}`);addressSelect.append(option);});
      const defaultIndex=addresses.findIndex((address)=>address.is_default);
      const selectedIndex=defaultIndex>=0?defaultIndex:(addresses.length?0:-1);
      if(selectedIndex>=0){addressSelect.value=String(selectedIndex);applyAddress(addresses[selectedIndex]);setAddressExpanded(false);void refreshQuote();}else setAddressExpanded(true);
    }catch(error){setAddressExpanded(true);}
  };
  syncCheckoutAccountField(form);
  window.addEventListener('bead-account-changed',()=>syncCheckoutAccountField(form));
  addressSelect.addEventListener('change',()=>{
    const address=addresses[Number(addressSelect.value)];
    if(!addressSelect.value){
      form.elements.shipping_name.value='';form.elements.address_line1.value='';form.elements.address_line2.value='';form.elements.city.value='';form.elements.state.value='';form.elements.postal_code.value='';
      addressSummary.replaceChildren();setAddressExpanded(true);shippingQuote=null;taxQuote=null;drawSummary();return;
    }
    applyAddress(address);setAddressExpanded(false);void refreshQuote();
  });
  editAddress.addEventListener('click',()=>setAddressExpanded(true));
  form.addEventListener('input',()=>{if(addressFields.hidden)return;window.clearTimeout(quoteTimer);quoteTimer=window.setTimeout(()=>void refreshQuote(),350);});
  promoEntry.querySelector('[data-apply-checkout-promo]').addEventListener('click',async()=>{
    const code=String(form.elements.promo_code.value||'').trim();
    if(!code){activePromo=window.storePromos.auto(currentTotals().subtotal);savedPromoCode='';window.storeCart?.clearPromo?.();promoStatus.textContent=activePromo?'Automatic promotion applied.':'No promotion is active.';drawSummary();return;}
    try{
      const promo=await window.storePromos.findAsync(code);
      if(!promo||promo.mode!=='manual'){promoStatus.textContent='That promo code is not available.';return;}
      const existing=activePromo;
      if(existing?.code&&String(existing.code).toUpperCase()!==code.toUpperCase()){
        const existingLabel=promoLabel(existing);
        const newLabel=promoLabel(promo);
        const message=existing.mode==='manual'?`A manual promo code (${existing.code}${existingLabel?` · ${existingLabel}`:''}) is already active. Replace it with ${promo.code||code}${newLabel?` · ${newLabel}`:''}?`:`An automatic promotion (${existing.code}${existingLabel?` · ${existingLabel}`:''}) is already active. Replace it with ${promo.code||code}${newLabel?` · ${newLabel}`:''}?`;
        if(!window.confirm(message))return;
      }
      activePromo=promo;savedPromoCode=promo.code;window.storeCart?.setPromo?.(promo.code);promoStatus.textContent=promo.code+' applied.';drawSummary();await refreshQuote();
    }catch(error){promoStatus.textContent='That promo code is not available.';}
  });
  form.addEventListener('submit',async(event)=>{
    event.preventDefault();
    const invalid=invalidEntries();
    if(invalid.length){status.textContent=`Remove or reselect ${invalid.length===1?'the highlighted item':'the highlighted items'} before checkout.`;drawSummary();return;}
    const address=addressValue();
    if(!addressValid(address)){status.textContent='Complete the shipping address first.';setAddressExpanded(true);return;}
    const account=window.customerAccounts?.current?.();
    const email=account?.email||String(form.elements.customer_email?.value||'').trim();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){status.textContent='Enter an email address for order updates.';return;}
    if(activePromo?.mode==='manual'){
      try{
        const verified=await window.storePromos.findAsync(activePromo.code);
        if(!verified||verified.mode!=='manual'){activePromo=window.storePromos.auto(currentTotals().subtotal);savedPromoCode='';window.storeCart?.clearPromo?.();promoStatus.textContent='That promo code is no longer available.';drawSummary();return;}
        activePromo=verified;
      }catch(error){status.textContent='Unable to verify the promo code right now.';return;}
    }
    const totals=currentTotals();
    const selectedRate=shippingMethod==='priority'?shippingQuote?.priority:shippingQuote?.standard;
    const shippingAmount=selectedRate?(shippingMethod==='standard'&&shippingQuote.free?0:Number(selectedRate.amount)||0):0;
    const submit=form.querySelector('[type="submit"]');
    submit.disabled=true;
    status.textContent='Creating your order…';
    try{
      const confirmationLines=currentEntries().map((entry)=>{const item=findProduct(entry.id);const pricing=linePricing(entry,item);const sku=String(pricing?.sku||pricing?.option?.inventorySku||pricing?.option?.sku||item?.sku||'').trim();const name=String(pricing?.option?.label||sku||item?.name||'Item').trim();const quantity=Math.max(1,Number(entry.quantity)||1);return{name,sku,quantity,unitPrice:Number(pricing?.unitPrice??item?.price)||0};});
      const confirmationItems=confirmationLines.reduce((total,line)=>total+line.quantity,0);
      const confirmationItemMarkup=confirmationLines.map((line)=>`<li><div><strong>${escapeProductText(line.name)}</strong><small>${line.sku?`SKU: ${escapeProductText(line.sku)}`:''}</small></div><span>${line.quantity} × $${line.unitPrice.toFixed(2)}</span></li>`).join('');
      const confirmationEta=selectedRate?.scheduledDeliveryDate?new Date(`${selectedRate.scheduledDeliveryDate}T12:00:00`).toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'}):'To be confirmed';
      const order=await window.storeCheckout({shippingName:address.recipient_name,shippingAddress:address,customerEmail:email,promoCode:activePromo?.mode==='manual'?activePromo.code:'',shippingAmount,shippingCost:Number(selectedRate?.amount)||0,shippingMethod:shippingMethod==='priority'?'priority':'standard',taxAmount:Number(taxQuote?.amount)||0,taxRate:Number(taxQuote?.rate)||0,taxState:taxQuote?.state||'',taxJurisdiction:taxQuote?.jurisdiction||'',testOrder:true});
      const wasGuest=!account;
      const confirmationTotal=Math.max(0,totals.subtotal-promoDiscount(totals)+shippingAmount+Number(taxQuote?.amount||0));
      storePage.innerHTML=`<section class="order-confirmation" aria-labelledby="order-confirmation-title"><div class="order-confirmation-main"><span class="order-confirmation-mark" aria-hidden="true">✓</span><p class="kicker">ORDER CONFIRMED</p><h1 id="order-confirmation-title">Your order is on its way</h1><p class="order-confirmation-lead">Thanks for your order from Bead Different Co. We’ve received it and will keep you updated as it moves through fulfillment.</p><div class="order-confirmation-number"><span>Order number</span><strong>${escapeProductText(publicOrderNumber(order))}</strong></div><p class="order-confirmation-email">A confirmation has been sent to <strong>${escapeProductText(email)}</strong>.</p><a class="cta" href="shop-all.html">Continue shopping <span aria-hidden="true">→</span></a></div><aside class="order-confirmation-details" aria-label="Order details"><h2>Order details</h2><dl><div><dt>Items</dt><dd>${confirmationItems}</dd></div><div><dt>Shipping</dt><dd>${shippingMethod==='priority'?'Priority':'Standard'}</dd></div><div><dt>Estimated arrival</dt><dd>${escapeProductText(confirmationEta)}</dd></div><div><dt>Payment</dt><dd>Card payment</dd></div><div class="order-confirmation-total"><dt>Order total</dt><dd>$${confirmationTotal.toFixed(2)}</dd></div></dl><p class="order-confirmation-note">We’ll send updates as your order moves through fulfillment.</p></aside><section class="order-confirmation-items" aria-labelledby="order-items-title"><div><p class="kicker">ORDER RECAP</p><h2 id="order-items-title">Items in your order</h2></div><ul>${confirmationItemMarkup}</ul></section></section>`;
      const confirmationRewards=document.createElement('section');confirmationRewards.className='order-confirmation-rewards';confirmationRewards.dataset.confirmationRewards='true';confirmationRewards.hidden=true;confirmationRewards.setAttribute('aria-live','polite');storePage.querySelector('.order-confirmation')?.append(confirmationRewards);void hydrateConfirmationRewards(storePage,account);
      if(wasGuest)guestAccountPrompt(storePage,email);
      window.dispatchEvent(new Event('bead-order-created'));
    }catch(error){status.textContent=error.message||'Unable to create your order.';submit.disabled=false;}
  });
  setAddressExpanded(true);drawSummary();renderCart();void restoreSavedPromo();void hydrateAddresses();
  const refresh=()=>{renderCart();if(!summary.isConnected&&currentEntries().length)storePage.append(summary);if(summary.isConnected)drawSummary();};
  window.addEventListener('bead-cart-changed',refresh);
  window.addEventListener('bead-store-synced',refresh);
  window.addEventListener('bead-catalog-enriched',refresh);
  window.addEventListener('bead-catalog-options-ready',refresh);
  window.addEventListener('bead-inventory-recipes-ready',refresh);
  window.addEventListener('bead-cart-stock-limited',(event)=>{status.textContent=`Only ${Math.max(0,Number(event.detail?.maximum)||0)} of that pack can be purchased with the other items in your cart.`;refresh();});
};

const renderStorePage=async()=>{
  const productId=document.body.dataset.productId||new URLSearchParams(location.search).get('id');
  if(productId&&page!=='Product'){window.location.replace(`product.html?id=${encodeURIComponent(productId)}`);return;}
  if(page==='Shopping Bag'){if(!document.querySelector('.shopping-bag-page'))main.innerHTML=shoppingBagShell();await setupShoppingBag();return;}
  if(page==='Wishlist'){
    const renderFavorites=()=>{
      main.innerHTML='<section class="store-page wishlist-page"><p class="kicker">SAVED FOR LATER</p><h1>Favorites</h1><p class="wishlist-count" id="wishlist-count"></p><div class="product-grid" id="page-products"></div><p class="store-empty" id="store-empty">No favorites saved yet.</p></section>';
      const products=wishlistItems().map((id)=>findProduct(id)).filter(Boolean).filter(isProductVisible);
      renderProductCards(products,document.querySelector('#page-products'));
      document.querySelector('#wishlist-count').textContent=products.length===1?'1 favorite':`${products.length} favorites`;
      document.querySelector('#store-empty').hidden=products.length>0;
    };
    renderFavorites();
    if(!window.wishlistPageListenersAttached){
      const refresh=()=>{if(document.body.dataset.page==='Wishlist')renderFavorites();};
      window.addEventListener('bead-store-synced',refresh);
      window.addEventListener('bead-account-changed',refresh);
      window.addEventListener('bead-catalog-enriched',refresh);
      window.wishlistPageListenersAttached=true;
    }
    return;
  }
  if(page==='Search'){renderSearchPage();return;}
  if(page==='Sale Collection'){await renderSaleCollection();return;}
  if(page==='New Arrivals'||currentRequestedCategory()==='new-arrivals'){return;}
  if(storefrontListingPage()&&storefrontCategoryListing.request.categorySlugs.length){await renderCategoryPage();return;}
  const heading=document.querySelector('#page-title');if(heading)heading.textContent=page;
};

if(storefrontListingPage()){
  catalogReady.then(()=>renderCategoryPage());
  window.addEventListener('popstate',()=>{storefrontCategoryListing.request=storefrontCategoryRequest();void loadStorefrontCategoryPage(1).then(()=>renderCategoryPage());});
}else if(page==='Shopping Bag'){
  catalogReady.then(()=>setupShoppingBag());
}else{
  catalogReady.then(()=>renderStorePage());
}

const managedContentDefaults={
  storyTitle:'Our Story',
  storyBody:'Bead Different Co. is a small, family-run creative supply shop built around colorful ideas, useful supplies, and making something that feels like you.',
  faqItems:[
    {question:'How long does shipping take?',answer:'Shipping options and delivery estimates are shown at checkout.'},
    {question:'Do you accept returns?',answer:'Please contact us through the Contact Us page so we can review your order and help.'},
    {question:'Can I use these beads on a beadable pen?',answer:'Product pages identify the bead sizes and compatible supplies for each item.'}
  ],
  footerShippingPolicy:'Shipping options and delivery estimates are shown at checkout. Contact us if your order arrives with a problem so we can help.'
};
const managedContentSource=()=>{
  const source=window.siteContent||window.productStoreConfig||{};
  let local={};
  if(window.siteSettingsLoadState!=='connected'){
    try{local=JSON.parse(localStorage.getItem('beadDifferentAdminData')||'{}').settings||{};}catch(error){}
  }
  const faqItems=Array.isArray(source.faqItems)?source.faqItems:Array.isArray(local.faqItems)?local.faqItems:managedContentDefaults.faqItems;
  return {...managedContentDefaults,...local,...source,faqItems};
};
const renderManagedPages=()=>{
  const source=managedContentSource();
  if(page==='FAQ'){
    const items=(source.faqItems||[]).filter((item)=>String(item?.question||'').trim()&&String(item?.answer||'').trim());
    main.innerHTML=`<section class="store-page managed-faq-page"><p class="kicker">HELP & INFORMATION</p><h1>Frequently Asked Questions</h1><div class="managed-faq-list">${items.map((item)=>`<details><summary>${escapeProductText(item.question)}</summary><div>${window.sanitizeRichText(item.answer)}</div></details>`).join('')||'<p>Questions and answers will be added soon.</p>'}</div></section>`;
  }
  if(page==='Shipping & Returns'){
    const target=document.querySelector('[data-footer-shipping-policy]');
    if(target)target.innerHTML=window.sanitizeRichText(source.footerShippingPolicy||managedContentDefaults.footerShippingPolicy).replace(/\r?\n/g,'<br>');
  }
  if(page==='Our Story'){
    const target=document.querySelector('[data-managed-story]');
    if(target)target.innerHTML=`<p class="kicker">ABOUT US</p><h1>${escapeProductText(source.storyTitle||managedContentDefaults.storyTitle)}</h1><div class="managed-story-body">${window.sanitizeRichText(source.storyBody||managedContentDefaults.storyBody)}</div>`;
  }
  if(page==='Contact'){
    const account=window.customerAccounts?.current?.();
    main.innerHTML=`<section class="store-page contact-page"><p class="kicker">WE’RE HERE TO HELP</p><h1>Contact Us</h1><p>Send us a message and we’ll get back to you by email.</p><p class="contact-email-line" ${source.contactEmail?'':'hidden'}>Email: <a data-contact-email href="mailto:${encodeURIComponent(source.contactEmail||'')}">${escapeProductText(source.contactEmail||'')}</a></p><form class="contact-form" data-contact-form><div class="admin-form-grid"><label>Name<input name="name" autocomplete="name" required value="${escapeProductText(account?.fullName||account?.name||'')}"></label><label>Email<input name="email" type="email" autocomplete="email" required value="${escapeProductText(account?.email||'')}"></label></div><label>Subject<input name="subject" required maxlength="160"></label><label>Message<textarea name="message" rows="8" required maxlength="10000"></textarea></label><button class="cta" type="submit">Send message</button><p data-contact-status role="status"></p></form></section>`;
    const form=main.querySelector('[data-contact-form]');
    const contactParams=new URLSearchParams(location.search);const contactOrder=contactParams.get('order')||'';const contactOrderId=contactParams.get('orderId')||'';const contactTopic=contactParams.get('topic')||'';const priorityOrderRequest=Boolean(contactOrder&&(contactTopic==='cancellation'||contactTopic==='issue'));if(priorityOrderRequest){const isCancellation=contactTopic==='cancellation';form.querySelector('button[type="submit"]').textContent=isCancellation?'Submit cancellation request':'Submit order issue';form.elements.subject.value=isCancellation?`Cancellation request for order ${contactOrder}`:`Problem with order ${contactOrder}`;form.elements.message.value=isCancellation?`I would like to request cancellation of order ${contactOrder}.`:`I need help with order ${contactOrder}.`;form.closest('.contact-page').querySelector('h1').textContent=isCancellation?'Priority cancellation request':'Priority order support';form.closest('.contact-page').querySelector('h1').insertAdjacentHTML('afterend',`<p class="priority-order-notice">This request is sent to our priority order support queue. Someone will reach out as soon as possible.</p>`);}
    const status=main.querySelector('[data-contact-status]');
    const hydrate=async()=>{if(!window.beadSupabase)return;const result=await window.beadSupabase.auth.getUser();const user=result.data?.user;if(!user)return;const profile=await window.beadSupabase.from('profiles').select('email,full_name').eq('id',user.id).maybeSingle();if(profile.data){if(!form.elements.name.value)form.elements.name.value=profile.data.full_name||'';if(!form.elements.email.value)form.elements.email.value=profile.data.email||user.email||'';}};
    void hydrate();
form.addEventListener('submit',async(event)=>{event.preventDefault();const fields=Object.fromEntries(new FormData(form));const email=String(fields.email||'').trim().toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){status.textContent='Enter a valid email address.';return;}const submit=form.querySelector('button[type="submit"]');submit.disabled=true;status.textContent='Sending message…';try{let userId=null;if(window.beadSupabase){const userResult=await window.beadSupabase.auth.getUser();userId=userResult.data?.user?.id||null;const payload={user_id:userId,name:String(fields.name||'').trim(),email,subject:String(fields.subject||'').trim(),message:String(fields.message||'').trim()};if(priorityOrderRequest){payload.order_id=contactOrderId||null;payload.order_number=contactOrder;payload.request_type=contactTopic;payload.priority=contactTopic==='cancellation'?'urgent':'high';}const result=await window.beadSupabase.from(priorityOrderRequest?'order_support_requests':'contact_messages').insert(payload);if(result.error)throw result.error;}else{const key=priorityOrderRequest?'beadDifferentOrderSupportRequests':'beadDifferentContactMessages';const messages=JSON.parse(localStorage.getItem(key)||'[]');messages.unshift({...fields,email,order_id:priorityOrderRequest?contactOrderId:null,order_number:priorityOrderRequest?contactOrder:null,request_type:priorityOrderRequest?contactTopic:null,priority:priorityOrderRequest?'high':null,created_at:new Date().toISOString(),status:'new'});localStorage.setItem(key,JSON.stringify(messages));}form.reset();if(account){form.elements.name.value=account.fullName||account.name||'';form.elements.email.value=account.email||email;}status.textContent=priorityOrderRequest?(contactTopic==='cancellation'?'Someone will be in touch regarding your cancellation request as soon as possible.':'Someone will be in touch regarding your order issue as soon as possible.'):'Message sent. We’ll reply by email.';}catch(error){status.textContent='Message was not sent: '+(error.message||'Unknown error.');}finally{submit.disabled=false;}});
  }
};
window.siteSettingsReady?.then(()=>renderManagedPages());
