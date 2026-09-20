const productPageEscape=(value)=>String(value??'').replace(/[&<>"']/g,(character)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));function openProductImageLightbox(image){if(!image)return;let dialog=document.querySelector('[data-product-image-lightbox]');if(!dialog){dialog=document.createElement('dialog');dialog.className='product-image-lightbox';dialog.dataset.productImageLightbox='';dialog.innerHTML='<form method="dialog"><button type="submit" class="product-image-lightbox-close" aria-label="Close full-size image">×</button><img data-lightbox-image alt=""></form>';dialog.addEventListener('click',(event)=>{if(event.target===dialog)dialog.close();});document.body.append(dialog);}const fullImage=dialog.querySelector('[data-lightbox-image]');fullImage.src=image.currentSrc||image.src;fullImage.alt=image.alt;dialog.showModal();}

function productOptionPrice(option,value){
  if(value&&typeof value==='object')return Number(value.price)||0;
  const match=String(value).match(/\(\s*([+-])\s*\$?(\d+(?:\.\d{1,2})?)\s*\)/);
  if(!match)return 0;
  const amount=Number(match[2]);
  return match[1]==='-'?-amount:amount;
}

const deliveryZipPattern=/^\d{5}(?:-\d{4})?$/;
const deliveryDateLabel=(value)=>{const date=new Date(`${String(value||'').slice(0,10)}T12:00:00`);return Number.isNaN(date.getTime())?'':date.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});};
const deliveryProcessingLabel=(days)=>`${Number(days)||0} business-day processing`;

function addShippingIcon(className,svg){const icon=document.createElement('span');icon.className=`shipping-row-icon ${className}`;icon.setAttribute('aria-hidden','true');icon.innerHTML=svg;return icon;}
function enhanceProductShippingCard(){const shipping=document.querySelector('[data-delivery-form]');if(!shipping||shipping.dataset.iconsReady)return;shipping.dataset.iconsReady='true';const heading=shipping.querySelector('.shipping-estimate-heading');const destination=shipping.querySelector('.shipping-delivery');const estimate=shipping.querySelector('.shipping-estimate-result');const truck='<svg viewBox="0 0 24 24" focusable="false"><path d="M3 6h11v10H3zM14 10h4l3 3v3h-7zM7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM18 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/></svg>';const pin='<svg viewBox="0 0 24 24" focusable="false"><path d="M12 21s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12Z"/><circle cx="12" cy="9" r="2.2"/></svg>';const calendar='<svg viewBox="0 0 24 24" focusable="false"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>';if(heading&&!heading.querySelector('.shipping-row-icon')){heading.classList.add('shipping-row');heading.prepend(addShippingIcon('shipping-truck-icon',truck));}if(destination&&!destination.querySelector('.shipping-row-icon')){destination.classList.add('shipping-row');destination.prepend(addShippingIcon('',pin));}if(estimate&&!estimate.querySelector('.shipping-row-icon')){estimate.classList.add('shipping-row');estimate.prepend(addShippingIcon('',calendar));}}
new MutationObserver(enhanceProductShippingCard).observe(document.documentElement,{childList:true,subtree:true});

async function refreshProductDeliveryEstimate(main,item){
  const form=main.querySelector('[data-delivery-form]');
  const input=main.querySelector('#delivery-zip');
  const button=main.querySelector('[data-estimate-delivery]');
  const arrival=main.querySelector('[data-arrival]');
  const note=main.querySelector('[data-delivery-note]');
  if(!form||!input||!arrival)return;
  const zip=input.value.trim();
  if(!deliveryZipPattern.test(zip)){arrival.textContent='Enter a valid ZIP code to see an estimate.';return;}
  if(button)button.disabled=true;
  arrival.textContent='Checking USPS service standards…';
  const result=await window.storeShipping?.estimateDelivery({postalCode:zip,weightOz:item.weight});
  if(button)button.disabled=false;
  if(!result||result.error){arrival.textContent=result?.error||'Delivery estimates are unavailable right now.';return;}
  const rate=result.rates?.[0]||{};
  const earliestDate=deliveryDateLabel(rate.estimatedDeliveryStart||result.estimatedDeliveryStart);
  const latestDate=deliveryDateLabel(rate.estimatedDeliveryEnd||result.estimatedDeliveryEnd);
  const deliveryDate=deliveryDateLabel(rate.scheduledDeliveryDate||result.scheduledDeliveryDate);
  arrival.textContent=earliestDate&&latestDate?`Estimated delivery ${earliestDate} – ${latestDate}`:deliveryDate?`Estimated delivery by ${deliveryDate}`:'USPS estimate received.';
  if(note)note.textContent=result.estimateSource==='usps-standard'?`USPS Ground Advantage · 2–5 business days after ${deliveryProcessingLabel(result.processingDays)} · Service standards are estimates, not guarantees.`:`USPS Ground Advantage · ${deliveryProcessingLabel(result.processingDays)} · Service standards are estimates, not guarantees.`;
}

function bindProductDeliveryEstimate(main,item){
  const form=main.querySelector('[data-delivery-form]');
  if(!form)return;
  form.addEventListener('submit',(event)=>{event.preventDefault();void refreshProductDeliveryEstimate(main,item);});
  const input=form.querySelector('#delivery-zip');
  input?.addEventListener('input',()=>{if(deliveryZipPattern.test(input.value.trim()))void refreshProductDeliveryEstimate(main,item);});
}

async function hydrateProductDeliveryEstimate(main,item){
  const client=window.beadSupabase;
  if(!window.customerAccounts?.addresses)return;
  try{
    const user=client?.auth?.getUser?(await client.auth.getUser()).data?.user:null;
    const account=!user?window.customerAccounts.current?.():null;
    const input=main.querySelector('#delivery-zip');
    const destination=main.querySelector('[data-delivery-address]');
    const note=main.querySelector('[data-delivery-note]');
    let changeButton=main.querySelector('[data-change-delivery-zip]');
    if(!changeButton&&input?.parentElement){changeButton=document.createElement('button');changeButton.type='button';changeButton.className='shipping-change-zip';changeButton.dataset.changeDeliveryZip='';changeButton.textContent='Change';changeButton.hidden=true;input.parentElement.append(changeButton);}
    const showManualEntry=()=>{if(input){input.hidden=false;input.readOnly=false;input.required=true;input.focus();}if(destination)destination.hidden=true;if(changeButton){changeButton.textContent='Use default';changeButton.hidden=false;}if(note)note.textContent='Using a manual ZIP · USPS Ground Advantage service standards.';};
    const showDefaultEntry=()=>{if(input){input.value=String(address?.postal_code||'').trim();input.readOnly=true;input.required=false;input.hidden=true;}if(destination){destination.textContent=`Default address · ZIP ${input?.value||''}`;destination.hidden=false;}if(changeButton){changeButton.textContent='Change';changeButton.hidden=false;}if(note)note.textContent=`Using your ${productPageEscape(address?.label||'default address')} ZIP · USPS Ground Advantage service standards.`;};
    changeButton?.addEventListener('click',()=>{if(input?.readOnly)showManualEntry();else showDefaultEntry();});
    if(!user&&!account){showManualEntry();if(changeButton)changeButton.hidden=true;if(note)note.textContent='Enter your ZIP for an estimate using USPS Ground Advantage.';return;}
    const addresses=await window.customerAccounts.addresses();
    const address=addresses.find((entry)=>entry.is_default)||addresses[0];
    if(!address||!deliveryZipPattern.test(String(address.postal_code||'').trim())){showManualEntry();if(changeButton)changeButton.hidden=true;if(note)note.textContent='Enter your ZIP for an estimate using USPS Ground Advantage.';return;}
    if(!input)return;
    input.value=String(address.postal_code).trim();
    input.readOnly=true;
    input.required=false;
    input.hidden=true;
    if(destination){destination.textContent=`Default address · ZIP ${input.value}`;destination.hidden=false;}
    if(changeButton){changeButton.hidden=false;changeButton.textContent='Change';}
    if(note)note.textContent=`Using your ${productPageEscape(address.label||'default address')} ZIP · USPS Ground Advantage service standards.`;
    await refreshProductDeliveryEstimate(main,item);
  }catch(error){}
}

function renderProductPage(item){
  const main=document.querySelector('main');
  const images=item.images.length?item.images:[item.image];
  const basePrice=Number(item.price)||0;
  const config=window.productStoreConfig||{};
  const shippingPolicy=window.canonicalShippingPolicy?.()||'Shipping options and delivery estimates are shown at checkout. Please contact us if your order arrives with a problem so we can help.';
  const configuredVariants=(item.options||[]).flatMap((option)=>option.values||[]).filter((value)=>typeof value==='object'&&String(value.sku||value.inventorySku||'').trim());
  const skuVariants=configuredVariants.length?configuredVariants:(item.sku?[{sku:item.sku,inventorySku:item.sku,price:basePrice,unitType:item.unitType||'Each',quantity:item.quantity}]:[]);
  const hasMultipleSkus=skuVariants.length>1;
  const lowestVariant=skuVariants.reduce((lowest,value)=>!lowest||Number(value.price||0)<Number(lowest.price||0)?value:lowest,null);
  const singleVariant=skuVariants.length===1?skuVariants[0]:null;
  const compactPackConfig=null;
  const canonicalFilterDefinitions=Array.isArray(item.sku_filter_definitions)?item.sku_filter_definitions.filter((definition)=>String(definition?.label||'').trim()):[];
  const optionMarkup=hasMultipleSkus?(canonicalFilterDefinitions.length?'<div data-canonical-filter-host></div><select data-option-index="0" hidden><option value="">Select an option</option>'+((item.options||[]).find((option)=>String(option.name||'').trim().toLowerCase()==='sku')?.values||[]).map((value)=>{const label=typeof value==='object'?value.label:value;return`<option value="${productPageEscape(label)}">${productPageEscape(label)}</option>`;}).join('')+'</select>':(canonicalFilterDefinitions.length?(item.options||[]).filter((option)=>String(option.name||'').trim().toLowerCase()!=='sku'):(item.options||[])).map((option,index)=>`<label class="product-option"><span>${productPageEscape(option.name)}</span><select data-option-index="${index}"><option value="">Select an option</option>${option.values.map((value)=>{const label=typeof value==='object'?value.label:value;return`<option value="${productPageEscape(label)}">${productPageEscape(label)}</option>`;}).join('')}</select></label>`).join('')):'';
  const productStatus=(window.storefrontStatusBadges?.(item)||['Out of Stock'])[0]||'Out of Stock';const productStatusClass=productStatus.toLowerCase().replace(/[^a-z0-9]+/g,'-');const productIsBestSeller=window.storefrontBestSellerIds?.has(item.externalId||item.id)===true;const productUnit=singleVariant?.unitType||item.unitType||'Each';main.innerHTML=`<section class="store-page product-detail-page"><a class="back-to-results" href="javascript:history.back()">← Back to results</a><div class="product-page-layout"><div class="product-page-left"><div class="product-page-gallery"><div class="product-page-media"><button type="button" class="product-page-image-trigger" aria-label="Open full-size image"><img class="product-page-main-image" src="${productPageEscape(images[0])}" alt="${productPageEscape(item.name)}"></button></div><div class="product-page-thumbnails">${images.map((image,index)=>`<button type="button" class="product-page-thumbnail${index===0?' active':''}" data-image="${productPageEscape(image)}" aria-label="View image ${index+1}"><img src="${productPageEscape(image)}" alt=""></button>`).join('')}</div></div><section class="product-page-reviews"><h2>Reviews</h2><p>Reviews for this item will appear here once reviews are enabled.</p></section></div><div class="product-page-purchase"><p class="kicker">${productPageEscape(item.category.replaceAll('-',' ').toUpperCase())}</p><h1>${productPageEscape(item.name)}</h1><p class="product-page-short-description">${productPageEscape(item.shortDescription||'')}</p><div class="product-page-reference-meta">${productIsBestSeller?'<span class="best-seller-badge">BESTSELLER</span>':''}<span class="product-page-stock-status product-page-stock-status-${productStatusClass}"><i aria-hidden="true"></i><span data-product-status>${productPageEscape(productStatus)}</span></span><span class="product-page-unit" data-product-unit>${productPageEscape(productUnit)}</span></div><strong class="product-page-price" data-base-price="${item.price}">$${item.price.toFixed(2)}</strong><p class="product-page-stock" aria-live="polite">${item.quantity>0?`${item.quantity} in stock`:'Availability confirmed at checkout'}</p>${optionMarkup?`<section class="product-options"><h2>Choose your options</h2>${optionMarkup}</section>`:''}<p data-stock-message class="stock-threshold-message" aria-live="polite"></p><div class="product-purchase-controls"><div class="product-quantity"><button type="button" data-quantity-decrement aria-label="Decrease quantity">−</button><output data-quantity-display>1</output><button type="button" data-quantity-increment aria-label="Increase quantity">+</button><select data-quantity aria-label="Quantity"><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option></select></div><div class="product-actions product-page-actions"><button type="button" class="cart-toggle${isInBag(item.id)?' in-cart':''}">${isInBag(item.id)?'Remove from Cart':'Add to Cart'}</button><button type="button" class="wishlist-button${wishlistItems().includes(item.id)?' active':''}" aria-label="Favorite">♡</button></div></div><form class="product-page-shipping" data-shipping-estimate data-delivery-form><div class="shipping-estimate-heading"><strong>Ships from ${productPageEscape(config.shippingFrom||'our studio')}</strong><span>USPS Ground Advantage</span></div><div class="shipping-delivery"><label for="delivery-zip">Deliver to</label><div class="shipping-destination"><input id="delivery-zip" inputmode="numeric" placeholder="ZIP code" maxlength="10" required><span data-delivery-address hidden></span></div></div><div class="shipping-estimate-result"><strong>Estimated delivery</strong><span data-arrival>Enter your ZIP for an estimate</span></div><small data-delivery-note>Enter your ZIP to get a live USPS Ground Advantage estimate.</small></form><p class="purchase-note">Secure checkout will be connected to the store payment provider.</p><div class="product-page-sections product-page-sections-side"><section><h2>Item details</h2><dl><div><dt>SKU</dt><dd data-selected-sku>${productPageEscape(item.sku||'')}</dd></div>${item.materials?`<div><dt>Materials</dt><dd>${productPageEscape(item.materials)}</dd>`:''}<div><dt>Category</dt><dd>${productPageEscape(item.category.replaceAll('-',' '))}</dd></div></dl></section><section><h2>Product description</h2><p>${productPageEscape(item.description).replace(/\r?\n/g,'<br>')}</p></section><section><h2>Shipping & returns</h2><div class="product-page-rich-content" data-shipping-policy>${window.sanitizeRichText(shippingPolicy)}</div></section></div></div></div></section>`;const mediaElement=main.querySelector('.product-page-media');(item.media||[]).filter((entry)=>entry.type==='video').forEach((entry)=>{const video=document.createElement('video');video.src=entry.url;video.controls=true;video.preload='metadata';video.className='product-page-video';video.setAttribute('aria-label',`${item.name} video`);mediaElement?.append(video);});const allBadges=[...new Set(window.storefrontBrowseBadges?.(item)||[...(item.badges||[]),...(window.storefrontStatusBadges?.(item)||[])])];const aboveBadges=allBadges.filter((badge)=>!['Best Seller','On Sale','Clearance','Low Stock','In Stock','Out of Stock'].includes(badge));const inventoryBadges=allBadges.filter((badge)=>['On Sale','Clearance','Low Stock','Out of Stock'].includes(badge));const badgeSpan=(badge)=>`<span class="product-badge product-badge-${String(badge).toLowerCase().replace(/[^a-z0-9]+/g,'-')}">${productPageEscape(badge)}</span>`;if(mediaElement&&aboveBadges.length){const aboveRow=document.createElement('div');aboveRow.className='product-badges-above';aboveRow.innerHTML=aboveBadges.map(badgeSpan).join('');mediaElement.parentElement?.insertBefore(aboveRow,mediaElement);}if(mediaElement&&inventoryBadges.length){const inventoryRow=document.createElement('div');inventoryRow.className='product-badges product-page-badges';inventoryRow.innerHTML=inventoryBadges.map(badgeSpan).join('');mediaElement.append(inventoryRow);}
  if(window.storefrontInventoryStatus?.(item)==='In Stock')main.querySelector('.product-page-stock-status')?.remove();
  const promoDisclaimer=document.createElement('p');promoDisclaimer.className='product-page-promo-disclaimer';promoDisclaimer.hidden=true;main.querySelector('.product-page-price')?.after(promoDisclaimer);const promoPercent=Number(item.promoDiscountPercent??item.promo_discount_percent)||0;const promoEndsAt=item.promoEndsAt||item.promo_ends_at;const promoEndTime=promoEndsAt?Date.parse(promoEndsAt):NaN;if(promoPercent>0&&(!Number.isFinite(promoEndTime)||promoEndTime>Date.now())){const endLabel=Number.isFinite(promoEndTime)?new Date(promoEndTime).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'';promoDisclaimer.textContent=`${promoPercent}% off${endLabel?` Sale Ends ${endLabel}`:' Sale'}`;promoDisclaimer.hidden=false;}
  const detailSections=main.querySelector('.product-page-sections-side');
  const detailBlock=[...detailSections.querySelectorAll('section')].find((section)=>['item details','product details'].includes(section.querySelector('h2')?.textContent.toLowerCase()));
  if(detailBlock){detailBlock.querySelector('h2').textContent='Product details';if(item.itemDetails){const details=document.createElement('div');details.className='product-page-rich-detail';details.innerHTML=window.sanitizeRichText(item.itemDetails);detailBlock.append(details);}}
  const descriptionBlock=[...detailSections.querySelectorAll('section')].find((section)=>section.querySelector('h2')?.textContent.toLowerCase()==='product description');
  if(detailBlock&&descriptionBlock)detailSections.insertBefore(descriptionBlock,detailBlock);
  if(item.shippingDetails){const shippingSection=document.createElement('section');shippingSection.innerHTML='<h2>Shipping details</h2><div class="product-page-rich-content">'+window.sanitizeRichText(item.shippingDetails)+'</div>';detailSections.insertBefore(shippingSection,detailSections.lastElementChild);}
  const quantitySelect=main.querySelector('[data-quantity]');
  for(let quantity=6;quantity<=20;quantity+=1){const option=document.createElement('option');option.value=quantity;option.textContent=quantity;quantitySelect.append(option);}
  const quantityDisplay=main.querySelector('[data-quantity-display]');const syncQuantityDisplay=()=>{if(quantityDisplay)quantityDisplay.textContent=quantitySelect.value;};main.querySelector('[data-quantity-decrement]')?.addEventListener('click',()=>{quantitySelect.value=String(Math.max(1,Number(quantitySelect.value)-1));syncQuantityDisplay();quantitySelect.dispatchEvent(new Event('change'));});main.querySelector('[data-quantity-increment]')?.addEventListener('click',()=>{quantitySelect.value=String(Math.min(20,Number(quantitySelect.value)+1));syncQuantityDisplay();quantitySelect.dispatchEvent(new Event('change'));});
  const cartButton=main.querySelector('.cart-toggle');
  let waitlistSelected=false;
  const price=main.querySelector('.product-page-price');
  let priceUnit=price?.querySelector('[data-price-unit]');
  if(price&&!priceUnit){priceUnit=document.createElement('span');priceUnit.className='product-page-price-unit';priceUnit.dataset.priceUnit='';price.append(' ',priceUnit);}
  const packCountForVariant=(variant)=>{const label=String(variant?.label||'');const countLabel=label.match(/\((\d+)\s*(?:ct|count|pcs?|pack)\)/i);if(countLabel)return Math.max(1,Number(countLabel[1])||1);const sku=String(variant?.sku||variant?.inventorySku||'').trim();const packMatch=sku.match(/-(\d+)PK$/i);return packMatch?Math.max(1,Number(packMatch[1])||1):1;};
  const bulkPricing=document.createElement('p');
  bulkPricing.className='product-page-bulk-pricing';
  bulkPricing.hidden=true;
  price?.after(bulkPricing);
  const selectedOptionEntries=()=>[...main.querySelectorAll('[data-option-index]')].map((select,index)=>{const option=item.options?.[index];const configured=(option?.values||[]).find((value)=>typeof value==='object'?value.label===select.value:value===select.value);return{option,configured,label:select.value};}).filter((entry)=>entry.label);
  const requiredOptionsReady=()=>{if(!hasMultipleSkus)return true;return(item.options||[]).every((option,index)=>option.required===false||Boolean(main.querySelector(`[data-option-index="${index}"]`)?.value));};  const savedCartEntry=window.storeCart?.entries?.()?.find((entry)=>entry.id===item.id);(savedCartEntry?.selectedOptions||[]).forEach((selected,index)=>{const select=main.querySelector(`[data-option-index="${index}"]`);if(select&&selected?.label)select.value=selected.label;});
  const selectedVariant=()=>{const entry=selectedOptionEntries().find(({option})=>String(option?.name||'').trim().toLowerCase()==='sku')||((item.options||[]).length===1?selectedOptionEntries()[0]:null);if(entry)return typeof entry.configured==='object'?entry.configured:{label:entry.label,price:basePrice+productOptionPrice(entry.option,entry.configured),unitType:'Each'};return singleVariant;};
  const updatePrice=()=>{const selected=selectedVariant();const pricingVariant=selected||lowestVariant;const originalPrice=Number(pricingVariant?.price??basePrice)||0;const promo=window.storefrontPromoForSku?.(item,originalPrice,pricingVariant?.sku||item.sku)||{originalPrice,price:originalPrice,discounted:false};if(price){price.replaceChildren();const pricePrefix=hasMultipleSkus&&!selected?'Starting at ':'';if(promo.discounted){const original=document.createElement('s');original.className='product-page-original-price';original.textContent=pricePrefix+'$'+promo.originalPrice.toFixed(2);const current=document.createElement('span');current.className='product-page-promo-price';current.textContent='$'+promo.price.toFixed(2);price.append(original,' ',current);}else{price.append(document.createTextNode(pricePrefix+'$'+promo.price.toFixed(2)));}price.append(' ',priceUnit);priceUnit.textContent=`/ ${pricingVariant?.unitType||item.unitType||'Each'}`;const unitElement=main.querySelector('[data-product-unit]');if(unitElement)unitElement.textContent=pricingVariant?.unitType||item.unitType||'Each';}};
  const updateBulkPricing=()=>{const selected=selectedVariant();const pricingVariant=selected||lowestVariant;const packCount=packCountForVariant(pricingVariant);const packLabel=packCount>1?`${packCount} Pack`:pricingVariant?.unitType||item.unitType||'Each';if(priceUnit)priceUnit.textContent=`/ ${packLabel}`;const unitElement=main.querySelector('[data-product-unit]');if(unitElement)unitElement.textContent=packLabel;if(!selected||packCount<=1){bulkPricing.hidden=true;bulkPricing.replaceChildren();return;}const selectedPrice=Math.max(0,Number(pricingVariant?.price)||0);const singleSku=String(pricingVariant?.sku||pricingVariant?.inventorySku||'').trim().replace(/-\d+PK$/i,'-1PK');const singleVariant=skuVariants.find((variant)=>String(variant?.sku||variant?.inventorySku||'').trim().toLowerCase()===singleSku.toLowerCase());if(!singleVariant){bulkPricing.hidden=true;bulkPricing.replaceChildren();return;}const singlePrice=Math.max(0,Number(singleVariant.price)||0);const regularEquivalent=singlePrice*packCount;const savings=regularEquivalent-selectedPrice;const perBead=selectedPrice/packCount;if(savings>0){const savingsPercent=regularEquivalent?Math.round((savings/regularEquivalent)*100):0;bulkPricing.innerHTML=`<strong>Bulk discount</strong> <s>$${regularEquivalent.toFixed(2)}</s> <span>$${selectedPrice.toFixed(2)} total</span> · $${perBead.toFixed(2)} per bead · Save $${savings.toFixed(2)} (${savingsPercent}%)`;}else{bulkPricing.innerHTML=`<strong>Bulk pricing</strong> <span>$${selectedPrice.toFixed(2)} total</span> · $${perBead.toFixed(2)} per bead · Single-bead equivalent: $${regularEquivalent.toFixed(2)} · No bulk savings`; }bulkPricing.hidden=false;};
  const updateVariantDisplay=()=>{updatePrice();updateBulkPricing();const selected=selectedVariant();const sku=main.querySelector('[data-selected-sku]');if(sku)sku.textContent=selected?.sku||item.sku||'—';const image=main.querySelector('.product-page-main-image');if(image)image.src=selected?.imageUrl||images[0];main.querySelectorAll('.product-page-thumbnail').forEach((thumbnail,index)=>thumbnail.classList.toggle('active',selected?.imageUrl?thumbnail.dataset.image===selected.imageUrl:index===0));syncQuantityFromCart();syncStockButton();};
  main.querySelectorAll('[data-option-index]').forEach((select)=>select.addEventListener('change',updateVariantDisplay));
  main.querySelectorAll('[data-image]').forEach((button)=>button.addEventListener('click',()=>{main.querySelector('.product-page-main-image').src=button.dataset.image;main.querySelectorAll('.product-page-thumbnail').forEach((thumbnail)=>thumbnail.classList.toggle('active',thumbnail===button));}));main.querySelector('.product-page-image-trigger')?.addEventListener('click',()=>openProductImageLightbox(main.querySelector('.product-page-main-image')));
  bindProductDeliveryEstimate(main,item);
  const waitlistEnabled=item.waitlist!==false&&!config.waitlistDisabled?.[item.id];
  const stockMessage=main.querySelector('[data-stock-message]');
  const updateProductStatus=(available,threshold)=>{const status=available<=0?'Out of Stock':threshold>0&&available<=threshold?'Low Stock':'In Stock';const element=main.querySelector('[data-product-status]');if(element)element.textContent=status;const meta=element?.closest('.product-page-stock-status');if(meta)meta.className='product-page-stock-status product-page-stock-status-'+status.toLowerCase().replace(/[^a-z0-9]+/g,'-');};const syncStockButton=()=>{if(!requiredOptionsReady()){waitlistSelected=false;stockMessage.textContent='Choose an option before adding this item to your cart.';main.querySelector('.product-page-stock').textContent='Select an option to see availability';cartButton.textContent='Select Option';cartButton.classList.remove('restock-button','in-cart');cartButton.disabled=true;return;}const requested=Number(quantitySelect.value);const selected=selectedVariant();const canonicalAvailable=selected&&selected.quantity!==null&&selected.quantity!==undefined?Number(selected.quantity):Number(item.quantity)||0;const cartMaximum=window.storeCart?.maxQuantity?.(item.id,selectedOptionsForCart());const available=Number.isFinite(cartMaximum)?Math.min(canonicalAvailable,cartMaximum):canonicalAvailable;updateProductStatus(available,Number(selected?.lowStockThreshold??item.lowStockThreshold)||0);waitlistSelected=requested>available;if(!waitlistSelected){stockMessage.textContent='';main.querySelector('.product-page-stock').textContent=available>0?`${available} available with your current cart`:'Availability confirmed at checkout';cartButton.textContent=isInBag(item.id,selectedOptionsForCart())?'Remove from Cart':'Add to Cart';cartButton.classList.remove('restock-button');cartButton.disabled=false;return;}if(!waitlistEnabled){stockMessage.textContent=available?`Only ${available} available with the other items in your cart. Choose ${available} or fewer.`:'Currently out of stock. Waitlist is unavailable for this item.';cartButton.textContent=available?'Choose an available quantity':'Unavailable';cartButton.classList.add('restock-button');cartButton.disabled=true;return;}stockMessage.textContent=available?`Only ${available} of ${requested} are available with the other items in your cart. Buy the available amount and waitlist the rest, or waitlist the full requested quantity.`:'This item is currently out of stock. Join the waitlist to be notified when it is available.';cartButton.textContent=available?'Select Option':'Join Waitlist';cartButton.classList.add('restock-button');cartButton.disabled=false;};
  quantitySelect.addEventListener('change',()=>{if(window.storeControls?.salesFrozen){cartButton.disabled=true;cartButton.textContent='Sales paused for inventory audit';}else{persistCartQuantity();syncStockButton();}});
  const selectedOptionsForCart=()=>{const entries=selectedOptionEntries();if(!entries.length&&singleVariant)return[{label:singleVariant.label||'Standard',sku:singleVariant.sku||'',inventorySku:singleVariant.inventorySku||singleVariant.sku||'',inventoryUnits:Number(singleVariant.inventoryUnits)||1,imageUrl:singleVariant.imageUrl||'',price:Number(singleVariant.price)||basePrice,unitType:singleVariant.unitType||'Each',weight:singleVariant.weight??null,weightUnit:singleVariant.weightUnit||'oz'}];return entries.map(({configured,label})=>({label,sku:configured?.sku||'',inventorySku:configured?.inventorySku||'',inventoryUnits:Number(configured?.inventoryUnits)||1,imageUrl:configured?.imageUrl||'',price:Number(configured?.price)||basePrice,unitType:configured?.unitType||'Each',weight:configured?.weight??null,weightUnit:configured?.weightUnit||'oz'}));};  const cartLineForSelection=()=>window.storeCart?.entries?.()?.find((entry)=>entry.id===item.id&&JSON.stringify(entry.selectedOptions||[])===JSON.stringify(selectedOptionsForCart()));  const syncQuantityFromCart=()=>{const entry=requiredOptionsReady()?cartLineForSelection():null;if(!entry)return;const quantity=Math.min(20,Math.max(1,Math.floor(Number(entry.quantity)||1)));quantitySelect.value=String(quantity);syncQuantityDisplay();};  const persistCartQuantity=()=>{if(!requiredOptionsReady())return;const selectedOptions=selectedOptionsForCart();if(isInBag(item.id,selectedOptions))window.storeCart?.setQuantity?.(item.id,selectedOptions,Number(quantitySelect.value));};
  syncQuantityFromCart();updatePrice();updateBulkPricing();  if(window.storeControls?.salesFrozen){cartButton.disabled=true;cartButton.textContent='Sales paused for inventory audit';}else syncStockButton();
  cartButton.addEventListener('click',async()=>{if(window.storeControls?.salesFrozen)return;if(!requiredOptionsReady())return;const selectedOptions=selectedOptionsForCart();if(waitlistSelected){const requested=Number(quantitySelect.value);const selected=selectedVariant();const canonicalAvailable=selected&&selected.quantity!==null&&selected.quantity!==undefined?Number(selected.quantity):Number(item.quantity)||0;const cartMaximum=window.storeCart?.maxQuantity?.(item.id,selectedOptions);const availableStock=Number.isFinite(cartMaximum)?Math.min(canonicalAvailable,cartMaximum):canonicalAvailable;const requestMode=await window.restockWaitlist.chooseMode(requested,availableStock);if(!requestMode)return;const account=await window.restockWaitlist.requestAccount();if(!account)return;const available=requestMode==='partial'?Math.min(availableStock,requested):0;const waitlistedQuantity=requestMode==='full'?requested:Math.max(0,requested-availableStock);const options=[...main.querySelectorAll('[data-option-index], [data-compact-color], [data-compact-pack], [data-compact-special]')].map((select)=>select.value).filter(Boolean);const inventorySku=selected?.inventorySku||selected?.sku||selectedOptions.find((option)=>option.inventorySku)?.inventorySku||item.sku||'';options.push(`Requested quantity: ${requested}`);options.push(`Available at request: ${availableStock}`);options.push(`Waitlisted quantity: ${waitlistedQuantity}`);const joined=await window.restockWaitlist.join({productId:item.id,productName:item.name,accountEmail:account.email,requestedQuantity:waitlistedQuantity,requestedTotalQuantity:requested,availableQuantityAtRequest:availableStock,requestMode:requestMode==='full'?'full':'partial',inventorySku,selectedOptions,options});if(requestMode==='partial'){for(let count=0;count<available;count+=1){if(!addToBag(item.id,selectedOptions))break;}}cartButton.textContent=joined?(available?`Added ${available} + Waitlisted`:'Waitlist Joined'):'Already on waitlist';cartButton.disabled=true;return;}if(isInBag(item.id,selectedOptions)){removeFromBag(item.id,selectedOptions);cartButton.textContent='Add to Cart';cartButton.classList.remove('in-cart');}else{for(let count=0;count<Number(quantitySelect.value);count+=1){if(!addToBag(item.id,selectedOptions))break;}syncStockButton();cartButton.classList.toggle('in-cart',isInBag(item.id,selectedOptions));}});
  window.addEventListener('bead-cart-changed',syncStockButton);
  window.addEventListener('bead-inventory-recipes-ready',()=>{syncCompactPackOptions();updateVariantDisplay();});
  main.querySelector('.wishlist-button').addEventListener('click',(event)=>{event.currentTarget.classList.toggle('active',toggleWishlist(item.id));});
  void hydrateProductDeliveryEstimate(main,item);updateProductPageCategoryLabels();
}

Promise.all([catalogReady,window.catalogMetadataReady||catalogReady]).then(async()=>{await Promise.all([window.shippingSettingsReady,window.siteSettingsReady]);const params=new URLSearchParams(location.search);const productId=params.get('id');const item=findProduct(productId);const main=document.querySelector('main');if(!item||!isProductVisible(item)){if(params.has('debugCatalog')){const debug=document.createElement('pre');debug.textContent=JSON.stringify({catalogError:window.storeCatalogError?.message||String(window.storeCatalogError||''),request:window.storeCatalogDebug||null,assignments:window.storeCatalogAssignments||[],catalogCount:window.storeCatalog?.()?.length||0,identifiers:(window.storeCatalog?.()||[]).map((entry)=>({id:entry.id,externalId:entry.externalId,databaseId:entry.databaseId,visible:entry.visible})),item:item?{id:item.id,externalId:item.externalId,visible:item.visible}:null},null,2);main.innerHTML='<section class="store-page product-unavailable"><h1>Item unavailable</h1>'+debug.outerHTML+'<p>This item is not currently available for purchase.</p><a class="cta" href="shop-all.html">Continue shopping</a></section>';}else main.innerHTML='<section class="store-page product-unavailable"><h1>Item unavailable</h1><p>This item is not currently available for purchase.</p><a class="cta" href="shop-all.html">Continue shopping</a></section>';return;}trackProductEvent(item.id,'view');renderProductPage(item);restoreProductPageMediaOrder(item);installCanonicalProductPageFilters(item);});

async function hydrateProductReviews(item){
  const section=document.querySelector('.product-page-reviews');
  if(!section)return;
  let reviews=[];
  if(window.beadSupabase&&item.databaseId){
    const result=await window.beadSupabase.from('reviews').select('rating,body,verified_purchase,created_at').eq('product_id',item.databaseId).eq('review_type','item').eq('status','approved').order('created_at',{ascending:false});
    if(result.error)return;
    reviews=result.data||[];
  }else if(window.reviewTools){
    reviews=window.reviewTools.read().filter((review)=>review.productId===item.id&&review.status==='approved');
  }
  const ratingFor=(review)=>Math.max(0,Math.min(5,Math.round(Number(review.rating)||0)));
  const starsFor=(review)=>'★'.repeat(ratingFor(review))+'☆'.repeat(5-ratingFor(review));
  const dateFor=(review)=>{const date=new Date(review.created_at||review.createdAt||'');return Number.isNaN(date.getTime())?'Date unavailable':date.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});};
  const reviewMarkup=(review)=>`<article class="product-review"><strong class="product-review-stars" aria-label="${ratingFor(review)} out of 5 stars">${starsFor(review)}</strong><p>${productPageEscape(review.body||'')}</p><small>${review.verified_purchase?'Verified purchase · ':''}${dateFor(review)}</small></article>`;
  const average=reviews.length?reviews.reduce((total,review)=>total+Number(review.rating||0),0)/reviews.length:0;
  if(!reviews.length){section.innerHTML='<h2>Reviews</h2><p>No approved reviews yet.</p>';return;}
  const reviewCount=`${reviews.length} review${reviews.length===1?'':'s'}`;
  section.innerHTML=`<div class="product-review-summary"><button type="button" class="product-review-summary-trigger" aria-haspopup="dialog"><span class="product-review-summary-stars" aria-hidden="true">${starsFor({rating:average})}</span><span><strong>${average.toFixed(1)}/5</strong> · ${reviewCount}</span><span class="product-review-summary-link">Read reviews →</span></button></div><div class="product-review-list"><h2>Reviews · ${average.toFixed(1)}/5</h2>${reviews.map(reviewMarkup).join('')}</div>`;
  const dialog=document.createElement('dialog');
  dialog.className='product-reviews-dialog';
  dialog.setAttribute('aria-labelledby','product-reviews-dialog-title');
  dialog.innerHTML=`<button type="button" class="product-reviews-dialog-close" data-close-product-reviews aria-label="Close reviews">×</button><div class="product-reviews-dialog-content"><p class="kicker">CUSTOMER FEEDBACK</p><h2 id="product-reviews-dialog-title">Reviews · ${average.toFixed(1)}/5</h2><p class="product-reviews-dialog-summary"><span class="product-review-summary-stars" aria-hidden="true">${starsFor({rating:average})}</span> ${reviewCount}</p><div class="product-review-dialog-list">${reviews.map(reviewMarkup).join('')}</div></div>`;
  section.append(dialog);
  const closeDialog=()=>typeof dialog.close==='function'?dialog.close():dialog.removeAttribute('open');
  section.querySelector('.product-review-summary-trigger').addEventListener('click',()=>{if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');});
  dialog.querySelector('[data-close-product-reviews]').addEventListener('click',closeDialog);
  dialog.addEventListener('click',(event)=>{if(event.target===dialog)closeDialog();});
}

function installCanonicalProductPageFilters(item){
  const definitions=Array.isArray(item?.sku_filter_definitions)?item.sku_filter_definitions.filter((definition)=>String(definition?.label||'').trim()):[];
  const skuOption=(item.options||[]).find((option)=>String(option.name||'').trim().toLowerCase()==='sku');
  const section=document.querySelector('.product-options');
  if(!definitions.length||!skuOption||!section||section.dataset.canonicalFiltersReady)return;
  const values=(skuOption.values||[]).filter((value)=>typeof value==='object'&&String(value.sku||value.inventorySku||'').trim());
  if(!values.length)return;
  section.dataset.canonicalFiltersReady='true';
  const canonical=document.createElement('section');
  canonical.className='product-options product-page-canonical-filters';
  canonical.innerHTML='<h2>Choose your options</h2>';
  const choicesFor=(definition)=>{const options=definition.options&&typeof definition.options==='object'?definition.options:{};return[...new Set(values.map((value)=>String(options[String(value.sku||value.inventorySku||'').trim()]||options[String(value.sku||value.inventorySku||'').trim().toUpperCase()]||'').trim()).filter(Boolean))];};
  const selects=definitions.map((definition,index)=>{const label=document.createElement('label');label.className='product-option';const title=document.createElement('span');title.textContent=definition.label;const select=document.createElement('select');select.dataset.canonicalFilterIndex=String(index);select.innerHTML='<option value="">Select an option</option>';choicesFor(definition).forEach((choice)=>{const option=document.createElement('option');option.value=choice;option.textContent=choice;select.append(option);});label.append(title,select);canonical.append(label);return select;});
  section.hidden=true;
  section.before(canonical);
  const answerFor=(definition,value)=>{const sku=String(value.sku||value.inventorySku||'').trim();const options=definition.options&&typeof definition.options==='object'?definition.options:{};return String(options[sku]||options[sku.toUpperCase()]||'').trim();};
  const syncSelection=()=>{const selected=selects.map((select)=>select.value);const underlying=document.querySelector('[data-option-index]');if(!underlying)return;if(selected.some((value)=>!value)){if(underlying.value){underlying.value='';underlying.dispatchEvent(new Event('change'));}return;}const match=values.find((value)=>definitions.every((definition,index)=>answerFor(definition,value)===selected[index]));if(!match){if(underlying.value){underlying.value='';underlying.dispatchEvent(new Event('change'));}return;}const sku=String(match.sku||match.inventorySku||'').trim();const choice=[...underlying.options].find((option)=>{const candidate=values.find((value)=>String(value.sku||value.inventorySku||'').trim()===sku);return candidate&&option.value===candidate.label;});if(choice&&underlying.value!==choice.value){underlying.value=choice.value;underlying.dispatchEvent(new Event('change'));}};
  const guidance=document.createElement('div');
  guidance.className='product-filter-guidance';
  const clear=document.createElement('button');
  clear.type='button';
  clear.className='product-filter-clear';
  clear.textContent='Clear selections';
  clear.hidden=true;
  guidance.append(clear);
  canonical.append(guidance);
  const updateAvailability=()=>{
    selects.forEach((select,index)=>{
      const selected=selects.map((candidate)=>candidate.value);
      const otherSelections=selected.map((selection,selectionIndex)=>selectionIndex===index?'':selection);
      const context=otherSelections.filter(Boolean).join(' / ');
      [...select.options].forEach((option)=>{
        if(!option.value){option.disabled=false;return;}
        const available=values.some((value)=>{
          const answers=definitions.map((definition)=>answerFor(definition,value));
          return answers[index]===option.value&&otherSelections.every((selection,selectionIndex)=>!selection||answers[selectionIndex]===selection);
        });
        option.disabled=!available;
        const baseLabel=option.dataset.baseLabel||option.textContent.replace(/\s+— unavailable for .+$/,'');
        option.dataset.baseLabel=baseLabel;
        option.textContent=!available&&context?`${baseLabel} — unavailable for ${context}`:baseLabel;
      });
      const selectedOption=select.selectedOptions[0];
      if(select.value&&selectedOption?.disabled){
        select.value='';
      }
    });
    clear.hidden=!selects.some((select)=>select.value);
    syncSelection();
  };
  clear.addEventListener('click',()=>{selects.forEach((select)=>{select.value='';});updateAvailability();});
  selects.forEach((select)=>select.addEventListener('change',()=>updateAvailability()));
  updateAvailability();
}

function applyProductSaleContext(item){
  const params=new URLSearchParams(location.search);
  if(params.get('sale')!=='1')return;
  const main=document.querySelector('.product-detail-page');
  if(!main||main.dataset.saleContextReady)return;
  main.dataset.saleContextReady='true';
  const normalize=(value)=>String(value||'').trim().toLowerCase();
  const eligible=(value)=>{const sku=String(value?.sku||value?.inventorySku||'').trim();return sku&&window.storefrontPromoForSku?.(item,Number(value?.price??item.price)||0,sku)?.discounted===true;};
  main.querySelectorAll('[data-option-index]').forEach((select,index)=>{
    const option=item.options?.[index];
    [...select.options].forEach((choice)=>{
      if(!choice.value)return;
      const value=(option?.values||[]).find((candidate)=>typeof candidate==='object'&&String(candidate.label||'')===choice.value);
      if(value&&!eligible(value))choice.remove();
    });
  });
  const compactValues=(item.options?.length===1?(item.options[0].values||[]):[]).filter((value)=>typeof value==='object'&&String(value.sku||value.inventorySku||'').trim());
  const compactEntries=compactValues.map((value)=>{const sku=String(value.sku||value.inventorySku||'').trim();const match=sku.match(/-(\d+)PK$/i);const label=String(value.label||sku);return{value,sku,colorKey:sku.replace(/-(\d+)PK$/i,'').toUpperCase(),colorLabel:label.replace(/\s*[-–—]?\s*\(?\d+\s*(?:pack|pk)\)?\s*$/i,'').trim()||label,packCount:match?Number(match[1]):0};});
  const eligibleCompact=compactEntries.filter((entry)=>eligible(entry.value));
  if(compactColor&&eligibleCompact.length){[...compactColor.options].forEach((choice)=>{if(choice.value&&!eligibleCompact.some((entry)=>entry.colorKey===choice.value))choice.remove();});}
  if(compactSpecial){[...compactSpecial.options].forEach((choice)=>{if(choice.value&&!eligibleCompact.some((entry)=>entry.sku===choice.value))choice.remove();});}
  const syncCompactSaleOptions=()=>{if(!compactPack||!compactColor)return;const color=compactColor.value;[...compactPack.options].forEach((choice)=>{if(!choice.value)return;choice.disabled=!eligibleCompact.some((entry)=>entry.colorKey===color&&entry.packCount===Number(choice.value));});if(compactPack.selectedOptions[0]?.disabled)compactPack.value='';};
  compactColor?.addEventListener('change',syncCompactSaleOptions);syncCompactSaleOptions();
  const requestedSku=normalize(params.get('sku'));
  if(!requestedSku)return;
  if(compactColor&&compactPack){const entry=eligibleCompact.find((candidate)=>normalize(candidate.sku)===requestedSku);if(entry){if(entry.packCount===0&&compactSpecial){compactSpecial.value=entry.sku;compactColor.value='';compactPack.value='';compactSpecial.dispatchEvent(new Event('change'));}else{if(compactSpecial)compactSpecial.value='';compactColor.value=entry.colorKey;syncCompactSaleOptions();compactPack.value=String(entry.packCount);compactColor.dispatchEvent(new Event('change'));compactPack.value=String(entry.packCount);}}}
  else{main.querySelectorAll('[data-option-index]').forEach((select,index)=>{const value=(item.options?.[index]?.values||[]).find((candidate)=>typeof candidate==='object'&&normalize(candidate.sku||candidate.inventorySku)===requestedSku);if(value)select.value=value.label;});main.querySelector('[data-option-index]')?.dispatchEvent(new Event('change'));}
}

const productSaleContextObserver=new MutationObserver(()=>{const itemId=new URLSearchParams(location.search).get('id');const item=typeof findProduct==='function'?findProduct(itemId):null;if(item)applyProductSaleContext(item);});
productSaleContextObserver.observe(document.querySelector('main'),{childList:true});

catalogReady.then(async()=>{
  const productId=new URLSearchParams(location.search).get('id');
  const item=findProduct(productId);
  if(item&&isProductVisible(item))await hydrateProductReviews(item);
}).catch(()=>{});

const updateProductPageCategoryLabels=()=>{const productId=new URLSearchParams(location.search).get('id');const item=typeof findProduct==='function'?findProduct(productId):null;if(!item)return;const label=window.storeCategoryNameFor?.(item.category)||'';if(!label)return;document.querySelector('.product-page-purchase .kicker')?.replaceChildren(document.createTextNode(label.toUpperCase()));const categoryDetail=[...document.querySelectorAll('.product-page-sections-side dt')].find((element)=>element.textContent.trim().toLowerCase()==='category')?.nextElementSibling;if(categoryDetail)categoryDetail.textContent=label;};
catalogReady.then(updateProductPageCategoryLabels);

function restoreProductPageMediaOrder(item){
  const orderedMedia=(item.media||[]).filter((entry)=>entry?.url);
  const mediaElement=document.querySelector('.product-page-media');
  const thumbnails=document.querySelector('.product-page-thumbnails');
  if(!orderedMedia.length||!mediaElement||!thumbnails)return;
  const badgeRows=[...mediaElement.children].filter((child)=>child.classList.contains('product-page-badges'));
  let activeIndex=0;
  const showMedia=(index)=>{
    activeIndex=index;
    const entry=orderedMedia[index];
    mediaElement.replaceChildren();
    if(entry.type==='video'){
      const video=document.createElement('video');
      video.src=entry.url;
      video.controls=true;
      video.preload='metadata';
      video.className='product-page-video';
      video.setAttribute('aria-label',`${item.name} video`);
      mediaElement.append(video);
    }else{
      const trigger=document.createElement('button');
      trigger.type='button';
      trigger.className='product-page-image-trigger';
      trigger.setAttribute('aria-label','Open full-size image');
      const image=document.createElement('img');
      image.className='product-page-main-image';
      image.src=entry.url;
      image.alt=item.name;
      trigger.append(image);
      trigger.addEventListener('click',()=>openProductImageLightbox(image));
      mediaElement.append(trigger);
    }
    badgeRows.forEach((row)=>mediaElement.append(row));
    thumbnails.querySelectorAll('.product-page-thumbnail').forEach((thumbnail,thumbnailIndex)=>thumbnail.classList.toggle('active',thumbnailIndex===activeIndex));
  };
  thumbnails.replaceChildren();
  orderedMedia.forEach((entry,index)=>{
    const button=document.createElement('button');
    button.type='button';
    button.className='product-page-thumbnail';
    button.setAttribute('aria-label',`View ${entry.type==='video'?'video':'image'} ${index+1}`);
    if(entry.type==='video'){
      button.classList.add('product-page-video-thumbnail');
      button.textContent='Video';
    }else{
      const image=document.createElement('img');
      image.src=entry.url;
      image.alt='';
      button.append(image);
    }
    button.addEventListener('click',()=>showMedia(index));
    thumbnails.append(button);
  });
  showMedia(0);
}

catalogReady.then(()=>{
  const item=findProduct(new URLSearchParams(location.search).get('id'));
  if(item&&isProductVisible(item))restoreProductPageMediaOrder(item);
});
window.addEventListener('bead-categories-ready',updateProductPageCategoryLabels);
