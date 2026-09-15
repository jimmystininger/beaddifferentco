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
  (Array.isArray(filters)?filters:[]).forEach((filter)=>{
    const wrapper=document.createElement('label');
    wrapper.className='category-filter';
    wrapper.textContent=filter.label||filter.key;
    const select=document.createElement('select');
    select.dataset.categoryFilter=filter.key;
    select.setAttribute('aria-label',filter.label||filter.key);
    const all=document.createElement('option');
    all.value='';
    all.textContent=`All ${String(filter.label||filter.key).toLowerCase()}`;
    select.append(all);
    (Array.isArray(filter.values)?filter.values:[]).forEach((value)=>{
      const option=document.createElement('option');
      option.value=value.key||'';
      option.textContent=value.label||value.key||'';
      option.selected=request.filterKey===filter.key&&request.filterValues.includes(option.value);
      select.append(option);
    });
    select.addEventListener('change',async()=>{
      const nextUrl=new URL(location.href);
      nextUrl.searchParams.delete('style');
      const value=select.value;
      if(value){nextUrl.searchParams.set('filterKey',filter.key);nextUrl.searchParams.set('filterValues',value);}
      else{nextUrl.searchParams.delete('filterKey');nextUrl.searchParams.delete('filterValues');}
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
      renderCategoryFilters(window.storefrontCategoryFilters||filters);
    });
    wrapper.append(select);
    region.append(wrapper);
  });
};

const renderCategoryPage=async()=>{
  const storePage=document.querySelector('.store-page');
  const grid=document.querySelector('#page-products');
  const empty=document.querySelector('#store-empty');
  if(!storePage||!grid)return;
  const products=visibleCatalog();
  renderProductCards(products,grid);
  drawStorefrontPagination();
  if(empty){empty.textContent='No products are currently available in this category.';empty.hidden=products.length>0;}
  const slug=currentRequestedCategory()||storefrontCategoryListing.request.categorySlugs[0]||'';
  const heading=storePage.querySelector('h1');if(heading)heading.textContent=categoryLabelFor(slug)||page;
  if(slug){try{renderCategoryFilters(await loadStorefrontCategoryFilters(slug));}catch(error){renderCategoryFilters([]);}}
  storePage.dataset.categoryRendered='true';
};

const renderSearchPage=()=>{
  const query=new URLSearchParams(location.search).get('q')||'';
  main.innerHTML=`<section class="store-page"><p class="kicker">FIND YOUR FAVORITES</p><h1>Search</h1><form class="store-search-form"><input name="q" value="${query.replace(/"/g,'&quot;')}" placeholder="Search beads, charms, supplies..." aria-label="Search products"><button class="cta" type="submit">Search</button></form><div class="product-grid" id="page-products"></div><p class="store-empty" id="store-empty">No products found.</p></section>`;
  const form=main.querySelector('.store-search-form');
  const products=searchCatalog(query);
  renderProductCards(products,document.querySelector('#page-products'));
  document.querySelector('#store-empty').hidden=products.length>0;
  form.addEventListener('submit',(event)=>{event.preventDefault();location.href=`search.html?q=${encodeURIComponent(String(form.elements.q.value||'').trim())}`;});
};

const guestAccountPrompt=(storePage,email)=>{
  if(!email||storePage.querySelector('[data-guest-account-prompt]'))return;
  const prompt=document.createElement('aside');
  prompt.className='guest-account-prompt';
  prompt.dataset.guestAccountPrompt='true';
  prompt.innerHTML=`<h2>Track this order</h2><p>Create an account with ${escapeProductText(email)} to track this order and future orders.</p><a class="cta" href="account.html?signup=1&email=${encodeURIComponent(email)}">Create an account</a>`;
  storePage.append(prompt);
};

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
  const linePricing=(entry,item)=>window.storeCartPricing(item,entry);
  const currentEntries=()=>validBagItems().filter((entry)=>findProduct(entry.id));
  const renderCart=()=>{
    const allEntries=validBagItems();
    const entries=allEntries.filter((entry)=>findProduct(entry.id));
    grid.replaceChildren(...entries.map((entry)=>{
      const item=findProduct(entry.id);
      const pricing=linePricing(entry,item);
      const quantity=Math.max(1,Number(entry.quantity)||1);
      const row=document.createElement('article');
      row.className='cart-line';
      const image=pricing.option?.imageUrl||item.image||'product-mix.jpg';
      const productHref=`product.html?id=${encodeURIComponent(item.id)}`;
      const priceMarkup=pricing.productPromoApplied?`<s class="cart-line-original-price">$${pricing.originalUnitPrice.toFixed(2)}</s> <span class="cart-line-promo-price">$${pricing.unitPrice.toFixed(2)}</span>`:`$${pricing.unitPrice.toFixed(2)}`;
      const totalMarkup=pricing.productPromoApplied?`<s class="cart-line-original-price">$${(pricing.originalUnitPrice*quantity).toFixed(2)}</s> <span class="cart-line-promo-price">$${(pricing.unitPrice*quantity).toFixed(2)}</span>`:`$${(pricing.unitPrice*quantity).toFixed(2)}`;
      const wished=wishlistItems().includes(entry.id);
      const promoDetails=pricing.promoDetails?`<small class="cart-line-promo-disclaimer">${escapeProductText(pricing.promoDetails)}</small>`:'';
      row.innerHTML=`<a class="cart-line-image-link" href="${productHref}" aria-label="View ${escapeProductText(item.name)}"><img class="product-card-image" src="${escapeProductText(image)}" alt="${escapeProductText(item.name)}"></a><div class="cart-line-copy"><h3>${escapeProductText(item.name)}</h3>${optionSummary(entry)?`<p>${escapeProductText(optionSummary(entry))}</p>`:''}<p class="cart-line-sku">SKU: ${escapeProductText(pricing.sku||item.sku||'—')}</p></div><div class="cart-line-unit"><span>Price / unit</span><strong>${priceMarkup}</strong>${promoDetails}</div><label class="cart-line-quantity">Quantity<input type="number" min="1" step="1" value="${quantity}" data-cart-quantity></label><div class="cart-line-total"><span>Line total</span><strong>${totalMarkup}</strong></div><div class="cart-line-actions"><a href="#" class="cart-line-favorite${wished?' active':''}" data-cart-favorite aria-label="${wished?'Remove from':'Add to'} favorites">${wished?'Remove from Favorites':'Add to Favorites'}</a><a href="#" class="cart-line-remove" data-remove-cart-line>Remove</a></div>`;
      row.querySelector('[data-cart-quantity]').addEventListener('change',(event)=>window.storeCart.setQuantity(entry.id,entry.selectedOptions,event.target.value));
      row.querySelector('[data-remove-cart-line]').addEventListener('click',(event)=>{event.preventDefault();window.storeCart.removeLine(entry.id,entry.selectedOptions);});
      row.querySelector('[data-cart-favorite]').addEventListener('click',(event)=>{event.preventDefault();const active=toggleWishlist(entry.id);event.currentTarget.classList.toggle('active',active);event.currentTarget.textContent=active?'Remove from Favorites':'Add to Favorites';event.currentTarget.setAttribute('aria-label',active?'Remove from favorites':'Add to favorites');});
      return row;
    }));
    const unresolved=window.storeCartCatalogState==='ready'&&allEntries.length>entries.length;
    storePage.classList.toggle('bag-is-empty',entries.length===0);
    empty.hidden=entries.length>0;
    empty.textContent=unresolved?'Some saved items are no longer available.':'Your shopping bag is empty.';
    const continueLink=storePage.querySelector('.cart-continue');
    if(continueLink)continueLink.hidden=entries.length>0;
  };

  const summary=document.createElement('section');
  summary.className='bag-summary';
  summary.innerHTML='<h2>Order summary</h2><form class="checkout-form"><section class="checkout-shipping"><h3>Shipping information</h3><p class="checkout-signin-note"></p><label>Saved shipping address<select data-shipping-address><option value="">New address</option></select></label><div data-address-summary class="checkout-address-summary" hidden></div><button type="button" data-edit-address hidden>Edit address</button><fieldset data-address-fields><label>Recipient name<input name="shipping_name" autocomplete="name" required></label><label>Address<input name="address_line1" autocomplete="street-address" required></label><label>Apartment, suite, etc.<input name="address_line2" autocomplete="address-line2"></label><div class="admin-form-grid"><label>City<input name="city" autocomplete="address-level2" required></label><label>State<input name="state" autocomplete="address-level1" maxlength="2" required></label></div><label>ZIP code<input name="postal_code" inputmode="numeric" autocomplete="postal-code" required></label></fieldset></section><section class="checkout-calculator"><section class="checkout-promo-section"><h4>Promotion</h4><div class="checkout-promo-entry"><label>Promo code<input name="promo_code" placeholder="Enter a manual promo code"></label><button type="button" data-apply-checkout-promo>Apply</button></div><p data-checkout-promo-status role="status"></p></section><div data-order-summary></div><button class="cta" type="submit">Place test order</button><p data-checkout-status role="status"></p></section></form>';
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
  const setAddressExpanded=(expanded)=>{addressFields.hidden=!expanded;editAddress.hidden=expanded||!addressSelect.value;addressSummary.hidden=expanded||!addressSelect.value;};
  const addressValue=()=>({recipient_name:String(form.elements.shipping_name.value||'').trim(),address_line1:String(form.elements.address_line1.value||'').trim(),address_line2:String(form.elements.address_line2.value||'').trim(),city:String(form.elements.city.value||'').trim(),state:String(form.elements.state.value||'').trim().toUpperCase(),postal_code:String(form.elements.postal_code.value||'').trim(),country:'US'});
  const addressValid=(address)=>Boolean(address.recipient_name&&address.address_line1&&address.city&&/^[A-Z]{2}$/.test(address.state)&&/^\d{5}(?:-\d{4})?$/.test(address.postal_code));
  const showAddress=(address)=>{addressSummary.replaceChildren();[address.recipient_name,address.address_line1,address.address_line2,address.city&&address.state?`${address.city}, ${address.state}`:address.city||address.state,address.postal_code].filter(Boolean).forEach((value)=>{const line=document.createElement('span');line.textContent=value;addressSummary.append(line);});};
  const applyAddress=(address)=>{form.elements.shipping_name.value=address.recipient_name||'';form.elements.address_line1.value=address.address_line1||'';form.elements.address_line2.value=address.address_line2||'';form.elements.city.value=address.city||'';form.elements.state.value=address.state||'';form.elements.postal_code.value=address.postal_code||'';showAddress(address);};
  const currentTotals=()=>window.storeShipping.totals(currentEntries());
  const promoDiscount=(totals)=>window.storePromos.discount(activePromo,totals.promoEligibleSubtotal);
  const drawSummary=()=>{
    const totals=currentTotals();
    const discount=promoDiscount(totals);
    const standard=shippingQuote?.standard;
    const priority=shippingQuote?.priority;
    const selectedRate=shippingMethod==='priority'?priority:standard;
    const shippingAmount=selectedRate?(shippingMethod==='standard'&&shippingQuote.free?0:Number(selectedRate.amount)||0):0;
    const taxAmount=Number(taxQuote?.amount)||0;
    const total=Math.max(0,totals.subtotal-discount+shippingAmount+taxAmount);
    const eta=selectedRate?.scheduledDeliveryDate;
    const dateLabel=eta?new Date(eta+'T12:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):'Quote pending';
    const promoMarkup=activePromo?`<div class="checkout-promo-applied"><span>Promo code · ${escapeProductText(activePromo.code||'Automatic promotion')}</span><strong>-$${discount.toFixed(2)}</strong><button type="button" data-remove-checkout-promo>Remove</button></div>`:'';
    orderSummary.innerHTML=`<section class="checkout-summary-section checkout-summary-subtotal"><h4>Items</h4><div class="checkout-summary-line"><span>Subtotal</span><strong>$${totals.subtotal.toFixed(2)}</strong></div></section>${promoMarkup?`<section class="checkout-summary-section checkout-summary-promotion"><h4>Promotion</h4>${promoMarkup}</section>`:''}<section class="checkout-summary-section checkout-summary-shipping"><h4>Shipping</h4><div class="checkout-summary-shipping-method"><label>Shipping method<select data-checkout-shipping-method ${standard&&priority?'':'disabled'}><option value="standard" ${shippingMethod==='standard'?'selected':''}>${escapeProductText(standard?(shippingQuote.free?'USPS Ground Advantage — Free':'USPS Ground Advantage — $'+Number(standard.amount).toFixed(2)):'USPS Ground Advantage — unavailable')}</option><option value="priority" ${shippingMethod==='priority'?'selected':''}>${escapeProductText(priority?'USPS Priority Mail — $'+Number(priority.amount).toFixed(2):'USPS Priority Mail — unavailable')}</option></select></label><div class="checkout-summary-line"><span>Shipping</span><strong>${selectedRate?(shippingMethod==='standard'&&shippingQuote.free?'Free':'$'+shippingAmount.toFixed(2)):'Quote pending'}</strong></div><div class="checkout-summary-line checkout-estimated-arrival"><span>Estimated arrival</span><strong>${escapeProductText(dateLabel)}</strong></div></div></section><section class="checkout-summary-section checkout-summary-tax"><h4>Taxes</h4><div class="checkout-summary-line"><span>Sales tax</span><strong>${taxQuote?'$'+taxAmount.toFixed(2):'Pending'}</strong></div></section><section class="checkout-summary-section checkout-summary-total"><div class="checkout-summary-line bag-total"><span>Total</span><strong>$${total.toFixed(2)}</strong></div></section>`;
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
    try{
      const result=await window.beadSupabase.functions.invoke('ohio-sales-tax',{body:{address:{addressLine1:address.address_line1,city:address.city,state:'OH',postalCode:address.postal_code},taxableAmount:Math.max(0,totals.subtotal-discount+shippingAmount)}});
      if(result.error||result.data?.error||result.data?.amount===undefined){taxQuote={amount:0,rate:0,state:'OH'};return;}
      taxQuote={amount:Number(result.data.amount)||0,rate:Number(result.data.rate)||0,state:'OH',jurisdiction:result.data.jurisdiction||'Ohio'};
    }catch(error){taxQuote={amount:0,rate:0,state:'OH'};}
  };
  const refreshQuote=async()=>{
    const token=++quoteToken;
    const address=addressValue();
    if(!addressValid(address)){shippingQuote=null;taxQuote=null;drawSummary();return;}
    const totals=currentTotals();
    const cacheKey=JSON.stringify({postalCode:address.postal_code,weightOz:totals.weightOz,subtotal:totals.subtotal});
    const cached=quoteCache.get(cacheKey);
    if(cached){shippingQuote=cached;await refreshTax();if(token===quoteToken)drawSummary();return;}
    const result=await window.storeShipping.quote(currentEntries(),address.postal_code);
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
    const existing=activePromo;
    if(existing?.code&&String(existing.code).toUpperCase()!==code.toUpperCase()){
      const message=existing.mode==='manual'?`A manual promo code (${existing.code}) is already active. Remove it and apply ${code}?`:`An automatic promotion (${existing.code}) is already active. Replace it with ${code}?`;
      if(!window.confirm(message))return;
    }
    try{
      const promo=await window.storePromos.findAsync(code);
      if(!promo||promo.mode!=='manual'){promoStatus.textContent='That promo code is not available.';return;}
      activePromo=promo;savedPromoCode=promo.code;window.storeCart?.setPromo?.(promo.code);promoStatus.textContent=promo.code+' applied.';drawSummary();await refreshQuote();
    }catch(error){promoStatus.textContent='That promo code is not available.';}
  });
  form.addEventListener('submit',async(event)=>{
    event.preventDefault();
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
    status.textContent='Creating test order…';
    try{
      const order=await window.storeCheckout({shippingName:address.recipient_name,shippingAddress:address,customerEmail:email,promoCode:activePromo?.mode==='manual'?activePromo.code:'',shippingAmount,shippingMethod:shippingMethod==='priority'?'priority':'standard',taxAmount:Number(taxQuote?.amount)||0,taxRate:Number(taxQuote?.rate)||0,taxState:taxQuote?.state||'',taxJurisdiction:taxQuote?.jurisdiction||'',testOrder:true});
      const wasGuest=!account;
      storePage.innerHTML=`<p class="kicker">TEST ORDER CONFIRMED</p><h1>Order received</h1><p>Order ${escapeProductText(order?.id||'created')} was created without payment.</p><p>Order updates were sent to ${escapeProductText(email)}.</p><a class="cta" href="shop-all.html">Continue shopping</a>`;
      if(wasGuest)guestAccountPrompt(storePage,email);
      window.dispatchEvent(new Event('bead-order-created'));
    }catch(error){status.textContent=error.message||'Unable to create test order.';submit.disabled=false;}
  });
  setAddressExpanded(true);drawSummary();renderCart();void restoreSavedPromo();void hydrateAddresses();
  const refresh=()=>{renderCart();if(!summary.isConnected&&currentEntries().length)storePage.append(summary);if(summary.isConnected)drawSummary();};
  window.addEventListener('bead-cart-changed',refresh);
  window.addEventListener('bead-store-synced',refresh);
  window.addEventListener('bead-catalog-enriched',refresh);
  window.addEventListener('bead-catalog-options-ready',refresh);
};

const renderStorePage=async()=>{
  const productId=document.body.dataset.productId||new URLSearchParams(location.search).get('id');
  if(productId&&page!=='Product'){window.location.replace(`product.html?id=${encodeURIComponent(productId)}`);return;}
  if(page==='Shopping Bag'){if(!document.querySelector('.shopping-bag-page'))main.innerHTML=shoppingBagShell();await setupShoppingBag();return;}
  if(page==='Wishlist'){
    main.innerHTML='<section class="store-page wishlist-page"><p class="kicker">SAVED FOR LATER</p><h1>Wishlist</h1><div class="product-grid" id="page-products"></div><p class="store-empty" id="store-empty">Your wishlist is empty.</p></section>';
    const products=wishlistItems().map((id)=>findProduct(id)).filter(Boolean).filter(isProductVisible);
    renderProductCards(products,document.querySelector('#page-products'));
    document.querySelector('#store-empty').hidden=products.length>0;
    return;
  }
  if(page==='Search'){renderSearchPage();return;}
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
