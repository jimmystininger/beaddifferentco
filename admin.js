const publicOrderNumber=(order)=>order?.order_number?`BD-${String(order.order_number).padStart(6,'0')}`:String(order?.id||'').slice(0,8).toUpperCase()||'NEW';
const repairStorePaymentConnectionStatus=()=>{document.querySelectorAll('.admin-card').forEach((card)=>{if(card.querySelector('h3')?.textContent.trim()!=='Payment connection')return;const description=card.querySelector('p');const status=card.querySelector('strong');const nextDescription='Stripe is connected for payments and refunds. QuickBooks is not used for this store.';if(description&&description.textContent!==nextDescription)description.textContent=nextDescription;if(status&&status.textContent!=='Stripe connected')status.textContent='Stripe connected';});};
if(document.body){const storePaymentConnectionObserver=new MutationObserver(repairStorePaymentConnectionStatus);storePaymentConnectionObserver.observe(document.body,{childList:true,subtree:true});repairStorePaymentConnectionStatus();}
const installAdminStoryRichEditor=()=>{const textarea=document.querySelector('[data-content-form] textarea[name="storyBody"]');if(!textarea||textarea.dataset.storyRichEditor)return;textarea.dataset.storyRichEditor='true';const label=textarea.closest('label');if(!label)return;const editor=document.createElement('div');editor.className='admin-rich-editor story-rich-editor';editor.innerHTML='<div class="rich-toolbar" role="toolbar" aria-label="Our Story formatting"><button type="button" data-story-command="bold"><strong>B</strong></button><button type="button" data-story-command="italic"><em>I</em></button><button type="button" data-story-command="underline"><u>U</u></button><select data-story-command="formatBlock" aria-label="Text style"><option value="p">Paragraph</option><option value="h2">Heading</option><option value="h3">Subheading</option><option value="blockquote">Quote</option></select><button type="button" data-story-command="insertUnorderedList">• List</button><button type="button" data-story-command="insertOrderedList">1. List</button><button type="button" data-story-command="justifyLeft">Left</button><button type="button" data-story-command="justifyCenter">Center</button><button type="button" data-story-command="removeFormat">Clear</button></div><div class="rich-content story-rich-content" contenteditable="true" role="textbox" aria-multiline="true"></div>';const content=editor.querySelector('.story-rich-content');const hidden=document.createElement('input');hidden.type='hidden';hidden.name='storyBody';const source=String(textarea.value||'');if(/<(?:p|h[1-6]|ul|ol|blockquote|strong|em|u)\b/i.test(source)&&window.sanitizeRichText)content.innerHTML=window.sanitizeRichText(source);else source.split(/\r?\n/).forEach((line)=>{const paragraph=document.createElement('p');paragraph.textContent=line;content.append(paragraph);});const sync=()=>{const markup=window.sanitizeRichText?window.sanitizeRichText(content.innerHTML):content.innerHTML;hidden.value=markup;};editor.querySelectorAll('[data-story-command]').forEach((control)=>{control.addEventListener('mousedown',(event)=>event.preventDefault());control.addEventListener('change',()=>{content.focus();document.execCommand(control.dataset.storyCommand,false,control.value||null);sync();});control.addEventListener('click',()=>{content.focus();document.execCommand(control.dataset.storyCommand,false,null);sync();});});content.addEventListener('input',sync);label.replaceChild(editor,textarea);label.append(hidden);sync();};
if(document.body){const storyRichEditorObserver=new MutationObserver(installAdminStoryRichEditor);storyRichEditorObserver.observe(document.body,{childList:true,subtree:true});installAdminStoryRichEditor();}else document.addEventListener('DOMContentLoaded',installAdminStoryRichEditor);
const adminRowsCache=window.__beadAdminRowsCache||(window.__beadAdminRowsCache=new Map());
const adminBatchRows=async(values,buildQuery,batchSize=250)=>{const rows=[];for(let start=0;start<values.length;start+=batchSize){const result=await buildQuery(values.slice(start,start+batchSize));if(result.error)return result;rows.push(...(result.data||[]));}return{data:rows,error:null};};
const adminCachedRows=async(key,load,ttl=300000)=>{
  const now=Date.now();
  const existing=adminRowsCache.get(key);
  if(existing?.promise)return existing.promise;
  if(existing?.result&&now-existing.timestamp<ttl)return existing.result;
  const promise=Promise.resolve().then(load).then((result)=>{
    if(!result?.error)adminRowsCache.set(key,{timestamp:Date.now(),result});
    else adminRowsCache.delete(key);
    return result;
  }).catch((error)=>{adminRowsCache.delete(key);return{data:[],error};});
  adminRowsCache.set(key,{timestamp:now,promise});
  return promise;
};
const adminReportCacheTtl=24*60*60*1000;
const adminReportCacheDb={promise:null};
const openAdminReportCache=()=>{
  if(!window.indexedDB)return Promise.resolve(null);
  if(adminReportCacheDb.promise)return adminReportCacheDb.promise;
  adminReportCacheDb.promise=new Promise((resolve)=>{
    const request=window.indexedDB.open('bead-different-admin-reports',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('reports',{keyPath:'key'});
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>resolve(null);
  });
  return adminReportCacheDb.promise;
};
const readAdminReportCache=async(key)=>{const db=await openAdminReportCache();if(!db)return null;return new Promise((resolve)=>{const transaction=db.transaction('reports','readwrite');const request=transaction.objectStore('reports').get(key);request.onsuccess=()=>{const record=request.result;if(!record||Date.now()-Number(record.savedAt||0)>=adminReportCacheTtl){if(record)transaction.objectStore('reports').delete(key);resolve(null);return;}resolve(record);};request.onerror=()=>resolve(null);});};
const writeAdminReportCache=async(key,data)=>{const db=await openAdminReportCache();if(!db)return;return new Promise((resolve)=>{const transaction=db.transaction('reports','readwrite');transaction.objectStore('reports').put({key,data,savedAt:Date.now()});transaction.oncomplete=resolve;transaction.onerror=resolve;});};
const clearAdminReportCache=async(prefix)=>{const db=await openAdminReportCache();if(!db)return;return new Promise((resolve)=>{const transaction=db.transaction('reports','readwrite');const store=transaction.objectStore('reports');const request=store.getAllKeys();request.onsuccess=()=>request.result.filter((key)=>String(key).startsWith(prefix)).forEach((key)=>store.delete(key));transaction.oncomplete=resolve;transaction.onerror=resolve;});};
const clearAdminRowsCachePrefix=(prefix)=>{for(const key of adminRowsCache.keys())if(String(key).startsWith(prefix))adminRowsCache.delete(key);};
const invalidateAdminAccountingInventoryCaches=async()=>{
  const prefixes=['stats-rpc:','catalog-part:stats:','inventory:','catalog-part:inventory:'];
  prefixes.forEach(clearAdminRowsCachePrefix);
  await Promise.all(prefixes.map((prefix)=>clearAdminReportCache('report:'+prefix).catch(()=>undefined)));
};
const adminCachedReportRows=async(key,load)=>{
  const now=Date.now();
  const existing=adminRowsCache.get(key);
  if(existing?.result&&now-existing.timestamp<adminReportCacheTtl)return{...existing.result,__adminCachedAt:existing.timestamp};
  const stored=await readAdminReportCache('report:'+key);
  if(stored){const result={data:stored.data,error:null,__adminCachedAt:stored.savedAt};adminRowsCache.set(key,{timestamp:stored.savedAt,result});return result;}
  const result=await adminCachedRows(key,load);
  if(result?.error)return result;
  await writeAdminReportCache('report:'+key,result.data);
  return{...result,__adminCachedAt:null};
};
// Catalog reference data is shared by Metrics, Inventory, and the SKU tools.
// Cache by the requested sections—not by the tab that asked for them—so
// switching between admin tabs does not download the same 6k+ SKU reference
// rows again during the cache window.
const adminCatalogSnapshot=async(_key,includeProducts=true,includeOptions=true,includeRecipes=true,includeMappings=true,includeInventory=true,parallel=false,persistent=false)=>{
  const sections=[];
  if(includeInventory)sections.push('inventory');
  if(includeProducts)sections.push('products');
  if(includeOptions)sections.push('options');
  if(includeRecipes)sections.push('recipes');
  if(includeMappings)sections.push('mappings','mapping_components');
    const loadSection=(section)=>{const cacheKey=persistent?`catalog-part:${_key}:${section}`:`catalog-part:${section}`;return persistent?adminCachedReportRows(cacheKey,()=>window.beadSupabase.rpc('admin_catalog_snapshot_part',{p_section:section})):adminCachedRows(cacheKey,()=>window.beadSupabase.rpc('admin_catalog_snapshot_part',{p_section:section}));};
  const results=parallel?await Promise.all(sections.map(loadSection)):[];
  if(!parallel)for(const section of sections)results.push(await loadSection(section));
  const failed=results.find((result)=>result?.error);
  const snapshot={inventory:[],products:[],options:[],recipes:[],mappings:[],mapping_components:[]};
  sections.forEach((section,index)=>{const value=results[index]?.data;if(Array.isArray(value))snapshot[section]=value;});
  return{data:snapshot,error:failed?.error||null};
};
const adminCatalogSnapshotParts=(result)=>{
  const snapshot=result?.data&&typeof result.data==='object'&&!Array.isArray(result.data)?result.data:{};
  return{
    error:result?.error||null,
    products:Array.isArray(snapshot.products)?snapshot.products:[],
    options:Array.isArray(snapshot.options)?snapshot.options:[],
    inventory:Array.isArray(snapshot.inventory)?snapshot.inventory:[],
    recipes:Array.isArray(snapshot.recipes)?snapshot.recipes:[],
    mappings:Array.isArray(snapshot.mappings)?snapshot.mappings:[],
    mappingComponents:Array.isArray(snapshot.mapping_components)?snapshot.mapping_components:[]
  };
};
const clearAdminRowsCache=()=>adminRowsCache.clear();
const adminStoreSettingsCache=window.__beadAdminStoreSettingsCache||(window.__beadAdminStoreSettingsCache={value:null,at:0,promise:null});
const loadAdminStoreSettings=async(force=false)=>{
  if(!cloudAdmin())return{};
  const now=Date.now();
  if(!force&&adminStoreSettingsCache.promise)return adminStoreSettingsCache.promise;
  if(!force&&adminStoreSettingsCache.value&&now-adminStoreSettingsCache.at<30000)return adminStoreSettingsCache.value;
  const promise=(async()=>{
    let lastError=null;
    for(let attempt=0;attempt<3;attempt+=1){
      try{
        const result=await cloudAdmin().from('site_settings').select('value').eq('key','store').maybeSingle();
        if(!result.error){
          const value=result.data?.value&&typeof result.data.value==='object'?result.data.value:{};
          adminStoreSettingsCache.value=value;
          adminStoreSettingsCache.at=Date.now();
          return value;
        }
        lastError=result.error;
      }catch(error){lastError=error;}
      const statusCode=Number(lastError?.status||0);
      const retryable=!statusCode||statusCode>=500||/(?:fetch|network|timeout|5\d\d)/i.test(String(lastError?.message||''));
      if(!retryable||attempt===2)throw lastError;
      await new Promise((resolve)=>setTimeout(resolve,250*(attempt+1)));
    }
    throw lastError||new Error('Store settings could not be loaded.');
  })().finally(()=>{if(adminStoreSettingsCache.promise===promise)adminStoreSettingsCache.promise=null;});
  adminStoreSettingsCache.promise=promise;
  return promise;
};
const clearAdminStoreSettingsCache=()=>{adminStoreSettingsCache.value=null;adminStoreSettingsCache.at=0;};
const adminOverviewCountsCache=window.__beadAdminOverviewCountsCache||(window.__beadAdminOverviewCountsCache={key:'',value:null,at:0,promise:null});
const loadAdminOverviewCounts=async(since,defaults)=>{
  if(!cloudAdmin())return defaults;
  const key=String(since||'').slice(0,10);
  const now=Date.now();
  if(adminOverviewCountsCache.promise&&adminOverviewCountsCache.key===key)return adminOverviewCountsCache.promise;
  if(adminOverviewCountsCache.value&&adminOverviewCountsCache.key===key&&now-adminOverviewCountsCache.at<15000)return adminOverviewCountsCache.value;
  const promise=Promise.resolve().then(async()=>{
    const counts={...defaults};
    const [orders,members,reviews,waitlist]=await Promise.all([
      cloudAdmin().from('orders').select('id',{count:'exact',head:true}).in('status',['pending','paid','processing']),
      cloudAdmin().from('profiles').select('id',{count:'exact',head:true}).gte('created_at',since),
      cloudAdmin().from('reviews').select('id',{count:'exact',head:true}).eq('status','pending'),
      cloudAdmin().from('waitlist_entries').select('id',{count:'exact',head:true}).eq('status','waiting'),
    ]);
    if(!orders.error)counts.activeOrders=orders.count||0;
    if(!members.error)counts.newMembers=members.count||0;
    if(!reviews.error)counts.newReviews=reviews.count||0;
    if(!waitlist.error)counts.waitlistCount=waitlist.count||0;
    const contacts=await cloudAdmin().from('contact_messages').select('id',{count:'exact',head:true}).eq('status','new');
    if(!contacts.error)counts.contactCount=contacts.count||0;
    const [cancellations,issues]=await Promise.all([
      cloudAdmin().from('order_support_requests').select('id',{count:'exact',head:true}).eq('request_type','cancellation').in('status',['new','in_progress']),
      cloudAdmin().from('order_support_requests').select('id',{count:'exact',head:true}).eq('request_type','issue').in('status',['new','in_progress'])
    ]);
    if(!cancellations.error)counts.cancellationCount=cancellations.count||0;
    if(!issues.error)counts.issueCount=issues.count||0;
    return counts;
  }).then((value)=>{
    adminOverviewCountsCache.value=value;
    adminOverviewCountsCache.at=Date.now();
    return value;
  }).finally(()=>{if(adminOverviewCountsCache.promise===promise)adminOverviewCountsCache.promise=null;});
  adminOverviewCountsCache.key=key;
  adminOverviewCountsCache.promise=promise;
  return promise;
};
async function renderPromos(){
  const clearPromoStorefrontCache=()=>{try{sessionStorage.removeItem('beadStorePromosV1');}catch(error){}};
  const cloud=Boolean(window.beadSupabase);
  const readLocal=()=>{try{return JSON.parse(localStorage.getItem('beadDifferentPromos')||'[]');}catch(error){return[];}};
  const saveLocal=(promos)=>localStorage.setItem('beadDifferentPromos',JSON.stringify(promos));
  const loadCloud=async()=>{const result=await adminCachedRows('admin-promos',()=>cloudAdmin().from('promo_codes').select('id,title,code,discount_type,value,mode,active,starts_at,ends_at,show_homepage_banner,details,banner_text,banner_link,created_at').order('created_at',{ascending:false}).range(0,199));if(result.error)throw result.error;return result.data||[];};
  let promos=cloud?await loadCloud():readLocal();
  let editingIndex=null;
  const discountLabel=(promo)=>promo.mode==='banner'?'Banner only':promo.discount_type==='free_shipping'?'Free shipping':promo.discount_type==='percent'||promo.type==='percent'?`${Number(promo.value||0)}% off`:`$${Number(promo.value||0).toFixed(2)} off`;
  const endLabel=(value)=>{const date=new Date(value||'');return Number.isNaN(date.getTime())?'':date.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});};
  const dateTimeLabel=(value,emptyLabel)=>{const date=new Date(value||'');return Number.isNaN(date.getTime())?emptyLabel:date.toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});};
  const dateTimeLocalValue=(value)=>{const date=new Date(value||'');if(Number.isNaN(date.getTime()))return '';const pad=(number)=>String(number).padStart(2,'0');return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;};
  const draftBody=(promo)=>{const discount=promo.mode==='banner'?(promo.banner_text||'See the offer details on the homepage.'):discountLabel(promo);const end=endLabel(promo.ends_at);const access=promo.mode==='banner'?'See the offer details on the homepage.':promo.mode==='manual'&&promo.code?`Use code ${promo.code} at checkout.`:'Your discount will be applied automatically at checkout.';const extra=promo.details?`\n\nOffer details:\n${promo.details}`:'';const shopUrl=new URL('shop-all.html',window.location.href).href;return `${promo.title||'Special offer'} is now live!\n\n${discount}.${end?` This offer ends ${end}.`:''}${extra}\n\n${access}\n\nShop now: ${shopUrl}`;};
  const createEmailDraft=async(promo)=>{if(!cloud)throw new Error('Email drafts require the connected store database.');const {data:{user}}=await window.beadSupabase.auth.getUser();if(!user?.id)throw new Error('Your admin session has expired. Sign in again.');const result=await cloudAdmin().from('email_campaigns').insert({author_id:user.id,subject:`${promo.title||'Special offer'} — ${discountLabel(promo)}`,body:draftBody(promo),audience:'all_subscribers_optins',status:'draft'});if(result.error)throw result.error;};
  const draw=()=>{
    const selectedPromo=editingIndex===null?null:promos[editingIndex];
    const isEditing=Boolean(selectedPromo);
    panel.innerHTML=`<div class="admin-heading"><div><p class="kicker">MARKETING</p><h2>Promo codes</h2><p>Create automatic promotions or codes customers enter at checkout.</p></div></div><form class="admin-form promo-form"><h3>${isEditing?'Edit promo':'Add a promo'}</h3><div class="admin-form-grid"><label>Promotion title<input name="title" required placeholder="Fall Sale"></label><label>Code<input name="code" placeholder="WELCOME10"></label></div><div class="admin-form-grid"><label>Discount type<select name="discount_type"><option value="percent">Percent</option><option value="fixed">Fixed amount</option></select></label><label>Value<input name="value" type="number" min="0" step="0.01" required></label></div><div class="admin-form-grid"><label>Mode<select name="mode"><option value="manual">Customer enters code</option><option value="auto">Apply automatically</option></select></label><label>Starts<input name="starts_at" type="datetime-local"></label></div><div class="admin-form-grid"><label>Ends<input name="ends_at" type="datetime-local"></label></div><div class="promo-form-options"><label><span><input name="show_homepage_banner" type="checkbox"> Show a sale banner on the homepage</span></label><label><span><input name="create_email_draft" type="checkbox"> Prepare an email draft for all subscribers and member opt-ins</span></label></div><div class="promo-form-actions"><button class="cta" data-promo-submit>${isEditing?'Save promo changes':'Add promo'}</button>${isEditing?'<button type="button" data-cancel-promo-edit>Cancel edit</button>':''}</div><p data-promo-status role="status"></p></form><div class="admin-list promo-list">${promos.map((promo,index)=>`<article><div><strong>${adminSafe(promo.title||promo.code||'Promotion')} · ${adminSafe(discountLabel(promo))}</strong><span>${promo.code?`Code ${adminSafe(promo.code)} · `:''}${promo.mode==='auto'?'Automatic':'Code required'} · ${promo.active===false?'Inactive':'Active'} · Starts ${adminSafe(dateTimeLabel(promo.starts_at,'Immediately'))} · Ends ${adminSafe(dateTimeLabel(promo.ends_at,'No end date'))}${promo.show_homepage_banner?' · Homepage banner on':''}</span></div><div><button type="button" data-edit-promo="${index}">Edit</button><button type="button" data-prepare-promo-email="${index}">Prepare email</button><button type="button" data-toggle-promo="${index}">${promo.active===false?'Activate':'Deactivate'}</button><button type="button" data-toggle-promo-banner="${index}">${promo.show_homepage_banner?'Hide homepage banner':'Show homepage banner'}</button><button type="button" data-delete-promo="${index}">Delete</button><span class="promo-email-status" data-promo-email-status="${index}" role="status"></span></div></article>`).join('')||'<div class="admin-empty">No promo codes yet.</div>'}</div>`;
    const form=panel.querySelector('form');
    const modeSelect=form.elements.mode;
    modeSelect.insertAdjacentHTML('beforeend','<option value="banner">Banner announcement only</option>');
    form.elements.discount_type.insertAdjacentHTML('beforeend','<option value="free_shipping">Free shipping</option>');
    const bannerTextLabel=document.createElement('label');
    bannerTextLabel.textContent='Banner display text';
    const bannerTextInput=document.createElement('input');
    bannerTextInput.name='banner_text';bannerTextInput.maxLength=240;bannerTextInput.placeholder='10% off all Halloween merchandise.';
    bannerTextLabel.append(bannerTextInput);
    const detailsLabel=document.createElement('label');
    detailsLabel.textContent='Offer details (shown after clicking Offer Details)';
    const detailsInput=document.createElement('textarea');
    detailsInput.name='details';detailsInput.rows=5;detailsInput.maxLength=5000;detailsInput.placeholder='Cannot be combined with other discounts. Only applies to Halloween items.';
    detailsLabel.append(detailsInput);
    const bannerLinkLabel=document.createElement('label');
    bannerLinkLabel.textContent='Offer destination link (optional)';
    const bannerLinkInput=document.createElement('input');
    bannerLinkInput.name='banner_link';bannerLinkInput.type='text';bannerLinkInput.maxLength=500;bannerLinkInput.placeholder='sale.html, product.html?id=… or category.html?category=clearance';
    const saleCollectionShortcut=document.createElement('button');
    saleCollectionShortcut.type='button';saleCollectionShortcut.textContent='Use Sale Collection';
    saleCollectionShortcut.addEventListener('click',()=>{bannerLinkInput.value='sale.html';});
    bannerLinkLabel.append(bannerLinkInput,saleCollectionShortcut);
    form.querySelector('.promo-form-options')?.before(bannerTextLabel,detailsLabel,bannerLinkLabel);
    if(selectedPromo){
      form.elements.title.value=selectedPromo.title||'';
      form.elements.code.value=selectedPromo.code||'';
      form.elements.discount_type.value=selectedPromo.discount_type||selectedPromo.type||'percent';
      form.elements.value.value=Number(selectedPromo.value)||0;
      form.elements.mode.value=selectedPromo.mode||'manual';
      form.elements.starts_at.value=dateTimeLocalValue(selectedPromo.starts_at);
      form.elements.ends_at.value=dateTimeLocalValue(selectedPromo.ends_at);
      form.elements.show_homepage_banner.checked=selectedPromo.show_homepage_banner===true;
      bannerTextInput.value=selectedPromo.banner_text||'';
      detailsInput.value=selectedPromo.details||'';
      bannerLinkInput.value=selectedPromo.banner_link||'';
    }
    const syncPromoMode=()=>{const banner=modeSelect.value==='banner';const freeShipping=form.elements.discount_type.value==='free_shipping';const codeLabel=form.elements.code.closest('label');const discountTypeLabel=form.elements.discount_type.closest('label');const valueLabel=form.elements.value.closest('label');if(codeLabel)codeLabel.hidden=banner;if(discountTypeLabel)discountTypeLabel.hidden=banner;if(valueLabel)valueLabel.hidden=banner||freeShipping;form.elements.code.disabled=banner;form.elements.discount_type.disabled=banner;form.elements.value.disabled=banner||freeShipping;form.elements.value.required=!banner&&!freeShipping;if(banner||freeShipping)form.elements.value.value='0';bannerTextLabel.hidden=!banner&&!form.elements.show_homepage_banner.checked;};
    modeSelect.addEventListener('change',syncPromoMode);
    form.elements.show_homepage_banner.addEventListener('change',syncPromoMode);
    form.elements.discount_type.addEventListener('change',syncPromoMode);
    syncPromoMode();
    panel.querySelectorAll('.promo-list article').forEach((article,index)=>{const promo=promos[index];if(promo?.mode!=='banner')return;const meta=article.querySelector('span');if(meta)meta.textContent=meta.textContent.replace('Code required','Banner only');});
    form.addEventListener('submit',async(event)=>{
      event.preventDefault();
      const fields=Object.fromEntries(new FormData(form));
      const status=form.querySelector('[data-promo-status]');
      const title=String(fields.title||'').trim();
      const code=String(fields.code||'').trim().toUpperCase();
      const bannerOnly=fields.mode==='banner';
      const freeShipping=fields.discount_type==='free_shipping';
      const value=bannerOnly||freeShipping?0:Number(fields.value);
      const bannerText=String(fields.banner_text||'').trim();
      const details=String(fields.details||'').trim();
      const bannerLink=String(fields.banner_link||'').trim();
      if(!title||(!bannerOnly&&!freeShipping&&(!Number.isFinite(value)||value<0))){status.textContent=bannerOnly?'Enter a banner title.':'Enter a promotion title and a non-negative value.';return;}
      if(fields.mode==='manual'&&!code){status.textContent='Enter a code for a promotion customers enter at checkout.';return;}
      const existing=editingIndex===null?null:promos[editingIndex];
      const promo={...(existing||{}),title,code:bannerOnly?null:code||null,discount_type:bannerOnly?'percent':fields.discount_type,value,mode:fields.mode,starts_at:fields.starts_at?new Date(fields.starts_at).toISOString():null,ends_at:fields.ends_at?new Date(fields.ends_at).toISOString():null,show_homepage_banner:fields.show_homepage_banner==='on',banner_text:bannerText,details,banner_link:bannerLink};
      status.textContent='Saving promo…';
      try{
        let campaignError='';
        if(editingIndex!==null&&existing){
          if(cloud){
            const result=await cloudAdmin().from('promo_codes').update({title:promo.title,code:promo.code,discount_type:promo.discount_type,value:promo.value,mode:promo.mode,starts_at:promo.starts_at,ends_at:promo.ends_at,show_homepage_banner:promo.show_homepage_banner,banner_text:promo.banner_text,details:promo.details,banner_link:promo.banner_link}).eq('id',existing.id).select('id,title,code,discount_type,value,mode,active,starts_at,ends_at,show_homepage_banner,banner_text,details,banner_link,created_at').single();
            if(result.error)throw result.error;
            if(fields.create_email_draft==='on'){
              try{await createEmailDraft(result.data||promo);}catch(error){campaignError=error.message||'Unknown error.';}
            }
             clearAdminRowsCache();clearPromoStorefrontCache();
            promos=await loadCloud();
          }else{
            promos[editingIndex]=promo;
            saveLocal(promos);
            if(fields.create_email_draft==='on')campaignError='Email drafts require the connected store database.';
          }
        }else if(cloud){
          const result=await cloudAdmin().from('promo_codes').insert(promo).select('id,title,code,discount_type,value,mode,active,starts_at,ends_at,show_homepage_banner,banner_text,details,banner_link,created_at').single();
          if(result.error)throw result.error;
          if(fields.create_email_draft==='on'){
            try{
              const {data:{user}}=await window.beadSupabase.auth.getUser();
              if(!user?.id)throw new Error('Your admin session has expired. Sign in again.');
              const campaign=await cloudAdmin().from('email_campaigns').insert({author_id:user.id,subject:`${title} — ${discountLabel(promo)}`,body:draftBody(promo),audience:'all_subscribers_optins',status:'draft'});
              if(campaign.error)throw campaign.error;
            }catch(error){campaignError=error.message||'Unknown error.';}
          }
           clearAdminRowsCache();clearPromoStorefrontCache();
          promos=await loadCloud();
        }else{
          promos.push(promo);
          saveLocal(promos);
          if(fields.create_email_draft==='on')campaignError='Email drafts require the connected store database.';
        }
        clearPromoStorefrontCache();
        editingIndex=null;
        draw();
        if(campaignError)panel.querySelector('[data-promo-status]').textContent=`Promo saved, but the email draft was not created: ${campaignError}`;
      }catch(error){status.textContent=`Promo was not saved: ${error.message||'Unknown error.'}`;}
    });
    panel.querySelectorAll('[data-edit-promo]').forEach((button)=>button.addEventListener('click',()=>{editingIndex=Number(button.dataset.editPromo);draw();panel.querySelector('.promo-form')?.scrollIntoView({block:'start',behavior:'smooth'});panel.querySelector('[name="title"]')?.focus();}));
    panel.querySelector('[data-cancel-promo-edit]')?.addEventListener('click',()=>{editingIndex=null;draw();});
    panel.querySelectorAll('[data-prepare-promo-email]').forEach((button)=>button.addEventListener('click',async()=>{const promo=promos[Number(button.dataset.preparePromoEmail)];const status=button.parentElement.querySelector(`[data-promo-email-status="${button.dataset.preparePromoEmail}"]`);if(!promo||!status)return;button.disabled=true;status.textContent='Preparing…';try{await createEmailDraft(promo);status.textContent='Draft created. Review it in Email drafts.';}catch(error){status.textContent=`Draft was not created: ${error.message||'Unknown error.'}`;}finally{button.disabled=false;}}));
    panel.querySelectorAll('[data-toggle-promo]').forEach((button)=>button.addEventListener('click',async()=>{const promo=promos[Number(button.dataset.togglePromo)];if(!promo)return;const active=promo.active===false;if(cloud){const result=await cloudAdmin().from('promo_codes').update({active}).eq('id',promo.id);if(result.error){panel.querySelector('[data-promo-status]')?.replaceChildren(document.createTextNode(`Promo was not updated: ${result.error.message}`));return;}clearAdminRowsCache();clearPromoStorefrontCache();promos=await loadCloud();}else{promo.active=active;saveLocal(promos);clearPromoStorefrontCache();}editingIndex=null;draw();}));
    panel.querySelectorAll('[data-toggle-promo-banner]').forEach((button)=>button.addEventListener('click',async()=>{const promo=promos[Number(button.dataset.togglePromoBanner)];if(!promo)return;const show=promo.show_homepage_banner!==true;if(cloud){const result=await cloudAdmin().from('promo_codes').update({show_homepage_banner:show}).eq('id',promo.id);if(result.error){panel.querySelector('[data-promo-status]')?.replaceChildren(document.createTextNode(`Promo banner was not updated: ${result.error.message}`));return;}clearAdminRowsCache();clearPromoStorefrontCache();promos=await loadCloud();}else{promo.show_homepage_banner=show;saveLocal(promos);clearPromoStorefrontCache();}editingIndex=null;draw();}));
    panel.querySelectorAll('[data-delete-promo]').forEach((button)=>button.addEventListener('click',async()=>{const promo=promos[Number(button.dataset.deletePromo)];if(!promo)return;if(cloud){const result=await cloudAdmin().from('promo_codes').delete().eq('id',promo.id);if(result.error){panel.querySelector('[data-promo-status]')?.replaceChildren(document.createTextNode(`Promo was not deleted: ${result.error.message}`));return;}clearAdminRowsCache();clearPromoStorefrontCache();promos=await loadCloud();}else{promos.splice(Number(button.dataset.deletePromo),1);saveLocal(promos);clearPromoStorefrontCache();}editingIndex=null;draw();}));
  };
  const promoHourOptions=()=>Array.from({length:24},(_,hour)=>{const value=String(hour).padStart(2,'0');const label=(hour%12||12)+(hour<12?' AM':' PM');return '<option value="'+value+'">'+label+'</option>';}).join('');
  const promoScheduleParts=(value)=>{const date=new Date(value||'');if(Number.isNaN(date.getTime()))return{date:'',hour:''};const pad=(number)=>String(number).padStart(2,'0');return{date:date.getFullYear()+'-'+pad(date.getMonth()+1)+'-'+pad(date.getDate()),hour:pad(date.getHours())};};
  const installPromoScheduleFields=()=>{const form=panel.querySelector('.promo-form');if(!form||form.dataset.promoScheduleReady)return;['starts','ends'].forEach((prefix)=>{const hidden=form.elements[prefix+'_at'];const originalLabel=hidden?.closest('label');if(!hidden||!originalLabel)return;hidden.type='hidden';originalLabel.hidden=true;const label=prefix==='starts'?'Start':'End';const fields=document.createElement('div');fields.className='promo-schedule-fields';fields.dataset.promoSchedule=prefix;fields.innerHTML='<label>'+label+' day<input name="'+prefix+'_date" type="date"></label><label>'+label+' hour<select name="'+prefix+'_hour"><option value="">Choose hour</option>'+promoHourOptions()+'</select></label>';originalLabel.after(fields);const parts=promoScheduleParts(hidden.value);fields.querySelector('[name="'+prefix+'_date"]').value=parts.date;fields.querySelector('[name="'+prefix+'_hour"]').value=parts.hour;const sync=()=>{const date=fields.querySelector('[name="'+prefix+'_date"]').value;const hour=fields.querySelector('[name="'+prefix+'_hour"]').value;if(!date&&!hour){hidden.value='';return;}if(!date||hour===''){hidden.value='';return;}const local=new Date(date+'T'+hour+':00');hidden.value=Number.isNaN(local.getTime())?'':local.toISOString();};fields.querySelectorAll('input,select').forEach((field)=>field.addEventListener('change',sync));sync();});form.addEventListener('submit',(event)=>{const invalid=[...form.querySelectorAll('[data-promo-schedule]')].some((fields)=>{const date=fields.querySelector('input').value;const hour=fields.querySelector('select').value;return(date||hour)&&(!date||!hour);});if(invalid){event.preventDefault();form.querySelector('[data-promo-status]').textContent='Choose both a day and an hour, or leave both blank.';}},true);form.dataset.promoScheduleReady='true';};
  const promoScheduleObserver=new MutationObserver(installPromoScheduleFields);
  promoScheduleObserver.observe(panel,{childList:true,subtree:true});
  draw();
  installPromoScheduleFields();
}
const adminDataKey='beadDifferentAdminData';
const adminDataDefaults={categories:[],products:{},deletedProducts:[],reviews:[],members:[],orders:[],clicks:{},sold:{},cartAdds:{}};
const cloudAdmin=()=>window.beadSupabase;
let adminAuthorized=false;
let adminTabRenderGeneration=0;
let memberRenderSequence=0;
let reviewRenderSequence=0;
async function requireAdmin(){
  const shell=document.querySelector('.admin-shell');
  try{
    const client=await window.beadSupabaseReady;
    if(!client)throw new Error('The store database is unavailable.');
    const {data:{user}}=await client.auth.getUser();
    if(!user)throw new Error('Sign in required.');
    const {data:profile,error}=await client.from('profiles').select('role,status').eq('id',user.id).maybeSingle();
    if(error||profile?.role!=='admin'||profile?.status!=='active')throw new Error('Administrator access required.');
    // Store settings/theme hydration is independent of admin authorization.
    // Waiting for the storefront category + shipping requests here made every
    // direct editor route block before the editor could begin loading.
  }catch(error){
    if(shell)shell.hidden=true;
    const returnTarget=`${location.pathname.split('/').pop()||'admin.html'}${location.search}`;
    window.location.replace(`account.html?admin=required&return=${encodeURIComponent(returnTarget)}`);
    return;
  }
  adminAuthorized=true;
  document.body.classList.add('admin-authorized');
  if(shell){shell.hidden=false;shell.removeAttribute('aria-busy');}
  // Restock delivery is an admin-side maintenance action, not a 15-second
  // polling loop. Run it once after authorization; the next admin visit can
  // pick up any newly queued notifications without burning Supabase requests
  // while this tab sits open.
  // Keep this maintenance check off the critical editor-load path.
  window.setTimeout(()=>void dispatchRestockNotifications(),5000);
  try{
    document.querySelectorAll('[data-admin-tab]').forEach((button)=>button.addEventListener('click',()=>switchTab(button.dataset.adminTab)));
     const editorId=adminUrlParams.get('edit');
     if(editorId||adminUrlParams.get('new')==='item'){
       activeTab='items';
       void openCloudItemForm(editorId||undefined).catch(renderCloudError);
     }else switchTab(activeTab);
  }catch(error){
    panel.innerHTML=`<div class="admin-empty admin-load-error">Unable to load Store Control: ${adminSafe(error.message||'Unknown error.')}</div>`;
    console.error('Admin panel failed to initialize.',error);
  }
}
const adminData=()=>{try{return {...adminDataDefaults,...JSON.parse(localStorage.getItem(adminDataKey)||'{}')};}catch(error){return {...adminDataDefaults};}};
// Supabase is the canonical admin catalog. Do not replay the stale local catalog
// into it when saving unrelated settings/content; that was reverting product names.
const saveAdminData=(data)=>{localStorage.setItem(adminDataKey,JSON.stringify(data));};
const adminSafe=(value)=>String(value??'').replace(/[&<>"']/g,(character)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const adminNetAvailable=(record)=>Number(record?.quantity_on_hand||0)-Number(record?.reserve_quantity||0);
// Keep shipping addresses readable everywhere in admin. Supabase stores the
// address as an object, but object key order is not a mailing-label format.
const adminShippingAddressMarkup=(address,recipient='')=>{
  if(!address||typeof address!=='object')return adminSafe(String(address||'No shipping address'));
  const line1=address.address_line1||address.line1||address.address||'';
  const line2=address.address_line2||address.line2||'';
  const city=address.city||'';
  const state=address.state||address.region||'';
  const postal=address.postal_code||address.postalCode||address.zip||address.zip_code||'';
  const country=address.country||address.country_code||address.countryCode||'';
  const locality=[city,[state,postal].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [recipient,line1,line2,locality,country].filter((value)=>String(value||'').trim()).map((value)=>adminSafe(String(value))).join('<br>')||'No shipping address';
};
const adminSkuLink=(value,productId='')=>{const sku=String(value||'').trim();if(!sku)return'—';const target=productId&&!String(productId).startsWith('inventory-')?'admin.html?edit='+encodeURIComponent(productId):'admin.html?inventory=sku&sku='+encodeURIComponent(sku);return'<a class="admin-sku-link" href="'+target+'">'+adminSafe(sku)+'</a>';};
const adminMediaName=(url,displayName)=>String(displayName||'').trim()||String(url||'').split(/[\\/?#]/).pop()||'Media';
const normalizeAdminRichTextSource=(value)=>{let source=String(value??'').trim().replace(/^```(?:html)?\s*/i,'').replace(/\s*```$/,'').trim();if(/&lt;\/?[a-z][\s\S]*&gt;/i.test(source)){const decoder=document.createElement('textarea');decoder.innerHTML=source;const decoded=decoder.value;if(/<\/?[a-z][\s\S]*>/i.test(decoded))source=decoded;}return source;};
const adminRichText=(value)=>{const source=normalizeAdminRichTextSource(value);if(!source)return '';if(window.sanitizeRichText)return window.sanitizeRichText(source);if(!/[<][a-z][\s\S]*[>]/i.test(source))return adminSafe(source).replace(/\r?\n/g,'<br>');const template=document.createElement('template');template.innerHTML=source;template.content.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach((element)=>element.remove());return template.innerHTML;};
const initializeAdminRichEditor=(root)=>{const editor=root?.querySelector('[data-rich-editor]');const input=root?.querySelector('[data-rich-value]');if(!editor||!input||root.dataset.richEditorReady)return;root.dataset.richEditorReady='true';let savedRange=null;const rememberSelection=()=>{const selection=window.getSelection();if(selection?.rangeCount&&editor.contains(selection.anchorNode))savedRange=selection.getRangeAt(0).cloneRange();};const restoreSelection=()=>{if(!savedRange)return;const selection=window.getSelection();selection.removeAllRanges();selection.addRange(savedRange);};const sync=()=>{input.value=window.sanitizeRichText?window.sanitizeRichText(editor.innerHTML):editor.innerHTML;};const runCommand=(control)=>{restoreSelection();editor.focus();if(control.dataset.richCommand==='lineHeight'){editor.style.lineHeight=control.value;}else document.execCommand(control.dataset.richCommand,false,control.value||null);sync();};const insertPastedContent=(event)=>{event.preventDefault();const html=event.clipboardData?.getData('text/html')||'';let text=event.clipboardData?.getData('text/plain')||'';const normalized=normalizeAdminRichTextSource(text);const pastedHtml=html||(/[<][a-z][\s\S]*[>]/i.test(normalized)?normalized:'');restoreSelection();editor.focus();if(pastedHtml){const safeHtml=window.sanitizeRichText?window.sanitizeRichText(pastedHtml):pastedHtml;document.execCommand('insertHTML',false,safeHtml);}else document.execCommand('insertText',false,text);sync();};editor.addEventListener('paste',insertPastedContent);editor.addEventListener('mouseup',rememberSelection);editor.addEventListener('keyup',rememberSelection);editor.addEventListener('blur',rememberSelection);editor.addEventListener('input',()=>{rememberSelection();sync();});root.querySelectorAll('[data-rich-command]').forEach((control)=>{control.addEventListener('change',()=>runCommand(control));control.addEventListener('mousedown',(event)=>{if(control.tagName==='BUTTON')event.preventDefault();});control.addEventListener('click',()=>{if(control.tagName==='BUTTON')runCommand(control);});});sync();};
const installFeaturedRichEditorPersistence=()=>{const root=document.querySelector('.featured-rich-editor');const editor=root?.querySelector('[data-rich-editor]');const input=root?.querySelector('[data-rich-value]');if(!root||!editor||!input||root.dataset.featuredRichPersistence)return;root.dataset.featuredRichPersistence='true';const wrapper=editor.children.length===1?editor.firstElementChild:null;if(wrapper?.tagName==='DIV'&&wrapper.style.lineHeight){editor.style.lineHeight=wrapper.style.lineHeight;editor.innerHTML=wrapper.innerHTML;}if(!editor.style.lineHeight)editor.style.lineHeight='1.2';const sync=()=>{const content=window.sanitizeRichText?window.sanitizeRichText(editor.innerHTML):editor.innerHTML;input.value='<div style="line-height:'+editor.style.lineHeight+'">'+content+'</div>';};editor.addEventListener('input',sync);editor.addEventListener('keyup',sync);root.querySelectorAll('[data-rich-command]').forEach((control)=>{control.addEventListener('change',()=>window.setTimeout(sync,0));control.addEventListener('click',()=>window.setTimeout(sync,0));});sync();};const featuredRichEditorObserver=new MutationObserver(()=>installFeaturedRichEditorPersistence());featuredRichEditorObserver.observe(document.body,{childList:true,subtree:true});installFeaturedRichEditorPersistence();
const installFeaturedRichEditorSizeControl=()=>{const root=document.querySelector('.featured-rich-editor');const editor=root?.querySelector('[data-rich-editor]');const toolbar=root?.querySelector('.rich-toolbar');if(!root||!editor||!toolbar||root.dataset.featuredSizeControl)return;root.dataset.featuredSizeControl='true';const control=document.createElement('span');control.className='featured-font-size-control';control.innerHTML='<label>Text size <input type="number" min="10" max="48" step="1" value="16" aria-label="Featured text size in pixels"><button type="button">Apply</button></label>';toolbar.append(control);const sizeInput=control.querySelector('input');const applyButton=control.querySelector('button');let savedRange=null;const remember=()=>{const selection=window.getSelection();if(selection?.rangeCount&&editor.contains(selection.anchorNode))savedRange=selection.getRangeAt(0).cloneRange();};const apply=()=>{const size=Math.min(48,Math.max(10,Number(sizeInput.value)||16));if(!savedRange)return;const selection=window.getSelection();selection.removeAllRanges();selection.addRange(savedRange);const range=savedRange.cloneRange();const span=document.createElement('span');span.style.fontSize=size+'px';span.append(range.extractContents());range.insertNode(span);savedRange=null;editor.dispatchEvent(new Event('input',{bubbles:true}));};editor.addEventListener('mouseup',remember);editor.addEventListener('keyup',remember);editor.addEventListener('blur',remember);applyButton.addEventListener('mousedown',(event)=>event.preventDefault());applyButton.addEventListener('click',apply);sizeInput.addEventListener('keydown',(event)=>{if(event.key==='Enter'){event.preventDefault();apply();}});};const featuredRichEditorSizeObserver=new MutationObserver(()=>installFeaturedRichEditorSizeControl());featuredRichEditorSizeObserver.observe(document.body,{childList:true,subtree:true});installFeaturedRichEditorSizeControl();
 let restockDispatchPromise=null;
const reportRestockDispatchIssue=(message,retryFailed=false)=>{let notice=document.querySelector('[data-restock-dispatch-notice]');if(!notice){notice=document.createElement('div');notice.className='admin-saved admin-save-error';notice.dataset.restockDispatchNotice='';notice.setAttribute('role','alert');document.querySelector('.admin-content')?.prepend(notice);}if(!notice)return;notice.replaceChildren(document.createTextNode(message));if(retryFailed){const button=document.createElement('button');button.type='button';button.textContent='Retry failed restock emails';button.onclick=async()=>{button.disabled=true;try{const result=await window.beadSupabase.from('waitlist_restock_notifications').update({status:'pending',attempt_count:0,sent_at:null,last_error:'Manually requeued for delivery.'}).eq('status','failed').select('id');if(result.error){reportRestockDispatchIssue('Failed restock emails could not be requeued. Please try again.',true);return;}notice.remove();await dispatchRestockNotifications();}catch(error){reportRestockDispatchIssue('Failed restock emails could not be requeued. Please try again.',true);console.warn('Restock notification retry could not be queued.',error);}};notice.append(' ',button);}};
const dispatchRestockNotifications=async()=>{if(!adminAuthorized||!window.beadSupabase?.functions?.invoke||restockDispatchPromise)return restockDispatchPromise;restockDispatchPromise=(async()=>{const [pending,failed]=await Promise.all([window.beadSupabase.from('waitlist_restock_notifications').select('id',{count:'exact',head:true}).eq('status','pending'),window.beadSupabase.from('waitlist_restock_notifications').select('id',{count:'exact',head:true}).eq('status','failed')]);if(pending.error||failed.error){reportRestockDispatchIssue('Restock notifications could not be checked. Please refresh or contact support.');return;}if(Number(failed.count)>0)reportRestockDispatchIssue(`${Number(failed.count)} restock email${Number(failed.count)===1?'':'s'} failed permanently and need attention.`,true);if(!pending.count)return;try{const result=await window.beadSupabase.functions.invoke('send-restock-notifications');if(result.error){reportRestockDispatchIssue('Restock notifications could not be processed. Please try again.');console.warn('Restock notification delivery unavailable.',result.error);return;}const counts=result.data||{};if(Number(counts.failed)>0)reportRestockDispatchIssue(`${Number(counts.failed)} restock email${Number(counts.failed)===1?'':'s'} failed permanently and need attention.`,true);else if(!Number(failed.count))document.querySelector('[data-restock-dispatch-notice]')?.remove();}catch(error){reportRestockDispatchIssue('Restock notifications could not be processed. Please try again.');console.warn('Restock notification delivery unavailable.',error);}})().finally(()=>{restockDispatchPromise=null;});return restockDispatchPromise;};
const restockDispatchTimer=window.setInterval(()=>{if(document.visibilityState==='visible')void dispatchRestockNotifications();},300000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void dispatchRestockNotifications();});
const panel=document.querySelector('#admin-panel');
const adminUrlParams=new URLSearchParams(location.search);
let activeTab=adminUrlParams.has('etsy')?'etsy':(adminUrlParams.has('member')||adminUrlParams.has('customer'))?'members':adminUrlParams.has('inventory')?'inventory':(adminUrlParams.has('order')||adminUrlParams.has('orders'))?'orders':(adminUrlParams.has('review')||adminUrlParams.has('reviews'))?'reviews':(adminUrlParams.has('edit')||adminUrlParams.get('new')==='item'?'items':(localStorage.getItem('beadAdminActiveTab')||'overview'));
let selectedMemberId=new URLSearchParams(location.search).get('member')||'';
let selectedCustomerEmail=new URLSearchParams(location.search).get('customer')||'';
let memberCreatedAfter=null;let memberView='all';let memberPage=1;let orderView='unprocessed';let orderPage=1;const adminPageSize=25;let reviewView=adminUrlParams.has('review')?'all':adminUrlParams.get('reviews')||'new';let subscriberPage=1;let expensePage=1;
function adminCatalog(){const data=adminData();const base=typeof catalog==='undefined'?[]:catalog.filter((item)=>!data.deletedProducts.includes(item.id));const custom=Object.entries(data.products).filter(([id])=>!catalog.some((item)=>item.id===id)&&!data.deletedProducts.includes(id)).map(([id,product])=>({id,name:product.name||id,price:Number(product.price)||0,quantity:Number(product.quantity)||0,description:product.description||'',category:product.category||'uncategorized',image:(product.photos||'').split(/\s*[,\r\n]\s*/)[0]||'product-mix.jpg'}));return [...base,...custom];}
async function renderOverview(){
  const data=adminData();
  const localEntries=window.restockWaitlist?.entries()||[];
  const sinceDate=new Date();
  sinceDate.setMonth(sinceDate.getMonth()-1);
  const since=sinceDate.toISOString();
  let waitlistCount=localEntries.length;
  let activeOrders=Object.values(data.orders||{}).filter((order)=>['pending','paid','processing'].includes(order.status)).length;
  let newMembers=Object.values(data.members||{}).filter((member)=>!member.created_at||(member.created_at||member.createdAt)>=since).length;
  let newReviews=Object.values(data.reviews||{}).filter((review)=>review.status==='pending'||!review.status).length;
  let contactCount=0;
  let cancellationCount=0;
  let issueCount=0;
  const counts=await loadAdminOverviewCounts(since,{waitlistCount,activeOrders,newMembers,newReviews,contactCount,cancellationCount,issueCount});
  ({waitlistCount,activeOrders,newMembers,newReviews,contactCount,cancellationCount,issueCount}=counts);
  if(activeTab!=='overview')return;
  panel.innerHTML=`<div class="admin-heading"><div><p class="kicker">CONTROL CENTER</p><h2>Store overview</h2><p>Manage products, customer activity, reviews, and fulfillment from one place.</p></div></div><div class="admin-stat-grid"><button class="admin-stat-card" type="button" data-overview-target="waitlist"><b>${waitlistCount}</b><span>Restock requests</span></button><button class="admin-stat-card" type="button" data-overview-target="orders"><b>${activeOrders}</b><span>Active orders</span></button><button class="admin-stat-card" type="button" data-overview-target="members-new"><b>${newMembers}</b><span>New members (30 days)</span></button><button class="admin-stat-card" type="button" data-overview-target="reviews"><b>${newReviews}</b><span>New reviews</span></button><button class="admin-stat-card" type="button" data-overview-target="contacts"><b>${contactCount}</b><span>New contact messages</span></button><button class="admin-stat-card" type="button" data-overview-target="order-cancellations"><b>${cancellationCount}</b><span>Open order cancellations</span></button><button class="admin-stat-card" type="button" data-overview-target="order-issues"><b>${issueCount}</b><span>Open order issues</span></button></div>`;
const cancellationCard=panel.querySelector('[data-overview-target="order-cancellations"]');const issueCard=panel.querySelector('[data-overview-target="order-issues"]');if(cancellationCard){cancellationCard.dataset.overviewTarget='order-requests';cancellationCard.querySelector('b').textContent=String(cancellationCount+issueCount);cancellationCard.querySelector('span').textContent='Open Order Issues/Cancels';}if(issueCard)issueCard.remove();
  panel.querySelectorAll('[data-overview-target]').forEach((card)=>card.addEventListener('click',()=>{if(card.dataset.overviewTarget==='members-new'){memberView='new';memberCreatedAfter=since;memberPage=1;switchTab('members');return;}memberCreatedAfter=null;if(card.dataset.overviewTarget==='reviews')reviewView='new';switchTab(card.dataset.overviewTarget);}));
}
async function renderWaitlist(){
  const productCard=(productId,name,image,requester,requesterEmail,details,removeAttribute)=>{const href=productId?`product.html?id=${encodeURIComponent(productId)}`:'';const itemLink=href?new URL(href,window.location.href).href:'';const imageMarkup=image?(href?`<a class="admin-waitlist-image-link" href="${adminSafe(href)}" aria-label="Open ${adminSafe(name)}"><img class="admin-waitlist-image" src="${adminSafe(image)}" alt=""></a>`:`<img class="admin-waitlist-image" src="${adminSafe(image)}" alt="">`):'';const nameMarkup=href?`<a class="admin-waitlist-product-link" href="${adminSafe(href)}">${adminSafe(name)}</a>`:`<strong>${adminSafe(name)}</strong>`;const emailMarkup=requesterEmail?`<button type="button" class="admin-waitlist-email-link" data-admin-email data-email-to="${adminSafe(requesterEmail)}" data-email-name="${adminSafe(requester)}" data-email-subject="${adminSafe(`Regarding your waitlist request for ${name}`)}" data-email-link="${adminSafe(itemLink)}">Email</button>`:'';return `<article class="admin-waitlist-row"><div class="admin-waitlist-product-image">${imageMarkup}</div><div class="admin-waitlist-item-copy">${nameMarkup}</div><div class="admin-waitlist-requester-row"><span class="admin-waitlist-requester">${requester}</span></div><span class="admin-waitlist-details">${details}</span>${emailMarkup}<button type="button" data-remove-waitlist="${adminSafe(removeAttribute)}" data-remove-waitlist-name="${adminSafe(name)}">Remove</button></article>`;};
  if(!window.beadSupabase){
    const entries=window.restockWaitlist?.entries()||[];
    if(activeTab!=='waitlist')return;
    const localCatalog=typeof catalog==='undefined'?[]:adminCatalog();
    panel.innerHTML=`<div class="admin-heading"><div><p class="kicker">CUSTOMER DEMAND</p><h2>Waiting on a Restock</h2><p>Customers and quantities requested for products that need replenishment.</p></div></div><div class="admin-list">${entries.map((entry,index)=>{const product=localCatalog.find((item)=>item.id===entry.productId);const email=String(entry.accountEmail||'').trim();return productCard(product?.id||entry.productId,entry.productName||product?.name||'Product',product?.image||'',adminSafe(email||'Guest'),email,adminSafe(`${(entry.options||[]).join(' · ')}`),index);}).join('')||'<div class="admin-empty">No waitlist requests yet.</div>'}</div>`;
    panel.querySelectorAll('[data-remove-waitlist]').forEach((button)=>button.addEventListener('click',()=>{if(!window.confirm(`Remove the waitlist request for ${button.dataset.removeWaitlistName||'this product'}?`))return;const nextEntries=entries.slice();nextEntries.splice(Number(button.dataset.removeWaitlist),1);localStorage.setItem('beadDifferentRestockWaitlist',JSON.stringify(nextEntries));renderWaitlist();}));
    return;
  }
  const pageSize=25;
  const page=Math.max(1,Number(panel.dataset.waitlistPage||1));
  const result=await window.beadSupabase.from('waitlist_entries').select('id,requested_quantity,status,created_at,products(id,external_id,name,product_images(url,sort_order)),profiles(id,email,full_name)',{count:'exact'}).order('created_at',{ascending:false}).range((page-1)*pageSize,page*pageSize-1);
  if(result.error){if(activeTab==='waitlist')panel.innerHTML='<div class="admin-empty">Unable to load waitlist requests.</div>';return;}
  if(activeTab!=='waitlist')return;
  const entries=result.data||[];
  const pageCount=Math.max(1,Math.ceil((result.count||0)/pageSize));
  panel.dataset.waitlistPage=String(Math.min(page,pageCount));
  panel.innerHTML=`<div class="admin-heading"><div><p class="kicker">CUSTOMER DEMAND</p><h2>Waiting on a Restock</h2><p>Customers and quantities requested for products that need replenishment.</p></div></div><div class="admin-list">${entries.map((entry)=>{const product=entry.products||{};const image=(product.product_images||[]).slice().sort((left,right)=>(Number(left.sort_order)||0)-(Number(right.sort_order)||0))[0]?.url||'';const requesterEmail=String(entry.profiles?.email||'').trim();const requester=entry.profiles?.id?`<a class="admin-waitlist-requester-link" href="admin.html?member=${encodeURIComponent(entry.profiles.id)}">${adminSafe(entry.profiles.full_name||requesterEmail||'Registered member')}</a>`:adminSafe(requesterEmail||'Account');return productCard(product.external_id||product.id,product.name||'Product',image,requester,requesterEmail,`Qty ${Number(entry.requested_quantity)||0} · ${adminSafe(entry.status)}`,entry.id);}).join('')||'<div class="admin-empty">No waitlist requests yet.</div>'}</div><div class="admin-pagination"><button type="button" data-waitlist-page="prev" ${page<=1?'disabled':''}>Previous</button><span>Page ${page} of ${pageCount} · ${result.count||0} requests</span><button type="button" data-waitlist-page="next" ${page>=pageCount?'disabled':''}>Next</button></div>`;
  panel.querySelectorAll('[data-remove-waitlist]').forEach((button)=>button.addEventListener('click',async()=>{if(!window.confirm(`Remove the waitlist request for ${button.dataset.removeWaitlistName||'this product'}?`))return;const removeResult=await window.beadSupabase.from('waitlist_entries').delete().eq('id',button.dataset.removeWaitlist);if(removeResult.error){panel.querySelector('.admin-empty')?.replaceChildren(document.createTextNode('Unable to remove waitlist request.'));return;}renderWaitlist();}));
  panel.querySelectorAll('[data-waitlist-page]').forEach((button)=>button.addEventListener('click',()=>{panel.dataset.waitlistPage=String(Math.max(1,Math.min(pageCount,page+(button.dataset.waitlistPage==='next'?1:-1))));renderWaitlist();}));
}
let metricsRenderRequestId=0;
async function renderStats(){
  const requestId=++metricsRenderRequestId;
  const researchRequested=panel.dataset.metricsResearchRun==='true';
  const accountingRequested=panel.dataset.metricsAccountingRun==='true';
  if(activeTab==='stats'){
    panel.setAttribute('aria-busy','true');
    const report=panel.querySelector('#metrics-report');
    if(report)report.innerHTML='<div class="admin-empty" role="status">Loading metrics…</div>';
  }
  const csvEscape=(value)=>'"'+String(value??'').replace(/"/g,'""')+'"';
  const download=(rows,name)=>{const link=document.createElement('a');const url=URL.createObjectURL(new Blob([rows.map((row)=>row.map(csvEscape).join(',')).join('\n')],{type:'text/csv;charset=utf-8'}));link.href=url;link.download=name;link.click();URL.revokeObjectURL(url);};
  const researchPeriod=panel.dataset.researchMetricsPeriod||'month';
  const accountingPeriod=panel.dataset.accountingMetricsPeriod||'month';
  const selectedPeriod=researchPeriod;
  const end=new Date();
  const periodStart=(period)=>period==='week'?new Date(end.getTime()-7*24*60*60*1000):period==='year'?new Date(end.getFullYear(),0,1):period==='all'?null:new Date(end.getFullYear(),end.getMonth(),1);
  const start=periodStart(researchPeriod);
  const accountingStart=periodStart(accountingPeriod);
  const previousStart=start?new Date(start):null;
  const previousEnd=start?new Date(end):null;
  const accountingPreviousStart=accountingStart?new Date(accountingStart):null;
  const accountingPreviousEnd=accountingStart?new Date(end):null;
  if(previousStart)previousStart.setFullYear(previousStart.getFullYear()-1);
  if(previousEnd)previousEnd.setFullYear(previousEnd.getFullYear()-1);
  if(accountingPreviousStart)accountingPreviousStart.setFullYear(accountingPreviousStart.getFullYear()-1);
  if(accountingPreviousEnd)accountingPreviousEnd.setFullYear(accountingPreviousEnd.getFullYear()-1);
  const periodLabel=researchPeriod==='week'?'Last 7 days':researchPeriod==='year'?'This year':researchPeriod==='all'?'All time':'This month';
  const accountingPeriodLabel=accountingPeriod==='week'?'Last 7 days':accountingPeriod==='year'?'This year':accountingPeriod==='all'?'All time':'This month';
  const queryStarts=[start,previousStart].filter(Boolean);
  const queryStart=queryStarts.length?new Date(Math.min(...queryStarts.map((value)=>value.getTime()))):null;
  const inRange=(timestamp,rangeStart,rangeEnd)=>{const time=Date.parse(timestamp||'');return Number.isFinite(time)&&(!rangeStart||time>=rangeStart.getTime())&&(!rangeEnd||time<rangeEnd.getTime());};
  const money=(value)=>'$'+Number(value||0).toFixed(2);
  const percentage=(current,prior)=>{if(prior===null)return'—';if(!prior)return current?'New':'0%';return((current-prior)/prior*100).toFixed(1)+'%';};
  const filters=[
    {key:'views',label:'Most viewed products',direction:'desc'},
    {key:'views',label:'Least viewed products',direction:'asc'},
    {key:'searches',label:'Search terms',direction:'desc',type:'search'},
    {key:'cartAdds',label:'Most added to carts',direction:'desc'},
    {key:'cartAdds',label:'Least added to carts',direction:'asc'},
    {key:'unitsSold',label:'Most sold SKUs',direction:'desc'},
    {key:'unitsSold',label:'Least sold SKUs',direction:'asc'},
    {key:'revenue',label:'Highest revenue',direction:'desc'},
    {key:'netProfit',label:'Highest net profit',direction:'desc'},
    {key:'inventory',label:'Lowest inventory',direction:'asc'}
  ];
  const headers=['SKU','Product name','Category','Inventory','Unit type','Cost','Price','Preferred vendor','Product views','Search appearances','Cart additions','Units sold','Promo units sold','Revenue','Total cost','Marketplace fees','Net profit','YoY units %','YoY revenue %'];
  const selectedSku=(item)=>{if(item?.sku)return String(item.sku);const selected=item?.selected_options||item?.selectedOptions||{};const values=Array.isArray(selected)?selected:Object.values(selected||{});const found=values.find((value)=>value&&typeof value==='object'&&(value.sku||value.inventorySku||value.variantSku));return String(found?.sku||found?.inventorySku||found?.variantSku||'');};
  const buildRows=(products,optionGroups,inventoryRecords,events,priorEvents,orders,etsyLines,recipes,localData)=>{
    const productById=new Map(products.map((product)=>[product.id,product]));
    const inventoryBySku=new Map((inventoryRecords||[]).filter((record)=>record.sku).map((record)=>[String(record.sku).trim().toLowerCase(),record]));
    const inventoryById=new Map((inventoryRecords||[]).filter((record)=>record.id).map((record)=>[String(record.id),record]));
    const recipeParts=new Map();
    (recipes||[]).forEach((recipe)=>{const bundle=inventoryById.get(String(recipe.bundle_sku_id));const component=inventoryById.get(String(recipe.component_sku_id));if(!bundle?.sku||!component?.sku)return;const parts=recipeParts.get(String(bundle.sku))||[];parts.push({sku:String(component.sku),quantity:Math.max(1,Number(recipe.quantity)||1)});recipeParts.set(String(bundle.sku),parts);});
    const singleChildBySku=new Map();
    recipeParts.forEach((parts,bundleSku)=>{const unique=[...new Map(parts.map((part)=>[part.sku,part])).values()];if(unique.length===1)singleChildBySku.set(bundleSku,unique[0]);});
    const optionRows=[];
    (optionGroups||[]).forEach((group)=>{(group.product_option_values||[]).forEach((value)=>{const sku=String(value.inventory_sku||value.sku||'').trim();if(sku)optionRows.push({productId:group.product_id,sku,canonicalId:value.inventory_sku_id||null,label:value.label,priceDelta:Number(value.price_delta)||0,quantity:value.quantity,unitType:value.unit_type,inventoryUnits:Number(value.inventory_units)||1});});});
    const optionBySku=new Map();
    const placementsBySku=new Map();
    optionRows.forEach((value)=>{const key=value.sku.toLowerCase();if(!optionBySku.has(key))optionBySku.set(key,value);const placements=placementsBySku.get(key)||[];placements.push(value);placementsBySku.set(key,placements);});
    const eventWeight=(event)=>Math.max(1,Number(event?.event_count)||1);
    const eventCounts=(records,type)=>records.filter((event)=>event.event_type===type).reduce((counts,event)=>{if(event.product_id)counts[event.product_id]=(counts[event.product_id]||0)+eventWeight(event);return counts;},{});
    const skuEventCounts=(records)=>records.filter((event)=>event.event_type==='cart_add'&&event.inventory_sku_id).reduce((counts,event)=>{counts[event.inventory_sku_id]=(counts[event.inventory_sku_id]||0)+eventWeight(event);return counts;},{});
    const counts={views:eventCounts(events,'view'),searches:eventCounts(events,'search_result'),cartAdds:eventCounts(events,'cart_add')};
    const priorCounts={views:eventCounts(priorEvents,'view'),searches:eventCounts(priorEvents,'search_result'),cartAdds:eventCounts(priorEvents,'cart_add')};
    const skuCounts={cartAdds:skuEventCounts(events),priorCartAdds:skuEventCounts(priorEvents)};
    const rows=new Map();
    const ensure=(sku,product,option)=>{
      const requestedKey=String(sku||'').trim()||'Unassigned SKU';
      const inventory=inventoryBySku.get(requestedKey.toLowerCase());
      const key=String(inventory?.sku||requestedKey).trim();
      const placements=placementsBySku.get(key.toLowerCase())||[];
      const primaryPlacement=placements.find((placement)=>product?.id===placement.productId)||placements[0];
      if(rows.has(key)){
        const existing=rows.get(key);
        const displayProduct=product||productById.get(primaryPlacement?.productId)||null;
        const displayOption=option||primaryPlacement;
        if(displayProduct&&(!existing.productId||existing.productName==='Unknown SKU')){existing.productId=displayProduct.id||'';existing.productName=displayProduct.name||existing.productName;existing.category=displayProduct.category_slug||existing.category;}
        if(displayOption?.label&&(!existing.variant||existing.variant===inventory?.name))existing.variant=displayOption.label;
        return existing;
      }
      const placementProducts=[...new Map([...placements.map((placement)=>productById.get(placement.productId)),product].filter(Boolean).map((entry)=>[entry.id,entry])).values()];
      const linkedProductIds=[...new Set(placementProducts.map((entry)=>entry.id))];
      const viewCount=linkedProductIds.reduce((sum,productId)=>sum+Number(counts.views[productId]||0),0);
      const searchCount=linkedProductIds.reduce((sum,productId)=>sum+Number(counts.searches[productId]||0),0);
      const cartCount=linkedProductIds.reduce((sum,productId)=>sum+Number(counts.cartAdds[productId]||0),0);
      const priorViewCount=linkedProductIds.reduce((sum,productId)=>sum+Number(priorCounts.views[productId]||0),0);
      const priorSearchCount=linkedProductIds.reduce((sum,productId)=>sum+Number(priorCounts.searches[productId]||0),0);
      const priorCartCount=linkedProductIds.reduce((sum,productId)=>sum+Number(priorCounts.cartAdds[productId]||0),0);
      const displayProduct=product||productById.get(primaryPlacement?.productId)||null;
      const displayOption=option||primaryPlacement;
      const fallbackPrice=Number(displayProduct?.price)||0;
      const pageMetrics=Object.fromEntries(placementProducts.map((placement)=>[placement.id,{productId:placement.id,productName:placement.name||'Unknown product',category:placement.category_slug||'uncategorized',views:Number(counts.views[placement.id]||0),searches:Number(counts.searches[placement.id]||0),cartAdds:Number(counts.cartAdds[placement.id]||0),priorViews:Number(priorCounts.views[placement.id]||0),priorSearches:Number(priorCounts.searches[placement.id]||0),priorCartAdds:Number(priorCounts.cartAdds[placement.id]||0)}]));
      const row={sku:key,rollupSku:singleChildBySku.get(key)?.sku||key,rollupUnits:singleChildBySku.get(key)?.quantity||1,productId:displayProduct?.id||'',productName:inventory?.name||displayProduct?.name||'Unknown SKU'||'Unknown SKU',category:displayProduct?.category_slug||inventory?.category||'uncategorized',inventory:Number(inventory?.quantity_on_hand??displayOption?.quantity??displayProduct?.quantity)||0,unitType:inventory?.unit_type||displayOption?.unitType||'Each',cost:Number(inventory?.cost??displayProduct?.estimated_cost)||0,price:Number(inventory?.price??(fallbackPrice+(displayOption?.priceDelta||0)))||0,vendor:inventory?.preferred_vendor||'',views:viewCount,searches:searchCount,cartAdds:Number(skuCounts.cartAdds[inventory?.id]||0),priorViews:priorViewCount,priorSearches:priorSearchCount,priorCartAdds:Number(skuCounts.priorCartAdds[inventory?.id]||0),pageMetrics,placementCount:linkedProductIds.length,placementStatus:linkedProductIds.length?'Linked':'Orphaned',unitsSold:0,promoUnits:0,revenue:0,totalCost:0,marketplaceFees:0,priorUnitsSold:0,priorRevenue:0};
      rows.set(key,row);
      return row;
    };
    (inventoryRecords||[]).forEach((record)=>{if(record.sku)ensure(record.sku,null,optionBySku.get(String(record.sku).toLowerCase()));});
    optionRows.forEach((option)=>ensure(option.sku,productById.get(option.productId)||null,option));
    products.forEach((product)=>{const productOptions=optionRows.filter((option)=>option.productId===product.id);if(!productOptions.length)return;});
    (orders||[]).forEach((order)=>{
      const orderTime=Date.parse(order.created_at||'');
      const current=inRange(order.created_at,start,end);
      const prior=start&&inRange(order.created_at,previousStart,previousEnd);
      if(!current&&!prior)return;
      (order.order_items||[]).forEach((item)=>{
        const product=productById.get(item.product_id)||products.find((entry)=>entry.name===item.product_name);
        const selected=selectedSku(item);
        const productSku=String(product?.sku||'').trim();
        const sku=selected&&!selected.includes(',')?selected:(!productSku.includes(',')?productSku:'Unassigned SKU');
        const option=optionBySku.get(String(sku).toLowerCase());
        const row=ensure(sku,product,option);
        const quantity=Number(item.quantity)||0;
        const unitPrice=Number(item.unit_price)||0;
        const lineRevenue=unitPrice*quantity;
        if(current){row.unitsSold+=quantity;row.revenue+=lineRevenue;if(unitPrice<row.price-0.0001)row.promoUnits+=quantity;row.totalCost+=row.cost*quantity;}
        if(prior){row.priorUnitsSold+=quantity;row.priorRevenue+=lineRevenue;}
      });
    });
    const seenEtsyLines=new Set();
    (etsyLines||[]).forEach((line)=>{
      const sku=String(line.matched_inventory_sku||'').trim();
      if(!sku)return;
      const lineKey=String(line.external_order_id||'')+'|'+String(line.external_line_id||'');
      if(lineKey!=='|'&&seenEtsyLines.has(lineKey))return;
      if(lineKey!=='|')seenEtsyLines.add(lineKey);
      const current=inRange(line.sale_date,start,end);
      const prior=start&&inRange(line.sale_date,previousStart,previousEnd);
      if(!current&&!prior)return;
      const product=products.find((entry)=>entry.sku===sku)||null;
      const option=optionBySku.get(sku.toLowerCase());
      const row=ensure(sku,product,option);
      const quantity=Number(line.quantity)||0;
      const revenue=Number(line.gross_revenue)||0;
      const unitCost=Number(line.unit_cost??row.cost)||0;
      if(current){row.unitsSold+=quantity;row.revenue+=revenue;if(Number(line.discount_amount)>0)row.promoUnits+=quantity;row.totalCost+=unitCost*quantity;row.marketplaceFees+=Number(line.marketplace_fees)||0;}
      if(prior){row.priorUnitsSold+=quantity;row.priorRevenue+=revenue;}
    });
    return [...rows.values()].map((row)=>{row.netProfit=row.revenue-row.totalCost-row.marketplaceFees;row.yoyUnits=percentage(row.unitsSold,start?row.priorUnitsSold:null);row.yoyRevenue=percentage(row.revenue,start?row.priorRevenue:null);return row;});
  };
  const rollupRowsToChildren=(source)=>{
    const bySku=new Map(source.map((row)=>[String(row.sku),row]));
    const groups=new Map();
    source.forEach((row)=>{
      const childSku=String(row.rollupSku||row.sku);
      const base=bySku.get(childSku)||row;
      const group=groups.get(childSku)||{...base,sku:childSku,variant:base===row?base.variant:'Combined pack sales',unitsSold:0,promoUnits:0,revenue:0,totalCost:0,marketplaceFees:0,priorUnitsSold:0,priorRevenue:0};
      group.unitsSold+=Number(row.unitsSold||0)*(Number(row.rollupUnits)||1);
      group.promoUnits+=Number(row.promoUnits||0)*(Number(row.rollupUnits)||1);
      group.revenue+=Number(row.revenue||0);
      group.totalCost+=Number(row.totalCost||0);
      group.marketplaceFees+=Number(row.marketplaceFees||0);
      group.priorUnitsSold+=Number(row.priorUnitsSold||0)*(Number(row.rollupUnits)||1);
      group.priorRevenue+=Number(row.priorRevenue||0);
      group.netProfit=group.revenue-group.totalCost-group.marketplaceFees;
      group.yoyUnits=percentage(group.unitsSold,start?group.priorUnitsSold:null);
      group.yoyRevenue=percentage(group.revenue,start?group.priorRevenue:null);
      groups.set(childSku,group);
    });
    return [...groups.values()];
  };
  const buildSearchTerms=(events,priorEvents)=>{const terms=new Map();const add=(records,key)=>{records.filter((event)=>event.event_type==='search'&&String(event.search_term||'').trim()).forEach((event)=>{const term=String(event.search_term).trim();const row=terms.get(term)||{term,searches:0,priorSearches:0,latestSearch:event.latest_created_at||event.created_at};row[key]+=Math.max(1,Number(event.event_count)||1);const latest=event.latest_created_at||event.created_at;if(Date.parse(latest||'')>Date.parse(row.latestSearch||''))row.latestSearch=latest;terms.set(term,row);});};add(events,'searches');add(priorEvents,'priorSearches');return [...terms.values()].map((row)=>({...row,yoySearches:percentage(row.searches,start?row.priorSearches:null)}));};
   const buildAccountingRows=(websiteOrders,etsyLines,adjustments,purchases,inventoryRecords,etsySummary,websiteSummary,ledgerSummary)=>{
     const start=accountingStart;
     const end=new Date();
     const previousStart=accountingPreviousStart;
     const previousEnd=accountingPreviousEnd;
     const metricKeys=['orders','unitsSold','returnedUnits','grossSales','discounts','refunds','netSales','shippingCollected','cogs','shrinkage','marketplaceFees','taxCollected','inventoryPurchases','netProfit','promoUnits'];
     const empty=(channel)=>{const row={channel};metricKeys.forEach((key)=>{row[key]=0;row['prior'+key[0].toUpperCase()+key.slice(1)]=0;});return row;};
     const website=empty('Website');const etsy=empty('Etsy');const ledger=empty('Inventory ledger');const inventoryBySku=new Map((inventoryRecords||[]).map((record)=>[String(record.sku||'').trim().toLowerCase(),record]));
     const costForSku=(sku)=>Number(inventoryBySku.get(String(sku||'').trim().toLowerCase())?.cost)||0;
     const add=(row,key,value,prior)=>{const numeric=Number(value)||0;row[key]+=numeric;if(prior)row['prior'+key[0].toUpperCase()+key.slice(1)]+=numeric;};
     const orderKeys=new Set();
     const applyWebsiteSummary=(summary,prior)=>{if(!summary)return;add(website,'orders',Number(summary.order_count)||0,prior);add(website,'unitsSold',Number(summary.units_sold)||0,prior);add(website,'returnedUnits',Number(summary.returned_units)||0,prior);add(website,'grossSales',Number(summary.gross_sales)||0,prior);add(website,'discounts',Number(summary.discounts)||0,prior);add(website,'refunds',Number(summary.refunds)||0,prior);add(website,'shippingCollected',Number(summary.shipping_collected)||0,prior);add(website,'taxCollected',Number(summary.tax_collected)||0,prior);add(website,'cogs',Number(summary.cogs)||0,prior);add(website,'promoUnits',Number(summary.promo_units)||0,prior);};
     if(websiteSummary){applyWebsiteSummary(websiteSummary.current,false);applyWebsiteSummary(websiteSummary.prior,true);}else (websiteOrders||[]).forEach((order)=>{const current=inRange(order.created_at,start,end);const prior=Boolean(start&&inRange(order.created_at,previousStart,previousEnd));if(!current&&!prior)return;const status=String(order.status||'').toLowerCase();const paymentStatus=String(order.payment_status||(['paid','processing','shipped','completed'].includes(status)?'paid':'')).toLowerCase();const sale=['paid','partially_refunded','refunded'].includes(paymentStatus);if(!sale)return;const items=order.order_items||[];const returnedUnits=items.reduce((total,item)=>total+Math.min(Number(item.quantity)||0,Number(item.refunded_quantity)||0),0);const lineGross=items.reduce((total,item)=>total+(Number(item.unit_price)||0)*(Number(item.quantity)||0),0);const lineCogs=items.reduce((total,item)=>{const sku=selectedSku(item)||item.sku||'';const remaining=Math.max(0,(Number(item.quantity)||0)-(Number(item.refunded_quantity)||0));return total+(Number(item.cost_at_purchase??costForSku(sku))||0)*remaining;},0);const units=items.reduce((total,item)=>total+Math.max(0,(Number(item.quantity)||0)-(Number(item.refunded_quantity)||0)),0);const promoUnits=items.reduce((total,item)=>total+(item.promo_applied?Math.max(0,(Number(item.quantity)||0)-(Number(item.refunded_quantity)||0)):0),0);const refundAmount=Math.max(0,Number(order.refunded_amount)||0);const taxAmount=Math.max(0,Number(order.tax_amount)||0);const taxRefunded=Number(order.total)>0?taxAmount*Math.min(1,refundAmount/Number(order.total)):0;const shippingRefunded=Math.min(Math.max(0,Number(order.shipping_amount)||0),Math.max(0,Number(order.refunded_shipping_amount)||0));const orderKey='website|'+String(order.id||order.created_at);if(!orderKeys.has(orderKey)){add(website,'orders',1,prior);orderKeys.add(orderKey);}add(website,'returnedUnits',returnedUnits,prior);add(website,'refunds',Math.max(0,refundAmount-taxRefunded-shippingRefunded),prior);add(website,'unitsSold',units,prior);add(website,'grossSales',lineGross,prior);add(website,'discounts',Number(order.discount)||0,prior);add(website,'shippingCollected',Math.max(0,(Number(order.shipping_amount)||0)-shippingRefunded),prior);add(website,'taxCollected',Math.max(0,taxAmount-taxRefunded),prior);add(website,'cogs',lineCogs,prior);add(website,'promoUnits',promoUnits,prior);});
     const etsyOrderKeys=new Set();
     (etsyLines||[]).forEach((line)=>{const current=inRange(line.sale_date,start,end);const prior=Boolean(start&&inRange(line.sale_date,previousStart,previousEnd));if(!current&&!prior)return;const status=String(line.status||'').toLowerCase();const quantity=Number(line.quantity)||0;const refundedQuantity=Math.min(quantity,Math.max(0,Number(line.refunded_quantity)||0));const returnedRefund=Number(line.refund_amount)||((['cancelled','refunded','returned'].includes(status)&&quantity>0)?(Number(line.gross_revenue)||0)*(refundedQuantity/quantity||1):0);const desiredUnits=Math.max(0,quantity-refundedQuantity);const sale=quantity>0||Number(line.gross_revenue)||0;const orderKey='etsy|'+String(line.external_order_id||line.id||line.sale_date);if(sale&&!['cancelled','refunded','returned'].includes(status)&&!etsyOrderKeys.has(orderKey)){add(etsy,'orders',1,prior);etsyOrderKeys.add(orderKey);}add(etsy,'unitsSold',desiredUnits,prior);add(etsy,'returnedUnits',refundedQuantity,prior);add(etsy,'grossSales',Number(line.gross_revenue)||0,prior);add(etsy,'discounts',Number(line.discount_amount)||0,prior);add(etsy,'refunds',returnedRefund,prior);add(etsy,'shippingCollected',Number(line.shipping_revenue)||0,prior);add(etsy,'marketplaceFees',Number(line.marketplace_fees)||0,prior);add(etsy,'taxCollected',Number(line.sales_tax)||0,prior);const lineCost=Number(line.unit_cost??costForSku(line.matched_inventory_sku))||0;add(etsy,'cogs',lineCost*(Number(line.inventory_units_applied)||desiredUnits),prior);});
     const applyEtsySummary=(summary,prior)=>{if(!summary)return;add(etsy,'orders',Number(summary.order_count)||0,prior);add(etsy,'unitsSold',Number(summary.units_sold)||0,prior);add(etsy,'returnedUnits',Number(summary.returned_units)||0,prior);add(etsy,'grossSales',Number(summary.gross_sales)||0,prior);add(etsy,'discounts',Number(summary.discounts)||0,prior);add(etsy,'refunds',Number(summary.refunds)||0,prior);add(etsy,'shippingCollected',Number(summary.shipping_collected)||0,prior);add(etsy,'marketplaceFees',Number(summary.marketplace_fees)||0,prior);add(etsy,'taxCollected',Number(summary.tax_collected)||0,prior);add(etsy,'cogs',Number(summary.cogs)||0,prior);};
     applyEtsySummary(etsySummary?.current,false);applyEtsySummary(etsySummary?.prior,true);
     if(ledgerSummary){add(ledger,'shrinkage',Number(ledgerSummary.current?.shrinkage)||0,false);add(ledger,'inventoryPurchases',Number(ledgerSummary.current?.inventory_purchases)||0,false);add(ledger,'shrinkage',Number(ledgerSummary.prior?.shrinkage)||0,true);add(ledger,'inventoryPurchases',Number(ledgerSummary.prior?.inventory_purchases)||0,true);}else{(adjustments||[]).forEach((adjustment)=>{if(!['audit_shrink','manual'].includes(adjustment.adjustment_type)||Number(adjustment.quantity_delta)>=0)return;const current=inRange(adjustment.created_at,start,end);const prior=Boolean(start&&inRange(adjustment.created_at,previousStart,previousEnd));if(!current&&!prior)return;add(ledger,'shrinkage',Number(adjustment.cost_impact)||Math.abs(Number(adjustment.quantity_delta)||0)*costForSku(adjustment.inventory_sku),prior);});(purchases||[]).forEach((purchase)=>{const current=inRange(purchase.purchase_date,start,end);const prior=Boolean(start&&inRange(purchase.purchase_date,previousStart,previousEnd));if(!current&&!prior)return;add(ledger,'inventoryPurchases',Number(purchase.total_cost)||0,prior);});}
     const finalize=(row)=>{row.netSales=row.grossSales-row.discounts-row.refunds;row.priorNetSales=row.priorGrossSales-row.priorDiscounts-row.priorRefunds;row.netProfit=row.netSales+row.shippingCollected-row.cogs-row.marketplaceFees-row.shrinkage;row.priorNetProfit=row.priorNetSales+row.priorShippingCollected-row.priorCogs-row.priorMarketplaceFees-row.priorShrinkage;row.salesYoy=percentage(row.netSales,start?row.priorNetSales:null);row.cogsYoy=percentage(row.cogs,start?row.priorCogs:null);row.netProfitYoy=percentage(row.netProfit,start?row.priorNetProfit:null);return row;};
     const combined=empty('Combined');metricKeys.forEach((key)=>{combined[key]=website[key]+etsy[key];combined['prior'+key[0].toUpperCase()+key.slice(1)]=website['prior'+key[0].toUpperCase()+key.slice(1)]+etsy['prior'+key[0].toUpperCase()+key.slice(1)];});combined.shrinkage=ledger.shrinkage;combined.priorShrinkage=ledger.priorShrinkage;combined.inventoryPurchases=ledger.inventoryPurchases;combined.priorInventoryPurchases=ledger.priorInventoryPurchases;return [finalize(website),finalize(etsy),finalize(combined)];
   };
  let rows=[];
  let searchTermRows=[];
  let accountingRows=[];
  let expenseRows=[];
  let metricWarnings=[];
  let expenseSummary=null;
  try{
    if(window.beadSupabase){
       // Metrics uses the server aggregate and never falls back to downloading raw order rows.
       const researchSalesMetricsQuery=(rangeStart,rangeEnd)=>adminCachedReportRows(rpcCacheKey('website-research-sales',rangeStart,rangeEnd),()=>window.beadSupabase.rpc('admin_website_research_sales_metrics',rpcArgs(rangeStart,rangeEnd)));
       const rpcArgs=(rangeStart,rangeEnd)=>({p_start:rangeStart?rangeStart.toISOString():null,p_end:rangeEnd?rangeEnd.toISOString():null});
       const eventMetricsQuery=(rangeStart,rangeEnd)=>adminCachedReportRows(rpcCacheKey('analytics-events',rangeStart,rangeEnd),()=>window.beadSupabase.rpc('admin_analytics_event_metrics',rpcArgs(rangeStart,rangeEnd)));
       const rpcCacheKey=(name,rangeStart,rangeEnd)=>['stats-rpc',name,rangeStart?.toISOString()||'all',rangeEnd?.toISOString().slice(0,10)||'now'].join(':');
       const etsySkuMetricsQuery=(rangeStart,rangeEnd)=>adminCachedReportRows(rpcCacheKey('etsy-sku-metrics',rangeStart,rangeEnd),()=>window.beadSupabase.rpc('admin_etsy_sku_metrics',rpcArgs(rangeStart,rangeEnd)));
       const etsyAccountingQuery=(rangeStart,rangeEnd)=>adminCachedReportRows(rpcCacheKey('etsy-accounting',rangeStart,rangeEnd),()=>window.beadSupabase.rpc('admin_etsy_accounting_totals',rpcArgs(rangeStart,rangeEnd)));
       const websiteAccountingQuery=(rangeStart,rangeEnd)=>adminCachedReportRows(rpcCacheKey('website-accounting',rangeStart,rangeEnd),()=>window.beadSupabase.rpc('admin_website_accounting_totals',rpcArgs(rangeStart,rangeEnd)));
       const ledgerSummaryQuery=(rangeStart,rangeEnd)=>adminCachedReportRows(rpcCacheKey('ledger-summary',rangeStart,rangeEnd),()=>window.beadSupabase.rpc('admin_inventory_ledger_summary',rpcArgs(rangeStart,rangeEnd)));
       const summaryLines=(result,rangeEnd,scope)=> (result?.data||[]).map((row)=>{const units=Number(row.units_sold)||0;const unitCost=units?Number(row.total_cost||0)/units:0;return {external_order_id:'etsy-summary-'+scope+'-'+String(row.sku||''),external_line_id:'etsy-summary-line-'+scope+'-'+String(row.sku||''),etsy_sku:row.sku,matched_inventory_sku:row.sku,sale_date:new Date((rangeEnd||end).getTime()-1).toISOString(),status:'paid',quantity:units,refunded_quantity:0,gross_revenue:Number(row.gross_revenue)||0,discount_amount:Number(row.discounts)||0,refund_amount:Number(row.refunds)||0,shipping_revenue:0,sales_tax:0,marketplace_fees:Number(row.etsy_fees)||0,unit_cost:unitCost,inventory_units_applied:units};});
       const emptyMetricsResult={data:[],error:null};
       // Metrics needs product/option placements for the paginated research
       // report, not the entire canonical inventory table. Accounting totals
       // come from server aggregates, and option quantities/costs remain the
       // report fallback. Keeping inventory out of this request avoids a
       // 6k+ row timeout when switching between Metrics and Inventory.
       const [etsyAccountingResult,etsyPriorAccountingResult,etsySkuResult,etsyPriorSkuResult,catalogSnapshotResult,eventResult,priorEventResult,researchSalesResult,websiteAccountingResult,websitePriorAccountingResult,ledgerResult,priorLedgerResult]=await Promise.all([
         accountingRequested?etsyAccountingQuery(accountingStart,end):emptyMetricsResult,
         accountingRequested&&accountingStart?etsyAccountingQuery(accountingPreviousStart,accountingPreviousEnd):emptyMetricsResult,
         researchRequested?etsySkuMetricsQuery(start,end):emptyMetricsResult,
         researchRequested&&start?etsySkuMetricsQuery(previousStart,previousEnd):emptyMetricsResult,
         researchRequested?adminCatalogSnapshot('stats:catalog-snapshot',true,true,true,false,false,true,true):Promise.resolve({data:{products:[],options:[],recipes:[],inventory:[],mappings:[],mapping_components:[]},error:null}),
         researchRequested?eventMetricsQuery(start,end):emptyMetricsResult,
         researchRequested&&start?eventMetricsQuery(previousStart,previousEnd):emptyMetricsResult,
         researchRequested?researchSalesMetricsQuery(queryStart,end):emptyMetricsResult,
         accountingRequested?websiteAccountingQuery(accountingStart,end):emptyMetricsResult,
         accountingRequested&&accountingStart?websiteAccountingQuery(accountingPreviousStart,accountingPreviousEnd):emptyMetricsResult,
         accountingRequested?ledgerSummaryQuery(accountingStart,end):emptyMetricsResult,
         accountingRequested&&accountingStart?ledgerSummaryQuery(accountingPreviousStart,accountingPreviousEnd):emptyMetricsResult
       ]);
       if(requestId!==metricsRenderRequestId||activeTab!=='stats')return;
       const catalogSnapshot=adminCatalogSnapshotParts(catalogSnapshotResult);
       const productResult={data:catalogSnapshot.products,error:catalogSnapshot.error};
       const optionResult={data:catalogSnapshot.options,error:catalogSnapshot.error};
       const inventoryResult={data:catalogSnapshot.inventory,error:catalogSnapshot.error};
       const recipeResult={data:catalogSnapshot.recipes,error:catalogSnapshot.error};
       const metricFailures=[['catalog snapshot',catalogSnapshotResult],['analytics',eventResult],['prior analytics',priorEventResult],['research sales summary',researchSalesResult],['website accounting totals',websiteAccountingResult],['prior website accounting totals',websitePriorAccountingResult],['Etsy SKU metrics',etsySkuResult],['prior Etsy SKU metrics',etsyPriorSkuResult],['Etsy accounting totals',etsyAccountingResult],['prior Etsy accounting totals',etsyPriorAccountingResult],['inventory ledger summary',ledgerResult],['prior inventory ledger summary',priorLedgerResult]].filter(([,result])=>result?.error);metricWarnings=metricFailures.map(([source,result])=>({source,message:result.error.message||'database request failed'}));
       let accountingOrderRows=[];
       let adjustmentRows=[];
       let purchaseRows=[];
       let expenseFallbackRows=[];
       let ledgerSummary=null;
       let websiteAccountingSummary=null;
       let eventsForReport=eventResult.data||[];
       let priorEventsForReport=priorEventResult.data||[];
       const clearMetricWarning=(source)=>{metricWarnings=metricWarnings.filter((warning)=>warning.source!==source);};
       if(eventResult.error)metricWarnings=metricWarnings.map((warning)=>warning.source==='analytics'?{...warning,message:'The server aggregate is unavailable; no raw analytics download was attempted.'}:warning);
       if(priorEventResult.error)metricWarnings=metricWarnings.map((warning)=>warning.source==='prior analytics'?{...warning,message:'The server aggregate is unavailable; no raw analytics download was attempted.'}:warning);
       if(!websiteAccountingResult.error&&!websitePriorAccountingResult.error){
         websiteAccountingSummary={current:(websiteAccountingResult.data||[])[0]||null,prior:(websitePriorAccountingResult.data||[])[0]||null};
       }else{
         metricWarnings=metricWarnings.map((warning)=>warning.source==='website accounting totals'?{...warning,message:'The server aggregate is unavailable; no raw order download was attempted.'}:warning);
       }
       if(!ledgerResult.error&&(!accountingStart||!priorLedgerResult.error)){
         ledgerSummary={current:(ledgerResult.data||[])[0]||null,prior:(priorLedgerResult.data||[])[0]||null};
         clearMetricWarning('inventory ledger summary');clearMetricWarning('prior inventory ledger summary');
         expenseSummary=ledgerSummary;
       }else{
         metricWarnings=metricWarnings.map((warning)=>warning.source==='inventory ledger summary'?{...warning,message:'The server aggregate is unavailable; no raw adjustment, purchase, or expense download was attempted.'}:warning);
         expenseSummary=null;
       }
       const etsyResearchLines=[...summaryLines(etsySkuResult,end,'current'),...summaryLines(etsyPriorSkuResult,previousEnd,'prior')];
       const etsyAccountingSummary={current:(etsyAccountingResult.data||[])[0]||null,prior:(etsyPriorAccountingResult.data||[])[0]||null};
       let researchOrderRows=[];
       if(researchSalesResult.error){
         metricWarnings=metricWarnings.map((warning)=>warning.source==='research sales summary'?{...warning,message:'The server aggregate is unavailable; no raw order/order-item download was attempted.'}:warning);
       }else{
         researchOrderRows=(researchSalesResult.data||[]).map((line,index)=>({id:'research-summary-'+index,created_at:line.sale_date,status:'paid',order_items:[{product_id:line.product_id,product_name:line.product_name,sku:line.sku,quantity:line.quantity,unit_price:line.unit_price}]}));
       }
       rows=buildRows(productResult.data||[],optionResult.data||[],inventoryResult.data||[],eventsForReport,priorEventsForReport,researchOrderRows,etsyResearchLines,recipeResult.data||[],null);
       searchTermRows=buildSearchTerms(eventsForReport,priorEventsForReport);
        accountingRows=buildAccountingRows(accountingOrderRows,[],adjustmentRows,purchaseRows,inventoryResult.data||[],etsyAccountingSummary,websiteAccountingSummary,ledgerSummary);expenseRows=expenseFallbackRows;
    }else{
      const data=adminData();
      const products=adminCatalog().map((product)=>({id:product.id,sku:product.sku||product.id,name:product.name,category_slug:product.category||'uncategorized',price:Number(product.price)||0,quantity:Number(product.quantity)||0,estimated_cost:Number(product.estimatedCost)||0}));
      const localRows=products.map((product)=>{const row={...product,productName:product.name,variant:'',inventory:product.quantity,unitType:product.unitType||'Each',cost:product.estimated_cost||0,price:product.price,vendor:product.preferredVendor||'',views:Number(data.clicks?.[product.id]||0),searches:0,cartAdds:Number(data.cartAdds?.[product.id]||0),priorViews:0,priorSearches:0,priorCartAdds:0,unitsSold:Number(data.sold?.[product.id]||0),promoUnits:0,revenue:Number(data.sold?.[product.id]||0)*product.price,totalCost:Number(data.sold?.[product.id]||0)*product.estimated_cost||0,priorUnitsSold:0,priorRevenue:0};row.netProfit=row.revenue-row.totalCost;row.yoyUnits='—';row.yoyRevenue='—';return row;});
       rows=localRows;
       searchTermRows=[];
       accountingRows=buildAccountingRows(Object.values(data.orders||{}),[],[],[],[]);expenseRows=[];
    }
  }catch(error){if(requestId!==metricsRenderRequestId||activeTab!=='stats')return;panel.innerHTML='<div class="admin-empty">'+adminSafe(error.message||'Unable to load store metrics.')+'</div>';return;}if(requestId!==metricsRenderRequestId||activeTab!=='stats')return;const expenseTotal=expenseSummary?Number(expenseSummary.current?.business_expenses)||0:expenseRows.filter((expense)=>expenseDateInPeriod(expense.expense_date,accountingPeriod)).reduce((sum,expense)=>sum+Number(expense.amount||0),0);accountingRows=accountingRows.map((row)=>({...row,businessExpenses:row.channel==='Combined'?expenseTotal:0,netProfitAfterExpenses:row.netProfit-(row.channel==='Combined'?expenseTotal:0)}));
  if(requestId!==metricsRenderRequestId||activeTab!=='stats')return;
  let selectedFilter=Number(panel.dataset.metricsSelectedFilter||0);
  const filterButtons=filters.map((filter,index)=>'<button type="button" class="'+(index===selectedFilter?'active':'')+'" data-metrics-filter="'+index+'">'+filter.label+'</button>').join('');
   const warningMarkup=metricWarnings.length?'<section class="admin-card admin-metrics-warning" role="status"><h3>Some metric sources are unavailable</h3><p>Available reports are shown below. Reconnect or repair the named source before relying on totals that include it.</p><ul>'+metricWarnings.map((warning)=>'<li><strong>'+adminSafe(warning.source)+'</strong>: '+adminSafe(warning.message)+'</li>').join('')+'</ul></section>':'';
   panel.innerHTML=warningMarkup+'<div class="admin-heading"><div><p class="kicker">STORE PERFORMANCE</p><h2>Metrics</h2><p>Accounting metrics are separate from product research. Website sales, Etsy sales, and combined totals use the selected period.</p></div></div><section class="admin-card" id="accounting-metrics"></section><section class="admin-card metrics-controls metrics-research-controls" id="metrics-research-controls"><div class="admin-form-grid"><label>Find in research report<input type="search" data-metrics-search placeholder="SKU, name, category, vendor, or search term"></label></div><div class="metrics-filter-list" role="group" aria-label="Research metric filters">'+filterButtons+'</div></section><section class="admin-card" id="metrics-report"></section>';
   panel.setAttribute('aria-busy','false');
   const accounting=panel.querySelector('#accounting-metrics');
   const accountingHeaders=['Channel','Orders','Units sold','Returned units','Gross product sales','Discounts / promos','Promo units','Returns / refunds','Net product sales','Shipping collected','COGS','Shrinkage','Marketplace fees','Sales tax collected','Inventory purchases','Net profit after COGS','Business expenses','Net profit after expenses','Sales YoY %','COGS YoY %','Net profit YoY %'];
   const drawAccounting=()=>{const combined=accountingRows.find((row)=>row.channel==='Combined')||{};const value=(row,key)=>key==='netSales'||key==='netProfit'||key==='netProfitAfterExpenses'?money(row[key]):['grossSales','discounts','refunds','shippingCollected','cogs','shrinkage','marketplaceFees','taxCollected','inventoryPurchases','businessExpenses'].includes(key)?money(row[key]):Number(row[key]||0);const accountingCells=(row)=>[row.channel,row.orders,row.unitsSold,row.returnedUnits,value(row,'grossSales'),value(row,'discounts'),row.promoUnits,value(row,'refunds'),value(row,'netSales'),value(row,'shippingCollected'),value(row,'cogs'),value(row,'shrinkage'),value(row,'marketplaceFees'),value(row,'taxCollected'),value(row,'inventoryPurchases'),value(row,'netProfit'),value(row,'businessExpenses'),value(row,'netProfitAfterExpenses'),row.salesYoy,row.cogsYoy,row.netProfitYoy];accounting.innerHTML='<div class="admin-heading"><div><h3>Business accounting · '+accountingPeriodLabel+'</h3><p>Website and Etsy are isolated, with combined totals last. Net profit includes product sales, shipping collected, COGS, marketplace fees, shrinkage, and recorded business expenses.</p></div><button type="button" data-download-accounting>Export accounting CSV</button></div><div class="admin-stat-grid"><div class="admin-stat-card"><b>'+money(combined.grossSales)+'</b><span>Combined gross product sales</span></div><div class="admin-stat-card"><b>'+money(combined.cogs)+'</b><span>Combined COGS</span></div><div class="admin-stat-card"><b>'+money(combined.shrinkage)+'</b><span>Inventory shrinkage</span></div><div class="admin-stat-card"><b>'+money(combined.netProfit)+'</b><span>Net profit after COGS</span></div><div class="admin-stat-card"><b>'+money(combined.businessExpenses)+'</b><span>Business expenses</span></div><div class="admin-stat-card"><b>'+money(combined.netProfitAfterExpenses)+'</b><span>Net profit after expenses</span></div></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr>'+accountingHeaders.map((header)=>'<th>'+header+'</th>').join('')+'</tr></thead><tbody>'+accountingRows.map((row)=>'<tr>'+accountingCells(row).map((cell)=>'<td>'+adminSafe(cell)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';accounting.querySelector('[data-download-accounting]').onclick=()=>download([accountingHeaders,...accountingRows.map(accountingCells)],'business-accounting-'+accountingPeriod+'.csv');};
   drawAccounting();
   if(!accountingRequested){accounting.innerHTML='<div class="admin-heading"><div><h3>Business accounting report</h3><p>Select a reporting period, then click Run report when you need the accounting totals.</p></div><div class="admin-report-launch-actions"><button type="button" data-run-accounting>Run report</button><button type="button" data-run-accounting-fresh>Run fresh report</button></div></div>';}
   const report=panel.querySelector('#metrics-report');
   const accountingHeading=accounting.querySelector('.admin-heading');
   const periodControl=document.createElement('label');
   periodControl.className='metrics-period-control';
   periodControl.innerHTML='<span>Reporting period</span><select data-accounting-period><option value="week" '+(accountingPeriod==='week'?'selected':'')+'>Last 7 days</option><option value="month" '+(accountingPeriod==='month'?'selected':'')+'>This month</option><option value="year" '+(accountingPeriod==='year'?'selected':'')+'>This year</option><option value="all" '+(accountingPeriod==='all'?'selected':'')+'>All time</option></select>';
   accountingHeading?.querySelector('div')?.append(periodControl);
   const researchPeriodControl=document.createElement('label');
   researchPeriodControl.className='metrics-period-control';
   researchPeriodControl.innerHTML='<span>Reporting period</span><select data-research-period><option value="week" '+(researchPeriod==='week'?'selected':'')+'>Last 7 days</option><option value="month" '+(researchPeriod==='month'?'selected':'')+'>This month</option><option value="year" '+(researchPeriod==='year'?'selected':'')+'>This year</option><option value="all" '+(researchPeriod==='all'?'selected':'')+'>All time</option></select>';
   panel.querySelector('#metrics-research-controls .admin-form-grid')?.append(researchPeriodControl);
  const clearMetricsReportCache=async()=>{clearAdminRowsCachePrefix('stats-rpc:');clearAdminRowsCachePrefix('catalog-part:stats:');await clearAdminReportCache('report:stats-rpc:');await clearAdminReportCache('report:catalog-part:stats:');};
  const researchPrompt=()=>{report.innerHTML='<div class="admin-heading"><div><h3>Research report not run</h3><p>Choose a report and period, then run it when you need the detailed SKU data.</p></div><div class="admin-report-launch-actions"><button type="button" data-run-metrics>Run report</button><button type="button" data-run-metrics-fresh>Run fresh report</button></div></div>';report.querySelector('[data-run-metrics]').onclick=()=>{panel.dataset.metricsResearchRun='true';void renderStats();};report.querySelector('[data-run-metrics-fresh]').onclick=async()=>{await clearMetricsReportCache();panel.dataset.metricsResearchRun='true';void renderStats();};};
  const drawSearchTerms=(filter)=>{const termHeaders=['Search term','Searches','Last searched','YoY searches %'];const needle=(panel.querySelector('[data-metrics-search]')?.value||'').trim().toLowerCase();const visible=searchTermRows.filter((row)=>row.term.toLowerCase().includes(needle)).sort((left,right)=>(Date.parse(right.latestSearch||'')||0)-(Date.parse(left.latestSearch||'')||0));const pageSize=25;const pageCount=Math.max(1,Math.ceil(visible.length/pageSize));const page=Math.min(Number(report.dataset.page||1),pageCount);report.dataset.page=page;const cell=(row)=>'<tr><td>'+adminSafe(row.term)+'</td><td>'+row.searches+'</td><td>'+adminSafe(row.latestSearch?new Date(row.latestSearch).toLocaleString():'—')+'</td><td>'+row.yoySearches+'</td></tr>';report.innerHTML='<div class="admin-heading"><div><h3>Search terms · '+periodLabel+'</h3><p>'+visible.length+' exact terms · no fuzzy grouping · 25 rows per page</p></div><button type="button" data-download-metrics>Export CSV</button></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr>'+termHeaders.map((header)=>'<th>'+header+'</th>').join('')+'</tr></thead><tbody>'+((visible.slice((page-1)*pageSize,page*pageSize).map(cell).join(''))||'<tr><td colspan="4">No matching search terms.</td></tr>')+'</tbody></table></div><div class="admin-pagination"><button type="button" data-metrics-page="prev" '+(page===1?'disabled':'')+'>Previous</button><span>Page '+page+' of '+pageCount+' · '+visible.length+' rows</span><button type="button" data-metrics-page="next" '+(page===pageCount?'disabled':'')+'>Next</button></div>';report.querySelectorAll('[data-metrics-page]').forEach((button)=>button.onclick=()=>{report.dataset.page=Math.max(1,Math.min(pageCount,page+(button.dataset.metricsPage==='next'?1:-1)));drawSearchTerms(filter);});report.querySelector('[data-download-metrics]').onclick=()=>download([termHeaders,...visible.map((row)=>[row.term,row.searches,row.latestSearch?new Date(row.latestSearch).toISOString():'',row.yoySearches])],'search-terms-'+selectedPeriod+'.csv');};
  const draw=()=>{
    const filter=filters[selectedFilter];
    if(filter.type==='search'){drawSearchTerms(filter);return;}
    const needle=(panel.querySelector('[data-metrics-search]')?.value||'').trim().toLowerCase();
    const pageRows=[...new Map(rows.flatMap((row)=>Object.values(row.pageMetrics||{}).map((metric)=>{const existing={...row,sku:'Product page',productId:metric.productId,productName:metric.productName,variant:'All linked SKUs',category:metric.category,inventory:'—',unitType:'—',cost:0,price:0,vendor:'',views:metric.views,searches:metric.searches,cartAdds:metric.cartAdds,priorViews:metric.priorViews,priorSearches:metric.priorSearches,priorCartAdds:metric.priorCartAdds,unitsSold:0,promoUnits:0,revenue:0,totalCost:0,marketplaceFees:0,netProfit:0,yoyUnits:'—',yoyRevenue:'—'};return[metric.productId,existing];}))).values()];
    const pageMetric=['views','searches'].includes(filter.key);
    const reportRows=pageMetric?pageRows:['unitsSold','revenue','netProfit'].includes(filter.key)?rollupRowsToChildren(rows):rows;
    const visible=reportRows.filter((row)=>[row.sku,row.productName,row.variant,row.category,row.vendor].join(' ').toLowerCase().includes(needle)).sort((left,right)=>{const direction=filter.direction==='asc'?1:-1;const leftValue=Number(left[filter.key])||0;const rightValue=Number(right[filter.key])||0;return leftValue===rightValue?String(left.sku).localeCompare(String(right.sku)):direction*(leftValue-rightValue);});
    const pageSize=25;
    const pageCount=Math.max(1,Math.ceil(visible.length/pageSize));
    const page=Number(report.dataset.page||1);
    const safePage=Math.min(page,pageCount);
    report.dataset.page=safePage;
    const sortCell=(row)=>'<tr><td>'+adminSkuLink(row.sku,row.productId)+'</td><td>'+adminSafe(row.productName)+'</td><td>'+adminSafe(row.category)+'</td><td>'+row.inventory+'</td><td>'+adminSafe(row.unitType)+'</td><td>'+money(row.cost)+'</td><td>'+money(row.price)+'</td><td>'+adminSafe(row.vendor||'—')+'</td><td>'+row.views+'</td><td>'+row.searches+'</td><td>'+row.cartAdds+'</td><td>'+row.unitsSold+'</td><td>'+row.promoUnits+'</td><td>'+money(row.revenue)+'</td><td>'+money(row.totalCost)+'</td><td>'+money(row.marketplaceFees)+'</td><td>'+money(row.netProfit)+'</td><td>'+row.yoyUnits+'</td><td>'+row.yoyRevenue+'</td></tr>';
    report.innerHTML='<div class="admin-heading"><div><h3>'+adminSafe(filter.label)+' · '+periodLabel+'</h3><p>'+visible.length+' SKU rows · 25 rows per page</p></div><button type="button" data-download-metrics>Export CSV</button></div><div class="admin-form-grid"><label>Sort rows<select data-metrics-sort><option value="metric">Selected metric</option><option value="sku">SKU</option><option value="productName">Product name</option><option value="category">Category</option><option value="inventory">Inventory</option><option value="cost">Cost</option><option value="price">Price</option><option value="unitsSold">Units sold</option><option value="revenue">Revenue</option><option value="netProfit">Net profit</option></select></label><label>Direction<select data-metrics-direction><option value="auto">Automatic</option><option value="desc">Highest to lowest</option><option value="asc">Lowest to highest</option></select></label><span class="admin-field-note">Data period: '+periodLabel+'</span></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr>'+headers.map((header)=>'<th>'+header+'</th>').join('')+'</tr></thead><tbody>'+(visible.slice((safePage-1)*pageSize,safePage*pageSize).map(sortCell).join('')||'<tr><td colspan="'+headers.length+'">No matching SKU data.</td></tr>')+'</tbody></table></div><div class="admin-pagination"><button type="button" data-metrics-page="prev" '+(safePage===1?'disabled':'')+'>Previous</button><span>Page '+safePage+' of '+pageCount+' · '+visible.length+' rows</span><button type="button" data-metrics-page="next" '+(safePage===pageCount?'disabled':'')+'>Next</button></div>';
    if(pageMetric){const subtitle=report.querySelector('.admin-heading p');if(subtitle)subtitle.textContent=visible.length+' product-page rows · 25 rows per page';}
    const sort=report.querySelector('[data-metrics-sort]');
    sort.value=report.dataset.sort||'metric';
    const direction=report.querySelector('[data-metrics-direction]');
    direction.value=report.dataset.sortDirection||'auto';
    const sortedRows=()=>visible.slice().sort((left,right)=>{const sortKey=sort.value==='metric'?filter.key:sort.value;const descending=direction.value==='auto'?(sort.value==='metric'?filter.direction==='desc':['views','searches','cartAdds','unitsSold','revenue','netProfit'].includes(sortKey)):direction.value==='desc';const leftValue=left[sortKey];const rightValue=right[sortKey];if(typeof leftValue==='number'||typeof rightValue==='number'){const difference=(Number(leftValue)||0)-(Number(rightValue)||0);return descending?-difference:difference;}const difference=String(leftValue||'').localeCompare(String(rightValue||''));return descending?-difference:difference;});
    const redrawSorted=()=>{report.dataset.sort=sort.value;report.dataset.sortDirection=direction.value;const sorted=sortedRows();const currentPage=Math.min(Number(report.dataset.page||1),Math.max(1,Math.ceil(sorted.length/pageSize)));report.dataset.page=currentPage;report.querySelector('tbody').innerHTML=sorted.slice((currentPage-1)*pageSize,currentPage*pageSize).map(sortCell).join('')||'<tr><td colspan="'+headers.length+'">No matching SKU data.</td></tr>';report.querySelector('.admin-pagination span').textContent='Page '+currentPage+' of '+Math.max(1,Math.ceil(sorted.length/pageSize))+' · '+sorted.length+' rows';report.querySelector('[data-metrics-page="prev"]').disabled=currentPage===1;report.querySelector('[data-metrics-page="next"]').disabled=currentPage===Math.max(1,Math.ceil(sorted.length/pageSize));};
    sort.onchange=redrawSorted;
    direction.onchange=redrawSorted;
    redrawSorted();
    report.querySelectorAll('[data-metrics-page]').forEach((button)=>button.onclick=()=>{report.dataset.page=Math.max(1,Math.min(pageCount,Number(report.dataset.page||1)+(button.dataset.metricsPage==='next'?1:-1)));redrawSorted();});
    report.querySelector('[data-download-metrics]').onclick=()=>{const sorted=sortedRows();download([headers,...sorted.map((row)=>[row.sku,row.productName,row.category,row.inventory,row.unitType,row.cost,row.price,row.vendor,row.views,row.searches,row.cartAdds,row.unitsSold,row.promoUnits,row.revenue,row.totalCost,row.marketplaceFees,row.netProfit,row.yoyUnits,row.yoyRevenue])],'metrics-'+selectedPeriod+'.csv');};
  };
  panel.querySelector('[data-run-accounting]')?.addEventListener('click',()=>{panel.dataset.metricsAccountingRun='true';void renderStats();});
  panel.querySelector('[data-run-accounting-fresh]')?.addEventListener('click',async()=>{await clearMetricsReportCache();panel.dataset.metricsAccountingRun='true';void renderStats();});
  panel.querySelector('[data-accounting-period]').onchange=(event)=>{panel.dataset.accountingMetricsPeriod=event.target.value;panel.dataset.metricsAccountingRun='false';void renderStats();};
  panel.querySelector('[data-research-period]').onchange=(event)=>{panel.dataset.researchMetricsPeriod=event.target.value;panel.dataset.metricsResearchRun='false';researchPrompt();};
  panel.querySelector('[data-metrics-search]').oninput=()=>{if(!researchRequested)return;report.dataset.page=1;draw();};
  panel.querySelectorAll('[data-metrics-filter]').forEach((button)=>button.onclick=()=>{selectedFilter=Number(button.dataset.metricsFilter);panel.dataset.metricsSelectedFilter=String(selectedFilter);panel.querySelectorAll('[data-metrics-filter]').forEach((entry)=>entry.classList.toggle('active',entry===button));report.dataset.page=1;if(researchRequested)draw();else researchPrompt();});
  if(researchRequested)draw();else researchPrompt();
}
const shippingBoxMarkup=(box={})=>'<div class="admin-shipping-box" data-shipping-box><label>Box name<input data-box-name value="'+adminSafe(box.name||'')+'" placeholder="Etsy package name"></label><label>Max weight (oz)<input data-box-max-weight type="number" min="0" step="0.001" value="'+adminSafe(box.maxWeightOz??'')+'" placeholder="Required for selection"></label><label>Length (in)<input data-box-length type="number" min="0" step="0.01" value="'+adminSafe(box.lengthIn??'')+'"></label><label>Width (in)<input data-box-width type="number" min="0" step="0.01" value="'+adminSafe(box.widthIn??'')+'"></label><label>Height (in)<input data-box-height type="number" min="0" step="0.01" value="'+adminSafe(box.heightIn??'')+'"></label><input type="hidden" data-box-rate value=""><button type="button" data-remove-shipping-box>Remove box</button></div>';
function renderSettings(){const config=window.productStoreConfig||{};const data=adminData();const settings=data.settings||{};const shippingBoxes=Array.isArray(config.shippingBoxes)?config.shippingBoxes:[];panel.innerHTML=`<div class="admin-heading"><div><p class="kicker">STORE OPERATIONS</p><h2>Store settings</h2><p>Defaults used for delivery estimates, customer communication, SEO, and future payment connections.</p></div></div><form class="admin-form" id="settings-form"><div class="admin-form-grid"><label>Standard MSRP markup (%)<input name="msrpMarkupPercent" type="number" min="0" step="0.01" value="${Number(config.msrpMarkupPercent??100)}"></label><label>Reward threshold ($)<input name="rewardThreshold" type="number" min="0.01" step="0.01" value="${Number(config.rewardThreshold??35)}"></label><label>Reward discount (%)<input name="rewardDiscountPercent" type="number" min="0.01" max="100" step="0.01" value="${Number(config.rewardDiscountPercent??5)}"></label><label>Shipping from<input name="shippingFrom" value="${adminSafe(config.shippingFrom||'Ohio')}"></label><label>Processing time (business days)<input name="processingDays" type="number" min="0" value="${adminSafe(config.processingDays||3)}"></label></div><div class="admin-form-grid"><label>Support email<input name="supportEmail" type="email" value="${adminSafe(settings.supportEmail||'')}"></label><label>Announcement business text<input name="smallBusinessMessage" value="${adminSafe(settings.smallBusinessMessage||'SMALL BUSINESS')}"></label><label>Announcement creativity text<input name="bigCreativityMessage" value="${adminSafe(settings.bigCreativityMessage||'BIG CREATIVITY')}"></label></div><section class="admin-shipping-settings"><h3>Shipping calculation</h3><p>Product-page delivery estimates call the live USPS Ground Advantage Service Standards API. Set the USPS origin ZIP and processing time above; USPS credentials stay securely in Supabase and are never stored in the browser.</p><div class="admin-form-grid"><label>USPS origin ZIP<input name="shippingOriginPostalCode" inputmode="numeric" maxlength="10" value="${adminSafe(config.shippingOriginPostalCode||'')}"></label><label>Origin city<input name="shippingOriginCity" value="${adminSafe(config.shippingOriginCity||'')}"></label><label>Origin state<input name="shippingOriginState" maxlength="2" value="${adminSafe(config.shippingOriginState||'')}"></label><label>Free shipping threshold ($)<input name="freeShippingThreshold" type="number" min="0" step="0.01" value="${Number(config.freeShippingThreshold??50)}"></label><label>Rate provider<select name="shippingCarrier"><option value="usps" selected>USPS postage and delivery API</option></select></label></div><div class="admin-shipping-boxes"><h4>Package / box profiles</h4><p>Enter the package profiles from Etsy. Keep them ordered from smallest to largest max weight.</p><div data-shipping-box-list>${shippingBoxes.length?shippingBoxes.map((box)=>shippingBoxMarkup(box)).join(''):shippingBoxMarkup()}</div><button type="button" data-add-shipping-box>Add box profile</button></div></section><label>Default shipping & returns policy<div class="admin-rich-editor"><div class="rich-toolbar" role="toolbar" aria-label="Shipping policy formatting"><button type="button" data-rich-command="bold"><strong>B</strong></button><button type="button" data-rich-command="italic"><em>I</em></button><button type="button" data-rich-command="underline"><u>U</u></button><select data-rich-command="formatBlock" aria-label="Text style"><option value="p">Paragraph</option><option value="h2">Heading</option><option value="h3">Subheading</option><option value="blockquote">Quote</option></select><select data-rich-command="fontName" aria-label="Font"><option value="Arial">Arial</option><option value="Georgia">Georgia</option><option value="Verdana">Verdana</option><option value="Trebuchet MS">Trebuchet MS</option></select><select data-rich-command="fontSize" aria-label="Text size"><option value="3">Normal</option><option value="4">Large</option><option value="5">Larger</option><option value="2">Small</option></select><select data-rich-command="lineHeight" aria-label="Line spacing"><option value="1.2">Tight spacing</option><option value="1.5" selected>Comfortable spacing</option><option value="2">Loose spacing</option></select><button type="button" data-rich-command="justifyLeft">Left</button><button type="button" data-rich-command="justifyCenter">Center</button><button type="button" data-rich-command="insertUnorderedList">• List</button><button type="button" data-rich-command="removeFormat">Clear</button></div><div class="rich-content" contenteditable="true" data-rich-editor>${adminRichText(settings.shippingPolicy||'')}</div><input type="hidden" name="shippingPolicy" value=""></div></label><label>Default SEO description<textarea name="seoDescription" rows="4">${adminSafe(settings.seoDescription||'Shop unique beads, charms, acrylic and silicone beads, rhinestones, flatbacks, beadable pen supplies, craft kits, and creative jewelry-making supplies at Bead Different Co. Find colorful supplies for DIY pens, badge reels, keychains, jewelry, and more.')}</textarea></label><div class="admin-card"><h3>Payment connection</h3><p>Stripe and QuickBooks are not connected yet. Keep this status visible until payment, tax, refunds, and order webhooks are configured.</p><strong>Not connected</strong></div><div class="admin-card inventory-freeze-controls"><h3>Inventory audit controls</h3><p>Pause customer sales and future Etsy imports while counting inventory. Unfreezing does not automatically replay Etsy sales.</p><label><span><input name="salesFrozen" type="checkbox" ${config.salesFrozen?'checked':''}> Freeze new storefront sales</span></label><label><span><input name="etsyImportsFrozen" type="checkbox" ${config.etsyImportsFrozen?'checked':''}> Freeze Etsy imports</span></label></div><div class="admin-actions"><button class="cta">Save settings</button></div></form>`;const richEditor=panel.querySelector('[data-rich-editor]');const richInput=panel.querySelector('input[name="shippingPolicy"]');let savedRange=null;const rememberSelection=()=>{const selection=window.getSelection();if(selection?.rangeCount&&richEditor.contains(selection.anchorNode))savedRange=selection.getRangeAt(0).cloneRange();};const restoreSelection=()=>{if(!savedRange)return;const selection=window.getSelection();selection.removeAllRanges();selection.addRange(savedRange);};const syncRichText=()=>{richInput.value=`<div style="line-height:${richEditor.style.lineHeight||'1.5'}">${richEditor.innerHTML}</div>`;};richEditor.addEventListener('mouseup',rememberSelection);richEditor.addEventListener('keyup',rememberSelection);richEditor.addEventListener('blur',rememberSelection);panel.querySelectorAll('[data-rich-command]').forEach((control)=>control.addEventListener('change',()=>{restoreSelection();richEditor.focus();if(control.dataset.richCommand==='lineHeight'){richEditor.style.lineHeight=control.value;}else{document.execCommand(control.dataset.richCommand,false,control.value||null);}syncRichText();}));panel.querySelectorAll('[data-rich-command="bold"],[data-rich-command="italic"],[data-rich-command="underline"],[data-rich-command="justifyLeft"],[data-rich-command="justifyCenter"],[data-rich-command="insertUnorderedList"],[data-rich-command="removeFormat"]').forEach((control)=>control.addEventListener('mousedown',(event)=>event.preventDefault()));panel.querySelectorAll('[data-rich-command="bold"],[data-rich-command="italic"],[data-rich-command="underline"],[data-rich-command="justifyLeft"],[data-rich-command="justifyCenter"],[data-rich-command="insertUnorderedList"],[data-rich-command="removeFormat"]').forEach((control)=>control.addEventListener('click',()=>{restoreSelection();richEditor.focus();document.execCommand(control.dataset.richCommand,false,null);syncRichText();}));richEditor.addEventListener('input',()=>{rememberSelection();syncRichText();});syncRichText();const boxList=panel.querySelector('[data-shipping-box-list]');panel.querySelector('[data-add-shipping-box]').onclick=()=>boxList.insertAdjacentHTML('beforeend',shippingBoxMarkup());boxList.addEventListener('click',(event)=>{if(event.target.closest('[data-remove-shipping-box]'))event.target.closest('[data-shipping-box]').remove();});const readShippingBoxes=()=>[...boxList.querySelectorAll('[data-shipping-box]')].map((row)=>({name:row.querySelector('[data-box-name]').value.trim(),maxWeightOz:row.querySelector('[data-box-max-weight]').value.trim(),lengthIn:row.querySelector('[data-box-length]').value.trim(),widthIn:row.querySelector('[data-box-width]').value.trim(),heightIn:row.querySelector('[data-box-height]').value.trim(),fallbackRate:row.querySelector('[data-box-rate]').value.trim()})).filter((box)=>box.name||box.maxWeightOz||box.lengthIn||box.widthIn||box.heightIn||box.fallbackRate);false&&panel.querySelector('form').addEventListener('submit',async(event)=>{event.preventDefault();syncRichText();const fields=Object.fromEntries(new FormData(event.currentTarget));const next=adminData();next.settings={supportEmail:fields.supportEmail,smallBusinessMessage:String(fields.smallBusinessMessage||'').trim()||'SMALL BUSINESS',bigCreativityMessage:String(fields.bigCreativityMessage||'').trim()||'BIG CREATIVITY',shippingPolicy:fields.shippingPolicy,seoDescription:fields.seoDescription};saveAdminData(next);config.msrpMarkupPercent=Math.max(0,Number(fields.msrpMarkupPercent)||0);config.rewardThreshold=Math.max(0.01,Number(fields.rewardThreshold)||35);config.rewardDiscountPercent=Math.min(100,Math.max(0.01,Number(fields.rewardDiscountPercent)||5));config.shippingFrom=fields.shippingFrom;config.shippingOriginPostalCode=fields.shippingOriginPostalCode.trim();config.shippingOriginCity=fields.shippingOriginCity.trim();config.shippingOriginState=fields.shippingOriginState.trim().toUpperCase();config.processingDays=Number(fields.processingDays)||0;config.freeShippingThreshold=Math.max(0,Number(fields.freeShippingThreshold)||0);window.updateAnnouncementBar?.({freeShippingThreshold:config.freeShippingThreshold,smallBusiness:next.settings.smallBusinessMessage,bigCreativity:next.settings.bigCreativityMessage});config.shippingCarrier='usps';config.shippingBoxes=readShippingBoxes();config.salesFrozen=Boolean(event.currentTarget.elements.salesFrozen.checked);config.etsyImportsFrozen=Boolean(event.currentTarget.elements.etsyImportsFrozen.checked);localStorage.setItem('beadDifferentProductConfig',JSON.stringify(config));const notice=document.createElement('p');notice.className='admin-saved';notice.textContent='Settings saved locally. Syncing to the store…';event.currentTarget.prepend(notice);try{if(window.beadSupabase){const result=await patchAdminStoreSettings({config,admin:next.settings});if(!result)throw new Error('The store database rejected the settings update.');}notice.textContent='Settings saved.';}catch(error){notice.className='admin-saved admin-save-error';notice.textContent=`Saved locally, but store sync failed: ${error.message||'Unknown error'}`;}});}
async function renderReviews(){
  const renderGeneration=adminTabRenderGeneration;
  const renderSequence=++reviewRenderSequence;
  const isCurrent=()=>activeTab==='reviews'&&renderGeneration===adminTabRenderGeneration&&renderSequence===reviewRenderSequence;
  const memberYear=(value)=>{const date=new Date(value||'');return Number.isNaN(date.getTime())?'':String(date.getFullYear());};
  const reviewPhotos=(review)=>{const photos=Array.isArray(review.photos)?review.photos:[];return photos.slice(0,5).map((photo,index)=>{const safeUrl=safeAdminThemeImageUrl(photo);if(!safeUrl)return'';const safe=adminSafe(safeUrl);return `<a class="admin-review-photo-link" href="${safe}" target="_blank" rel="noreferrer"><img class="admin-review-photo" src="${safe}" alt="Review photo ${index+1}" loading="lazy"></a>`;}).join('');};
  const profileDialog=async(button)=>{
    const dialog=document.createElement('dialog');
    dialog.className='profile-dialog admin-review-member-dialog';
    const name=button.dataset.reviewMemberName||'Member';
    const id=button.dataset.reviewMemberId||'';
    const bindClose=()=>dialog.querySelector('[data-close-review-member]')?.addEventListener('click',()=>dialog.close());
    dialog.innerHTML='<button type="button" class="profile-dialog-close" data-close-review-member aria-label="Close profile">×</button><p class="kicker">MEMBER PROFILE</p><h3>'+adminSafe(name)+'</h3><p class="admin-member-record-status" role="status">Loading member dashboard…</p>';
    bindClose();
    dialog.addEventListener('click',(event)=>{if(event.target===dialog)dialog.close();});
    dialog.addEventListener('close',()=>dialog.remove(),{once:true});
    document.body.append(dialog);dialog.showModal();
    if(!id||!window.beadSupabase){const status=dialog.querySelector('.admin-member-record-status');if(status)status.textContent='This member record is not available.';return;}
    const [profileResult,reviewsResult,ordersResult,notesResult,financialResult]=await Promise.all([
      window.beadSupabase.from('profiles').select('id,email,full_name,status,created_at').eq('id',id).maybeSingle(),
      window.beadSupabase.from('reviews').select('id,review_type,rating,body,photos,status,created_at,products(name)',{count:'exact'}).eq('user_id',id).order('created_at',{ascending:false}).range(0,99),
      window.beadSupabase.from('orders').select('id,status,payment_status,refunded_amount,total,subtotal,discount,shipping_amount,tax_amount,shipping_name,shipping_address,carrier,tracking_number,shipped_at,created_at,order_items(id,product_name,sku,quantity,unit_price,selected_options)',{count:'exact'}).eq('user_id',id).order('created_at',{ascending:false}).range(0,99),
      window.beadSupabase.from('member_notes').select('id,note,created_at',{count:'exact'}).eq('member_id',id).order('created_at',{ascending:false}).range(0,99),
      window.beadSupabase.rpc('admin_member_financial_summary',{p_member_id:id})
    ]);
    const failure=profileResult.error||reviewsResult.error||ordersResult.error||notesResult.error;
    const status=dialog.querySelector('.admin-member-record-status');
    if(failure){if(status)status.textContent='Unable to load the full member record: '+(failure.message||'Unknown error.');return;}
    if(!dialog.isConnected)return;
    const profile=profileResult.data||{};
    const year=memberYear(profile.created_at||button.dataset.reviewMemberYear);
    const reviews=reviewsResult.data||[];
    const orders=ordersResult.data||[];
    const notes=notesResult.data||[];
    const reviewTotal=Number(reviewsResult.count)||reviews.length;
    const orderTotal=Number(ordersResult.count)||orders.length;
    const noteTotal=Number(notesResult.count)||notes.length;
    const totalSpentExact=!financialResult.error;
    const totalSpent=totalSpentExact?Number(financialResult.data?.[0]?.total_spent)||0:orders.filter((order)=>['paid','partially_refunded','refunded'].includes(String(order.payment_status||'').toLowerCase())).reduce((sum,order)=>sum+Math.max(0,(Number(order.total)||0)-(Number(order.refunded_amount)||0)),0);
    const totalSpentNote=totalSpentExact?'':' (latest 100 orders)';
    const pageSize=5;
    let activeSection='orders';
    let activePage=1;
    const dateLabel=(value,includeTime=false)=>{const date=new Date(value||'');return Number.isNaN(date.getTime())?'Unknown date':date.toLocaleString(undefined,includeTime?{}:{dateStyle:'medium'});};
    const moneyLabel=(value)=>'$'+(Number(value)||0).toFixed(2);
    const reviewRow=(review)=>{const photos=reviewPhotos(review);return'<article class="admin-member-record-item"><div class="admin-member-record-heading"><strong>'+adminSafe(review.products?.name||'Website review')+'</strong><span>Rating: '+Number(review.rating||0)+'/5</span></div><div class="admin-member-record-meta"><span>Status: '+adminSafe(review.status||'pending')+'</span><span>Posted: '+adminSafe(dateLabel(review.created_at))+'</span></div><p>'+adminSafe(window.decodeReviewText(review.body||''))+'</p>'+(photos?'<div class="admin-review-photos">'+photos+'</div>':'')+'<a class="admin-member-canonical-link" href="admin.html?review='+encodeURIComponent(review.id)+'">View review</a></article>';};
    const orderRow=(order)=>'<a class="admin-member-order-row" href="admin.html?order='+encodeURIComponent(order.id)+'"><span class="admin-member-order-summary"><strong>Order '+adminSafe(String(order.id||'').slice(0,8))+'</strong><small>Status: '+adminSafe(order.status||'unknown')+' · Placed: '+adminSafe(dateLabel(order.created_at))+'</small></span><span class="admin-member-order-total"><small>Total</small><strong>'+moneyLabel(order.total)+'</strong></span><span class="admin-member-order-open">View order&nbsp;›</span></a>';
    const noteRow=(note)=>'<article class="admin-member-record-item"><div class="admin-member-record-heading"><strong>Private note</strong><span>Written: '+adminSafe(dateLabel(note.created_at,true))+'</span></div><p>'+adminSafe(note.note||'')+'</p></article>';
    const rowsFor=(section)=>section==='orders'?orders:section==='notes'?notes:reviews;
    const sectionTitle=(section)=>section==='orders'?'Orders':section==='notes'?'Private notes':'Reviews';
    const renderDrilldown=()=>{
      const drilldown=dialog.querySelector('[data-member-drilldown]');
      if(!drilldown)return;
      const rows=rowsFor(activeSection);
      const pageCount=Math.max(1,Math.ceil(rows.length/pageSize));
      activePage=Math.min(activePage,pageCount);
      const visible=rows.slice((activePage-1)*pageSize,activePage*pageSize);
      const markup=activeSection==='reviews'?visible.map(reviewRow).join(''):activeSection==='orders'?visible.map(orderRow).join(''):visible.map(noteRow).join('');
      const total=activeSection==='orders'?orderTotal:activeSection==='notes'?noteTotal:reviewTotal;
      const capNote=total>rows.length?'<small class="admin-member-record-cap">Showing the latest 100 records.</small>':'';
      drilldown.innerHTML='<div class="admin-member-drilldown-header"><h4>'+sectionTitle(activeSection)+'</h4><span>'+total+' total</span></div>'+capNote+'<div class="admin-member-record-list">'+(markup||'<p class="admin-member-empty">No '+sectionTitle(activeSection).toLowerCase()+' yet.</p>')+'</div><div class="admin-member-pagination"><button type="button" data-member-page="prev" '+(activePage<=1?'disabled':'')+'>Previous</button><span>Page '+activePage+' of '+pageCount+'</span><button type="button" data-member-page="next" '+(activePage>=pageCount?'disabled':'')+'>Next</button></div>';
      drilldown.querySelectorAll('[data-member-page]').forEach((pageButton)=>pageButton.onclick=()=>{activePage+=pageButton.dataset.memberPage==='next'?1:-1;renderDrilldown();});
    };
    const emailButton=profile.email?'<button type="button" class="admin-member-email-button" data-admin-email data-email-to="'+adminSafe(profile.email)+'" data-email-name="'+adminSafe(profile.full_name||name)+'" data-email-subject="Message from Bead Different Co.">Send message</button>':'';
    dialog.innerHTML='<button type="button" class="profile-dialog-close" data-close-review-member aria-label="Close profile">×</button><p class="kicker">MEMBER PROFILE</p><div class="admin-member-profile-heading"><div><h3>'+adminSafe(profile.full_name||profile.email||name)+'</h3><p>'+adminSafe(profile.email||'Not available')+'</p></div>'+emailButton+'</div><div data-member-record><dl class="admin-review-member-profile"><div><dt>Member since</dt><dd>'+adminSafe(year||'Not available')+'</dd></div><div><dt>Status</dt><dd>'+adminSafe(profile.status||'unknown')+'</dd></div></dl><section class="admin-member-activity" aria-labelledby="member-activity-heading"><div class="admin-member-section-heading"><h4 id="member-activity-heading">Member activity</h4><p>Choose a count to view that record type.</p></div><div class="admin-member-dashboard" aria-label="Member activity summary"><button type="button" class="admin-member-stat" data-member-section="orders"><span>Orders</span><strong>'+orderTotal+'</strong></button><div class="admin-member-stat admin-member-stat-total"><span>Total spent'+adminSafe(totalSpentNote)+'</span><strong>'+moneyLabel(totalSpent)+'</strong></div><button type="button" class="admin-member-stat" data-member-section="notes"><span>Notes</span><strong>'+noteTotal+'</strong></button><button type="button" class="admin-member-stat" data-member-section="reviews"><span>Reviews</span><strong>'+reviewTotal+'</strong></button></div></section><section class="admin-member-drilldown" data-member-drilldown></section></div>';
    bindClose();
    dialog.querySelectorAll('[data-member-section]').forEach((sectionButton)=>sectionButton.onclick=()=>{activeSection=sectionButton.dataset.memberSection;activePage=1;dialog.querySelectorAll('[data-member-section]').forEach((entry)=>entry.classList.toggle('active',entry===sectionButton));renderDrilldown();});
    dialog.querySelector('[data-member-section="orders"]')?.classList.add('active');
    renderDrilldown();
  };
  const attachMemberButtons=()=>panel.querySelectorAll('[data-review-member]').forEach((button)=>button.addEventListener('click',()=>profileDialog(button)));
  if(!window.beadSupabase){
    const reviews=window.reviewTools?.read()||[];
    panel.innerHTML=`<div class="admin-heading"><div><p class="kicker">MODERATION</p><h2>Reviews</h2><p>Item reviews are tied to purchased items. Website reviews are managed separately.</p></div></div><div class="review-admin-tabs"><button class="${reviewView==='new'?'active':''}" data-review-filter="new">New Reviews</button><button class="${reviewView==='all'?'active':''}" data-review-filter="all">All Reviews</button><button class="${reviewView==='item'?'active':''}" data-review-filter="item">Item reviews</button><button class="${reviewView==='website'?'active':''}" data-review-filter="website">Website reviews</button></div><div class="admin-list" id="review-admin-list"></div>`;
    const list=panel.querySelector('#review-admin-list');
    const draw=(filter)=>{const visible=reviews.filter((review)=>filter==='new'?(!review.status||review.status==='pending'):filter==='all'||review.type===filter);list.innerHTML=visible.map((review)=>{const photos=reviewPhotos(review);return`<article><div class="admin-review-card-copy"><div class="admin-review-card-heading"><strong>${review.type==='item'?'Item review':'Website review'}</strong><span>Rating: ${adminSafe(review.rating)}/5</span></div><div class="admin-review-card-meta"><span>Member: ${adminSafe(review.email||'Account')}</span><span>Posted: ${adminSafe(review.created_at?new Date(review.created_at).toLocaleString():'Unknown date')}</span><span>Status: ${adminSafe(review.status||'pending')}</span></div><p class="admin-review-card-body">${adminSafe(window.decodeReviewText(review.body||''))}</p>${photos?`<div class="admin-review-photos">${photos}</div>`:''}</div><div><button data-review-status="approved" data-review-id="${adminSafe(review.id)}">Approve</button><button data-review-status="blocked" data-review-id="${adminSafe(review.id)}">Block</button></div></article>`;}).join('')||'<div class="admin-empty">No reviews in this view.</div>';list.querySelectorAll('[data-review-status]').forEach((button)=>button.addEventListener('click',()=>{const index=reviews.findIndex((review)=>review.id===button.dataset.reviewId);if(index>=0){reviews[index].status=button.dataset.reviewStatus;window.reviewTools.save(reviews);draw(filter);}}));};
    panel.querySelectorAll('[data-review-filter]').forEach((button)=>button.addEventListener('click',()=>{reviewView=button.dataset.reviewFilter;panel.querySelectorAll('[data-review-filter]').forEach((tab)=>tab.classList.toggle('active',tab===button));draw(reviewView);}));
    draw(reviewView);
    return;
  }
  try{if(window.beadSupabaseReady)await withAdminTimeout(window.beadSupabaseReady,'Reviews connection');}
  catch(error){if(isCurrent())panel.innerHTML='<div class="admin-empty">'+adminSafe(error.message||'Reviews connection failed.')+'</div>';return;}
  if(!isCurrent())return;
  const pageSize=25;
  const page=Math.max(1,Number(panel.dataset.reviewPage||1));
  const filter=reviewView;
  const focusedReviewId=new URLSearchParams(location.search).get('review')||'';
  let query=window.beadSupabase.from('reviews').select('id,user_id,review_type,rating,body,photos,status,verified_purchase,reviewer_name,author_name,reviewer_member_since,external_source,external_review_id,created_at,admin_response,admin_response_at,profiles(id,email,full_name,created_at),products(id,external_id,name)',{count:'exact'}).order('created_at',{ascending:false});
  if(focusedReviewId)query=query.eq('id',focusedReviewId);
  else if(filter==='new')query=query.or('status.is.null,status.eq.pending,status.eq.new');
  else if(filter==='item'||filter==='website')query=query.eq('review_type',filter);
  let result;
  try{result=await withAdminTimeout(query.range((page-1)*pageSize,page*pageSize-1),'Reviews request');}
  catch(error){if(isCurrent())panel.innerHTML='<div class="admin-empty">'+adminSafe(error.message||'Unable to load reviews.')+'</div>';return;}
  if(!isCurrent())return;
  if(result.error){panel.innerHTML='<div class="admin-empty">Unable to load reviews.</div>';return;}
  const reviews=result.data||[];
  const pageCount=Math.max(1,Math.ceil((result.count||0)/pageSize));
  const safePage=Math.min(page,pageCount);
  panel.dataset.reviewPage=String(safePage);
  const reviewMarkup=(review)=>{const product=review.products;const productId=product?.external_id||product?.id;const productLink=review.review_type==='item'&&productId?`<a href="product.html?id=${encodeURIComponent(productId)}" target="_blank" rel="noreferrer">${adminSafe(product.name||'Open product')}</a>`:'';const member=review.reviewer_name||review.author_name||review.profiles?.full_name||review.profiles?.email||'Account';const memberId=review.profiles?.id||review.user_id||'';const memberEmail=review.profiles?.email||'';const year=memberYear(review.profiles?.created_at||review.reviewer_member_since);const memberMarkup=memberId?`<button type="button" class="admin-review-member-link" data-review-member data-review-member-id="${adminSafe(memberId)}" data-review-member-name="${adminSafe(member)}" data-review-member-email="${adminSafe(memberEmail)}" data-review-member-year="${adminSafe(year)}">${adminSafe(member)}</button>`:adminSafe(member);const photos=reviewPhotos(review);return `<article data-review-response-loaded="true" data-review-response="${adminSafe(window.decodeReviewText(review.admin_response||''))}" data-review-response-at="${adminSafe(review.admin_response_at||'')}"><div class="admin-review-card-copy"><div class="admin-review-card-heading"><strong>${review.review_type==='item'?'Item review':'Website review'}</strong><span>Rating: ${adminSafe(review.rating)}/5</span></div><div class="admin-review-card-meta">${productLink?`<span>Product: ${productLink}</span>`:''}<span>Member: ${memberMarkup}</span>${review.external_source==='etsy'&&review.external_review_id?`<span>Etsy review: ${adminSafe(review.external_review_id)}</span>`:''}<span>Posted: ${adminSafe(review.created_at?new Date(review.created_at).toLocaleString():'Unknown date')}</span><span>Status: ${adminSafe(review.status||'pending')}</span></div><p class="admin-review-card-body">${adminSafe(window.decodeReviewText(review.body||''))}</p>${photos?`<div class="admin-review-photos">${photos}</div>`:''}</div><div><button data-review-status="approved" data-review-id="${adminSafe(review.id)}">Approve</button><button data-review-status="blocked" data-review-id="${adminSafe(review.id)}">Block</button><button data-review-status="deleted" data-review-id="${adminSafe(review.id)}">Delete</button></div></article>`;};
  panel.innerHTML=`<div class="admin-heading"><div><p class="kicker">MODERATION</p><h2>Reviews</h2><p>Item reviews are tied to purchased items. Website reviews are managed separately.</p>${focusedReviewId?'<p class="admin-member-history-note">Showing the exact canonical review. <a href="admin.html?reviews=all">Return to all reviews</a></p>':''}</div></div><div class="review-admin-tabs"><button class="${reviewView==='new'?'active':''}" data-review-filter="new">New Reviews</button><button class="${reviewView==='all'?'active':''}" data-review-filter="all">All Reviews</button><button class="${reviewView==='item'?'active':''}" data-review-filter="item">Item reviews</button><button class="${reviewView==='website'?'active':''}" data-review-filter="website">Website reviews</button></div><div class="admin-list" id="review-admin-list">${reviews.map(reviewMarkup).join('')||'<div class="admin-empty">No reviews in this view.</div>'}</div><div class="admin-pagination"><button type="button" data-review-page="prev" ${safePage<=1?'disabled':''}>Previous</button><span>Page ${safePage} of ${pageCount} · ${result.count||0} reviews</span><button type="button" data-review-page="next" ${safePage>=pageCount?'disabled':''}>Next</button></div>`;
  attachMemberButtons();
  panel.querySelectorAll('[data-review-filter]').forEach((button)=>button.addEventListener('click',()=>{reviewView=button.dataset.reviewFilter;const url=new URL(location.href);url.searchParams.delete('review');url.searchParams.set('reviews',reviewView);history.replaceState({},'',url.href);panel.dataset.reviewPage='1';renderReviews();}));
  panel.querySelectorAll('[data-review-page]').forEach((button)=>button.addEventListener('click',()=>{panel.dataset.reviewPage=String(Math.max(1,Math.min(pageCount,safePage+(button.dataset.reviewPage==='next'?1:-1))));renderReviews();}));
  panel.querySelectorAll('[data-review-status]').forEach((button)=>button.addEventListener('click',async()=>{if(button.dataset.reviewStatus==='deleted'&&!window.confirm('Remove this review from the live website? It will remain in the customer\'s review history.'))return;const update=await window.beadSupabase.from('reviews').update({status:button.dataset.reviewStatus}).eq('id',button.dataset.reviewId);if(update.error){panel.querySelector('.admin-empty')?.replaceChildren(document.createTextNode('Unable to update review.'));return;}renderReviews();}));
}
async function renderAdminOrders(){
  if(!window.beadSupabase){panel.innerHTML='<div class="admin-empty">Orders require the connected store database.</div>';return;}
  const orderRouteValue=new URLSearchParams(location.search).get('order')||'';
  const focusedOrderId=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderRouteValue)?orderRouteValue:'';
  let orderQuery=window.beadSupabase.from('orders').select('id,order_number,status,total,subtotal,discount,shipping_amount,tax_amount,carrier,tracking_number,shipped_at,updated_at,shipping_name,shipping_address,customer_email,created_at,refunded_amount,payment_provider,payment_status,payment_failure_reason,payment_expires_at,order_items(product_name,sku,quantity,refunded_quantity,unit_price),stripe_refunds(amount,status)');
  if(focusedOrderId)orderQuery=orderQuery.eq('id',focusedOrderId);
  const result=await orderQuery.order('created_at',{ascending:false}).range(0,focusedOrderId?0:99);
  if(result.error){panel.innerHTML='<div class="admin-empty">Unable to load orders: '+adminSafe(result.error.message)+'</div>';return;}
  result.data?.forEach((order)=>{order.order_items=(order.order_items||[]).map((item)=>({...item,quantity:Math.max(0,Number(item.quantity||0)-Number(item.refunded_quantity||0))})).filter((item)=>item.quantity>0);const refunds=order.stripe_refunds||[];const stripeRefunded=refunds.filter((refund)=>String(refund.status||'').toLowerCase()==='succeeded').reduce((sum,refund)=>sum+(Number(refund.amount)||0),0);order.pending_refund_amount=refunds.filter((refund)=>String(refund.status||'').toLowerCase()==='pending').reduce((sum,refund)=>sum+(Number(refund.amount)||0),0);const closedRefund=String(order.status||'').toLowerCase()==='refunded'||String(order.payment_status||'').toLowerCase()==='refunded'?Number(order.total)||0:0;order.refunded_amount=Math.max(Number(order.refunded_amount)||0,stripeRefunded,closedRefund);if(Number(order.total)>0&&Number(order.refunded_amount)>=Number(order.total))order.status='cancelled';});
  const allOrders=result.data||[];const state={view:focusedOrderId||adminUrlParams.get('orders')==='all'?'all':orderView==='unprocessed'?'unprocessed':orderView==='recent'?'recent':'all',query:focusedOrderId?'':orderRouteValue,page:1,pageSize:15};
  const orderLabel=(order)=>order.order_number?`BD-${String(order.order_number).padStart(6,'0')}`:String(order.id||'').slice(0,8).toUpperCase();
  const visibleOrderStatus=(order)=>{const status=String(order.status||'pending').toLowerCase();const refunded=Number(order.refunded_amount)||0;const total=Number(order.total)||0;if(refunded>0){if(total<=0||Math.round(refunded*100)>=Math.round(total*100))return 'cancelled';if(status==='shipped'||status==='completed'||order.shipped_at)return 'shipped · partially refunded';return 'partially refunded';}if(Number(order.pending_refund_amount)>0)return 'refund pending';return status==='processing'?'paid':status==='completed'?'shipped':status.replace('_',' ');};
  const searchable=(order)=>[order.id,orderLabel(order),order.shipping_name,order.customer_email,JSON.stringify(order.shipping_address||{}),...(order.order_items||[]).flatMap((item)=>[item.product_name,item.sku])].filter(Boolean).join(' ').toLowerCase();
   const render=()=>{const cutoff=Date.now()-30*86400000;const processedAt=(order)=>new Date(order.updated_at||order.shipped_at||order.created_at||0).getTime();const filtered=allOrders.filter((order)=>{const orderStatus=String(order.status||'').toLowerCase();const unshippedPartialRefund=orderStatus==='partially_refunded'&&!order.shipped_at;if(state.view==='unprocessed'&&!['paid','processing'].includes(orderStatus)&&!unshippedPartialRefund)return false;if(state.view==='unprocessed'&&Number(order.refunded_amount)>=Number(order.total||0)&&Number(order.total)>0)return false;if(state.view==='recent'&&new Date(order.created_at).getTime()<cutoff)return false;return !state.query||searchable(order).includes(state.query.trim().toLowerCase());});const pageCount=Math.max(1,Math.ceil(filtered.length/state.pageSize));state.page=Math.min(Math.max(1,state.page),pageCount);const ordered=state.view==='all'?[...filtered].sort((a,b)=>processedAt(b)-processedAt(a)):filtered;const visible=ordered.slice((state.page-1)*state.pageSize,state.page*state.pageSize);const options=(value,disabled=false,stripeOrder=false)=>{const allowed=stripeOrder&&['refunded','returned','cancelled'].includes(value)?[value]:stripeOrder?['paid','processing','shipped','completed']:['processing','cancelled','shipped','completed'];if(value&&!allowed.includes(value))allowed.unshift(value);return allowed.map((status)=>`<option value="${status}" ${String(value||'')===status?'selected':''} ${disabled?'disabled':''}>${status.replace('_',' ')}</option>`).join('');};const card=(order)=>{const items=(order.order_items||[]).map((item)=>`${adminSafe(item.product_name||item.sku||'Item')} × ${Number(item.quantity||1)}`).join(' · ')||'No item details';const address=adminShippingAddressMarkup(order.shipping_address);const remaining=Math.max(0,Number(order.total||0)-Number(order.refunded_amount||0));const stripeOrder=String(order.payment_provider||'').toLowerCase()==='stripe';const awaitingStripePayment=stripeOrder&&String(order.payment_status||'').toLowerCase()==='pending';const pendingRefundAmount=Number(order.pending_refund_amount)||0;const refundPending=pendingRefundAmount>0;const pendingFullRefund=refundPending&&Math.round(pendingRefundAmount*100)>=Math.round(Math.max(0,Number(order.total||0)-Number(order.refunded_amount||0))*100);const paymentLabel=awaitingStripePayment?'Payment pending — do not fulfill':String(order.payment_status||order.status||'').replace('_',' ');const paymentExpiry=awaitingStripePayment&&order.payment_expires_at?`Reservation expires ${new Date(order.payment_expires_at).toLocaleString()}`:'';const controlsDisabled=awaitingStripePayment||pendingFullRefund?'disabled':'';return `<article class="admin-order-card"><div class="admin-order-card-heading"><div><p class="kicker">ORDER ${adminSafe(orderLabel(order))}</p><h3>$${Number(order.total||0).toFixed(2)} · ${adminSafe(awaitingStripePayment?'payment pending':visibleOrderStatus(order))}</h3><p>${adminSafe(new Date(order.created_at).toLocaleString())} · ${adminSafe(order.shipping_name||'Guest')} · ${adminSafe(order.customer_email||'No email')}</p></div><strong>${Number(order.refunded_amount||0)>0?'Refunded $'+Number(order.refunded_amount).toFixed(2):''}</strong></div><p class="admin-order-items-summary">${items}</p><p class="admin-order-customer-summary">${address||'No shipping address'}</p><p class="admin-order-payment-status ${awaitingStripePayment?'awaiting-payment':''}">${adminSafe(paymentLabel)}${refundPending?' · Refund pending — waiting for Stripe confirmation':''}${paymentExpiry?' · '+adminSafe(paymentExpiry):''}${order.payment_failure_reason?' · '+adminSafe(order.payment_failure_reason):''}</p><form class="admin-order-control-form" data-admin-order-form="${adminSafe(order.id)}" data-stripe-order="${stripeOrder}" data-order-status="${adminSafe(order.status)}" data-order-carrier="${adminSafe(order.carrier||'')}" data-order-tracking="${adminSafe(order.tracking_number||'')}"><label>Status<select name="status" ${controlsDisabled}>${options(order.status,awaitingStripePayment||pendingFullRefund,stripeOrder)}</select></label><label>Carrier<input name="carrier" value="${adminSafe(order.carrier||'USPS')}" placeholder="USPS, UPS, FedEx" ${controlsDisabled}></label><label>Tracking number<input name="tracking_number" value="${adminSafe(order.tracking_number||'')}" placeholder="Tracking number" ${controlsDisabled}></label><button type="submit" class="cta" ${controlsDisabled}>Save fulfillment</button></form><div class="admin-order-actions"><button type="button" data-order-cancel="${adminSafe(order.id)}" ${stripeOrder||['cancelled','refunded','shipped','completed'].includes(order.status)||refundPending?'disabled':''}>Cancel order</button>${stripeOrder&&['paid','partially_refunded'].includes(String(order.payment_status||'').toLowerCase())?'<span>Use a Stripe refund to close this order.</span>':''}<button type="button" data-order-refund-full="${adminSafe(order.id)}" ${remaining<=0||order.status==='cancelled'||awaitingStripePayment||refundPending?'disabled':''}>Refund remaining $${remaining.toFixed(2)}</button><label>Partial refund<input type="number" min="0.01" max="${remaining.toFixed(2)}" step="0.01" data-order-refund-amount="${adminSafe(order.id)}" placeholder="Amount" ${awaitingStripePayment||refundPending?'disabled':''}></label><button type="button" data-order-refund-partial="${adminSafe(order.id)}" ${remaining<=0||order.status==='cancelled'||awaitingStripePayment||refundPending?'disabled':''}>Issue partial refund</button><span data-order-action-status="${adminSafe(order.id)}" role="status"></span></div></article>`;};panel.innerHTML=`<div class="admin-heading"><div><p class="kicker">FULFILLMENT OPERATIONS</p><h2>Orders</h2>${focusedOrderId?'<p class="admin-member-history-note">Showing the exact canonical order. <a href="admin.html?orders=all">Return to all orders</a></p>':''}<p>Search by order number, customer name, email, phone, address, SKU, or product. Shipment updates and financial reversals are recorded separately.</p></div></div><div class="admin-order-search"><label>Search orders<input type="search" data-admin-order-search value="${adminSafe(state.query)}" placeholder="Order number, name, email, phone, address, SKU"></label></div><div class="admin-tabs"><button type="button" data-order-view="unprocessed" class="${state.view==='unprocessed'?'active':''}">New/Unprocessed</button><button type="button" data-order-view="recent" class="${state.view==='recent'?'active':''}">Last 30 Days</button><button type="button" data-order-view="all" class="${state.view==='all'?'active':''}">All Orders</button></div><div class="admin-order-list">${visible.map(card).join('')||'<div class="admin-empty">No matching orders.</div>'}</div><div class="admin-pagination"><button type="button" data-order-page="prev" ${state.page<=1?'disabled':''}>Previous</button><span>Page ${state.page} of ${pageCount} · ${filtered.length} orders</span><button type="button" data-order-page="next" ${state.page>=pageCount?'disabled':''}>Next</button></div>`;panel.querySelector('[data-admin-order-search]').addEventListener('input',(event)=>{state.query=event.target.value;state.page=1;render();});panel.querySelectorAll('[data-order-view]').forEach((button)=>button.addEventListener('click',()=>{state.view=button.dataset.orderView;state.page=1;render();}));panel.querySelector('[data-order-page="prev"]').addEventListener('click',()=>{state.page-=1;render();});panel.querySelector('[data-order-page="next"]').addEventListener('click',()=>{state.page+=1;render();});bindActions();};
  const bindActions=()=>{panel.querySelectorAll('[data-admin-order-form]').forEach((form)=>form.addEventListener('submit',async(event)=>{event.preventDefault();const fields=Object.fromEntries(new FormData(form));if(fields.status==='shipped'&&!String(fields.carrier||'').trim()){alert('Enter the carrier before marking this order shipped.');return;}if(fields.status==='shipped'&&!String(fields.tracking_number||'').trim()){alert('Enter tracking before marking this order shipped.');return;}const order=allOrders.find((entry)=>entry.id===form.dataset.adminOrderForm);const wasShipped=form.dataset.orderStatus==='shipped'||Boolean(order?.shipped_at);const tracking=String(fields.tracking_number||'').trim();const carrier=String(fields.carrier||'').trim()||null;const shippedAt=fields.status==='shipped'?(order?.shipped_at||new Date().toISOString()):fields.status==='completed'||fields.status==='partially_refunded'?order?.shipped_at||null:null;const button=form.querySelector('button[type="submit"]');button.disabled=true;const update=await window.beadSupabase.from('orders').update({status:fields.status,carrier,tracking_number:tracking||null,updated_at:new Date().toISOString(),shipped_at:shippedAt}).eq('id',form.dataset.adminOrderForm).select('status,carrier,tracking_number,shipped_at').single();if(update.error||!update.data){alert('Fulfillment was not saved: '+(update.error?.message||'Order update was not confirmed.'));button.disabled=false;return;}if(order)Object.assign(order,update.data);if(window.sendAdminStoreEmail&&fields.status==='shipped'&&(!wasShipped||tracking!==String(form.dataset.orderTracking||'')||carrier!==String(form.dataset.orderCarrier||''))){try{await window.sendAdminStoreEmail({action:'order_update',orderId:form.dataset.adminOrderForm});}catch(error){alert('Order was shipped, but the update email was not sent: '+error.message);}}render();}));panel.querySelectorAll('[data-order-cancel]').forEach((button)=>button.addEventListener('click',async()=>{const order=allOrders.find((entry)=>entry.id===button.dataset.orderCancel);if(!order||!confirm(`Cancel order ${orderLabel(order)}? Inventory will be restored.`))return;const reason=prompt('Cancellation reason:');if(reason===null)return;button.disabled=true;const status=panel.querySelector(`[data-order-action-status="${CSS.escape(order.id)}"]`);status.textContent='Cancelling…';const result=await window.beadSupabase.rpc('cancel_test_order',{order_id:order.id,target_status:'cancelled',reason});if(result.error){status.textContent='Cancellation failed: '+result.error.message;button.disabled=false;return;}order.status='cancelled';order.updated_at=new Date().toISOString();status.textContent='Order cancelled.';render();}));};
  render();
}
async function renderSimple(tab,title,description,empty){
  const renderGeneration=adminTabRenderGeneration;
  const renderSequence=tab==='members'?++memberRenderSequence:0;
  const isCurrent=()=>activeTab===tab&&renderGeneration===adminTabRenderGeneration&&(tab!=='members'||renderSequence===memberRenderSequence);
  if(!window.beadSupabase){
    const data=adminData();
    const records=data[tab]||[];
    panel.innerHTML=`<div class="admin-heading"><div><p class="kicker">CUSTOMER OPERATIONS</p><h2>${title}</h2><p>${description}</p></div></div><div class="admin-empty">${records.length?`${records.length} records ready for review.`:empty}</div>`;
    return;
  }
  if(tab==='orders')return renderAdminOrders();
  if(tab==='members'){
    if(selectedCustomerEmail&&!selectedMemberId){
      const email=selectedCustomerEmail.trim().toLowerCase();
      const existingProfileResult=await withAdminTimeout(window.beadSupabase.from('profiles').select('id').ilike('email',email).maybeSingle(),'Member lookup');
      if(!isCurrent())return;
      if(existingProfileResult.data?.id){location.href=`admin.html?member=${encodeURIComponent(existingProfileResult.data.id)}`;return;}
      const guestOrdersResult=await withAdminTimeout(window.beadSupabase.from('orders').select('id,order_number,status,total,shipping_name,created_at,customer_email,order_items(product_name,sku,quantity,unit_price)',{count:'exact'}).ilike('customer_email',email).order('created_at',{ascending:false}).range(0,99),'Member orders request');
      if(!isCurrent())return;
      if(guestOrdersResult.error){panel.innerHTML='<div class="admin-empty">Unable to load this temporary customer record.</div>';return;}
      const guestOrders=guestOrdersResult.data||[];
      const guestOrderIds=guestOrders.map((order)=>order.id);
      const guestNotesResult=guestOrderIds.length?await withAdminTimeout(window.beadSupabase.from('order_notes').select('id,order_id,note,created_at',{count:'exact'}).in('order_id',guestOrderIds).order('created_at',{ascending:false}).range(0,99),'Member notes request'):{data:[],count:0,error:null};
      if(!isCurrent())return;
      const guestNotes=guestNotesResult.data||[];
      const customerName=guestOrders.find((order)=>order.shipping_name)?.shipping_name||'Temporary customer';
      const totalSpent=guestOrders.filter((order)=>!['cancelled','refunded'].includes(String(order.status||'').toLowerCase())).reduce((sum,order)=>sum+(Number(order.total)||0),0);
      const guestOrderRows=guestOrders.map((order)=>`<button type="button" class="admin-member-order-row" data-open-admin-order="${adminSafe(order.id)}"><span class="admin-member-order-summary"><strong>Order ${adminSafe(order.order_number?`BD-${String(order.order_number).padStart(6,'0')}`:String(order.id).slice(0,8))}</strong><small>${adminSafe(String(order.status||'unknown').replaceAll('_',' '))} · ${adminSafe(order.created_at?new Date(order.created_at).toLocaleDateString():'Unknown date')}</small></span><span class="admin-member-order-total"><small>Total</small><strong>$${Number(order.total||0).toFixed(2)}</strong></span><span class="admin-member-order-open">View order&nbsp;›</span></button>`).join('');
      const guestNoteRows=guestNotes.map((note)=>`<article class="admin-member-record-item"><div class="admin-member-record-heading"><strong>Order note</strong><span>${adminSafe(note.created_at?new Date(note.created_at).toLocaleString():'Unknown date')}</span></div><p>${adminSafe(note.note||'')}</p></article>`).join('');
      const guestOrderTotal=Number(guestOrdersResult.count)||guestOrders.length;
      const guestNoteTotal=Number(guestNotesResult.count)||guestNotes.length;
      const historyCapNote=guestOrderTotal>guestOrders.length||guestNoteTotal>guestNotes.length?'<p class="admin-field-note">Showing the latest 100 records for this temporary customer.</p>':'';
      panel.innerHTML=`<div class="admin-heading"><div><p class="kicker">CUSTOMER OPERATIONS · TEMPORARY RECORD</p><h2>${adminSafe(customerName)}</h2><p>${adminSafe(email)} · Orders and notes are grouped by email until the customer creates an account.</p></div></div>${historyCapNote}<div class="admin-member-dashboard" aria-label="Temporary customer summary"><div class="admin-member-stat"><span>Orders</span><strong>${guestOrderTotal}</strong></div><div class="admin-member-stat admin-member-stat-total"><span>Total spent</span><strong>$${totalSpent.toFixed(2)}</strong></div><div class="admin-member-stat"><span>Order notes</span><strong>${guestNoteTotal}</strong></div></div><section class="admin-card admin-customer-history"><div class="admin-section-label">Orders</div><div class="admin-member-record-list">${guestOrderRows||'<p class="admin-member-empty">No orders found for this email.</p>'}</div></section><section class="admin-card admin-customer-history"><div class="admin-section-label">Shared order notes</div><div class="admin-member-record-list">${guestNoteRows||'<p class="admin-member-empty">No order notes yet.</p>'}</div></section>`;
      panel.querySelectorAll('[data-open-admin-order]').forEach((button)=>button.addEventListener('click',()=>void openAdminOrderModal(button.dataset.openAdminOrder)));
      return;
    }
    const {data:{user:currentAdmin}}=await withAdminTimeout(window.beadSupabase.auth.getUser(),'Members session');
    if(!isCurrent())return;
    const memberQuery=window.beadSupabase.from('profiles').select('id,email,full_name,role,status,created_at',{count:'exact'}).order('created_at',{ascending:false});
    if(selectedMemberId)memberQuery.eq('id',selectedMemberId);
    if(memberView==='new')memberQuery.gte('created_at',memberCreatedAfter);
    const memberResult=await withAdminTimeout(memberQuery.range((memberPage-1)*adminPageSize,memberPage*adminPageSize-1),'Members request');
    if(!isCurrent())return;
    if(memberResult.error){panel.innerHTML='<div class="admin-empty">Unable to load members.</div>';return;}
    const members=memberResult.data||[];
    const memberPageCount=Math.max(1,Math.ceil((memberResult.count||0)/adminPageSize));
    memberPage=Math.min(memberPage,memberPageCount);
    const memberIds=members.map((member)=>member.id);
    const activityResult=memberIds.length?await withAdminTimeout(window.beadSupabase.rpc('admin_member_activity_counts',{p_member_ids:memberIds}),'Member activity counts'):{data:[],error:null};
    if(!isCurrent())return;
    let activityCounts=new Map((activityResult.data||[]).map((row)=>[String(row.member_id),row]));
    const activityUnavailable=Boolean(activityResult.error);
    const memberRows=members.map((member)=>{const counts=activityCounts.get(String(member.id))||{};const reviewCount=Number(counts.reviews_count)||0;const orderCount=Number(counts.orders_count)||0;const noteCount=Number(counts.notes_count)||0;const countLabel=(count)=>activityUnavailable?'':' ('+count+')';const isAdmin=member.role==='admin';const isCurrentAdmin=String(member.id)===String(currentAdmin?.id);const roleButton=isCurrentAdmin&&isAdmin?'<button type="button" disabled title="You cannot revoke your own admin access.">Current admin</button>':`<button type="button" data-member-role="${member.id}" data-role="${isAdmin?'customer':'admin'}">${isAdmin?'Revoke admin':'Make admin'}</button>`;return`<article class="member-row"><div><strong>${adminSafe(member.full_name||member.email)}</strong><span>${adminSafe(member.email)}</span>${isAdmin?'<span class="member-role-badge">Admin</span>':''}</div><div class="admin-actions"><button type="button" data-admin-email data-email-to="${adminSafe(member.email)}" data-email-name="${adminSafe(member.full_name||'customer')}" data-email-subject="Message from Bead Different Co.">Send email</button><button type="button" data-member-notes="${member.id}">Notes${countLabel(noteCount)}</button><button type="button" data-member-reviews="${member.id}">Reviews${countLabel(reviewCount)}</button><button type="button" data-member-orders="${member.id}">Orders${countLabel(orderCount)}</button><button type="button" data-member-status="${member.id}" data-status="${member.status==='blocked'?'active':'blocked'}">${member.status==='blocked'?'Unblock':'Block'}</button>${roleButton}</div></article>`}).join('')||`<div class="admin-empty">${empty}</div>`;
    panel.innerHTML=`<div class="admin-heading"><div><p class="kicker">CUSTOMER OPERATIONS</p><h2>${memberView==='new'?'New members (30 days) · ':''}${title}</h2><p>Contact customers, review their history, manage notes, and control account access.</p></div></div>${activityUnavailable?'<p class="admin-field-note" role="status">Member activity counts are unavailable. The list is shown without downloading full order or review histories.</p>':''}<div class="admin-tabs"><button type="button" data-member-view="all" class="${memberView==='all'?'active':''}">All</button><button type="button" data-member-view="new" class="${memberView==='new'?'active':''}">New (30 days)</button></div><div class="admin-list" id="member-list">${memberRows}</div><div class="admin-pagination"><button type="button" data-member-page="prev" ${memberPage<=1?'disabled':''}>Previous</button><span>Page ${memberPage} of ${memberPageCount} · ${memberResult.count||0} members</span><button type="button" data-member-page="next" ${memberPage>=memberPageCount?'disabled':''}>Next</button></div>`;
    panel.querySelectorAll('[data-member-view]').forEach((button)=>button.addEventListener('click',()=>{memberView=button.dataset.memberView;memberCreatedAfter=memberView==='new'?new Date(Date.now()-30*86400000).toISOString():null;memberPage=1;renderSimple(tab,title,description,empty);}));
    panel.querySelectorAll('[data-member-page]').forEach((button)=>button.addEventListener('click',()=>{memberPage+=button.dataset.memberPage==='next'?1:-1;renderSimple(tab,title,description,empty);}));
    const memberFor=(memberId)=>members.find((member)=>member.id===memberId);
    const openMemberDetail=(memberId,section)=>{
      const member=memberFor(memberId);
      const memberName=member?.full_name||member?.email||'member';
      const sectionTitles={notes:'Notes for ',reviews:'Reviews by ',orders:'Orders for '};
      const sectionTitle=sectionTitles[section]+memberName;
      const titleId='member-detail-'+section+'-'+memberId;
      const dialog=document.createElement('dialog');
      dialog.className='profile-dialog admin-member-action-dialog';
      dialog.setAttribute('aria-labelledby',titleId);
      dialog.innerHTML='<button type="button" class="profile-dialog-close" data-close-member-detail aria-label="Close '+adminSafe(section)+'">×</button><p class="kicker">MEMBER '+adminSafe(section.toUpperCase())+'</p><h3 id="'+adminSafe(titleId)+'">'+adminSafe(sectionTitle)+'</h3><p class="admin-member-modal-status" role="status" aria-live="polite">Loading '+adminSafe(section)+'…</p><div class="admin-member-record-list" data-member-modal-list></div><div class="admin-member-pagination" data-member-modal-pagination></div>'+(section==='notes'?'<form class="admin-inline-form admin-member-note-form" data-add-member-note><input name="note" required placeholder="Add private note"><button type="submit">Save note</button><p class="admin-note-status" role="status"></p></form>':'');
      document.body.append(dialog);
      let page=1;
      let requestVersion=0;
      const pageSize=10;
      const list=dialog.querySelector('[data-member-modal-list]');
      const status=dialog.querySelector('.admin-member-modal-status');
      const pagination=dialog.querySelector('[data-member-modal-pagination]');
      const loadPage=async()=>{
        const version=++requestVersion;
        const offset=(page-1)*pageSize;
        status.textContent='Loading '+section+'…';
        list.innerHTML='';
        pagination.innerHTML='';
        let query;
        if(section==='notes')query=window.beadSupabase.from('member_notes').select('id,member_id,author_id,note,created_at',{count:'exact'}).eq('member_id',memberId).order('created_at',{ascending:false});
        else if(section==='reviews')query=window.beadSupabase.from('reviews').select('id,user_id,review_type,rating,body,photos,status,created_at,products(name)',{count:'exact'}).eq('user_id',memberId).order('created_at',{ascending:false});
        else query=window.beadSupabase.from('orders').select('id,user_id,status,total,tracking_number,created_at',{count:'exact'}).eq('user_id',memberId).order('created_at',{ascending:false});
        try{
          const result=await withAdminTimeout(query.range(offset,offset+pageSize-1),'Member '+section);
          if(version!==requestVersion||!dialog.open)return;
          if(result.error)throw result.error;
          const rows=result.data||[];
          const total=Number(result.count)||0;
          const pageCount=Math.max(1,Math.ceil(total/pageSize));
          page=Math.min(page,pageCount);
          if(page!==(Math.floor(offset/pageSize)+1))return void loadPage();
          const markup=section==='notes'?rows.map((note)=>'<article class="admin-member-record-item"><div class="admin-member-record-heading"><strong>Private note</strong><span>'+adminSafe(note.created_at?new Date(note.created_at).toLocaleString():'Unknown date')+'</span></div><p>'+adminSafe(note.note||'')+'</p></article>').join(''):section==='reviews'?rows.map((review)=>'<article class="admin-member-record-item"><div class="admin-member-record-heading"><strong>'+adminSafe(review.products?.name||'Website review')+'</strong><span>'+Number(review.rating||0)+'/5 · '+adminSafe(review.status||'')+' · '+adminSafe(review.created_at?new Date(review.created_at).toLocaleDateString():'Unknown date')+'</span></div><p>'+adminSafe(window.decodeReviewText(review.body||''))+'</p>'+((review.photos||[]).map((photo)=>{const safeUrl=safeAdminThemeImageUrl(photo);return safeUrl?'<img class="member-review-photo" src="'+adminSafe(safeUrl)+'" alt="Customer review photo" loading="lazy">':'';}).join(''))+'<a class="admin-member-canonical-link" href="admin.html?review='+encodeURIComponent(review.id)+'">View review</a></article>').join(''):rows.map((order)=>'<article class="admin-member-record-item"><div class="admin-member-record-heading"><a class="admin-member-canonical-link" href="admin.html?order='+encodeURIComponent(order.id)+'"><strong>Order '+adminSafe(String(order.id||'').slice(0,8))+' · $'+Number(order.total||0).toFixed(2)+'</strong></a><span>'+adminSafe(order.created_at?new Date(order.created_at).toLocaleDateString():'Unknown date')+'</span></div><p>'+adminSafe(order.status||'Unknown status')+' · '+adminSafe(order.tracking_number||'No tracking')+'</p></article>').join('');
          list.innerHTML=markup||'<p class="admin-member-empty">No '+adminSafe(section)+' yet.</p>';
          status.textContent=total?'Showing '+(offset+1)+'–'+Math.min(offset+rows.length,total)+' of '+total+'.':'';
          pagination.innerHTML='<button type="button" data-modal-page="prev" '+(page<=1?'disabled':'')+'>Previous</button><span>Page '+page+' of '+pageCount+' · '+total+' '+adminSafe(section)+'</span><button type="button" data-modal-page="next" '+(page>=pageCount?'disabled':'')+'>Next</button>';
        }catch(error){
          if(version!==requestVersion||!dialog.open)return;
          status.textContent='Unable to load '+section+': '+(error?.message||'Try again.');
        }
      };
      dialog.querySelector('[data-close-member-detail]').addEventListener('click',()=>dialog.close());
      dialog.addEventListener('click',(event)=>{
        if(event.target===dialog){dialog.close();return;}
        const button=event.target.closest('[data-modal-page]');
        if(!button||button.disabled)return;
        page+=button.dataset.modalPage==='next'?1:-1;
        void loadPage();
      });
      dialog.addEventListener('close',()=>dialog.remove(),{once:true});
      const noteForm=dialog.querySelector('[data-add-member-note]');
      if(noteForm)noteForm.addEventListener('submit',async(event)=>{
        event.preventDefault();
        const submit=noteForm.querySelector('button[type="submit"]');
        const noteStatus=noteForm.querySelector('.admin-note-status');
        const note=String(new FormData(noteForm).get('note')||'').trim();
        if(!note){noteStatus.textContent='Enter a note first.';return;}
        submit.disabled=true;
        noteStatus.textContent='Saving…';
        try{
          const {data:{user},error:authError}=await window.beadSupabase.auth.getUser();
          if(authError||!user)throw authError||new Error('Your admin session has expired. Sign in again.');
          const saveResult=await window.beadSupabase.from('member_notes').insert({member_id:memberId,author_id:user.id,note});
          if(saveResult.error)throw saveResult.error;
          noteForm.reset();
          page=1;
          await loadPage();
          noteStatus.textContent='Note saved.';
        }catch(error){noteStatus.textContent='Save failed: '+(error?.message||'Unable to save note.');}
        finally{submit.disabled=false;}
      });
      dialog.showModal();
      void loadPage();
    };
    panel.querySelectorAll('[data-member-notes]').forEach((button)=>button.addEventListener('click',()=>openMemberDetail(button.dataset.memberNotes,'notes')));
    panel.querySelectorAll('[data-member-reviews]').forEach((button)=>button.addEventListener('click',()=>openMemberDetail(button.dataset.memberReviews,'reviews')));
    panel.querySelectorAll('[data-member-orders]').forEach((button)=>button.addEventListener('click',()=>openMemberDetail(button.dataset.memberOrders,'orders')));
    panel.querySelectorAll('[data-member-status]').forEach((button)=>button.addEventListener('click',async()=>{const result=await window.beadSupabase.from('profiles').update({status:button.dataset.status}).eq('id',button.dataset.memberStatus);if(result.error)return renderCloudError(result.error);renderSimple(tab,title,description,empty);}));
    panel.querySelectorAll('[data-member-role]').forEach((button)=>button.addEventListener('click',async()=>{button.disabled=true;const result=await window.beadSupabase.from('profiles').update({role:button.dataset.role}).eq('id',button.dataset.memberRole);if(result.error){button.disabled=false;return renderCloudError(result.error);}renderSimple(tab,title,description,empty);}));
    return;
  }
  const thirtyDaysAgo=new Date(Date.now()-30*86400000).toISOString();
  let orderQuery=window.beadSupabase.from('orders').select('id,status,total,carrier,tracking_number,shipped_at,created_at',{count:'exact'}).order('created_at',{ascending:false});
  if(orderView==='unprocessed')orderQuery=orderQuery.in('status',['pending','paid','processing']);
  else if(orderView==='recent')orderQuery=orderQuery.gte('created_at',thirtyDaysAgo);
  const orderResult=await orderQuery.range((orderPage-1)*adminPageSize,orderPage*adminPageSize-1);
  if(orderResult.error){panel.innerHTML='<div class="admin-empty">Unable to load orders.</div>';return;}
  const orders=orderResult.data||[];
  const orderPageCount=Math.max(1,Math.ceil((orderResult.count||0)/adminPageSize));
  orderPage=Math.min(orderPage,orderPageCount);
  panel.innerHTML=`<div class="admin-heading"><div><p class="kicker">FULFILLMENT</p><h2>${title}</h2><p>${description}</p></div></div><div class="admin-tabs"><button type="button" data-order-view="unprocessed" class="${orderView==='unprocessed'?'active':''}">New/Unprocessed</button><button type="button" data-order-view="recent" class="${orderView==='recent'?'active':''}">Last 30 Days</button><button type="button" data-order-view="all" class="${orderView==='all'?'active':''}">All Orders</button></div><div class="admin-list">${orders.map((order)=>`<article><div><strong>Order ${adminSafe(order.id.slice(0,8))} · $${Number(order.total||0).toFixed(2)}</strong><span>${adminSafe(order.status)} · ${new Date(order.created_at).toLocaleDateString()}</span></div><form data-order-form="${order.id}" data-order-status="${adminSafe(order.status)}" data-order-tracking="${adminSafe(order.tracking_number||'')}" data-order-carrier="${adminSafe(order.carrier||'')}" class="admin-inline-form"><select name="status"><option ${order.status==='pending'?'selected':''}>pending</option><option ${order.status==='paid'?'selected':''}>paid</option><option ${order.status==='processing'?'selected':''}>processing</option><option ${order.status==='shipped'?'selected':''}>shipped</option><option ${order.status==='completed'?'selected':''}>completed</option><option ${order.status==='cancelled'?'selected':''}>cancelled</option><option ${order.status==='refunded'?'selected':''}>refunded</option></select><input name="carrier" value="${adminSafe(order.carrier||'')}" placeholder="Carrier"><input name="tracking_number" value="${adminSafe(order.tracking_number||'')}" placeholder="Tracking"><button type="submit">Save</button></form></article>`).join('')||`<div class="admin-empty">${empty}</div>`}</div><div class="admin-pagination"><button type="button" data-order-page="prev" ${orderPage<=1?'disabled':''}>Previous</button><span>Page ${orderPage} of ${orderPageCount} · ${orderResult.count||0} orders</span><button type="button" data-order-page="next" ${orderPage>=orderPageCount?'disabled':''}>Next</button></div>`;
  panel.querySelectorAll('[data-order-view]').forEach((button)=>button.addEventListener('click',()=>{orderView=button.dataset.orderView;orderPage=1;renderSimple(tab,title,description,empty);}));
  panel.querySelectorAll('[data-order-page]').forEach((button)=>button.addEventListener('click',()=>{orderPage+=button.dataset.orderPage==='next'?1:-1;renderSimple(tab,title,description,empty);}));
  panel.querySelectorAll('[data-order-form]').forEach((form)=>form.addEventListener('submit',async(event)=>{event.preventDefault();const fields=Object.fromEntries(new FormData(form));const changed=fields.status!==form.dataset.orderStatus||String(fields.tracking_number||'')!==String(form.dataset.orderTracking||'')||String(fields.carrier||'')!==String(form.dataset.orderCarrier||'');const result=await window.beadSupabase.from('orders').update({status:fields.status,carrier:fields.carrier||null,tracking_number:fields.tracking_number||null,shipped_at:fields.status==='shipped'?new Date().toISOString():null}).eq('id',form.dataset.orderForm);if(result.error)return renderCloudError(result.error);if(changed&&window.sendAdminStoreEmail){try{await window.sendAdminStoreEmail({action:'order_update',orderId:form.dataset.orderForm});}catch(error){window.alert(`Order saved, but the update email was not sent: ${error.message||'Unknown error.'}`);}}renderSimple(tab,title,description,empty);}));
}
async function renderCampaigns(){
  const cloud=Boolean(window.beadSupabase);
  let campaigns=[];
  let recipientCounts={all_subscribers_optins:0,member_optins:0,nonmember_subscribers:0,waitlist_product:0};
  if(cloud){
    const result=await window.beadSupabase.from('email_campaigns').select('id,subject,body,audience,status,created_at,updated_at').order('created_at',{ascending:false}).range(0,99);
    if(result.error){panel.innerHTML='<div class="admin-empty">Unable to load email drafts.</div>';return;}
    campaigns=result.data||[];
    const countsResult=await window.beadSupabase.rpc('admin_campaign_recipient_counts');
    if(!countsResult.error&&countsResult.data?.[0]){
      const counts=countsResult.data[0];
      recipientCounts={all_subscribers_optins:Number(counts.all_subscribers_optins)||0,member_optins:Number(counts.member_optins)||0,nonmember_subscribers:Number(counts.nonmember_subscribers)||0,waitlist_product:Number(counts.waitlist_product)||0};
    }else recipientCounts={all_subscribers_optins:null,member_optins:null,nonmember_subscribers:null,waitlist_product:null};
  }
  let editingId=null;
  const recipientCount=(audience)=>recipientCounts[audience]===null?'count unavailable':recipientCounts[audience]||0;
  const recipientOptionCount=(audience)=>recipientCounts[audience]===null?'count unavailable':recipientCounts[audience]||0;
  const audienceLabel=(audience)=>({all_subscribers_optins:'All subscribers and member opt-ins',member_optins:'Just member opt-ins',nonmember_subscribers:'Just non-member subscribers',waitlist_product:'Waitlisted customers'})[audience]||audience;
  const campaignDate=(campaign)=>{const date=new Date(campaign.created_at||'');return Number.isNaN(date.getTime())?'—':date.toLocaleDateString();};
  const statusRank=(status)=>status==='draft'||status==='queued'?0:1;
  const orderedCampaigns=()=>[...campaigns].sort((left,right)=>statusRank(left.status)-statusRank(right.status)||Date.parse(right.created_at||'')-Date.parse(left.created_at||''));
  const showEditor=(campaign)=>{
    const dialog=panel.querySelector('#campaign-editor-dialog');
    const form=dialog?.querySelector('[data-campaign-form]');
    if(!dialog||!form)return;
    editingId=campaign?.id||null;
    form.reset();
    form.elements.subject.value=campaign?.subject||'';
    form.elements.audience.value=campaign?.audience||'all_subscribers_optins';
    form.elements.body.value=campaign?.body||'';
    dialog.querySelector('[data-campaign-editor-title]').textContent=campaign?'Edit draft':'Create new draft';
    dialog.querySelector('[data-campaign-editor-status]').textContent='';
    const isLocked=Boolean(campaign&&campaign.status!=='draft');
    form.elements.subject.disabled=isLocked;
    form.elements.audience.disabled=isLocked;
    form.elements.body.disabled=isLocked;
    form.querySelector('[data-save-campaign]').hidden=isLocked;
    dialog.querySelector('[data-campaign-editor-status]').textContent=isLocked?(campaign.status==='sent'?'Sent campaigns are read-only.':'Delivery has started. This campaign is locked; use Send to retry only recipients not already recorded as sent.'):' ';
    dialog.showModal();
  };
  const draw=()=>{
    const rows=orderedCampaigns();
    const campaignMarkup=rows.map((campaign)=>'<article><div><strong>'+adminSafe(campaign.subject||'Untitled draft')+'</strong><span>'+adminSafe(audienceLabel(campaign.audience||''))+' · '+adminSafe(campaign.status||'draft')+' · '+campaignDate(campaign)+'</span></div><div class="admin-actions"><button type="button" data-edit-campaign="'+adminSafe(campaign.id)+'">View/Edit</button><button type="button" data-send-campaign="'+adminSafe(campaign.id)+'" '+(campaign.status==='sent'||!cloud?'disabled':'')+'>'+(campaign.status==='sent'?'Sent':cloud?'Send with Resend':'Connect database to send')+'</button><button type="button" data-delete-campaign="'+adminSafe(campaign.id)+'">Delete</button></div></article>').join('')||'<div class="admin-empty">No email drafts yet.</div>';
    const dialogMarkup='<dialog class="profile-dialog" id="campaign-editor-dialog"><button type="button" class="profile-dialog-close" data-close-campaign-editor aria-label="Close editor">×</button><p class="kicker">CUSTOMER COMMUNICATION</p><h3 data-campaign-editor-title>Create new draft</h3><form class="admin-form" data-campaign-form><label>Subject<input name="subject" required></label><label>Audience<select name="audience"><option value="all_subscribers_optins">All subscribers and member opt-ins ('+recipientOptionCount('all_subscribers_optins')+')</option><option value="member_optins">Just member opt-ins ('+recipientOptionCount('member_optins')+')</option><option value="nonmember_subscribers">Just non-member subscribers ('+recipientOptionCount('nonmember_subscribers')+')</option><option value="waitlist_product">Waitlisted customers ('+recipientOptionCount('waitlist_product')+')</option></select><small data-campaign-recipient-count>Recipients: '+recipientCount('all_subscribers_optins')+'</small></label><label>Message<textarea name="body" rows="8" required></textarea></label><div class="profile-dialog-actions"><button type="submit" class="cta" data-save-campaign>Save draft</button><button type="button" data-close-campaign-editor>Cancel</button></div><p data-campaign-editor-status role="status"></p></form></dialog>';
    const recipientNotice=recipientCounts.all_subscribers_optins===null?' Recipient counts are temporarily unavailable; delivery still resolves the audience on the server.':'';
    panel.innerHTML='<div class="admin-heading"><div><p class="kicker">CUSTOMER COMMUNICATION</p><h2>Email drafts</h2><p>Create announcements for opted-in subscribers or waitlisted customers. Resend delivery is connected through the store email function.'+recipientNotice+'</p></div><button type="button" class="cta" data-create-campaign>Create new draft</button></div><div class="admin-list">'+campaignMarkup+'</div>'+dialogMarkup;
    const dialog=panel.querySelector('#campaign-editor-dialog');
    const form=dialog.querySelector('[data-campaign-form]');
    const updateRecipientCount=()=>{dialog.querySelector('[data-campaign-recipient-count]').textContent='Recipients: '+recipientCount(form.elements.audience.value);};
    panel.querySelector('[data-create-campaign]').addEventListener('click',()=>showEditor(null));
    panel.querySelectorAll('[data-edit-campaign]').forEach((button)=>button.addEventListener('click',()=>showEditor(campaigns.find((campaign)=>String(campaign.id)===button.dataset.editCampaign))));
    panel.querySelectorAll('[data-send-campaign]:not(:disabled)').forEach((button)=>button.addEventListener('click',async()=>{
      const campaign=campaigns.find((entry)=>String(entry.id)===button.dataset.sendCampaign);
      if(!campaign||!window.confirm(`Send “${campaign.subject||'Untitled campaign'}” to its eligible audience now?`))return;
      button.disabled=true;
      button.textContent='Sending…';
      try{
        const result=await window.beadSupabase.functions.invoke('send-store-email',{body:{action:'campaign',campaignId:campaign.id}});
        if(result.error)throw result.error;
        const data=result.data||{};
        const failures=Array.isArray(data.failures)?data.failures:[];
        campaign.status=failures.length?'queued':'sent';
        campaign.updated_at=new Date().toISOString();
        if(failures.length){
          window.alert(`Sent ${Number(data.sent)||0} of ${Number(data.recipients)||0} campaign emails. ${failures.length} did not complete. Retry is safe for recipients already recorded as sent. First issue: ${String(failures[0]).slice(0,240)}`);
        }else{
          window.alert(data.alreadySent?`Campaign is complete. ${Number(data.alreadySent)||0} recipients were already recorded as sent; no duplicate emails were sent.`:`Campaign sent to ${Number(data.sent)||0} eligible recipients.`);
        }
        draw();
      }catch(error){
        window.alert(`Campaign could not be completed: ${error.message||'Unknown error.'}`);
        button.disabled=false;
        button.textContent='Send with Resend';
      }
    }));
    dialog.querySelectorAll('[data-close-campaign-editor]').forEach((button)=>button.addEventListener('click',()=>dialog.close()));
    dialog.addEventListener('click',(event)=>{if(event.target===dialog)dialog.close();});
    form.elements.audience.addEventListener('change',updateRecipientCount);
    form.addEventListener('submit',async(event)=>{
      event.preventDefault();
      const fields=Object.fromEntries(new FormData(form));
      const status=dialog.querySelector('[data-campaign-editor-status]');
      if(!fields.subject?.trim()||!fields.body?.trim()){status.textContent='Enter a subject and message.';return;}
      status.textContent='Saving draft…';
      try{
        if(cloud){
          if(editingId){
            const result=await window.beadSupabase.from('email_campaigns').update({subject:fields.subject.trim(),body:fields.body.trim(),audience:fields.audience,updated_at:new Date().toISOString()}).eq('id',editingId).select('id,subject,body,audience,status,created_at,updated_at').single();
            if(result.error)throw result.error;
            campaigns=campaigns.map((campaign)=>campaign.id===editingId?result.data:campaign);
          }else{
            const {data:{user}}=await window.beadSupabase.auth.getUser();
            const result=await window.beadSupabase.from('email_campaigns').insert({author_id:user.id,subject:fields.subject.trim(),body:fields.body.trim(),audience:fields.audience,status:'draft'}).select('id,subject,body,audience,status,created_at,updated_at').single();
            if(result.error)throw result.error;
            campaigns.unshift(result.data);
          }
        }else if(editingId){
          campaigns=campaigns.map((campaign)=>campaign.id===editingId?{...campaign,subject:fields.subject.trim(),body:fields.body.trim(),audience:fields.audience,updated_at:new Date().toISOString()}:campaign);
        }else{
          campaigns.unshift({subject:fields.subject.trim(),body:fields.body.trim(),audience:fields.audience,id:'draft-'+Date.now(),status:'draft',created_at:new Date().toISOString()});
        }
        dialog.close();
        draw();
      }catch(error){status.textContent='Draft was not saved: '+(error.message||'Unknown error.');}
    });
    panel.querySelectorAll('[data-delete-campaign]').forEach((button)=>button.addEventListener('click',async()=>{
      if(!window.confirm('Delete this email draft?'))return;
      if(cloud){
        const result=await window.beadSupabase.from('email_campaigns').delete().eq('id',button.dataset.deleteCampaign);
        if(result.error){dialog.querySelector('[data-campaign-editor-status]').textContent='Draft was not deleted: '+result.error.message;return;}
      }
      campaigns=campaigns.filter((campaign)=>String(campaign.id)!==button.dataset.deleteCampaign);
      draw();
    }));
  };
  draw();
}
const renderSubscribers=async()=>{
  const cloud=Boolean(window.beadSupabase);
  let records=[];
  let remoteTotal=0;
  let legacyLoaded=false;
  let remotePaged=false;
  if(!cloud){
    const localSubscribers=JSON.parse(localStorage.getItem('beadDifferentNotificationSubscribers')||'[]');
    records=localSubscribers.map((email)=>({email,source:'footer',name:'',created_at:null}));
  }
  const draw=async()=>{
    const needle=(panel.querySelector('[data-subscriber-search]')?.value||'').trim().toLowerCase();
    if(cloud&&!legacyLoaded){
      const result=await window.beadSupabase.rpc('admin_newsletter_subscriber_page',{p_search:needle,p_page:subscriberPage,p_page_size:adminPageSize});
      if(result.error){
        legacyLoaded=true;
        const pattern=needle.replace(/[\\%_]/g,'\\$&');
        let fallbackQuery=window.beadSupabase.from('notification_subscribers').select('email,active,source,created_at',{count:'exact'}).eq('active',true).order('created_at',{ascending:false});
        if(pattern)fallbackQuery=fallbackQuery.ilike('email','%'+pattern+'%');
        const fallback=await fallbackQuery.range((subscriberPage-1)*adminPageSize,subscriberPage*adminPageSize-1);
        if(fallback.error){panel.innerHTML='<div class="admin-empty">Unable to load newsletter subscribers. The server-side page is unavailable and the bounded fallback could not be read.</div>';return;}
        const emails=[...new Set((fallback.data||[]).map((row)=>String(row.email||'').trim().toLowerCase()).filter(Boolean))];
        const profileResult=emails.length?await window.beadSupabase.from('profiles').select('id,email,full_name').in('email',emails):{data:[],error:null};
        if(profileResult.error){panel.innerHTML='<div class="admin-empty">Unable to load newsletter subscriber names.</div>';return;}
        const profiles=new Map((profileResult.data||[]).map((profile)=>[String(profile.email||'').trim().toLowerCase(),profile]));
        records=(fallback.data||[]).map((subscriber)=>{const profile=profiles.get(String(subscriber.email||'').trim().toLowerCase());return{email:subscriber.email,name:profile?.full_name||'',source:profile?'Member · '+(subscriber.source||'newsletter'):subscriber.source,created_at:subscriber.created_at,memberId:profile?.id};});
        remoteTotal=Number(fallback.count)||records.length;
        remotePaged=true;
      }else{records=result.data||[];remoteTotal=Number(records[0]?.total_count)||0;remotePaged=true;}
    }
    const remoteMode=cloud&&remotePaged;
    const filtered=remoteMode?records:records.filter((record)=>[record.email,record.name,record.source].filter(Boolean).join(' ').toLowerCase().includes(needle));
    const pageCount=Math.max(1,Math.ceil(filtered.length/adminPageSize));
    subscriberPage=Math.min(subscriberPage,remoteMode?Math.max(1,Math.ceil(remoteTotal/adminPageSize)):pageCount);
    const page=remoteMode?filtered:filtered.slice((subscriberPage-1)*adminPageSize,subscriberPage*adminPageSize);
    const tableRows=page.map((record)=>{
      const display=record.name||record.email||'Subscriber';
      const subscriberCell=record.memberId?'<a href="admin.html?member='+encodeURIComponent(record.memberId)+'">'+adminSafe(display)+'</a>':adminSafe(display);
      return '<tr><td>'+subscriberCell+'</td><td>'+adminSafe(record.source||'—')+'</td><td>'+adminSafe(record.created_at?new Date(record.created_at).toLocaleDateString():'—')+'</td></tr>';
    }).join('')||'<tr><td colspan="3">No subscribers found.</td></tr>';
    const total=remoteMode?remoteTotal:filtered.length;
    const totalPages=Math.max(1,Math.ceil(total/adminPageSize));
    panel.innerHTML='<div class="admin-heading"><div><p class="kicker">CUSTOMER COMMUNICATION</p><h2>Newsletter Subscribers</h2><p>Newsletter signups and members who opted in to product drops, restocks, and promotions.</p></div></div><div class="admin-form-grid"><label>Search subscribers<input type="search" data-subscriber-search placeholder="Name or email"></label></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Subscriber</th><th>Source</th><th>Joined</th></tr></thead><tbody>'+tableRows+'</tbody></table></div><div class="admin-pagination"><button type="button" data-subscriber-page="prev" '+(subscriberPage<=1?'disabled':'')+'>Previous</button><span>Page '+subscriberPage+' of '+totalPages+' · '+total+' subscribers</span><button type="button" data-subscriber-page="next" '+(subscriberPage>=totalPages?'disabled':'')+'>Next</button></div>';
    panel.querySelector('[data-subscriber-search]').addEventListener('input',()=>{subscriberPage=1;clearTimeout(draw.searchTimer);draw.searchTimer=setTimeout(()=>void draw(),250);});
    panel.querySelectorAll('[data-subscriber-page]').forEach((button)=>button.addEventListener('click',()=>{subscriberPage+=button.dataset.subscriberPage==='next'?1:-1;void draw();}));
  };
  await draw();
};
const decorateAdminOrderCards=()=>{document.querySelectorAll('.admin-order-card').forEach((card)=>{const form=card.querySelector('[data-admin-order-form]'),actions=card.querySelector('.admin-order-actions');if(!form||!actions)return;const orderId=form.dataset.adminOrderForm;const fullRefund=actions.querySelector(`[data-order-refund-full="${CSS.escape(orderId)}"]`),cancel=actions.querySelector(`[data-order-cancel="${CSS.escape(orderId)}"]`);actions.querySelector(`[data-order-refund-partial="${CSS.escape(orderId)}"]`)?.remove();actions.querySelector(`[data-order-refund-amount="${CSS.escape(orderId)}"]`)?.closest('label')?.remove();fullRefund?.remove();cancel?.remove();if(!actions.querySelector('[data-open-admin-order]')){const button=document.createElement('button');button.type='button';button.dataset.openAdminOrder=orderId;button.textContent='Open order & returns';button.addEventListener('click',()=>void openAdminOrderModal(orderId));actions.prepend(button);}});};
const adminOrderCardObserver=new MutationObserver(decorateAdminOrderCards);adminOrderCardObserver.observe(document.body,{childList:true,subtree:true});decorateAdminOrderCards();
const decorateAdminPackingSlipButtons=()=>{document.querySelectorAll('.admin-order-card').forEach((card)=>{const form=card.querySelector('[data-admin-order-form]'),actions=card.querySelector('.admin-order-actions');if(!form||!actions||actions.querySelector('[data-print-admin-packing-slip]'))return;const button=document.createElement('button');button.type='button';button.dataset.printAdminPackingSlip=form.dataset.adminOrderForm;button.textContent='Print packing slip';button.addEventListener('click',async()=>{button.disabled=true;try{const result=await cloudAdmin().from('orders').select('id,order_number,created_at,shipping_name,shipping_address,order_items(product_name,sku,quantity,refunded_quantity)').eq('id',form.dataset.adminOrderForm).maybeSingle();if(result.error||!result.data)throw result.error||new Error('Unable to load the order.');printAdminPackingSlip(result.data);}catch(error){alert('Packing slip could not be loaded: '+(error.message||'Unknown error.'));}finally{button.disabled=false;}});actions.append(button);});};
const adminPackingSlipObserver=new MutationObserver(decorateAdminPackingSlipButtons);adminPackingSlipObserver.observe(document.body,{childList:true,subtree:true});decorateAdminPackingSlipButtons();
window.addEventListener('admin-order-changed',()=>{document.querySelector('[data-admin-tab="orders"]')?.click();});
const normalizeAdminShippingMenus=()=>{document.querySelectorAll('.admin-order-control-form select[name="status"]').forEach((select)=>{const form=select.closest('[data-admin-order-form]');if(!form)return;const storedStatus=String(form.dataset.orderStatus||select.value||'').toLowerCase();const current=storedStatus==='processing'?'paid':storedStatus==='completed'?'shipped':storedStatus;const allowed=current==='partially_refunded'?['partially_refunded','shipped']:['paid','shipped'].includes(current)?['paid','shipped']:[current];const alreadyNormalized=select.options.length===allowed.length&&[...select.options].every((option,index)=>option.value===allowed[index])&&select.value===current;if(!alreadyNormalized){select.replaceChildren(...allowed.map((status)=>{const option=new Option(status.replace('_',' '),status);option.selected=status===current;return option;}));select.value=current;}if(current==='partially_refunded'&&!form.querySelector('[data-mark-partial-shipped]')){const button=document.createElement('button');button.type='button';button.className='cta';button.dataset.markPartialShipped='';button.textContent='Mark shipped';button.disabled=select.disabled;button.addEventListener('click',()=>{select.value='shipped';form.requestSubmit();});form.append(button);}});};
const adminShippingMenuObserver=new MutationObserver(normalizeAdminShippingMenus);adminShippingMenuObserver.observe(document.body,{childList:true,subtree:true});normalizeAdminShippingMenus();
const normalizeAdminCarriers=()=>{document.querySelectorAll('.admin-order-control-form input[name="carrier"]').forEach((input)=>{if(input.dataset.defaultCarrierReady)return;input.dataset.defaultCarrierReady='true';if(!String(input.value||'').trim()||String(input.value).trim().toLowerCase()==='standard shipping')input.value='USPS';});};
const adminCarrierObserver=new MutationObserver(normalizeAdminCarriers);adminCarrierObserver.observe(document.body,{childList:true,subtree:true});normalizeAdminCarriers();
document.addEventListener('submit',(event)=>{const form=event.target.closest('[data-admin-order-form]');const targetStatus=String(form?.elements?.status?.value||'');if(form&&targetStatus!==form.dataset.orderStatus&&['cancelled','refunded','partially_refunded','returned'].includes(targetStatus)){event.preventDefault();event.stopImmediatePropagation();alert('Use the dedicated Cancel order or refund action so inventory and refund totals are recorded correctly.');}},true);
function clearAdminRoute(){const url=new URL(window.location.href);url.search='';history.replaceState({},'',url.href);}
window.addEventListener('admin-product-saved',()=>{clearAdminRowsCache();clearAdminRoute();});
function switchTab(tab){if(!adminAuthorized)return;adminTabRenderGeneration++;if(tab!=='inventory'){delete document.body.dataset.inventoryReportActive;delete document.body.dataset.inventoryTab;}if(tab!=='stats'){delete panel.dataset.metricsAccountingRun;delete panel.dataset.metricsResearchRun;delete panel.dataset.stateTaxMetricsRun;}activeTab=tab;clearAdminRoute();document.querySelectorAll('[data-admin-tab]').forEach((button)=>button.classList.toggle('active',button.dataset.adminTab===activeTab));if(panel)panel.innerHTML='<div class="admin-empty admin-loading" role="status">Loading Store Control…</div>';renderTab();}
document.addEventListener('submit',async(event)=>{const form=event.target.closest('[data-order-form]');if(!form||!window.beadSupabase)return;const targetStatus=String(form.elements.status?.value||'');if(!['cancelled','refunded'].includes(targetStatus))return;event.preventDefault();event.stopImmediatePropagation();const reason=window.prompt('This will restore inventory and cannot be undone. Enter a reason, or cancel to leave the order unchanged.');if(reason===null)return;const submit=form.querySelector('[type="submit"]');if(submit)submit.disabled=true;const result=await window.beadSupabase.rpc('cancel_test_order',{order_id:form.dataset.orderForm,target_status:targetStatus,reason});if(result.error){if(submit)submit.disabled=false;renderCloudError(result.error);return;}if(window.sendAdminStoreEmail){try{await window.sendAdminStoreEmail({action:'order_update',orderId:form.dataset.orderForm});}catch(error){window.alert(`Order was updated, but the update email was not sent: ${error.message||'Unknown error.'}`);}}document.querySelector('[data-admin-tab="orders"]')?.click();},true);
// Report-only assumptions never change checkout prices or historical order costs.
function freeShippingAnalysis(orders, settings){
  const amount=(value)=>value!==null&&value!==undefined&&String(value).trim()!==''&&Number.isFinite(Number(value))&&Number(value)>=0?Number(value):null;
  const cents=(value)=>Math.round((value+Number.EPSILON)*100)/100;
  const start=settings.start?new Date(settings.start+'T00:00:00').getTime():null;
  const end=settings.end?new Date(settings.end+'T00:00:00').getTime():null;
  const endExclusive=end===null?null:new Date(new Date(end).setDate(new Date(end).getDate()+1)).getTime();
  const packaging=amount(settings.packaging),feePercent=amount(settings.feePercent),feeFixed=amount(settings.feeFixed),fallback=amount(settings.postage),target=amount(settings.target);
  const rows=orders.filter((order)=>{
    const time=Date.parse(order.created_at);
    return ['paid','processing','shipped','completed'].includes(String(order.status||'').toLowerCase())&&amount(order.shipping_amount)===0&&
      (start===null||time>=start)&&(endExclusive===null||time<endExclusive);
  }).map((order)=>{
    const issues=[];
    const subtotal=amount(order.subtotal),discount=amount(order.discount);
    const sales=subtotal===null||discount===null?null:cents(Math.max(0,subtotal-discount));
    if(sales===null)issues.push('Missing sales or discount');
    const items=order.order_items||[];
    const costKnown=items.length>0&&items.every((item)=>amount(item.cost_at_purchase)>0&&amount(item.quantity)>0);
    const cost=costKnown?cents(items.reduce((sum,item)=>sum+Number(item.cost_at_purchase)*Number(item.quantity),0)):null;
    if(cost===null)issues.push('Missing or unverified $0 item cost');
    const recordedPostage=amount(order.shipping_cost);
    const shipping=recordedPostage>0?recordedPostage:fallback;
    if(shipping===null)issues.push('Missing or unverified $0 postage');
    if(packaging===null||feePercent===null||feeFixed===null)issues.push('Enter packaging and payment-fee assumptions');
    const charged=amount(order.total);
    const fees=feePercent!==null&&feeFixed!==null&&(feePercent===0||charged!==null)?cents((charged||0)*feePercent/100+feeFixed):null;
    if(fees===null&&feePercent>0)issues.push('Missing payment total');
    const profit=[sales,cost,shipping,packaging,fees].every((value)=>value!==null)?cents(sales-cost-shipping-packaging-fees):null;
    const threshold=amount(order.free_shipping_threshold);
    return {id:order.id,date:order.created_at||'',threshold,sales,cost,shipping,fees,packaging,profit,
      near:threshold!==null&&threshold>0&&sales!==null&&sales>=threshold&&sales<cents(threshold+5),
      below:profit!==null&&target!==null?profit<target:null,
      postageSource:recordedPostage>0?'Recorded checkout postage':shipping!==null?'Fallback estimate':'Unknown',
      quality:issues.length?issues.join('; '):'Estimated: packaging, fees and checkout postage'};
  }).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  const summarize=(entries)=>{
    const known=entries.filter((row)=>row.profit!==null);
    const sum=(list,key)=>list.reduce((total,row)=>total+(row[key]||0),0);
    const salesRows=entries.filter((row)=>row.sales!==null),postageRows=entries.filter((row)=>row.shipping!==null);
    const profit=sum(known,'profit'),sales=sum(known,'sales');
    return {count:entries.length,known:known.length,missing:entries.length-known.length,
      averageSales:salesRows.length?sum(salesRows,'sales')/salesRows.length:null,
      averageShipping:postageRows.length?sum(postageRows,'shipping')/postageRows.length:null,
      averageProfit:known.length?profit/known.length:null,margin:known.length&&sales>0?profit/sales*100:null,
      profit:known.length?profit:null,below:target===null?null:known.filter((row)=>row.below).length,
      loss:known.filter((row)=>row.profit<0).length};
  };
  const groups=new Map();
  rows.forEach((row)=>{const key=row.threshold;const group=groups.get(key)||{threshold:key,rows:[]};group.rows.push(row);groups.set(key,group);});
  return {rows,groups:[...groups.values()].sort((a,b)=>(a.threshold??Infinity)-(b.threshold??Infinity)).map((group)=>({...group,...summarize(group.rows),near:summarize(group.rows.filter((row)=>row.near))})),totals:summarize(rows)};
}
function renderFreeShippingReport(view,orders,download){
  const storageKey='beadDifferentShippingReportAssumptions';
  let saved={};try{saved=JSON.parse(localStorage.getItem(storageKey)||'{}')||{};}catch(error){/* Defaults also work when storage is unavailable. */}
  const field=(key,label,type='number')=>'<label>'+label+'<input data-shipping-setting="'+key+'" type="'+type+'" '+(type==='number'?'min="0" step="0.01" ':'')+'value="'+adminSafe(String(saved[key]??''))+'"></label>';
  view.innerHTML='<div class="admin-heading"><div><p class="kicker">SHIPPING ANALYSIS</p><h3>Free-shipping profitability</h3><p>Compare money left per order and near the qualifying minimum.</p></div><button type="button" data-download-free-shipping>Download CSV</button></div>'+
    '<form data-shipping-assumptions class="admin-card admin-form"><h4>Comparison settings</h4><div class="admin-form-grid">'+field('start','From (local date)','date')+field('end','Through (local date)','date')+field('target','Minimum profit target per order ($)')+field('packaging','Estimated packaging per order ($)')+field('feePercent','Estimated payment fee (%)')+field('feeFixed','Estimated fixed payment fee per order ($)')+field('postage','Fallback postage for missing / $0 costs ($)')+'</div><p>Enter your own packaging and fee estimates, including 0 if none. Leave unknown costs blank. Assumptions are saved in this browser only and do not change checkout.</p><button type="submit">Update comparison</button><p data-shipping-error role="status"></p></form>'+
    '<p class="inventory-help">Estimated contribution profit = sales after discounts − item costs − postage − packaging − payment fees. Sales tax is excluded from revenue; percentage fees use the charged total, including tax. Only paid, processing, shipped and completed orders with a recorded $0 shipping charge are included. Cancelled and refunded orders are excluded; refund losses and overhead are not included.</p>'+
    '<p class="inventory-help">Recorded postage comes from checkout and may differ from the purchased label. Missing or $0 historical item costs are unverified; those orders have no profit estimate. Missing or $0 postage needs a fallback estimate. Profit averages, margins and target counts use only orders with all required costs; sales and postage averages use their available values.</p>'+
    '<div data-shipping-results></div><section class="admin-card"><h4>Which threshold increases overall profit?</h4><p>Profit per 100 visits: unavailable. Visits and paid-shipping orders are not currently attributed to the threshold shoppers saw. This report measures free-shipping order economics; it cannot measure conversion lift or declare the best threshold for total store profit. Compare similar dates, promotions and product mixes, and treat small samples cautiously.</p></section>';
  const money=(value)=>value===null?'—':'$'+value.toFixed(2);
  const percent=(value)=>value===null?'—':value.toFixed(1)+'%';
  const label=(threshold)=>threshold===null?'Not recorded':threshold===0?'$0 (no minimum)':'$'+threshold.toFixed(2)+'+';
  const table=(headers,body)=>'<div class="admin-table-wrap" tabindex="0" role="region" aria-label="Scrollable shipping comparison"><table class="admin-table free-shipping-table"><thead><tr>'+headers.map((header)=>'<th>'+header+'</th>').join('')+'</tr></thead><tbody>'+(body||'<tr><td colspan="'+headers.length+'">No orders match these dates.</td></tr>')+'</tbody></table></div>';
  const cells=(values)=>'<tr>'+values.map((value)=>'<td>'+adminSafe(String(value))+'</td>').join('')+'</tr>';
  let report,settings;
  const draw=()=>{
    const form=view.querySelector('[data-shipping-assumptions]');if(!form.reportValidity())return;
    const next=Object.fromEntries([...form.querySelectorAll('[data-shipping-setting]')].map((input)=>[input.dataset.shippingSetting,input.value]));
    const error=view.querySelector('[data-shipping-error]');
    if(next.start&&next.end&&next.start>next.end){error.textContent='The end date must be on or after the start date.';return;}
    if(Number(next.feePercent)>100){error.textContent='Payment fee percentage must be between 0 and 100.';return;}
    error.textContent='';settings=next;
    try{localStorage.setItem(storageKey,JSON.stringify(settings));}catch(storageError){error.textContent='Settings applied for this view; browser storage is unavailable.';}
    report=freeShippingAnalysis(orders,settings);
    const targetCount=(group)=>group.below===null?'Set a target':group.known?group.below+' / '+group.known+' ('+(group.below/group.known*100).toFixed(1)+'%)':'—';
    const totals=report.totals;
    view.querySelector('[data-shipping-results]').innerHTML='<div class="admin-stat-grid admin-report-summary"><div class="admin-stat-card"><b>'+totals.count+'</b><span>Free-shipping orders</span></div><div class="admin-stat-card"><b>'+money(totals.averageProfit)+'</b><span>Estimated profit per costed order</span></div><div class="admin-stat-card"><b>'+percent(totals.margin)+'</b><span>Estimated margin on costed orders</span></div><div class="admin-stat-card"><b>'+totals.missing+'</b><span>Orders missing required costs</span></div></div>'+
      '<section class="admin-card"><h4>Compare thresholds</h4><p>Shown by threshold, not ranked by total sales. “Costed” means all inputs needed for an estimate are available; it does not mean audited actual profit.</p>'+table(['Threshold','Orders','Costed / total','Avg order value','Avg postage','Est. profit / order','Est. margin','Below target / costed','Loss-making / costed','Est. profit subtotal'],report.groups.map((group)=>cells([label(group.threshold),group.count,group.known+' / '+group.count,money(group.averageSales),money(group.averageShipping),money(group.averageProfit),percent(group.margin),targetCount(group),group.known?group.loss+' / '+group.known:'—',money(group.profit)])).join(''))+'</section>'+
      '<section class="admin-card"><h4>Orders near the cutoff</h4><p>Net merchandise sales from the threshold up to, but excluding, $5 above it. Large baskets cannot hide the results of minimum qualifying orders.</p>'+table(['Threshold','Net sales band','Orders','Costed / total','Est. profit / order','Est. margin','Below target / costed'],report.groups.filter((group)=>group.threshold>0).map((group)=>cells([label(group.threshold),money(group.threshold)+'–'+money(group.threshold+4.99),group.near.count,group.near.known+' / '+group.near.count,money(group.near.averageProfit),percent(group.near.margin),targetCount(group.near)])).join(''))+'</section>'+
      '<section class="admin-card"><h4>Order details</h4>'+table(['Order','Date','Threshold','Net item sales','Item cost','Postage','Est. packaging','Est. fees','Est. contribution profit','Below target','Cost status'],report.rows.map((row)=>cells([String(row.id).slice(0,8),row.date?new Date(row.date).toLocaleDateString():'—',label(row.threshold),money(row.sales),money(row.cost),money(row.shipping),money(row.packaging),money(row.fees),money(row.profit),row.below===null?'—':row.below?'Yes':'No',row.quality+'; '+row.postageSource])).join(''))+'</section>';
  };
  view.querySelector('[data-shipping-assumptions]').onsubmit=(event)=>{event.preventDefault();draw();};
  view.querySelector('[data-download-free-shipping]').onclick=()=>{
    if(!report)return;
    download([['Free-shipping profitability — estimates, not net income'],['Filters and assumptions'],...Object.entries(settings),['Refunded and cancelled orders excluded; overhead and refund losses excluded'],['Profit metrics exclude orders with missing costs'],[],
      ['Threshold','Orders','Costed orders','Missing costs','Average order value','Average postage','Estimated profit per order','Estimated margin %','Below target','Loss-making','Estimated profit subtotal','Near-cutoff orders','Near-cutoff costed','Near-cutoff avg profit','Near-cutoff margin %','Near-cutoff below target'],
      ...report.groups.map((group)=>[label(group.threshold),group.count,group.known,group.missing,group.averageSales,group.averageShipping,group.averageProfit,group.margin,group.below,group.loss,group.profit,group.near.count,group.near.known,group.near.averageProfit,group.near.margin,group.near.below].map((value)=>value??'')),[],
      ['Order','Date','Threshold','Net item sales','Item cost','Postage','Estimated packaging','Estimated fees','Estimated contribution profit','Below target','Near cutoff','Cost status','Postage source'],
      ...report.rows.map((row)=>[row.id,row.date,label(row.threshold),row.sales,row.cost,row.shipping,row.packaging,row.fees,row.profit,row.below,row.near,row.quality,row.postageSource].map((value)=>value??''))],'free-shipping-profitability.csv');
  };
  draw();
}
const auditXmlEscape=(value)=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const auditXmlCell=(value)=>{const numeric=typeof value==='number'&&Number.isFinite(value);return'<Cell><Data ss:Type="'+(numeric?'Number':'String')+'">'+auditXmlEscape(value)+'</Data></Cell>';};
const auditWorkbookXml=(sheets)=>'<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><DocumentProperties xmlns="urn:schemas-microsoft-com:office:office"><Author>Bead Different Co.</Author></DocumentProperties>'+sheets.map((sheet)=>'<Worksheet ss:Name="'+auditXmlEscape(sheet.name)+'"><Table>'+sheet.rows.map((row)=>'<Row>'+row.map(auditXmlCell).join('')+'</Row>').join('')+'</Table></Worksheet>').join('')+'</Workbook>';
const auditWorkbookSheets=async(file)=>{const text=await file.text();if(!/<Workbook\b[^>]*urn:schemas-microsoft-com:office:spreadsheet/i.test(text))return[{name:'Child SKUs',rows:parseCsv(text)}];const document=new DOMParser().parseFromString(text,'application/xml');if(document.querySelector('parsererror'))throw new Error('The Excel workbook could not be read. Download a fresh year-end audit workbook and upload it unchanged.');const worksheets=[...document.getElementsByTagNameNS('*','Worksheet')];return worksheets.map((worksheet)=>{const name=worksheet.getAttribute('ss:Name')||worksheet.getAttributeNS('urn:schemas-microsoft-com:office:spreadsheet','Name')||'Sheet';const rows=[...worksheet.getElementsByTagNameNS('*','Row')].map((row)=>{let nextIndex=0;const values=[];[...row.getElementsByTagNameNS('*','Cell')].forEach((cell)=>{const indexAttribute=[...cell.attributes].find((attribute)=>attribute.localName==='Index');if(indexAttribute)nextIndex=Math.max(0,Number(indexAttribute.value)-1);const data=cell.getElementsByTagNameNS('*','Data')[0];values[nextIndex]=data?.textContent||'';nextIndex+=1;});return values;}).filter((row)=>row.some((value)=>String(value??'').trim()!=='')).map((row)=>{const headers=row;return headers;});if(!rows.length)return{name,rows:[]};const headers=rows.shift().map((header)=>String(header??'').trim());return{name,rows:rows.map((values)=>Object.fromEntries(headers.map((header,index)=>[header,String(values[index]??'').trim()])))};});};
const auditHeader=(row,aliases)=>{const key=Object.keys(row||{}).find((entry)=>aliases.includes(String(entry||'').toLowerCase().replace(/[^a-z0-9]+/g,'')));return key?row[key]:'';};
const auditNumber=(value,label,rowNumber,{integer=false,required=false}={})=>{const text=String(value??'').trim();if(!text){if(required)return{error:'Row '+rowNumber+': '+label+' is required.',value:null};return{error:'',value:null};}const number=Number(text);if(!Number.isFinite(number)||number<0||(integer&&!Number.isInteger(number)))return{error:'Row '+rowNumber+': '+label+' must be a non-negative '+(integer?'whole ':'')+'number.',value:null};return{error:'',value:number};};
let inventoryRenderToken=0;
async function openImportedEtsySkuCorrection(page,onSaved=()=>{}){
  if(!window.beadSupabase){alert('Correcting imported SKUs requires the connected store database.');return;}
  const listingId=String(page?.listing_id||'').trim();
  const variants=Array.isArray(page?.family_skus)?page.family_skus:[];
  if(!listingId||!variants.length){alert('The saved Etsy SKU family is incomplete. Refresh the import history and try again.');return;}
  const dialog=document.createElement('dialog');
  dialog.className='admin-etsy-correction-dialog';
  dialog.innerHTML='<form class="admin-etsy-correction-form"><button type="button" class="admin-dialog-close" data-close-correction aria-label="Close">×</button><p class="kicker">LOCAL SKU CORRECTION</p><h2>Correct imported SKUs</h2><div data-correction-variants>Loading this listing’s local SKUs and recipes…</div><p data-correction-status role="status"></p><div class="admin-actions"><button type="button" data-cancel-correction>Cancel</button><button type="submit" class="cta" data-save-correction disabled>Save local corrections</button></div></form>';
  document.body.append(dialog);
  const close=()=>{if(dialog.open)dialog.close();dialog.remove();};
  dialog.querySelector('[data-close-correction]').onclick=close;
  dialog.querySelector('[data-cancel-correction]').onclick=close;
  dialog.addEventListener('cancel',(event)=>{event.preventDefault();close();});
  dialog.addEventListener('click',(event)=>{if(event.target===dialog)close();});
  dialog.showModal();
  const status=dialog.querySelector('[data-correction-status]');
  const save=dialog.querySelector('[data-save-correction]');
  const variantsHost=dialog.querySelector('[data-correction-variants]');
  try{
    const inventory=[];
    for(let start=0;;start+=1000){
      const result=await cloudAdmin().from('inventory_skus').select('id,sku,name,source_metadata').order('sku').range(start,start+999);
      if(result.error)throw result.error;
      inventory.push(...(result.data||[]));
      if((result.data||[]).length<1000)break;
    }
    const byId=new Map(inventory.map((row)=>[String(row.id),row]));
    const parentIds=[...new Set(variants.map((variant)=>inventory.find((row)=>String(row.sku||'').trim().toUpperCase()===String(variant.etsy_sku||'').trim().toUpperCase())?.id).filter(Boolean))];
    const recipes=[];
    for(let start=0;start<parentIds.length;start+=100){
      const result=await cloudAdmin().from('inventory_bundle_components').select('bundle_sku_id,component_sku_id,quantity,sort_order').in('bundle_sku_id',parentIds.slice(start,start+100)).order('sort_order');
      if(result.error)throw result.error;
      recipes.push(...(result.data||[]));
    }
    const recipesByParent=new Map();
    recipes.forEach((line)=>{const values=recipesByParent.get(String(line.bundle_sku_id))||[];values.push({sku:byId.get(String(line.component_sku_id))?.sku||'',quantity:Number(line.quantity)||1});recipesByParent.set(String(line.bundle_sku_id),values);});
    const recipePickerMarkup=(component)=>'<label>Inventory component SKU<div class="admin-etsy-correction-sku-picker"><input data-recipe-sku autocomplete="off" value="'+adminSafe(component.sku||'')+'" required><div class="admin-etsy-correction-suggestions" data-recipe-suggestions hidden></div></div></label><label>Quantity<input data-recipe-quantity type="number" min="1" step="1" value="'+Number(component.quantity||1)+'" required></label><button type="button" data-remove-recipe-line aria-label="Remove recipe component">Remove</button>';
    variantsHost.innerHTML=variants.map((variant,index)=>{
      const etsySku=String(variant.etsy_sku||'').trim();
      const parent=inventory.find((row)=>String(row.sku||'').trim().toUpperCase()===etsySku.toUpperCase());
      const components=parent?recipesByParent.get(String(parent.id))||[]:[];
      const recipeEditable=Number(variant.pack_size||0)>1||components.length>0;
      return '<section class="admin-etsy-correction-variant" data-correction-variant="'+index+'"><h3>Etsy SKU <code>'+adminSafe(etsySku)+'</code> <small>· '+Number(variant.pack_size||1)+' pack</small></h3>'+(recipeEditable?'<fieldset><legend>Recipe for this Etsy package</legend><p>Choose the canonical inventory SKUs and quantities used to make one package.</p><div data-recipe-lines>'+components.map((component)=>'<div class="admin-etsy-correction-line">'+recipePickerMarkup(component)+'</div>').join('')+'</div><button type="button" data-add-recipe-line>Add component</button></fieldset>':'')+'</section>';
    }).join('');
    const attachRecipeSkuSuggestions=(line)=>{
      const input=line.querySelector('[data-recipe-sku]');
      const suggestions=line.querySelector('[data-recipe-suggestions]');
      const hide=()=>{suggestions.hidden=true;suggestions.replaceChildren();};
      const show=()=>{
        const term=input.value.trim().toLocaleLowerCase();
        suggestions.replaceChildren();
        if(!term){hide();return;}
        const matches=inventory.filter((record)=>String(record.sku||'').toLocaleLowerCase().includes(term)||String(record.name||'').toLocaleLowerCase().includes(term));
        if(!matches.length){const empty=document.createElement('div');empty.className='admin-etsy-correction-suggestion-status';empty.textContent='No matching canonical inventory SKU.';suggestions.append(empty);suggestions.hidden=false;return;}
        matches.forEach((record)=>{
          const option=document.createElement('button');
          option.type='button';
          option.className='admin-etsy-correction-suggestion';
          option.addEventListener('mousedown',(event)=>event.preventDefault());
          option.addEventListener('click',()=>{input.value=record.sku||'';hide();});
          const sku=document.createElement('strong');sku.textContent=record.sku||'';
          const name=document.createElement('span');name.textContent=record.name||'';
          option.append(sku,name);
          suggestions.append(option);
        });
        suggestions.hidden=false;
      };
      input.addEventListener('input',show);
      input.addEventListener('focus',()=>{if(input.value.trim())show();});
      input.addEventListener('blur',()=>setTimeout(hide,150));
    };
    variantsHost.querySelectorAll('.admin-etsy-correction-line').forEach(attachRecipeSkuSuggestions);
    variantsHost.querySelectorAll('[data-add-recipe-line]').forEach((button)=>button.onclick=()=>{const line=document.createElement('div');line.className='admin-etsy-correction-line';line.innerHTML=recipePickerMarkup({sku:'',quantity:1});button.before(line);line.querySelector('[data-remove-recipe-line]').onclick=()=>line.remove();attachRecipeSkuSuggestions(line);});
    variantsHost.querySelectorAll('[data-remove-recipe-line]').forEach((button)=>button.onclick=()=>button.closest('.admin-etsy-correction-line')?.remove());
    if(!dialog.isConnected)return;
    save.disabled=false;
    status.textContent='Edit canonical recipe components, then save once. Etsy’s data and your local SKU names will not be changed.';
    dialog.querySelector('form').onsubmit=async(event)=>{
      event.preventDefault();
      if(save.disabled)return;
      const rows=variants.map((variant,index)=>{
        const section=variantsHost.querySelector('[data-correction-variant="'+index+'"]');
        const etsySku=String(variant.etsy_sku||'').trim();
        const row={etsy_sku:etsySku,pack_size:Number(variant.pack_size)||1};
        if(section.querySelector('[data-recipe-lines]'))row.recipe_components=[...section.querySelectorAll('.admin-etsy-correction-line')].map((line)=>({sku:line.querySelector('[data-recipe-sku]').value.trim(),quantity:Number(line.querySelector('[data-recipe-quantity]').value)}));
        return row;
      });
      const invalidRecipe=rows.find((row)=>row.recipe_components?.some((component)=>!component.sku||!Number.isInteger(component.quantity)||component.quantity<1));
      if(invalidRecipe){status.textContent='Every recipe line needs a canonical inventory SKU and a positive whole-number quantity. No recipe was changed.';return;}
      save.disabled=true;
      status.textContent='Saving canonical recipes…';
      const result=await cloudAdmin().rpc('correct_imported_etsy_sku_family',{listing_id_value:listingId,variant_rows_value:rows});
      if(result.error){status.textContent='Nothing was changed: '+(result.error.message||'The local correction could not be saved.');save.disabled=false;return;}
      status.textContent='Canonical recipes saved. Etsy SKUs and local SKU names were not changed.';
      await onSaved();
      close();
    };
  }catch(error){status.textContent='Could not load this listing’s local SKU family: '+(error?.message||'Unknown database error.');save.disabled=true;}
}
const canonicalSkuDisposition=(record,hasRecipe=false)=>{const explicit=String(record?.source_metadata?.disposition||'').toLowerCase();if(explicit==='inventory'||explicit==='recipe_parent')return explicit;return hasRecipe||String(record?.item_type||'').toLowerCase()==='non-inventory'||String(record?.hierarchy||'').toLowerCase()==='parent'?'recipe_parent':'inventory';};
async function compressVendorOrderImage(file){const bitmap=await createImageBitmap(file);const scale=Math.min(1,1200/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();const blob=await new Promise((resolve,reject)=>canvas.toBlob((value)=>value?resolve(value):reject(new Error('Could not optimize the image.')),'image/webp',0.82));return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=()=>reject(reader.error||new Error('Could not read the image.'));reader.readAsDataURL(blob);});}
const vendorProductImageBucket='vendor-product-images';
async function signedVendorProductImage(path){if(!path)return'';const result=await cloudAdmin().storage.from(vendorProductImageBucket).createSignedUrl(path,3600);if(result.error)throw result.error;return result.data?.signedUrl||'';}
async function downloadVendorProductImage(path,reorderNumber,sku,button){if(!path)return;button.disabled=true;try{const result=await cloudAdmin().storage.from(vendorProductImageBucket).download(path);if(result.error)throw result.error;const url=URL.createObjectURL(result.data);const link=document.createElement('a');link.href=url;link.download=(String(reorderNumber||sku||'vendor-product').trim().replace(/[^a-z0-9._-]+/gi,'-').replace(/^[.-]+|[.-]+$/g,'')||'vendor-product')+'.webp';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){alert('Vendor image could not be downloaded: '+(error.message||'Unknown storage error.'));}finally{button.disabled=false;}}
async function renderVendorProductImageCell(record){let imageUrl='';if(record.vendor_product_image_path){try{imageUrl=await signedVendorProductImage(record.vendor_product_image_path);}catch(error){}}return'<div class="admin-vendor-report-image">'+(record.vendor_product_image_path?(imageUrl?'<img src="'+adminSafe(imageUrl)+'" alt="Vendor image for '+adminSafe(record.sku)+'" loading="lazy">':'<span>Preview unavailable</span>'):'<span>—</span>')+(record.vendor_product_image_path?'<button type="button" data-download-vendor-image="'+adminSafe(record.vendor_product_image_path)+'" data-vendor-image-reorder="'+adminSafe(record.vendor_reorder_number||'')+'" data-vendor-image-sku="'+adminSafe(record.sku)+'">Download</button>':'')+'<button type="button" data-edit-vendor-details="'+adminSafe(record.id)+'">Edit vendor info</button></div>';}
async function renderVendorChoiceCell(record){const options=record.vendor_options||[];if(!options.length)return'<span>No preferred vendor</span>';return'<label class="admin-vendor-choice"><select aria-label="Preferred vendor for SKU '+adminSafe(record.sku)+'" data-select-vendor-option="'+adminSafe(record.id)+'">'+options.map((option)=>'<option value="'+adminSafe(option.id)+'" '+(option.is_preferred?'selected':'')+'>'+adminSafe(option.vendor_name)+'</option>').join('')+'</select></label>';}
async function renderVendorReorderCell(record){return'<span>'+adminSafe(record.vendor_reorder_number||'—')+'</span>';}
async function openVendorSkuDetailsEditor(record,onSaved=async()=>{}){
  if(!window.beadSupabase){alert('Editing vendor details requires the connected store database.');return;}
  const dialog=document.createElement('dialog');
  dialog.className='admin-inventory-sku-dialog';
  dialog.innerHTML='<form class="admin-inventory-sku-editor admin-vendor-options-editor"><button type="button" class="admin-dialog-close" data-vendor-details-close aria-label="Close">×</button><p class="kicker">CANONICAL INVENTORY</p><h2>Vendor options</h2><p class="admin-inventory-sku-identity">'+adminSafe(record.sku)+'</p><p class="admin-vendor-editor-intro">Add each supplier and that supplier’s reorder number. Choose the preferred supplier for the low-stock report. One shared product image is saved for this SKU.</p><section class="admin-vendor-options-section"><div class="admin-vendor-section-heading"><h3>Vendors and reorder numbers</h3><p>Each vendor can have a different reorder number.</p></div><div data-vendor-option-list></div><button type="button" class="admin-vendor-add-option" data-add-vendor-option>Add vendor</button></section><section class="admin-sku-shared-image"><div class="admin-vendor-section-heading"><h3>Shared product image</h3><p>One image for this SKU, regardless of which vendor is selected.</p></div><label>Product image<input name="vendor_image" data-vendor-shared-image type="file" accept="image/*"></label><div class="admin-vendor-shared-preview"><img data-vendor-shared-preview alt="Shared product image preview" hidden><button type="button" data-vendor-shared-remove hidden>Remove image</button></div></section><p class="admin-inventory-sku-status" data-vendor-details-status role="status">Loading vendor options…</p><div class="admin-actions"><button type="button" data-vendor-details-cancel>Cancel</button><button type="submit" class="cta" data-vendor-details-save disabled>Save vendor options</button></div></form>';
  document.body.append(dialog);
  const form=dialog.querySelector('form');
  const status=dialog.querySelector('[data-vendor-details-status]');
  const save=dialog.querySelector('[data-vendor-details-save]');
  const list=dialog.querySelector('[data-vendor-option-list]');
  let latest=null,selectedImage=null,removeImage=false;
  const previewUrls=new Set();
  const sharedImageInput=form.elements.vendor_image;
  const sharedPreview=dialog.querySelector('[data-vendor-shared-preview]');
  const removeSharedImage=dialog.querySelector('[data-vendor-shared-remove]');
  const close=()=>{previewUrls.forEach((url)=>URL.revokeObjectURL(url));if(dialog.open)dialog.close();dialog.remove();};
  dialog.querySelector('[data-vendor-details-close]').onclick=close;
  dialog.querySelector('[data-vendor-details-cancel]').onclick=close;
  dialog.querySelector('[data-add-vendor-option]').onclick=()=>addVendorOptionRow();
  const addVendorOptionRow=(option={})=>{const row=document.createElement('section');row.className='admin-sku-vendor-option';row.dataset.vendorOptionId=option.id||crypto.randomUUID();row.innerHTML='<label>Vendor name<input data-vendor-name maxlength="160" required value="'+adminSafe(option.vendor_name||'')+'"></label><label>Vendor reorder number<input data-vendor-reorder maxlength="160" value="'+adminSafe(option.vendor_reorder_number||'')+'"></label><label class="admin-vendor-preferred"><input type="radio" name="preferred-vendor-option" data-vendor-preferred '+(option.is_preferred?'checked':'')+'> Preferred vendor</label><button type="button" class="admin-vendor-remove-option" data-remove-vendor-option>Remove vendor</button>';row.querySelector('[data-remove-vendor-option]').onclick=()=>{row.remove();if(!list.children.length)status.textContent='No vendor options saved. Add a vendor or save to clear the vendor list.';};list.append(row);};
  sharedImageInput.onchange=()=>{const file=sharedImageInput.files?.[0];if(!file)return;if(!file.type.startsWith('image/')||file.size>10*1024*1024){sharedImageInput.value='';status.textContent='Choose an image file no larger than 10 MB.';return;}selectedImage=file;removeImage=false;const url=URL.createObjectURL(file);previewUrls.add(url);sharedPreview.src=url;sharedPreview.hidden=false;removeSharedImage.hidden=true;};
  removeSharedImage.onclick=()=>{selectedImage=null;removeImage=true;sharedImageInput.value='';sharedPreview.removeAttribute('src');sharedPreview.hidden=true;removeSharedImage.hidden=true;};
  try{
    const loaded=await cloudAdmin().from('inventory_skus').select('id,sku,preferred_vendor,vendor_reorder_number,vendor_product_image_path,updated_at').eq('id',record.id).maybeSingle();
    if(loaded.error)throw loaded.error;
    if(!loaded.data)throw new Error('This canonical SKU no longer exists.');
    latest=loaded.data;
    const vendorResult=await cloudAdmin().from('inventory_sku_vendors').select('id,vendor_name,vendor_reorder_number,is_preferred').eq('inventory_sku_id',record.id).order('is_preferred',{ascending:false}).order('vendor_name');
    if(vendorResult.error)throw vendorResult.error;
    let options=vendorResult.data||[];
    if(latest.vendor_product_image_path){const url=await signedVendorProductImage(latest.vendor_product_image_path);sharedPreview.src=url;sharedPreview.hidden=!url;removeSharedImage.hidden=!url;}
    if(!options.length&&(latest.preferred_vendor||latest.vendor_reorder_number))options=[{id:crypto.randomUUID(),vendor_name:latest.preferred_vendor||'Unassigned vendor',vendor_reorder_number:latest.vendor_reorder_number,is_preferred:Boolean(latest.preferred_vendor)}];
    options.forEach(addVendorOptionRow);
    save.disabled=false;
    status.textContent='Choose one preferred supplier. The shared image stays with this SKU when you switch vendors.';
  }catch(error){status.textContent='Could not load canonical vendor details: '+(error.message||'Unknown database error.');return;}
  if(!list.children.length)addVendorOptionRow({is_preferred:true});
  form.onsubmit=async(event)=>{
    event.preventDefault();
    if(save.disabled)return;
    save.disabled=true;
    const uploadedPaths=[];
    const previousVendor=latest.preferred_vendor||'';
    const rows=[...list.querySelectorAll('[data-vendor-option-id]')];
    const options=rows.map((row)=>({id:row.dataset.vendorOptionId,vendor_name:row.querySelector('[data-vendor-name]').value.trim(),vendor_reorder_number:row.querySelector('[data-vendor-reorder]').value.trim()||null,is_preferred:row.querySelector('[data-vendor-preferred]').checked}));
    const names=options.map((option)=>option.vendor_name.toLowerCase());
    if(options.some((option)=>!option.vendor_name)||new Set(names).size!==names.length){status.textContent='Enter a unique name for every vendor.';save.disabled=false;return;}
    if(options.length&&!options.some((option)=>option.is_preferred)){status.textContent='Choose which vendor should be preferred.';save.disabled=false;return;}
    status.textContent='Saving vendor options…';
    try{
      let imagePath=latest.vendor_product_image_path||null;
      if(selectedImage){status.textContent='Optimizing shared product image…';const optimized=await optimizeAdminImage(selectedImage);const reorderBase=(options.find((option)=>option.is_preferred)?.vendor_reorder_number||latest.sku).replace(/[^a-z0-9._-]+/gi,'-').replace(/^[.-]+|[.-]+$/g,'')||latest.id;imagePath=latest.id+'/'+reorderBase+'-shared-'+Date.now()+'.webp';const upload=await cloudAdmin().storage.from(vendorProductImageBucket).upload(imagePath,optimized,{upsert:false,contentType:'image/webp',cacheControl:'31536000'});if(upload.error)throw upload.error;uploadedPaths.push(imagePath);}else if(removeImage)imagePath=null;
      const saved=await cloudAdmin().rpc('admin_replace_inventory_sku_vendor_options',{p_inventory_sku_id:latest.id,p_vendors:options,p_vendor_product_image_path:imagePath});
      if(saved.error)throw saved.error;
      const savedOptions=saved.data||[];const preferred=savedOptions.find((option)=>option.is_preferred)||null;Object.assign(record,{preferred_vendor:preferred?.vendor_name||'',vendor_reorder_number:preferred?.vendor_reorder_number||null,vendor_product_image_path:imagePath,vendor_options:savedOptions.map((option)=>({...option,vendor_product_image_path:null}))});
      const obsoletePaths=latest.vendor_product_image_path&&latest.vendor_product_image_path!==imagePath?[latest.vendor_product_image_path]:[];if(obsoletePaths.length)await cloudAdmin().storage.from(vendorProductImageBucket).remove(obsoletePaths);
      try{await onSaved(record,previousVendor);}catch(error){status.textContent='Vendor details saved, but the report did not refresh: '+(error.message||'Unknown error.');}
      close();
    }catch(error){if(uploadedPaths.length)await cloudAdmin().storage.from(vendorProductImageBucket).remove(uploadedPaths);status.textContent='Vendor options were not saved: '+(error.message||'Unknown database or storage error.');save.disabled=false;}
  };
  dialog.showModal();
}
async function vendorOrderImageData(record){if(record.vendor_product_image_data_url)return record.vendor_product_image_data_url;if(!record.vendor_product_image_path)return'';try{const result=await cloudAdmin().storage.from(vendorProductImageBucket).download(record.vendor_product_image_path);if(result.error||!result.data)return'';return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=()=>reject(reader.error||new Error('Could not read an image.'));reader.readAsDataURL(result.data);});}catch(error){return'';}}
async function downloadVendorOrderSheet(records,vendorName,button){const status=button.closest('[data-vendor-group]')?.querySelector('[data-vendor-sheet-status]');button.disabled=true;if(status)status.textContent='Preparing the complete vendor sheet…';try{const cards=[];for(const record of records){const image=await vendorOrderImageData(record);const reorder=String(record.vendor_reorder_number||'').trim();cards.push('<article class="item"><div class="photo">'+(image?'<img src="'+image+'" alt="">':'<span>Vendor image unavailable</span>')+'</div><strong class="reorder">'+adminSafe(reorder||'No reorder number')+'</strong><div class="name">'+adminSafe(record.name||record.sku||'Custom vendor item')+'</div><label class="quantity">Qty to order <input type="number" min="0" step="1" aria-label="Quantity to order for '+adminSafe(record.name||record.sku||'custom item')+'"></label></article>');}const title=String(vendorName||'No preferred vendor');const html='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+adminSafe(title)+' vendor order sheet</title><style>body{font:16px Arial,sans-serif;color:#241128;margin:24px}header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}h1{font-size:24px;margin:0 0 6px}.meta{color:#615965;margin:0 0 22px}button{padding:9px 16px;border:1px solid #8d7785;border-radius:20px;background:#fff;cursor:pointer}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}.item{border:1px solid #d9d1d4;border-radius:8px;padding:10px;text-align:center;break-inside:avoid}.photo{height:150px;display:flex;align-items:center;justify-content:center}.photo img{max-width:100%;max-height:145px;object-fit:contain}.photo span{color:#706872;font-size:13px}.reorder{display:block;font-size:18px;margin:9px 0 5px}.name{font-size:13px}.quantity{display:grid;justify-items:center;gap:5px;margin-top:10px;font-size:13px;font-weight:700}.quantity input{box-sizing:border-box;width:110px;min-height:36px;padding:6px;border:1px solid #aaa;border-radius:5px;font:inherit;text-align:center}@media print{body{margin:10mm}header button{display:none}.grid{grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.item{padding:7px}.photo{height:125px}.photo img{max-height:120px}.quantity input{border:0;border-bottom:1px solid #555;border-radius:0;background:transparent;appearance:textfield}}@media(max-width:700px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}header{align-items:center}}</style></head><body><header><div><h1>'+adminSafe(title)+'</h1><p class="meta">Generated '+new Date().toLocaleString()+'</p></div><button type="button" onclick="window.print()">Save as PDF / Print</button></header><main class="grid">'+cards.join('')+'</main></body></html>';const file=new Blob([html],{type:'text/html;charset=utf-8'});const url=URL.createObjectURL(file);const link=document.createElement('a');link.href=url;link.download=(title==='No preferred vendor'?'unassigned-vendor':title).trim().replace(/[^a-z0-9._-]+/gi,'-').replace(/^[.-]+|[.-]+$/g,'').toLowerCase()+'-order-sheet.html';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);if(status)status.textContent='Downloaded. Open the sheet in a browser, enter order quantities, then choose Save as PDF / Print and select Save as PDF.';}catch(error){if(status)status.textContent='Could not create this vendor sheet: '+(error.message||'Unknown error.');}finally{button.disabled=false;}}
async function openInventorySkuEditor(inventorySkuId,onSaved=()=>{}){
  if(!window.beadSupabase){alert('Editing inventory SKUs requires the connected store database.');return;}
  const dialog=document.createElement('dialog');
  dialog.className='admin-inventory-sku-dialog';
  dialog.innerHTML='<form class="admin-inventory-sku-editor"><button type="button" class="admin-dialog-close" data-close-sku-editor aria-label="Close">×</button><p class="kicker">CANONICAL INVENTORY</p><h2>Edit inventory SKU</h2><p class="admin-inventory-sku-identity">Loading SKU…</p><p class="admin-inventory-sku-note" data-sku-editor-note></p><div class="admin-inventory-sku-fields" data-sku-editor-fields></div><p class="admin-inventory-sku-status" data-sku-editor-status role="status">Loading SKU details…</p><div class="admin-actions"><button type="button" data-cancel-sku-editor>Cancel</button><button type="submit" class="cta" data-save-sku-editor disabled>Save SKU</button></div></form>';
  document.body.append(dialog);
  const close=()=>{if(dialog.open)dialog.close();dialog.remove();};
  dialog.querySelector('[data-close-sku-editor]').onclick=close;
  dialog.querySelector('[data-cancel-sku-editor]').onclick=close;
  dialog.addEventListener('cancel',(event)=>{event.preventDefault();close();});
  dialog.addEventListener('click',(event)=>{if(event.target===dialog)close();});
  dialog.showModal();
  const status=dialog.querySelector('[data-sku-editor-status]');
  const saveButton=dialog.querySelector('[data-save-sku-editor]');
  try{
    const loaded=await cloudAdmin().from('inventory_skus').select('id,sku,name,quantity_on_hand,reorder_point,reserve_quantity,item_type,hierarchy,price,cost,preferred_vendor,vendor_reorder_number,vendor_product_image_path,unit_type,weight_value,weight_unit,taxable,discontinued,source_metadata,updated_at').eq('id',inventorySkuId).maybeSingle();
    if(loaded.error)throw loaded.error;
    if(!loaded.data)throw new Error('This SKU could not be found. Search again and reopen it.');
    const record=loaded.data;
    const recipeResult=await cloudAdmin().from('inventory_bundle_components').select('bundle_sku_id').eq('bundle_sku_id',record.id).limit(1);
    if(recipeResult.error)throw new Error('The saved recipe could not be checked, so calculated inventory fields were not opened for editing. '+recipeResult.error.message);
    if(!dialog.isConnected)return;
    const locked=record.source_metadata?.setup_locked===true||record.source_metadata?.setup_locked==='true';
    const hasRecipe=(recipeResult.data||[]).length>0;
    const currentRole=canonicalSkuDisposition(record,hasRecipe);
    const calculatedParent=currentRole==='recipe_parent';
    dialog.querySelector('.admin-inventory-sku-identity').innerHTML='<strong>SKU</strong><span>SKU changes update this inventory item everywhere it is referenced.</span>';
    const note=dialog.querySelector('[data-sku-editor-note]');
    note.textContent=hasRecipe&&currentRole==='inventory'?'This SKU uses its own on-hand inventory. Its saved recipe stays available for building premade mixed bundles.':calculatedParent?(hasRecipe?'This SKU is a recipe parent. Its available quantity, cost, and weight follow its saved recipe and child SKUs.':'This SKU is a recipe parent with no recipe yet. Add its recipe later to calculate availability, cost, and weight.') :locked?'Inventory setup is finalized. Cost, unit, weight, reserve, and low-stock settings remain protected; on-hand quantity can still be adjusted with a recorded note.':'SKU changes keep linked product variants and recipes connected. Quantity changes are recorded in inventory history.';
    const fields=dialog.querySelector('[data-sku-editor-fields]');
    const protectedDisabled=locked?'disabled':'';
    const inventoryFields='<div class="admin-inventory-sku-grid" data-sku-editor-inventory-fields '+(calculatedParent?'hidden':'')+'><label>Cost<input name="cost" type="number" min="0" step="0.01" value="'+(record.cost??'')+'" '+protectedDisabled+'></label><label>Weight<input name="weight_value" type="number" min="0" step="0.001" value="'+(record.weight_value??'')+'" '+protectedDisabled+'></label><label>Weight unit<select name="weight_unit" '+protectedDisabled+'><option value="oz" '+(record.weight_unit==='oz'?'selected':'')+'>oz</option><option value="lb" '+(record.weight_unit==='lb'?'selected':'')+'>lb</option><option value="g" '+(record.weight_unit==='g'?'selected':'')+'>g</option><option value="kg" '+(record.weight_unit==='kg'?'selected':'')+'>kg</option></select></label><label>Reserve buffer<input name="reserve_quantity" type="number" min="0" step="1" value="'+Number(record.reserve_quantity||0)+'" '+protectedDisabled+'></label><label>Low stock minimum<input name="reorder_point" type="number" min="0" step="1" value="'+Number(record.reorder_point||0)+'" '+protectedDisabled+'></label></div>';
    const quantityFields='<div class="admin-inventory-sku-stock" data-sku-editor-quantity-fields '+(calculatedParent?'hidden':'')+'><p>Current on-hand quantity: <strong>'+Number(record.quantity_on_hand||0)+'</strong></p><div class="admin-inventory-sku-grid"><label>Change on-hand by<input name="quantity_delta" type="number" step="1" placeholder="Positive or negative whole number"></label><label class="admin-inventory-sku-adjustment-note">Note for this quantity change<input name="quantity_note" type="text" maxlength="240" placeholder="Required only when quantity changes"></label></div></div>';
    fields.innerHTML='<div class="admin-inventory-sku-grid"><label>Product name<input name="name" type="text" maxlength="240" value="'+adminSafe(record.name||'')+'" required></label><label>SKU<input name="sku" type="text" maxlength="120" value="'+adminSafe(record.sku||'')+'" required></label><label>SKU type<select name="sku_role"><option value="inventory" '+(currentRole==='inventory'?'selected':'')+'>Inventory / child</option><option value="recipe_parent" '+(currentRole==='recipe_parent'?'selected':'')+'>Parent / non-inventory</option></select></label><label>Price<input name="price" type="number" min="0" step="0.01" value="'+(record.price??'')+'"></label><label>Unit<input name="unit_type" type="text" maxlength="80" value="'+adminSafe(record.unit_type||'Each')+'" '+protectedDisabled+' required></label><label>Preferred vendor<input name="preferred_vendor" type="text" maxlength="160" value="'+adminSafe(record.preferred_vendor||'')+'"></label><label>Vendor reorder number<input name="vendor_reorder_number" type="text" maxlength="160" value="'+adminSafe(record.vendor_reorder_number||'')+'" placeholder="Vendor item number"></label><label class="admin-inventory-sku-check"><input name="discontinued" type="checkbox" '+(record.discontinued?'checked':'')+'> Discontinued</label></div><section class="admin-vendor-image-editor"><label>Vendor product image<input name="vendor_product_image" type="file" accept="image/*"><small>Images are optimized to WebP (max 2400 px, 10 MB input limit) and stored privately for admins.</small></label><div class="admin-vendor-image-preview" data-vendor-image-preview hidden><img alt="Vendor product image preview"><button type="button" data-remove-vendor-image>Remove image</button></div><p data-vendor-image-status role="status"></p></section>'+inventoryFields+quantityFields;
    const vendorImageInput=fields.querySelector('[name="vendor_product_image"]');const vendorImagePreview=fields.querySelector('[data-vendor-image-preview]');const vendorImageStatus=fields.querySelector('[data-vendor-image-status]');let vendorImageFile=null;let removeVendorImage=false;let vendorImageObjectUrl='';const setVendorImagePreview=(url)=>{vendorImagePreview.hidden=!url;vendorImagePreview.querySelector('img').src=url||'';};if(record.vendor_product_image_path){vendorImageStatus.textContent='Loading saved vendor image…';try{setVendorImagePreview(await signedVendorProductImage(record.vendor_product_image_path));vendorImageStatus.textContent='Saved vendor image';}catch(error){vendorImageStatus.textContent='Saved image could not be previewed: '+error.message;}}vendorImageInput.addEventListener('change',()=>{const file=vendorImageInput.files?.[0];if(!file)return;if(!file.type.startsWith('image/')){vendorImageInput.value='';vendorImageStatus.textContent='Choose an image file.';return;}if(file.size>10*1024*1024){vendorImageInput.value='';vendorImageStatus.textContent='Images must be 10 MB or smaller.';return;}vendorImageFile=file;removeVendorImage=false;if(vendorImageObjectUrl)URL.revokeObjectURL(vendorImageObjectUrl);vendorImageObjectUrl=URL.createObjectURL(file);setVendorImagePreview(vendorImageObjectUrl);vendorImageStatus.textContent='Image selected; it will be optimized and saved when you save this SKU.';});fields.querySelector('[data-remove-vendor-image]').onclick=()=>{vendorImageFile=null;vendorImageInput.value='';removeVendorImage=true;setVendorImagePreview('');vendorImageStatus.textContent='Image will be removed when you save this SKU.';};
    const roleInput=fields.querySelector('[name="sku_role"]');
     const syncRoleFields=()=>{const parent=roleInput.value==='recipe_parent';[fields.querySelector('[data-sku-editor-inventory-fields]'),fields.querySelector('[data-sku-editor-quantity-fields]')].forEach((group)=>{group.hidden=parent;group.querySelectorAll('input,select,textarea').forEach((control)=>{control.disabled=parent||control.dataset.skuEditorLocked==='true';});});};
    roleInput.addEventListener('change',syncRoleFields);
     fields.querySelectorAll('[data-sku-editor-inventory-fields] input,[data-sku-editor-inventory-fields] select,[data-sku-editor-quantity-fields] input,[data-sku-editor-quantity-fields] select').forEach((control)=>{control.dataset.skuEditorLocked=String(control.disabled);});
     syncRoleFields();
    const form=dialog.querySelector('form');
    const deleteButton=document.createElement('button');
    deleteButton.type='button';
    deleteButton.textContent='Delete SKU';
    deleteButton.className='admin-delete-sku-button';
    form.querySelector('.admin-actions').prepend(deleteButton);
    const confirmation=document.createElement('div');
    confirmation.className='admin-inventory-sku-delete-confirmation';
    confirmation.hidden=true;
    confirmation.innerHTML='<p>Delete <strong>'+adminSafe(record.sku)+'</strong> from canonical inventory? This cannot be undone. Its on-hand quantity of <strong>'+Number(record.quantity_on_hand||0)+'</strong>, recipe entries, product-page links, and Etsy links will be removed. Deletion is blocked only when this SKU has sales or purchase history.</p><div class="admin-actions"><button type="button" data-cancel-delete-sku>Cancel</button><button type="button" data-confirm-delete-sku>Confirm Delete</button></div>';
    form.querySelector('.admin-actions').before(confirmation);
    deleteButton.onclick=()=>{confirmation.hidden=false;deleteButton.disabled=true;saveButton.disabled=true;status.textContent='Choose Cancel or Confirm Delete.';};
    confirmation.querySelector('[data-cancel-delete-sku]').onclick=()=>{confirmation.hidden=true;deleteButton.disabled=false;saveButton.disabled=false;status.textContent='Deletion cancelled. No changes were made.';};
    confirmation.querySelector('[data-confirm-delete-sku]').onclick=async(event)=>{
      const confirmButton=event.currentTarget;
      confirmButton.disabled=true;
      saveButton.disabled=true;
      status.textContent='Deleting SKU…';
      const result=await cloudAdmin().rpc('delete_unused_inventory_sku',{inventory_sku_id_value:record.id});
      if(result.error){status.textContent='SKU was not deleted: '+(result.error.message||'Unknown database error.');confirmButton.disabled=false;return;}
      status.textContent='SKU deleted.';
      await onSaved();
      close();
    };
    saveButton.disabled=false;
    status.textContent='Edit the fields you need, then save this SKU.';
    form.onsubmit=async(event)=>{
      event.preventDefault();
      if(saveButton.disabled)return;
      const name=form.elements.name.value.trim();
      const nextSku=form.elements.sku.value.trim().toUpperCase();
      const unit=form.elements.unit_type.value.trim();
      const nextRole=form.elements.sku_role.value;
      const nextIsParent=nextRole==='recipe_parent';
      const quantityDelta=nextIsParent?0:(form.elements.quantity_delta.value.trim()===''?0:Number(form.elements.quantity_delta.value));
      const quantityNote=nextIsParent?'':form.elements.quantity_note.value.trim();
      if(!name||!unit){status.textContent='Product name and unit are required.';return;}
      if(!/^[A-Z0-9][A-Z0-9._/-]{0,119}$/.test(nextSku)){status.textContent='Enter a valid SKU using letters, numbers, periods, underscores, slashes, or hyphens.';return;}
      if(!Number.isFinite(quantityDelta)||!Number.isInteger(quantityDelta)){status.textContent='Quantity change must be a whole number.';return;}
      if(quantityDelta&&!quantityNote){status.textContent='Add a note explaining the quantity change so it is recorded in inventory history.';return;}
      const readOptionalNumber=(field,label,integer=false)=>{const raw=form.elements[field]?.value.trim()??'';if(raw==='')return null;const value=Number(raw);if(!Number.isFinite(value)||value<0||(integer&&!Number.isInteger(value)))throw new Error(label+' must be a non-negative '+(integer?'whole ':'')+'number.');return value;};
      let patch;
      try{
        patch={name,price:readOptionalNumber('price','Price'),preferred_vendor:form.elements.preferred_vendor.value.trim()||null,vendor_reorder_number:form.elements.vendor_reorder_number.value.trim()||null,discontinued:form.elements.discontinued.checked,updated_at:new Date().toISOString()};
        if(!locked){patch.unit_type=unit;if(!nextIsParent){patch.cost=readOptionalNumber('cost','Cost');patch.weight_value=readOptionalNumber('weight_value','Weight');patch.weight_unit=form.elements.weight_unit.value;patch.reserve_quantity=readOptionalNumber('reserve_quantity','Reserve buffer',true)??0;patch.reorder_point=readOptionalNumber('reorder_point','Low stock minimum',true)??0;}}
      }catch(error){status.textContent=error?.message||'Check the numeric fields and try again.';return;}
      saveButton.disabled=true;
      status.textContent='Saving SKU details…';
      let detailsSaved=false;
      let roleSaved=false;
      let skuRenamed=false;
      let uploadedVendorImagePath=null;
      let vendorImageCleanupWarning='';
      try{
        if(vendorImageFile){status.textContent='Optimizing and uploading vendor image…';const optimized=await optimizeAdminImage(vendorImageFile);const reorderBase=(form.elements.vendor_reorder_number.value.trim()||record.sku).replace(/[^a-z0-9._-]+/gi,'-').replace(/^[.-]+|[.-]+$/g,'')||record.id;uploadedVendorImagePath=record.id+'/'+reorderBase+'.webp';const upload=await cloudAdmin().storage.from(vendorProductImageBucket).upload(uploadedVendorImagePath,optimized,{upsert:true,contentType:'image/webp',cacheControl:'31536000'});if(upload.error)throw upload.error;patch.vendor_product_image_path=uploadedVendorImagePath;}else if(removeVendorImage){patch.vendor_product_image_path=null;}
        const currentHierarchy=String(record.hierarchy||'').toLowerCase();
        const currentType=String(record.item_type||'').toLowerCase();
        const roleNeedsUpdate=nextRole!==currentRole||record.source_metadata?.disposition!==nextRole||(nextIsParent?currentHierarchy!=='parent'||currentType!=='non-inventory':currentHierarchy==='parent'||currentHierarchy==='single'||currentType!=='inventory');
        let expectedUpdatedAt=record.updated_at;
        if(nextSku!==String(record.sku||'').trim().toUpperCase()){
          status.textContent='Updating SKU and its linked product options and recipes…';
          const renamed=await cloudAdmin().rpc('rename_inventory_sku',{inventory_sku_id_value:record.id,new_sku_value:nextSku});
          if(renamed.error)throw renamed.error;
          record.sku=nextSku;
          expectedUpdatedAt=renamed.data?.updated_at||expectedUpdatedAt;
          skuRenamed=true;
        }
        if(roleNeedsUpdate){
          status.textContent='Saving SKU type…';
          const roleUpdate=await cloudAdmin().rpc('apply_inventory_sku_disposition',{inventory_sku_id_value:record.id,disposition_value:nextRole});
          if(roleUpdate.error)throw roleUpdate.error;
          roleSaved=true;
          expectedUpdatedAt=roleUpdate.data?.updated_at||expectedUpdatedAt;
        }
        const updated=await cloudAdmin().from('inventory_skus').update(patch).eq('id',record.id).eq('updated_at',expectedUpdatedAt).select('id').maybeSingle();
        if(updated.error)throw updated.error;
        if(!updated.data)throw new Error('This SKU changed while you were editing it. Close the editor and reopen the latest version before saving.');
        detailsSaved=true;
        if(record.vendor_product_image_path&&(removeVendorImage||(uploadedVendorImagePath&&uploadedVendorImagePath!==record.vendor_product_image_path))){const removal=await cloudAdmin().storage.from(vendorProductImageBucket).remove([record.vendor_product_image_path]);if(removal.error)vendorImageCleanupWarning=' The previous image could not be removed from storage: '+removal.error.message;}
        if(quantityDelta){
          status.textContent='Details saved. Recording quantity change…';
          const adjustment=await cloudAdmin().rpc('adjust_inventory_skus',{adjustment_rows:[{sku:record.sku,quantity_delta:quantityDelta,note:quantityNote}]});
          if(adjustment.error)throw new Error('SKU details were saved, but the on-hand quantity was not changed: '+adjustment.error.message);
        }
        status.textContent='SKU saved.'+vendorImageCleanupWarning;
        await onSaved();
        close();
      }catch(error){
        if(uploadedVendorImagePath&&!detailsSaved&&uploadedVendorImagePath!==record.vendor_product_image_path)await cloudAdmin().storage.from(vendorProductImageBucket).remove([uploadedVendorImagePath]);
        status.textContent=(detailsSaved?'SKU details were saved, but the remaining change failed: ':roleSaved?'SKU type was saved, but the remaining change failed: ':skuRenamed?'The SKU name was updated, but the remaining changes failed: ':'SKU was not saved: ')+(error?.message||'Unknown database error.');
        saveButton.disabled=false;
      }
    };
    dialog.addEventListener('close',()=>{if(vendorImageObjectUrl)URL.revokeObjectURL(vendorImageObjectUrl);});
  }catch(error){
    if(!dialog.isConnected)return;
    status.textContent='Unable to open this SKU for editing: '+(error?.message||'Unknown database error.');
    saveButton.disabled=true;
  }
}
async function renderInventoryTools(tab='low',runReport=document.body.dataset.inventoryReportActive==='true',fresh=false){if(tab==='audit')runReport=true;if(fresh){clearAdminRowsCachePrefix('inventory:');clearAdminRowsCachePrefix('catalog-part:inventory:');await clearAdminReportCache('report:inventory:');await clearAdminReportCache('report:catalog-part:inventory:');}if(tab==='adjust'&&!runReport&&!adminUrlParams.has('inventory')&&!adminUrlParams.has('recipe')&&!document.body.dataset.inventoryTab)tab='menu';document.body.dataset.inventoryTab=tab;document.body.dataset.inventoryReportActive=runReport?'true':'false';const requestId=++inventoryRenderToken;const isCurrent=()=>requestId===inventoryRenderToken&&activeTab==='inventory';
  const renderInitialShell=()=>{if(!isCurrent())return;panel.innerHTML='<div class="admin-heading"><div><p class="kicker">INVENTORY & REPORTING</p><h2>Inventory and reports</h2><p>Every row below represents one inventory SKU.</p></div></div><div class="admin-tabs inventory-tabs"><button type="button" data-inventory-tab="low">Low Stock</button><button type="button" data-inventory-tab="sales">Sales</button><button type="button" data-inventory-tab="packs">Multi-pack sales</button><button type="button" data-inventory-tab="free-shipping">Free shipping orders</button><button type="button" data-inventory-tab="sku">SKU Search</button><button type="button" data-inventory-tab="adjust">Inventory adjustments</button><button type="button" data-inventory-tab="manual">Manual allocations</button><button type="button" data-inventory-tab="reassign-sales">Reassign sales SKUs</button><button type="button" data-inventory-tab="audit">Year-end audit</button><button type="button" data-inventory-tab="orphans">SKUs without product pages</button><button type="button" data-inventory-tab="missing-recipes">Non-inventory without recipes</button><button type="button" data-inventory-tab="missing-cost-price">Missing cost / price</button><button type="button" data-inventory-tab="uncategorized">Uncategorized</button></div><section id="inventory-view"><div class="admin-empty admin-loading" role="status">Loading inventory and reports…</div></section>';panel.querySelectorAll('[data-inventory-tab]').forEach((button)=>button.addEventListener('click',()=>renderInventoryTools(button.dataset.inventoryTab,false)));};
   renderInitialShell();
  const ensureBulkSkuCreatorTab=()=>{const tabs=panel.querySelector('.inventory-tabs');if(!tabs||tabs.querySelector('[data-inventory-tab="bulk-create"]'))return;const button=document.createElement('button');button.type='button';button.dataset.inventoryTab='bulk-create';button.textContent='Bulk SKU creator';button.onclick=()=>void renderInventoryTools('bulk-create',false);tabs.append(button);};
  ensureBulkSkuCreatorTab();
  const reportCatalog={low:['Low stock SKUs','SKUs at or below their configured reorder threshold.'],sales:['Sales by child SKU','Website and Etsy sales rolled into the physical canonical child SKU.'],packs:['Multi-pack sales','Recorded sales for recipe-based pack SKUs.'], 'free-shipping':['Free shipping orders','Orders where shipping was fully covered by the store.'],sku:['SKU search','Search the canonical inventory SKU and product-page links.'],manual:['Manual allocations','Imported sales waiting for child SKU allocation.'],'reassign-sales':['Reassign sales SKUs','Correct past sales references and choose the stock to restore and deduct.'],audit:['Year-end inventory audit','Download and apply the controlled inventory audit workbook.'],orphans:['SKUs without product pages','Canonical SKUs not present on any product page or product variant.'], 'missing-recipes':['Non-inventory SKUs without recipes','Non-inventory SKUs that do not have a saved recipe.'],'missing-cost-price':['SKUs missing cost or price','Find canonical inventory with a blank or zero cost or retail price.'],uncategorized:['Uncategorized products','Product pages missing a canonical category.']};
  const renderReportLauncher=()=>{const view=panel.querySelector('#inventory-view');if(!view)return;const entries=tab==='menu'?Object.entries(reportCatalog):[[tab,reportCatalog[tab]||['Inventory report','Run the selected inventory report.']]];view.innerHTML='<div class="admin-heading"><div><h3>'+ (tab==='menu'?'Inventory and reports':'Report ready to run') +'</h3><p>Choose a report, then click Run report. No report data is requested while this screen is open.</p></div></div><div class="admin-report-launch-list">'+entries.map(([key,detail])=>'<article class="admin-card admin-report-launch"><div><h4>'+adminSafe(detail[0])+'</h4><p>'+adminSafe(detail[1])+'</p></div><div class="admin-report-launch-actions"><button type="button" data-run-inventory-report="'+adminSafe(key)+'">Run report</button><button type="button" data-run-inventory-fresh="'+adminSafe(key)+'">Run fresh report</button></div></article>').join('')+'</div>';view.querySelectorAll('[data-run-inventory-report]').forEach((button)=>button.onclick=()=>void renderInventoryTools(button.dataset.runInventoryReport,true));view.querySelectorAll('[data-run-inventory-fresh]').forEach((button)=>button.onclick=()=>void renderInventoryTools(button.dataset.runInventoryFresh,true,true));};
  if(!runReport&&!['adjust','bulk-create','reassign-sales'].includes(tab)){renderReportLauncher();return;}
  const cloud=Boolean(await window.beadSupabaseReady||window.beadSupabase);
  let products=[], optionGroups=[], orders=[], etsyMappings=[], analytics=[], inventoryRecords=[], bundleComponents=[], etsySales=[], manualAllocations=[], websiteSalesRows=[], websiteSalesLoaded=false, manualSales=[], manualSalesHistory=[];
  if(cloud){
    const emptyResult=()=>Promise.resolve({data:[],error:null});
    const reportCacheable=['low','sales','packs','free-shipping','random','sku','orphans','uncategorized'].includes(tab);
    const cachedRows=(key,buildQuery)=>(reportCacheable?adminCachedReportRows:adminCachedRows)('inventory:'+key,()=>buildQuery().range(0,999));
    const reportRows=(key,load)=>reportCacheable?adminCachedReportRows('inventory:'+key,load):adminCachedRows('inventory:'+key,load);
     // Reports should load only the source tables they actually use. The
     // previous broad condition pulled the entire product catalog and all
     // option values even for low-stock, shipping, and sales reports.
    const needsProducts=false;
    const needsOptions=false;
    const needsOrders=tab==='free-shipping';
    // Free-shipping profitability is calculated from order rows only. Do not
    // download the entire canonical inventory table just to render that tab.
    // Operational screens use bounded lookups below. Only reports that need
    // every canonical row ask for the inventory snapshot; the explicit audit
    // is the only full-table workflow.
    const needsInventory=tab==='bulk-create';
    const needsSalesReference=['sales','packs'].includes(tab);
    const needsWebsiteSalesMetrics=['sales','packs'].includes(tab);
    const needsEtsySales=['sales','packs'].includes(tab);
    const needsManual=tab==='manual';
    const needsMappings=false;
    const needsEvents=false;
    const includeSnapshotProducts=needsProducts;
    const includeSnapshotOptions=needsOptions;
    // Recipe-builder lookups are search-driven below. Do not download every
    // saved recipe just to render the adjustment tab; reports that actually
    // expand recipe sales/audits still request the bounded server snapshot.
    const includeSnapshotRecipes=false;
    const needsCatalogSnapshot=needsInventory||includeSnapshotProducts||includeSnapshotOptions||includeSnapshotRecipes;
    const loadAuditInventoryPages=async()=>{
      const pageSize=100;
      const loadPage=(page)=>cloudAdmin().rpc('admin_inventory_sku_lookup_page',{p_search:null,p_mode:'all',p_page:page,p_page_size:pageSize});
      const first=await loadPage(1);
      if(first.error)return first;
      const rows=[...(first.data||[])];
      const total=Number(rows[0]?.total_count)||0;
      const pageCount=Math.ceil(total/pageSize);
      for(let start=2;start<=pageCount;start+=6){
        const pages=Array.from({length:Math.min(6,pageCount-start+1)},(_,index)=>start+index);
        const results=await Promise.all(pages.map(loadPage));
        const failed=results.find((result)=>result.error);
        if(failed)return{data:null,error:failed.error};
        results.forEach((result)=>rows.push(...(result.data||[])));
      }
      if(rows.length!==total)return{data:null,error:new Error('The inventory audit loaded '+rows.length+' of '+total+' SKU rows. Please retry the report.')};
      return{data:rows,error:null};
    };
    const auditInventoryResult=tab==='audit'?adminCachedRows('inventory:audit-inventory-pages',loadAuditInventoryPages):emptyResult();
    const [catalogSnapshotResult,orderResult,websiteSalesResult,mappingResult,eventResult,etsySalesResult,manualResult,salesReferenceResult,auditInventoryPageResult,manualSalesResult,manualSalesHistoryResult]=await Promise.all([
       needsCatalogSnapshot?adminCatalogSnapshot('inventory:catalog-snapshot',includeSnapshotProducts,includeSnapshotOptions,includeSnapshotRecipes,false,needsInventory,false,reportCacheable):emptyResult(),
       needsOrders?cachedRows('orders',()=>window.beadSupabase.from('orders').select('id,status,total,subtotal,discount,tax_amount,shipping_amount,shipping_cost,free_shipping_threshold,created_at,order_items(product_id,product_name,sku,quantity,unit_price,cost_at_purchase,selected_options)').in('status',['paid','processing','shipped','completed']).eq('shipping_amount',0).order('id')):emptyResult(),
       needsWebsiteSalesMetrics?reportRows('website-sales-metrics',()=>window.beadSupabase.rpc('admin_website_inventory_sales_metrics')):emptyResult(),
       emptyResult(),
       needsEvents?cachedRows('analytics-events',()=>window.beadSupabase.from('analytics_events').select('event_type,product_id').order('created_at')):emptyResult(),
       needsEtsySales?reportRows('etsy-sales-metrics',()=>window.beadSupabase.rpc('admin_etsy_inventory_sales_metrics')):emptyResult(),
       needsManual?cachedRows('manual-allocations',()=>window.beadSupabase.from('inventory_manual_pack_allocations').select('id,source_type,etsy_sale_line_id,order_item_id,parent_sku,units,status,allocations,note,created_at').eq('status','pending').order('created_at',{ascending:false})):emptyResult(),
       needsSalesReference?reportRows('sales-reference',()=>window.beadSupabase.rpc('admin_inventory_sales_reference')):emptyResult(),
       auditInventoryResult,
       needsSalesReference?reportRows('manual-sales-metrics',()=>window.beadSupabase.rpc('admin_manual_sales_metrics')):emptyResult(),
       needsSalesReference?reportRows('manual-sales-history',()=>window.beadSupabase.rpc('admin_manual_sales_history')):emptyResult()
     ]);
     const catalogSnapshot=adminCatalogSnapshotParts(catalogSnapshotResult);
     const productResult={data:catalogSnapshot.products,error:catalogSnapshot.error};
     const optionResult={data:catalogSnapshot.options,error:catalogSnapshot.error};
     const targetedInventoryResult=needsSalesReference?salesReferenceResult:null;
     const inventoryResult=tab==='audit'?auditInventoryPageResult:(targetedInventoryResult||{data:catalogSnapshot.inventory,error:catalogSnapshot.error});
     const bundleResult={data:catalogSnapshot.recipes,error:catalogSnapshot.error};
     let etsySalesForReport=etsySalesResult.data||[];
    if(etsySalesResult.error&&needsEtsySales){if(!isCurrent())return;panel.innerHTML='<div class="admin-empty"><h3>Etsy sales metrics are unavailable</h3><p>The server aggregate failed, so the dashboard did not download the raw Etsy sales table. Repair the aggregate function and try again.</p></div>';return;}
    let websiteSalesForReport=websiteSalesResult.data||[];
    if(websiteSalesResult.error&&needsWebsiteSalesMetrics){if(!isCurrent())return;panel.innerHTML='<div class="admin-empty"><h3>Website sales metrics are unavailable</h3><p>The server aggregate failed, so the dashboard did not download the raw orders table. Repair the aggregate function and try again.</p></div>';return;}
    if(productResult.error||optionResult.error||orderResult.error||mappingResult.error||eventResult.error||inventoryResult.error||bundleResult.error||manualResult.error||salesReferenceResult.error||manualSalesResult.error||manualSalesHistoryResult.error){if(!isCurrent())return;const failure=[productResult,optionResult,orderResult,mappingResult,eventResult,inventoryResult,bundleResult,manualResult,salesReferenceResult,manualSalesResult,manualSalesHistoryResult].find((result)=>result.error)?.error;panel.innerHTML='<div class="admin-empty">Unable to load inventory reporting: '+adminSafe(failure?.message||'Unknown database error.')+'</div>';return;}
    products=productResult.data||[];optionGroups=optionResult.data||[];if(!orders.length)orders=orderResult.data||[];etsyMappings=mappingResult.data||[];analytics=eventResult.data||[];inventoryRecords=inventoryResult.data||[];bundleComponents=bundleResult.data||[];etsySales=etsySalesForReport;
    websiteSalesRows=websiteSalesForReport;
    websiteSalesLoaded=needsWebsiteSalesMetrics&&!websiteSalesResult.error;
    manualAllocations=manualResult.data||[];
    manualSales=manualSalesResult.data||[];
    manualSalesHistory=manualSalesHistoryResult.data||[];
    if(needsSalesReference&&inventoryRecords.length){
      const bundleIds=inventoryRecords.map((record)=>record.id).filter(Boolean);
      if(bundleIds.length){
        const componentResult=await adminBatchRows(bundleIds,(batch)=>window.beadSupabase.from('inventory_bundle_components').select('bundle_sku_id,component_sku_id,quantity,sort_order').in('bundle_sku_id',batch));
        if(componentResult.error){if(!isCurrent())return;panel.innerHTML='<div class="admin-empty">Unable to load the recipes used by this report: '+adminSafe(componentResult.error.message||'Unknown database error.')+'</div>';return;}
        bundleComponents=componentResult.data||[];
      }
    }
  }else{
    products=adminCatalog().map((item)=>({id:item.id,external_id:item.id,sku:item.sku||'',name:item.name,quantity:Number(item.quantity)||0,price:Number(item.price)||0,estimated_cost:Number(item.estimatedCost)||0,low_stock_threshold:Number(item.lowStockThreshold)||5,category_slug:item.category||'uncategorized',visible:isProductVisible(item),promo_price:null,badges:item.badges||[]}));
    orders=Object.values(adminData().orders||{});etsyMappings=[];inventoryRecords=products.filter((product)=>product.sku).map((product)=>({id:product.id,sku:product.sku,name:product.name,quantity_on_hand:product.quantity,reorder_point:product.low_stock_threshold,price:product.price,cost:product.estimated_cost,category:product.category_slug,preferred_vendor:'',unit_type:'Each',weight_value:null,weight_unit:'oz'}));bundleComponents=[];etsySales=[];manualAllocations=[];manualSales=[];manualSalesHistory=[];
  }
  const title=(product)=>product.name&&product.name!=='1'?product.name:product.external_id||product.sku||'Untitled product';
   const canonicalCategorySlugs=new Set(['beadable-products','beadable-pen-blanks','mixes-bundles-kits','spacers-accessories','acrylic-flatbacks','rhinestone-beads','focal-beads','silicone','acrylic','cup-charms','completed-pens-keychains','charms-dangles','clearance-section']);
   const categoryAliases=new Map([['beadable products','beadable-products'],['beadable pen blanks','beadable-pen-blanks'],['mixes, bundles & kits','mixes-bundles-kits'],['spacers/accessories','spacers-accessories'],['acrylic flatbacks','acrylic-flatbacks'],['rhinestone beads','rhinestone-beads'],['focal beads','focal-beads'],['silicone','silicone'],['acrylic','acrylic'],['cup charms','cup-charms'],['completed pens/keychains','completed-pens-keychains'],['charms/dangles','charms-dangles'],['clearance section','clearance-section']]);
   const canonicalCategory=(row)=>{const productCategory=String(row.product?.category_slug||'').trim();if(canonicalCategorySlugs.has(productCategory))return productCategory;const legacy=String(row.record?.category||productCategory).trim().toLowerCase();if(categoryAliases.has(legacy))return categoryAliases.get(legacy);const inferred=typeof categoryFor==='function'?categoryFor({TITLE:String(row.product?.name||row.record?.name||''),TAGS:''}):'';return canonicalCategorySlugs.has(inferred)?inferred:'';};
   const simpleSkuName=(row)=>{const productName=title(row.product);const variantName=String(row.variantLabel||'').trim();return variantName&&variantName.toLowerCase()!=='standard'&&variantName.toLowerCase()!==productName.toLowerCase()?productName+' — '+variantName:productName;};
   const normalizeSku=(value)=>String(value||'').trim().toLowerCase();
  const productById=new Map(products.map((product)=>[product.id,product]));
  const skuRows=[];
  products.forEach((product)=>{
    const values=optionGroups.filter((option)=>option.product_id===product.id).flatMap((option)=>option.product_option_values||[]).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0));
    if(values.length)values.forEach((value)=>skuRows.push({product,variantId:value.id,variantLabel:value.label,sku:value.sku||value.inventory_sku||'',inventorySku:value.inventory_sku||value.sku||'',quantity:value.quantity===null||value.quantity===undefined?Number(product.quantity)||0:Number(value.quantity)||0,threshold:Number(value.low_stock_threshold)||0,reserve:0,price:Number(product.price||0)+Number(value.price_delta||0),weight:Number(value.weight_value)||null,weightUnit:value.weight_unit||'oz'}));
    else skuRows.push({product,variantId:null,variantLabel:'',sku:'',inventorySku:'',quantity:Number(product.quantity)||0,threshold:Number(product.low_stock_threshold)||0,reserve:0,price:Number(product.price)||0});
  });
  const inventoryBySku=new Map(inventoryRecords.filter((record)=>record.sku).map((record)=>[normalizeSku(record.sku),record]));
  skuRows.forEach((row)=>{const record=inventoryBySku.get(normalizeSku(row.sku));if(record){row.inventoryId=record.id;row.quantity=Number(record.quantity_on_hand)||0;row.threshold=Number(record.reorder_point)||0;row.reserve=Number(record.reserve_quantity)||0;row.price=Number(record.price)||0;row.cost=record.cost===null||record.cost===undefined?'':Number(record.cost);row.vendor=record.preferred_vendor||'';row.weight=record.weight_value===null||record.weight_value===undefined?null:Number(record.weight_value);row.weightUnit=record.weight_unit||'oz';row.record=record;}});
  const linkedSkus=new Set(skuRows.map((row)=>normalizeSku(row.sku)).filter(Boolean));
  inventoryRecords.filter((record)=>record.sku&&!linkedSkus.has(normalizeSku(record.sku))).forEach((record)=>{const product={id:'inventory-'+record.id,external_id:record.sku,sku:record.sku,name:record.name,category_slug:record.category||'uncategorized',visible:false,quantity:record.quantity_on_hand,price:record.price||0,low_stock_threshold:record.reorder_point||0,badges:[]};skuRows.push({product,variantId:null,variantLabel:record.name,inventoryId:record.id,sku:record.sku,inventorySku:record.sku,quantity:Number(record.quantity_on_hand)||0,threshold:Number(record.reorder_point)||0,reserve:Number(record.reserve_quantity)||0,price:Number(record.price)||0,cost:record.cost===null||record.cost===undefined?'':Number(record.cost),vendor:record.preferred_vendor||'',weight:record.weight_value===null||record.weight_value===undefined?null:Number(record.weight_value),weightUnit:record.weight_unit||'oz',record});});
   const uniqueSkuRows=(rows)=>{const bySku=new Map();rows.filter((row)=>row.sku).forEach((row)=>{const key=normalizeSku(row.sku);const current=bySku.get(key);if(!current||(!current.inventoryId&&row.inventoryId))bySku.set(key,row);});return [...bySku.values()];};
   const adjustmentRows=uniqueSkuRows(skuRows);
   const skuBySku=new Map(adjustmentRows.filter((row)=>row.sku).map((row)=>[normalizeSku(row.sku),row]));
   const auditRowsBySku=new Map();skuRows.filter((row)=>row.sku).forEach((row)=>{const key=normalizeSku(row.sku);const existing=auditRowsBySku.get(key);if(!existing){row.reviewNotes='';auditRowsBySku.set(key,row);return;}if(canonicalCategory(existing)!==canonicalCategory(row))existing.reviewNotes='SKU appears on multiple product pages with different categories; review.';});inventoryRecords.forEach((record)=>{const key=normalizeSku(record.sku);if(record.sku&&!auditRowsBySku.has(key)){auditRowsBySku.set(key,{product:{name:record.name||record.sku,external_id:record.sku,category_slug:''},variantLabel:'',sku:record.sku,inventorySku:record.sku,quantity:Number(record.quantity_on_hand)||0,threshold:Number(record.reorder_point)||0,reserve:Number(record.reserve_quantity)||0,price:Number(record.price)||0,cost:record.cost===null||record.cost===undefined?'':Number(record.cost),vendor:record.preferred_vendor||'',weight:record.weight_value===null||record.weight_value===undefined?null:Number(record.weight_value),weightUnit:record.weight_unit||'oz',record,reviewNotes:'SKU is not linked to a product page; review.'});}});const canonicalSkuRows=[...auditRowsBySku.values()].sort((left,right)=>String(left.sku).localeCompare(String(right.sku)));
  const selectedSku=(item)=>{
    if(item.sku)return item.sku;
    const selected=item.selected_options||item.selectedOptions||{};
    if(Array.isArray(selected))return selected.find((value)=>value.sku)?.sku||selected.find((value)=>value.inventorySku)?.inventorySku||'';
    return selected.sku||selected.variantSku||'';
  };
  const salesRows=websiteSalesLoaded?websiteSalesRows.map((item)=>{
    const sku=String(item.sku||'').trim();const row=skuBySku.get(normalizeSku(sku));const quantity=Number(item.quantity)||0;const gross=Number(item.gross_revenue)||0;const salePrice=quantity?gross/quantity:0;const cost=Number(row?.cost??row?.product?.estimated_cost)||0;
    return {date:item.sale_date||'',category:row?.product?.category_slug||row?.record?.category||'uncategorized',product:row?.product?title(row.product):item.product_name||'Unknown product',productId:row?.product?.id||item.product_id||'',sku,quantity,cost,salePrice,vendor:row?.vendor||'',gross,net:(salePrice-cost)*quantity};
  }):orders.flatMap((order)=>(order.order_items||order.items||[]).map((item)=>{
    const sku=selectedSku(item);const row=skuBySku.get(normalizeSku(sku));const quantity=Number(item.quantity)||0;const salePrice=Number(item.unit_price)||0;const cost=Number(row?.cost??row?.product?.estimated_cost)||0;
    return {date:order.created_at||order.createdAt||'',category:row?.product?.category_slug||row?.record?.category||'uncategorized',product:row?.product?title(row.product):item.product_name||'Unknown product',productId:row?.product?.id||'',sku,quantity,cost,salePrice,vendor:row?.vendor||'',gross:salePrice*quantity,net:(salePrice-cost)*quantity};
  }));
  const recipeChildrenBySku=new Map();bundleComponents.forEach((component)=>{const bundle=inventoryRecords.find((record)=>record.id===component.bundle_sku_id);const child=inventoryRecords.find((record)=>record.id===component.component_sku_id);if(!bundle?.sku||!child?.sku)return;const list=recipeChildrenBySku.get(normalizeSku(bundle.sku))||[];list.push({sku:child.sku,quantity:Number(component.quantity)||1});recipeChildrenBySku.set(normalizeSku(bundle.sku),list);});
  const expandSaleSku=(sku,quantity,visited=new Set())=>{const key=normalizeSku(sku);const record=inventoryBySku.get(key);const parts=recipeChildrenBySku.get(key);if(record&&String(record.item_type||'Inventory').toLowerCase()==='non-inventory'&&parts?.length&&!visited.has(key)){const nextVisited=new Set(visited).add(key);return parts.flatMap((part)=>expandSaleSku(part.sku,quantity*part.quantity,nextVisited));}if(record&&String(record.item_type||'Inventory').toLowerCase()==='non-inventory'&&!parts?.length)return[];return sku?[{sku,quantity}]:[];};
  const etsySalesRows=etsySales.map((line)=>{const quantity=Math.max(0,Number(line.quantity||0)-Math.min(Number(line.quantity||0),Number(line.refunded_quantity||0)));const row=inventoryBySku.get(normalizeSku(line.etsy_sku))||inventoryBySku.get(normalizeSku(line.matched_inventory_sku));return{date:line.sale_date||'',category:row?.category||'uncategorized',product:row?.name||line.etsy_sku||'Unknown product',productId:'',sku:line.etsy_sku,quantity,cost:Number(row?.cost||0),salePrice:quantity?Number(line.gross_revenue||0)/quantity:0,vendor:row?.preferred_vendor||'',gross:Number(line.gross_revenue||0),net:Number(line.gross_revenue||0)-Number(row?.cost||0)*(Number(line.inventory_units_applied)||quantity),source:'Etsy'};});
  const manualSalesRows=manualSales.map((line)=>({date:line.sale_date||'',category:inventoryBySku.get(normalizeSku(line.sku))?.category||'uncategorized',product:line.product_name||line.sku,sku:line.sku,quantity:Number(line.quantity)||0,cost:Number(line.cost_total)||0,gross:Number(line.gross_revenue)||0,discount:Number(line.discount_amount)||0,source:'Custom',costBreakdown:Array.isArray(line.cost_breakdown)?line.cost_breakdown:[]}));
  const allSalesRows=[...salesRows.map((row)=>({...row,source:'Website'})),...etsySalesRows,...manualSalesRows];
  const canonicalSearchRows=inventoryRecords.filter((record)=>record.sku).map((record)=>{
    const linked=skuRows.filter((row)=>normalizeSku(row.sku)===normalizeSku(record.sku)&&!String(row.product?.id||'').startsWith('inventory-'));
    const primary=linked[0];
    const pageIds=[...new Set(linked.map((row)=>row.product?.id).filter(Boolean))];
     return primary?{...primary,variantLabel:title(primary.product),record,inventoryId:record.id,sku:record.sku,inventorySku:record.sku,quantity:Number(record.quantity_on_hand)||0,price:Number(record.price)||0,cost:record.cost===null||record.cost===undefined?'':Number(record.cost),vendor:record.preferred_vendor||'',linkedPageCount:pageIds.length,linkedPages:pageIds.map((id)=>{const page=products.find((product)=>product.id===id);return{id,name:page?title(page):id};})}: {product:{id:'inventory-'+record.id,external_id:record.sku,sku:record.sku,name:record.name||record.sku,category_slug:record.category||'uncategorized',visible:false,badges:[]},variantId:null,variantLabel:record.name||record.sku,inventoryId:record.id,sku:record.sku,inventorySku:record.sku,quantity:Number(record.quantity_on_hand)||0,threshold:Number(record.reorder_point)||0,reserve:Number(record.reserve_quantity)||0,price:Number(record.price)||0,cost:record.cost===null||record.cost===undefined?'':Number(record.cost),vendor:record.preferred_vendor||'',record,linkedPageCount:0,linkedPages:[]};
  });
  const soldCounts=salesRows.reduce((result,row)=>{if(row.sku)result[row.sku]=(result[row.sku]||0)+row.quantity;return result;},{});
  const csvEscape=(value)=>'"'+String(value??'').replace(/"/g,'""')+'"';
  const download=(rows,name)=>{const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([rows.map((row)=>row.map(csvEscape).join(',')).join('\n')],{type:'text/csv;charset=utf-8'}));link.download=name;link.click();URL.revokeObjectURL(link.href);};
  const paginate=(rows,tbody,pagination,rowRenderer,empty,colspan)=>{let page=1;const draw=()=>{const pageCount=Math.max(1,Math.ceil(rows().length/adminPageSize));page=Math.min(page,pageCount);const visible=rows().slice((page-1)*adminPageSize,page*adminPageSize);tbody.innerHTML=visible.map(rowRenderer).join('')||'<tr><td colspan="'+colspan+'">'+empty+'</td></tr>';pagination.innerHTML='<button type="button" data-page-prev '+(page===1?'disabled':'')+'>Previous</button><span>Page '+page+' of '+pageCount+' · '+rows().length+' rows</span><button type="button" data-page-next '+(page===pageCount?'disabled':'')+'>Next</button>';pagination.querySelector('[data-page-prev]').onclick=()=>{page=Math.max(1,page-1);draw();};pagination.querySelector('[data-page-next]').onclick=()=>{page=Math.min(pageCount,page+1);draw();};};return{draw,reset:()=>{page=1;draw();}};};
  const activePromo=(product)=>product.promo_price!==null&&product.promo_price!==''&&(!product.promo_starts_at||Date.parse(product.promo_starts_at)<=Date.now())&&(!product.promo_ends_at||Date.parse(product.promo_ends_at)>=Date.now());
  const clearance=(product)=>(String(product.category_slug||'').toLowerCase().includes('clearance')||(product.badges||[]).some((badge)=>String(badge).toLowerCase()==='clearance'));
   const renderShell=()=>{if(!isCurrent())return;panel.innerHTML='<div class="admin-heading"><div><p class="kicker">INVENTORY & REPORTING</p><h2>Inventory and reports</h2><p>Every row below represents one inventory SKU.</p></div></div><div class="admin-tabs inventory-tabs"><button type="button" data-inventory-tab="low">Low Stock</button><button type="button" data-inventory-tab="sales">Sales</button><button type="button" data-inventory-tab="packs">Multi-pack sales</button><button type="button" data-inventory-tab="free-shipping">Free shipping orders</button><button type="button" data-inventory-tab="sku">SKU Search</button><button type="button" data-inventory-tab="adjust">Inventory adjustments</button><button type="button" data-inventory-tab="manual">Manual allocations</button><button type="button" data-inventory-tab="reassign-sales">Reassign sales SKUs</button><button type="button" data-inventory-tab="audit">Year-end audit</button><button type="button" data-inventory-tab="orphans">SKUs without product pages</button><button type="button" data-inventory-tab="missing-recipes">Non-inventory without recipes</button><button type="button" data-inventory-tab="missing-cost-price">Missing cost / price</button><button type="button" data-inventory-tab="uncategorized">Uncategorized</button></div><section id="inventory-view"></section>';panel.querySelectorAll('[data-inventory-tab]').forEach((button)=>button.addEventListener('click',()=>renderInventoryTools(button.dataset.inventoryTab,false)));};
  renderShell();ensureBulkSkuCreatorTab();if(!isCurrent())return;const view=panel.querySelector('#inventory-view');
  const inventoryLookupPage=async(search='',mode='all',page=1,pageSize=60)=>{
    if(!cloud)return{data:[],error:null};
    const result=await cloudAdmin().rpc('admin_inventory_sku_lookup_page',{p_search:String(search||'').trim()||null,p_mode:mode,p_page:page,p_page_size:Math.min(100,Math.max(1,pageSize))});if(!result.error)result.total=Number(result.data?.[0]?.total_count)||0;return result;
  };
  const inventoryLookupAll=async(mode='all',search='')=>{
    const rows=[];let page=1;let total=null;
    while(total===null||rows.length<total){
      const result=await inventoryLookupPage(search,mode,page,100);if(result.error)throw result.error;
      const batch=result.data||[];rows.push(...batch);total=Number(batch[0]?.total_count)||0;if(!batch.length||batch.length<100)break;page+=1;
    }
    return rows;
  };
  const inventoryVendorReportPage=(mode,page=1,pageSize=25)=>cloudAdmin().rpc('admin_inventory_vendor_report_page',{p_mode:mode,p_page:page,p_page_size:pageSize});
  const inventoryVendorReportAll=async(mode)=>{const rows=[];let page=1;let total=null;while(total===null||rows.length<total){const result=await inventoryVendorReportPage(mode,page,100);if(result.error)throw result.error;const batch=result.data||[];rows.push(...batch);total=Number(batch[0]?.total_count)||0;if(!batch.length||batch.length<100)break;page+=1;}const ids=[...new Set(rows.map((row)=>row.id).filter(Boolean))];if(!ids.length)return rows;const [skuResult,recipeResult,vendorResult]=await Promise.all([adminBatchRows(ids,(batch)=>cloudAdmin().from('inventory_skus').select('id,item_type,hierarchy,source_metadata').in('id',batch)),adminBatchRows(ids,(batch)=>cloudAdmin().from('inventory_bundle_components').select('bundle_sku_id').in('bundle_sku_id',batch)),adminBatchRows(ids,(batch)=>cloudAdmin().from('inventory_sku_vendors').select('id,inventory_sku_id,vendor_name,vendor_reorder_number,vendor_product_image_path,is_preferred').in('inventory_sku_id',batch))]);if(skuResult.error)throw skuResult.error;if(recipeResult.error)throw recipeResult.error;if(vendorResult.error)throw vendorResult.error;const skuById=new Map((skuResult.data||[]).map((record)=>[record.id,record]));const recipeParents=new Set((recipeResult.data||[]).map((record)=>record.bundle_sku_id));const vendorsBySku=new Map();(vendorResult.data||[]).forEach((option)=>{const options=vendorsBySku.get(option.inventory_sku_id)||[];options.push(option);vendorsBySku.set(option.inventory_sku_id,options);});rows.forEach((row)=>{row.vendor_options=vendorsBySku.get(row.id)||[];});return rows.filter((row)=>{const record=skuById.get(row.id);if(!record)return false;const explicit=String(record.source_metadata?.disposition||'').toLowerCase();if(explicit)return explicit==='inventory';return !recipeParents.has(row.id)&&String(record.item_type||'inventory').toLowerCase()!=='non-inventory'&&String(record.hierarchy||'').toLowerCase()!=='parent';});};
  if(tab==='reassign-sales'){
    if(!isCurrent())return;
    if(!cloud){view.innerHTML='<div class="admin-empty">Sales reassignment requires the connected inventory database.</div>';return;}
    view.innerHTML='<section class="admin-card"><h3>Reassign sales history</h3><p>Move historical sale references from an incorrect SKU to an existing replacement. Sale revenue is unchanged. Review and edit the physical stock to add back and deduct; recipe suggestions use today’s recipe because older sales may not have saved component details.</p><form class="admin-form" data-reassign-sales-form><div class="admin-form-grid"><label>Incorrect SKU<input type="search" name="source_sku" autocomplete="off" placeholder="Enter exact SKU" required><small data-source-match></small></label><label>Replacement SKU<input type="search" name="target_sku" autocomplete="off" placeholder="Start typing a SKU" list="reassign-target-skus" required><datalist id="reassign-target-skus"></datalist><small data-target-match></small></label></div><div class="admin-actions"><button type="button" data-reassign-preview>Find affected sales</button><span data-reassign-summary role="status"></span></div><details data-reassign-details hidden><summary>Affected sale lines</summary><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Source</th><th>Date</th><th>Order / reference</th><th>SKU</th><th>Sold</th><th>Inventory units applied</th></tr></thead><tbody data-reassign-sale-list></tbody></table></div></details><div data-reassign-movements hidden><section><h4>Inventory to add back</h4><p>Total physical units to restore across the affected sales.</p><div data-reassign-restore-rows></div><button type="button" data-reassign-add-restore>Add add-back SKU</button></section><section><h4>Inventory to deduct</h4><p>Total physical units consumed for the replacement SKU.</p><div data-reassign-deduct-rows></div><button type="button" data-reassign-add-deduct>Add deduction SKU</button></section><label>Reason for correction<textarea name="note" rows="2" maxlength="1000" placeholder="Why these sales are being reassigned"></textarea></label><div class="admin-actions"><button type="submit" class="cta" data-reassign-submit>Apply reassignment</button><span data-reassign-status role="status"></span></div></div></form></section>';
    const form=view.querySelector('[data-reassign-sales-form]');
    const sourceInput=form.elements.source_sku;const targetInput=form.elements.target_sku;
    sourceInput.placeholder='Search canonical SKUs';targetInput.placeholder='Search canonical SKUs';
    const resolveExactSku=async(value)=>{const result=await inventoryLookupPage(value,'all',1,50);if(result.error)throw result.error;return(result.data||[]).find((record)=>normalizeSku(record.sku)===normalizeSku(value))||null;};
    const bindSkuValidation=(input,matchElement)=>{let request=0;input.addEventListener('change',async()=>{const current=++request;matchElement.textContent='Checking inventory…';try{const record=await resolveExactSku(input.value);if(current!==request)return;input.dataset.canonicalSku=record?.sku||'';matchElement.textContent=record?'Matched '+record.sku+' · '+(record.name||record.sku):'Must match an existing canonical SKU exactly.';}catch(error){if(current===request)matchElement.textContent='SKU lookup failed: '+error.message;}});};
    bindSkuValidation(sourceInput,form.querySelector('[data-source-match]'));bindSkuValidation(targetInput,form.querySelector('[data-target-match]'));
    const bindSkuSuggestions=(input,matchElement)=>{input.removeAttribute('list');form.querySelector('#reassign-target-skus')?.remove();const picker=document.createElement('div');picker.className='admin-reassign-sku-picker';input.before(picker);picker.append(input);const suggestions=document.createElement('div');suggestions.className='admin-sku-suggestions';suggestions.hidden=true;picker.append(suggestions);let requestId=0;let timer=null;const hide=()=>{suggestions.hidden=true;suggestions.replaceChildren();};const show=async(query)=>{const current=++requestId;suggestions.hidden=false;suggestions.replaceChildren();const loading=document.createElement('div');loading.className='admin-sku-suggestion-status';loading.textContent='Searching inventory SKUs…';suggestions.append(loading);matchElement.textContent='Searching canonical SKUs…';try{const result=await inventoryLookupPage(query,'all',1,50);if(current!==requestId)return;if(result.error)throw result.error;const records=(result.data||[]).filter((record)=>record.sku);suggestions.replaceChildren();if(!records.length){const empty=document.createElement('div');empty.className='admin-sku-suggestion-status';empty.textContent='No matching canonical SKUs found.';suggestions.append(empty);matchElement.textContent='No matching canonical SKUs found.';return;}const exact=records.find((record)=>normalizeSku(record.sku)===normalizeSku(query));matchElement.textContent=exact?'Matched '+exact.sku+' · '+(exact.name||exact.sku):'Choose an existing canonical SKU from the suggestions.';records.forEach((record)=>{const option=document.createElement('button');option.type='button';option.className='admin-sku-suggestion';option.addEventListener('mousedown',(event)=>event.preventDefault());option.addEventListener('click',()=>{input.value=record.sku;input.dataset.canonicalSku=record.sku;matchElement.textContent='Matched '+record.sku+' · '+(record.name||record.sku);hide();input.dispatchEvent(new Event('change',{bubbles:true}));});const sku=document.createElement('strong');sku.textContent=record.sku;const name=document.createElement('span');name.textContent=record.name||'';option.append(sku,name);suggestions.append(option);});}catch(error){if(current!==requestId)return;suggestions.replaceChildren();const failure=document.createElement('div');failure.className='admin-sku-suggestion-status';failure.textContent='SKU suggestions could not be loaded: '+error.message;suggestions.append(failure);matchElement.textContent='SKU suggestions could not be loaded: '+error.message;}};input.addEventListener('input',()=>{delete input.dataset.canonicalSku;requestId+=1;hide();clearTimeout(timer);const query=input.value.trim();if(query){matchElement.textContent='Searching canonical SKUs…';timer=setTimeout(()=>show(query),180);}else matchElement.textContent='';});input.addEventListener('focus',()=>{const query=input.value.trim();if(query)show(query);});input.addEventListener('blur',()=>{requestId+=1;setTimeout(hide,180);});};
    bindSkuSuggestions(sourceInput,form.querySelector('[data-source-match]'));bindSkuSuggestions(targetInput,form.querySelector('[data-target-match]'));
    const movementRows={restore:form.querySelector('[data-reassign-restore-rows]'),deduct:form.querySelector('[data-reassign-deduct-rows]')};
    [sourceInput,targetInput].forEach((input)=>input.addEventListener('input',()=>{delete input.dataset.canonicalSku;form.querySelector('[data-reassign-details]').hidden=true;form.querySelector('[data-reassign-movements]').hidden=true;form.querySelector('[data-reassign-summary]').textContent='';}));
    const addMovementRow=(kind,sku='',quantity='')=>{const row=document.createElement('div');row.className='admin-manual-child-row';row.dataset.reassignMovement=kind;row.innerHTML='<label>Physical inventory SKU<input data-movement-sku value="'+adminSafe(sku)+'" placeholder="Exact SKU" required></label><label>Total quantity<input data-movement-quantity type="number" min="1" step="1" value="'+adminSafe(quantity)+'" required></label><button type="button" data-remove-movement>Remove</button>';row.querySelector('[data-remove-movement]').onclick=()=>row.remove();movementRows[kind].append(row);};
    const setMovementRows=(kind,components)=>{movementRows[kind].replaceChildren();(components||[]).forEach((component)=>addMovementRow(kind,component.component_sku,component.quantity));};
    form.querySelector('[data-reassign-add-restore]').onclick=()=>addMovementRow('restore');form.querySelector('[data-reassign-add-deduct]').onclick=()=>addMovementRow('deduct');
    form.querySelector('[data-reassign-preview]').onclick=async()=>{const summary=form.querySelector('[data-reassign-summary]');summary.textContent='';form.querySelector('[data-reassign-status]').textContent='';try{const source=await resolveExactSku(sourceInput.value);const target=await resolveExactSku(targetInput.value);if(!source||!target){summary.textContent='Choose two existing SKUs by exact SKU.';return;}if(source.id===target.id){summary.textContent='The replacement must be a different SKU.';return;}sourceInput.dataset.canonicalSku=source.sku;targetInput.dataset.canonicalSku=target.sku;const result=await cloudAdmin().rpc('admin_preview_inventory_sku_reassignment',{p_source_sku:source.sku});if(result.error)throw result.error;const data=result.data||{};const appliedUnits=Number(data.total_units_applied)||0;let restore=[],deduct=[];if(appliedUnits>0){const movementResult=await cloudAdmin().rpc('admin_preview_inventory_sku_reassignment_movements',{p_source_sku:source.sku,p_target_sku:target.sku,p_units:Math.round(appliedUnits)});if(movementResult.error)throw movementResult.error;restore=movementResult.data?.restore||[];deduct=movementResult.data?.deduct||[];}setMovementRows('restore',restore);setMovementRows('deduct',deduct);form.querySelector('[data-reassign-details]').hidden=false;form.querySelector('[data-reassign-sale-list]').innerHTML=(data.sale_lines||[]).map((line)=>'<tr><td>'+adminSafe(line.source)+'</td><td>'+adminSafe(line.date?new Date(line.date).toLocaleDateString():'—')+'</td><td>'+adminSafe(line.reference||line.source_id||'—')+'</td><td>'+adminSafe(line.sku||'—')+'</td><td>'+Number(line.quantity||0)+'</td><td>'+Number(line.inventory_units_applied||0)+'</td></tr>').join('')||'<tr><td colspan="6">No matching sale lines found.</td></tr>';form.querySelector('[data-reassign-movements]').hidden=false;summary.textContent='Found '+Number(data.etsy_sale_lines||0)+' Etsy lines ('+Number(data.staged_etsy_lines||0)+' staged only), '+Number(data.website_order_lines||0)+' website lines, and '+Number(data.manual_sale_lines||0)+' outside-sale lines. '+appliedUnits+' inventory units were applied. Check the editable stock totals; recipe suggestions use the current recipes.';}catch(error){summary.textContent='Could not preview sales: '+error.message;}};
    form.onsubmit=async(event)=>{event.preventDefault();const status=form.querySelector('[data-reassign-status]');const submit=form.querySelector('[data-reassign-submit]');let sourceRecord,targetRecord;try{sourceRecord=await resolveExactSku(sourceInput.value);targetRecord=await resolveExactSku(targetInput.value);}catch(error){status.textContent='SKU validation failed: '+error.message;return;}if(!sourceRecord||!targetRecord){status.textContent='Choose two existing canonical SKUs by exact SKU.';return;}if(sourceRecord.id===targetRecord.id){status.textContent='The replacement must be a different SKU.';return;}const source=sourceRecord.sku;const target=targetRecord.sku;const readMovements=(kind)=>[...movementRows[kind].querySelectorAll('[data-reassign-movement]')].map((row)=>({sku:row.querySelector('[data-movement-sku]').value.trim(),quantity:Number(row.querySelector('[data-movement-quantity]').value)}));const restore=readMovements('restore');const deduct=readMovements('deduct');if([...restore,...deduct].some((item)=>!item.sku||!Number.isInteger(item.quantity)||item.quantity<1)){status.textContent='Every inventory movement needs an exact SKU and positive whole quantity.';return;}if(!window.confirm('Reassign matching Etsy, website, and outside-sale history from '+source+' to '+target+'? This changes on-hand stock using the quantities shown, but does not change revenue.'))return;submit.disabled=true;status.textContent='Applying inventory and sales-history correction…';const result=await cloudAdmin().rpc('reassign_inventory_sku_sales',{p_source_sku:source,p_target_sku:target,p_restore_components:restore,p_deduct_components:deduct,p_note:form.elements.note.value||null});if(result.error){submit.disabled=false;status.textContent='Nothing was reassigned: '+result.error.message;return;}await invalidateAdminAccountingInventoryCaches();const counts=result.data?.reference_counts||{};status.textContent='Done. Reassigned '+(Number(counts.etsy)||0)+' Etsy lines, '+(Number(counts.staged_etsy)||0)+' staged Etsy lines, '+(Number(counts.website)||0)+' website lines, '+(Number(counts.manual)||0)+' outside-sale lines, and '+(Number(counts.manual_allocations)||0)+' saved allocation records. Inventory adjustments were recorded. You can now delete the old SKU if it has no other purchase, recipe, or product-page references.';submit.disabled=true;};
    return;
  }
  if(tab==='manual'){
    const physicalResult=await inventoryLookupPage('', 'physical', 1, 100);
    const physicalInventory=physicalResult.data||[];
    const childOptions='<option value="">Choose child SKU</option>'+physicalInventory.sort((left,right)=>String(left.name||left.sku).localeCompare(String(right.name||right.sku))).map((record)=>'<option value="'+adminSafe(record.sku)+'">'+adminSafe(record.name||record.sku)+' · '+adminSafe(record.sku)+' · On hand '+Number(record.quantity_on_hand||0)+'</option>').join('');
    if(!isCurrent())return;view.innerHTML='<div class="admin-heading"><div><p class="kicker">INVENTORY OPERATIONS</p><h3>Manual SKU allocations</h3><p>Unmatched Etsy sales stay here until they can be matched to canonical inventory. For Etsy values shown as listing:<id>, create the SKU recipe in the normal inventory form, add that exact Etsy value to the product’s Etsy mapping, then click Match/apply. Mixed or random items can still be allocated to child SKUs manually.</p></div></div><div class="admin-stat-summary">'+manualAllocations.length+' manual allocation'+(manualAllocations.length===1?'':'s')+' waiting for allocation</div><div class="admin-list admin-manual-allocation-list">'+(manualAllocations.map((allocation)=>'<article class="admin-card admin-manual-allocation" data-manual-allocation="'+adminSafe(allocation.id)+'" data-manual-parent-sku="'+adminSafe(allocation.parent_sku)+'" data-manual-etsy-line="'+adminSafe(allocation.etsy_sale_line_id||'')+'"><div class="admin-heading"><div><h4>'+adminSafe(allocation.parent_sku)+'</h4><p>'+adminSafe(allocation.source_type==='etsy'?'Etsy import':'Website order')+' · '+Number(allocation.units||0)+' unit'+(Number(allocation.units||0)===1?'':'s')+' · '+adminSafe(allocation.created_at?new Date(allocation.created_at).toLocaleString():'Unknown date')+'</p></div>'+(allocation.source_type==='etsy'?'<button type="button" data-manual-reapply>Match/apply stored sale</button>':'')+'<button type="button" data-manual-add-child>Add child SKU</button></div><div data-manual-children></div><div class="admin-actions"><button type="button" class="cta" data-manual-apply>Apply allocation</button><span data-manual-status></span></div></article>').join('')||'<div class="admin-empty">No manual allocations are waiting for allocation.</div>')+'</div>';
    const manualAllocationHelp=view.querySelector('.admin-heading > div > p:not(.kicker)');if(manualAllocationHelp)manualAllocationHelp.textContent='Use Match/apply stored sale to retry matching after adding a missing canonical SKU. Use Ignore for inventory when a sale should remain in metrics without changing stock. Use Add child SKU only when inventory should be deducted from physical items.';
    view.querySelectorAll('[data-manual-allocation][data-manual-etsy-line]:not([data-manual-etsy-line=""])').forEach((card)=>{const button=document.createElement('button');button.type='button';button.textContent='Ignore for inventory';button.dataset.manualIgnore='';button.title='Keep this Etsy sale in metrics without changing inventory';card.querySelector('.admin-heading').append(button);});
    view.querySelectorAll('[data-manual-ignore]').forEach((button)=>button.onclick=async()=>{const card=button.closest('[data-manual-allocation]');const status=card?.querySelector('[data-manual-status]');const lineId=card?.dataset.manualEtsyLine;if(!card||!status||!lineId)return;if(!window.confirm('Ignore this Etsy sale for inventory? The sale stays in sales metrics, no stock changes, and it will no longer appear in manual allocations.'))return;if(!cloud){status.textContent='Ignoring an Etsy allocation requires the connected store database.';return;}button.disabled=true;status.textContent='Removing this sale from inventory follow-up…';const result=await cloudAdmin().rpc('mark_etsy_sale_lines_reviewed',{p_sale_line_ids:[lineId]});if(result.error){button.disabled=false;status.textContent='The sale was not ignored: '+result.error.message;return;}await renderInventoryTools('manual',true,true);});
    const addChild=(allocationCard)=>{const row=document.createElement('div');row.className='admin-manual-child-row';row.dataset.manualChildRow='';row.innerHTML='<label>Child SKU<select data-manual-child>'+childOptions+'</select></label><label>Quantity<input data-manual-quantity type="number" min="1" step="1" value="1"></label><button type="button" data-manual-remove-child>Remove</button>';row.querySelector('[data-manual-remove-child]').onclick=()=>row.remove();allocationCard.querySelector('[data-manual-children]').append(row);};
    view.querySelectorAll('[data-manual-allocation]').forEach((card)=>{card.querySelector('[data-manual-add-child]').onclick=()=>addChild(card);card.querySelector('[data-manual-apply]').onclick=async()=>{const status=card.querySelector('[data-manual-status]');const rows=[...card.querySelectorAll('[data-manual-child-row]')];const children=rows.map((row)=>({sku:row.querySelector('[data-manual-child]').value,quantity:Number(row.querySelector('[data-manual-quantity]').value)}));if(!children.length||children.some((child)=>!child.sku||!Number.isInteger(child.quantity)||child.quantity<1)){status.textContent='Add at least one child SKU with a positive whole quantity.';return;}if(!cloud){status.textContent='Manual allocations require the connected store database.';return;}const button=card.querySelector('[data-manual-apply]');button.disabled=true;status.textContent='Applying allocation…';const result=await cloudAdmin().rpc('apply_inventory_manual_pack_allocation',{allocation_id:card.dataset.manualAllocation,child_allocations:children,allocation_note:'Manual allocation from admin dashboard'});if(result.error){button.disabled=false;status.textContent='Allocation was not applied: '+result.error.message;return;}await renderInventoryTools('manual',true,true);};});
     view.querySelectorAll('[data-manual-reapply]').forEach((button)=>button.onclick=async()=>{const card=button.closest('[data-manual-allocation]');const status=card?.querySelector('[data-manual-status]');if(!card||!status)return;if(!cloud){status.textContent='Stored-sale matching requires the connected store database.';return;}button.disabled=true;status.textContent='Matching and applying the stored Etsy sale…';const result=await cloudAdmin().rpc('reapply_etsy_unmatched_sales',{etsy_sku_value:card.dataset.manualParentSku});if(result.error){button.disabled=false;status.textContent='Stored sale was not applied: '+result.error.message;return;}const matchedLines=Number(result.data?.matched_lines)||0;if(matchedLines===0&&card.dataset.manualEtsyLine){const lineResult=await cloudAdmin().from('etsy_sale_lines').select('match_status,matched_inventory_sku,quantity,refunded_quantity,inventory_units_applied').eq('id',card.dataset.manualEtsyLine).maybeSingle();if(lineResult.error){button.disabled=false;status.textContent='No unmatched sale was found, and its existing match could not be verified: '+lineResult.error.message;return;}const line=lineResult.data;const quantity=Number(line?.quantity)||0;const refunded=Math.min(quantity,Number(line?.refunded_quantity)||0);const applied=Number(line?.inventory_units_applied)||0;if(line?.match_status==='matched'&&line.matched_inventory_sku&&applied===quantity-refunded){const closed=await cloudAdmin().from('inventory_manual_pack_allocations').update({status:'cancelled',note:'Closed stale allocation; its Etsy sale was already matched and inventory units were applied.'}).eq('id',card.dataset.manualAllocation).eq('status','pending').select('id').maybeSingle();if(closed.error){button.disabled=false;status.textContent='The sale is already matched, but its stale queue entry could not be closed: '+closed.error.message;return;}if(closed.data){status.textContent='This sale was already matched and applied. Closed the stale pending entry; inventory was not changed.';await renderInventoryTools('manual',true,true);return;}const allocationResult=await cloudAdmin().from('inventory_manual_pack_allocations').select('status').eq('id',card.dataset.manualAllocation).maybeSingle();if(allocationResult.error){button.disabled=false;status.textContent='The sale is already matched, but its allocation status could not be verified: '+allocationResult.error.message;return;}if(allocationResult.data?.status!=='pending'){status.textContent='This sale was already matched and applied; its allocation was already closed. Inventory was not changed.';await renderInventoryTools('manual',true,true);return;}}button.disabled=false;status.textContent='No unmatched Etsy sale line was found. The pending allocation remains open because its applied status could not be confirmed.';return;}status.textContent='Applied '+matchedLines+' stored Etsy sale line'+(matchedLines===1?'':'s')+' without contacting Etsy.';await renderInventoryTools('manual',true,true);});
    return;
  }
   if(tab==='orphans'){await renderAdminSkuCoverageReport('orphans');return;}if(tab==='missing-recipes'){await renderAdminSkuCoverageReport('missing-recipes');return;}if(tab==='missing-cost-price'){await renderAdminMissingCostPriceReport();return;}if(tab==='uncategorized'){await renderAdminUncategorizedReportServer();return;}if(tab==='low'){
     if(!isCurrent())return;const mode='low';view.innerHTML='<div class="admin-heading"><div><h3>Low and out of stock SKUs</h3><p>All physical SKUs at or below their configured threshold are grouped by preferred vendor. Download each vendor’s sheet, enter order quantities, then print or save it as a PDF.</p></div></div><section class="admin-card" data-vendor-canonical-search><h3>Add a canonical SKU to this report</h3><p>Search by SKU or product name. The SKU is added temporarily under its saved preferred vendor and is not included in low-stock results next time.</p><label>Search canonical inventory<input type="search" data-vendor-sku-search placeholder="Type a SKU or product name" autocomplete="off" disabled><small data-vendor-sku-search-status role="status">Loading inventory report…</small></label><div data-vendor-sku-search-results></div></section><p data-low-status role="status">Loading inventory…</p><div class="admin-vendor-order-groups" data-low-vendor-groups></div>';
     const vendorGroupsForOrderForm=view.querySelector('[data-low-vendor-groups]');
const canonicalSkuSearch=view.querySelector('[data-vendor-sku-search]');
      const canonicalSkuSearchStatus=view.querySelector('[data-vendor-sku-search-status]');
      const canonicalSkuSearchResults=view.querySelector('[data-vendor-sku-search-results]');
      let canonicalSkuSearchTimer=null;
      let canonicalSkuSearchRequest=0;
      let canonicalSkuSearchMatches=[];
      const enableCanonicalSkuSearch=()=>{const reportStatus=view.querySelector('[data-low-status]')?.textContent||'';if(canonicalSkuSearch.disabled&&!reportStatus.startsWith('Loading inventory')){canonicalSkuSearch.disabled=false;canonicalSkuSearchStatus.textContent='Search by SKU or product name to add an item temporarily.';return true;}return false;};
      const canonicalSkuSearchReadyObserver=new MutationObserver(()=>{if(enableCanonicalSkuSearch())canonicalSkuSearchReadyObserver.disconnect();});
      canonicalSkuSearchReadyObserver.observe(view,{subtree:true,childList:true,characterData:true});
      let pendingCanonicalSkuAddButton=null;
      let canonicalSkuSearchClearTimer=null;
      canonicalSkuSearchResults.addEventListener('click',(event)=>{pendingCanonicalSkuAddButton=event.target.closest('[data-add-canonical-vendor-sku]');},true);
      const canonicalSkuAddConfirmationObserver=new MutationObserver(()=>{
        const confirmation=canonicalSkuSearchStatus.textContent||'';
        if(!confirmation.startsWith('Added ')||!pendingCanonicalSkuAddButton)return;
        const button=pendingCanonicalSkuAddButton;
        const completedQuery=canonicalSkuSearch.value;
        button.textContent='Added ✓';
        button.setAttribute('aria-label','Added to report');
        clearTimeout(canonicalSkuSearchClearTimer);
        canonicalSkuSearchClearTimer=setTimeout(()=>{
          if(canonicalSkuSearch.value===completedQuery){
            canonicalSkuSearch.value='';
            canonicalSkuSearchMatches=[];
            canonicalSkuSearchResults.replaceChildren();
            canonicalSkuSearch.focus();
          }
          if(canonicalSkuSearchStatus.textContent===confirmation)canonicalSkuSearchStatus.textContent='';
          if(pendingCanonicalSkuAddButton===button)pendingCanonicalSkuAddButton=null;
        },450);
      });
      canonicalSkuAddConfirmationObserver.observe(canonicalSkuSearchStatus,{childList:true,characterData:true,subtree:true});
      const searchCanonicalVendorSkus=async(page=1)=>{const query=canonicalSkuSearch.value.trim();const request=++canonicalSkuSearchRequest;if(query.length<2){canonicalSkuSearchMatches=[];canonicalSkuSearchResults.replaceChildren();canonicalSkuSearchStatus.textContent='Enter at least 2 characters to search inventory.';return;}canonicalSkuSearchStatus.textContent='Searching canonical inventory…';canonicalSkuSearchResults.replaceChildren();try{const result=await inventoryLookupPage(query,'physical',page,25);if(request!==canonicalSkuSearchRequest)return;if(result.error)throw result.error;const candidates=(result.data||[]).filter((record)=>record.sku);const ids=candidates.map((record)=>record.id).filter(Boolean);const [detailsResult,recipeResult]=ids.length?await Promise.all([adminBatchRows(ids,(batch)=>cloudAdmin().from('inventory_skus').select('id,item_type,hierarchy,source_metadata,preferred_vendor,vendor_reorder_number,vendor_product_image_path').in('id',batch)),adminBatchRows(ids,(batch)=>cloudAdmin().from('inventory_bundle_components').select('bundle_sku_id').in('bundle_sku_id',batch))]):[{data:[],error:null},{data:[],error:null}];if(detailsResult.error)throw detailsResult.error;if(recipeResult.error)throw recipeResult.error;const detailsById=new Map((detailsResult.data||[]).map((record)=>[record.id,record]));const recipeParents=new Set((recipeResult.data||[]).map((record)=>record.bundle_sku_id));canonicalSkuSearchMatches=candidates.filter((candidate)=>{const details=detailsById.get(candidate.id);if(!details||candidate.discontinued)return false;const disposition=String(details.source_metadata?.disposition||'').toLowerCase();if(disposition)return disposition==='inventory';return !recipeParents.has(candidate.id)&&String(details.item_type||candidate.item_type||'inventory').toLowerCase()!=='non-inventory'&&String(details.hierarchy||'').toLowerCase()!=='parent';}).map((candidate)=>({...candidate,...detailsById.get(candidate.id)}));if(!canonicalSkuSearchMatches.length){canonicalSkuSearchStatus.textContent='No matching physical inventory SKUs found.';return;}canonicalSkuSearchStatus.textContent='Choose a SKU to add it to its saved preferred-vendor group.';canonicalSkuSearchResults.innerHTML='<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>SKU</th><th>Product</th><th>On hand</th><th>Preferred vendor</th><th></th></tr></thead><tbody>'+canonicalSkuSearchMatches.map((record,index)=>'<tr><td>'+adminSafe(record.sku)+'</td><td>'+adminSafe(record.name||'—')+'</td><td>'+Number(record.quantity_on_hand||0)+'</td><td>'+adminSafe(String(record.preferred_vendor||'').trim()||'No preferred vendor')+'</td><td><button type="button" data-add-canonical-vendor-sku="'+index+'">Add to report</button></td></tr>').join('')+'</tbody></table></div>'+(Number(result.total||0)>25?'<div class="admin-heading"><button type="button" data-canonical-vendor-search-page="'+(page-1)+'" '+(page<=1?'disabled':'')+'>Previous</button><span>Page '+page+' of '+Math.ceil(Number(result.total)/25)+'</span><button type="button" data-canonical-vendor-search-page="'+(page+1)+'" '+(page>=Math.ceil(Number(result.total)/25)?'disabled':'')+'>Next</button></div>':'');}catch(error){if(request!==canonicalSkuSearchRequest)return;canonicalSkuSearchStatus.textContent='Could not search inventory: '+(error.message||'Unknown error.');canonicalSkuSearchResults.replaceChildren();}};
      canonicalSkuSearch.addEventListener('input',()=>{clearTimeout(canonicalSkuSearchTimer);canonicalSkuSearchTimer=setTimeout(()=>void searchCanonicalVendorSkus(1),250);});
      canonicalSkuSearchResults.addEventListener('click',async(event)=>{const pageButton=event.target.closest('[data-canonical-vendor-search-page]');if(pageButton){void searchCanonicalVendorSkus(Number(pageButton.dataset.canonicalVendorSearchPage));return;}const addButton=event.target.closest('[data-add-canonical-vendor-sku]');if(!addButton)return;const record=canonicalSkuSearchMatches[Number(addButton.dataset.addCanonicalVendorSku)];if(!record)return;const skuKey=normalizeSku(record.sku);if(vendorGroups.some((group)=>group.allRecords?.some((item)=>normalizeSku(item.sku)===skuKey))){canonicalSkuSearchStatus.textContent=record.sku+' is already included in this report.';return;}addButton.disabled=true;try{const vendorName=String(record.preferred_vendor||'').trim()||'No preferred vendor';let group=vendorGroups.find((candidate)=>candidate.name.toLowerCase()===vendorName.toLowerCase());if(!group){group={name:vendorName,records:[],allRecords:[],lowOutCount:0};vendorGroups.push(group);}if(!group.allRecords){group.allRecords=group.records;group.lowOutCount=group.records.length;}record.vendorOrderPrintSelected=true;record.vendorOrderPrintKey=String(record.sku);group.allRecords.push(record);group.records=group.allRecords.filter((item)=>item.vendorOrderPrintSelected!==false);const groupIndex=vendorGroups.indexOf(group);const section=vendorGroupsForOrderForm.querySelectorAll('[data-vendor-group]')[groupIndex];const includeColumn=Boolean(section?.querySelector('[data-vendor-print-group]')||vendorGroupsForOrderForm.querySelector('[data-vendor-print-group]'));const row='<tr>'+(includeColumn?'<td><input type="checkbox" data-vendor-print-group="'+groupIndex+'" data-vendor-print-key="'+adminSafe(record.vendorOrderPrintKey)+'" checked aria-label="Include '+adminSafe(record.name||record.sku)+' in vendor downloads"></td>':'')+'<td>'+adminSafe(record.category||'uncategorized')+'</td><td>'+adminSafe(record.name||record.sku)+'</td><td>'+adminSafe(record.sku)+'</td><td>Manually added</td><td>'+Number(record.quantity_on_hand||0)+'</td><td>'+Number(record.reorder_point||0)+'</td><td>$'+Number(record.price||0).toFixed(2)+'</td><td>'+(record.cost===null||record.cost===undefined?'—':'$'+Number(record.cost).toFixed(2))+'</td><td>'+await renderVendorReorderCell(record)+'</td><td>'+await renderVendorProductImageCell(record)+'</td></tr>';if(section){section.querySelector('tbody')?.insertAdjacentHTML('beforeend',row);const summary=section.querySelector('.admin-heading p');if(summary)summary.textContent=(group.lowOutCount||0)+' low/out-of-stock SKU'+(group.lowOutCount===1?'':'s')+' · '+(group.allRecords.length-(group.lowOutCount||0))+' temporarily added';}else{const newSection=document.createElement('section');newSection.className='admin-card admin-vendor-order-group';newSection.dataset.vendorGroup='';newSection.innerHTML='<div class="admin-heading"><div><h4>'+adminSafe(group.name)+'</h4><p>0 low/out-of-stock SKUs · 1 temporarily added</p></div><button type="button" data-download-vendor-sheet="'+groupIndex+'">Download entire vendor sheet</button></div><p data-vendor-sheet-status role="status"></p><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Vendor</th><th>Product</th><th>SKU</th><th>Status</th><th>Available</th><th>Minimum</th><th>Price</th><th>Cost</th><th>Vendor reorder number</th><th>Vendor product image</th></tr></thead><tbody>'+row+'</tbody></table></div></section>';if(includeColumn){newSection.dataset.vendorGroupIndex=String(groupIndex);newSection.querySelector('.admin-table thead tr')?.insertAdjacentHTML('afterbegin','<th>Include</th>');newSection.insertAdjacentHTML('beforeend','<div class="admin-vendor-custom-lines"><button type="button" data-add-vendor-custom-line>Add custom order line</button><div data-vendor-custom-editor></div></div>');}vendorGroupsForOrderForm.querySelector('.admin-empty')?.remove();vendorGroupsForOrderForm.append(newSection);}canonicalSkuSearchStatus.textContent='Added '+record.sku+' to '+vendorName+' temporarily. It will clear when you leave this report.';}catch(error){addButton.disabled=false;canonicalSkuSearchStatus.textContent='Could not add SKU to the report: '+(error.message||'Unknown error.');}});


     vendorGroupsForOrderForm.addEventListener('click',(event)=>{const addButton=event.target.closest('[data-add-vendor-custom-line]');if(addButton){const section=addButton.closest('[data-vendor-group]');const editor=section?.querySelector('[data-vendor-custom-editor]');if(editor&&!editor.querySelector('form'))editor.innerHTML='<form data-vendor-custom-form style="display:flex;flex-wrap:wrap;align-items:end;gap:12px;padding:14px;border:1px solid #ded7d5;border-radius:10px;background:#fffdfb"><label style="display:grid;gap:6px;font-weight:700">Vendor order number<input name="reorderNumber" required autocomplete="off" style="max-width:260px;padding:8px;border:1px solid #c9c1be;border-radius:6px;font:inherit"></label><label style="display:grid;gap:6px;font-weight:700">Product image<input name="image" type="file" accept="image/*" required style="max-width:260px;padding:8px;border:1px solid #c9c1be;border-radius:6px;font:inherit"></label><img data-vendor-custom-preview alt="Image preview" hidden style="max-width:100px;max-height:80px;object-fit:contain"><button type="button" data-save-vendor-custom-line>Add to downloads</button><button type="button" data-cancel-vendor-custom-line>Cancel</button><p data-vendor-custom-status role="status"></p></form>';return;}const cancelButton=event.target.closest('[data-cancel-vendor-custom-line]');if(cancelButton){cancelButton.closest('[data-vendor-custom-editor]')?.replaceChildren();return;}const saveButton=event.target.closest('[data-save-vendor-custom-line]');if(!saveButton)return;const editor=saveButton.closest('[data-vendor-custom-editor]');const form=editor?.querySelector('[data-vendor-custom-form]');const section=editor?.closest('[data-vendor-group]');const group=vendorGroups[Number(section?.dataset.vendorGroupIndex)];const reorderNumber=String(form?.elements.reorderNumber.value||'').trim();const imageDataUrl=editor?._vendorOrderImageDataUrl;if(!group||!reorderNumber||!imageDataUrl){const message=form?.querySelector('[data-vendor-custom-status]');if(message)message.textContent='Enter the vendor order number and choose an image first.';return;}const key='custom-'+Date.now()+'-'+Math.random().toString(36).slice(2,8);const record={sku:'',name:'Custom vendor item',vendor_reorder_number:reorderNumber,vendor_product_image_data_url:imageDataUrl,vendorOrderPrintKey:key,vendorOrderPrintSelected:true};group.allRecords.push(record);group.records=group.allRecords.filter((candidate)=>candidate.vendorOrderPrintSelected!==false);const row=section.querySelector('.admin-table tbody')?.insertRow();if(row){row.className='admin-vendor-custom-row';row.innerHTML='<td><input type="checkbox" data-vendor-print-group="'+section.dataset.vendorGroupIndex+'" data-vendor-print-key="'+adminSafe(key)+'" checked aria-label="Include custom vendor line in downloads"></td><td>Custom</td><td>Custom vendor item</td><td>—</td><td>Custom</td><td>—</td><td>—</td><td>—</td><td>—</td><td>'+adminSafe(reorderNumber)+'</td><td><img src="'+adminSafe(imageDataUrl)+'" alt="Custom vendor item" width="70"></td>';}editor.replaceChildren();});
     vendorGroupsForOrderForm.addEventListener('change',async(event)=>{const fileInput=event.target.closest('[data-vendor-custom-form] input[type="file"]');if(!fileInput)return;const editor=fileInput.closest('[data-vendor-custom-editor]');const image=fileInput.files?.[0];if(!editor||!image)return;const status=editor.querySelector('[data-vendor-custom-status]');try{editor._vendorOrderImageDataUrl=await compressVendorOrderImage(image);const preview=editor.querySelector('[data-vendor-custom-preview]');preview.src=editor._vendorOrderImageDataUrl;preview.hidden=false;if(status)status.textContent='Image ready.';}catch(error){editor._vendorOrderImageDataUrl='';if(status)status.textContent='Could not prepare image: '+(error.message||'Unknown error.');}});
     vendorGroupsForOrderForm.addEventListener('change',(event)=>{const checkbox=event.target.closest('[data-vendor-print-group]');if(!checkbox)return;const group=vendorGroups[Number(checkbox.dataset.vendorPrintGroup)];if(!group)return;const record=group.allRecords?.find((candidate)=>String(candidate.vendorOrderPrintKey)===checkbox.dataset.vendorPrintKey);if(!record)return;record.vendorOrderPrintSelected=checkbox.checked;group.records=group.allRecords.filter((candidate)=>candidate.vendorOrderPrintSelected!==false);});
     const vendorFormObserver=new MutationObserver(()=>{const sheetButtons=vendorGroupsForOrderForm.querySelectorAll('[data-download-vendor-sheet]');if(!sheetButtons.length)return;vendorFormObserver.disconnect();vendorGroupsForOrderForm.querySelectorAll('[data-vendor-group]').forEach((section,groupIndex)=>{const group=vendorGroups[groupIndex];if(!group)return;group.allRecords=group.records;section.dataset.vendorGroupIndex=String(groupIndex);section.querySelector('.admin-table thead tr')?.insertAdjacentHTML('afterbegin','<th>Include</th>');section.querySelectorAll('.admin-table tbody tr').forEach((row,rowIndex)=>{const record=group.allRecords[rowIndex];if(!record)return;record.vendorOrderPrintSelected=true;record.vendorOrderPrintKey=String(record.sku);row.insertAdjacentHTML('afterbegin','<td><input type="checkbox" data-vendor-print-group="'+groupIndex+'" data-vendor-print-key="'+adminSafe(record.vendorOrderPrintKey)+'" checked aria-label="Include '+adminSafe(record.name||record.sku)+' in vendor downloads"></td>');});section.insertAdjacentHTML('beforeend','<div class="admin-vendor-custom-lines"><button type="button" data-add-vendor-custom-line>Add custom order line</button><div data-vendor-custom-editor></div></div>');});});
     vendorFormObserver.observe(vendorGroupsForOrderForm,{childList:true});
const temporaryVendorGroupObserver=new MutationObserver(()=>{const sections=[...vendorGroupsForOrderForm.querySelectorAll('[data-vendor-group]')];if(!sections.some((section)=>section.querySelector('[data-vendor-print-group]')))return;sections.forEach((section,groupIndex)=>{if(section.dataset.vendorGroupIndex!==undefined)return;const group=vendorGroups[groupIndex];if(!group)return;section.dataset.vendorGroupIndex=String(groupIndex);if(!group.allRecords)group.allRecords=group.records;section.querySelector('.admin-table thead tr')?.insertAdjacentHTML('afterbegin','<th>Include</th>');section.querySelectorAll('.admin-table tbody tr').forEach((row,rowIndex)=>{const record=group.allRecords[rowIndex];if(!record)return;record.vendorOrderPrintSelected=true;record.vendorOrderPrintKey=String(record.sku);row.insertAdjacentHTML('afterbegin','<td><input type="checkbox" data-vendor-print-group="'+groupIndex+'" data-vendor-print-key="'+adminSafe(record.vendorOrderPrintKey)+'" checked aria-label="Include '+adminSafe(record.name||record.sku)+' in vendor downloads"></td>');});if(!section.querySelector('[data-add-vendor-custom-line]'))section.insertAdjacentHTML('beforeend','<div class="admin-vendor-custom-lines"><button type="button" data-add-vendor-custom-line>Add custom order line</button><div data-vendor-custom-editor></div></div>');});});
      temporaryVendorGroupObserver.observe(vendorGroupsForOrderForm,{childList:true});
      const reindexVendorReportGroups=()=>{const sections=[...vendorGroupsForOrderForm.querySelectorAll('[data-vendor-group]')];sections.forEach((section,index)=>{section.dataset.vendorGroupIndex=String(index);const download=section.querySelector('[data-download-vendor-sheet]');if(download)download.dataset.downloadVendorSheet=String(index);section.querySelectorAll('[data-vendor-print-group]').forEach((checkbox)=>checkbox.dataset.vendorPrintGroup=String(index));});};
      const updateVendorReportGroupSummary=(section)=>{const heading=section?.querySelector('.admin-heading p');if(!heading)return;const rows=[...section.querySelectorAll('tbody tr')];const temporary=rows.filter((row)=>row.textContent.includes('Manually added')).length;const low=rows.length-temporary;heading.textContent=low+' low/out-of-stock SKU'+(low===1?'':'s')+(temporary?' · '+temporary+' temporarily added':'');};
      vendorGroupsForOrderForm.addEventListener('click',async(event)=>{const editButton=event.target.closest('[data-edit-vendor-details]');if(!editButton)return;const skuId=editButton.dataset.editVendorDetails;const row=editButton.closest('tr');const sourceIndex=vendorGroups.findIndex((group)=>(group.allRecords||group.records||[]).some((item)=>item.id===skuId));const record=sourceIndex>=0?(vendorGroups[sourceIndex].allRecords||vendorGroups[sourceIndex].records).find((item)=>item.id===skuId):null;if(!record||!row)return;editButton.disabled=true;try{await openVendorSkuDetailsEditor(record,async(savedRecord,previousVendor)=>{const sourceGroup=vendorGroups.find((group)=>(group.allRecords||group.records||[]).includes(savedRecord));const sourceSection=vendorGroupsForOrderForm.querySelectorAll('[data-vendor-group]')[sourceIndex];const checkbox=row.querySelector('[data-vendor-print-group]');const selected=checkbox?checkbox.checked:savedRecord.vendorOrderPrintSelected!==false;savedRecord.vendorOrderPrintSelected=selected;const oldName=String(previousVendor||'').trim()||'No preferred vendor';const nextName=String(savedRecord.preferred_vendor||'').trim()||'No preferred vendor';row.cells[row.cells.length-2].textContent=savedRecord.vendor_reorder_number||'—';row.cells[row.cells.length-1].innerHTML=await renderVendorProductImageCell(savedRecord);if(oldName.toLowerCase()!==nextName.toLowerCase()&&sourceGroup){sourceGroup.allRecords=(sourceGroup.allRecords||sourceGroup.records||[]).filter((item)=>item.id!==skuId);sourceGroup.records=(sourceGroup.records||[]).filter((item)=>item.id!==skuId);let targetIndex=vendorGroups.findIndex((group)=>group.name.toLowerCase()===nextName.toLowerCase());let targetSection;if(targetIndex<0){targetIndex=vendorGroups.findIndex((group)=>group.name.localeCompare(nextName,undefined,{sensitivity:'base'})>0);if(targetIndex<0)targetIndex=vendorGroups.length;const newGroup={name:nextName,records:[],allRecords:[]};vendorGroups.splice(targetIndex,0,newGroup);const section=document.createElement('section');section.className='admin-card admin-vendor-order-group';section.dataset.vendorGroup='';section.dataset.vendorGroupIndex=String(targetIndex);section.innerHTML='<div class="admin-heading"><div><h4>'+adminSafe(nextName)+'</h4><p>0 low/out-of-stock SKUs</p></div><button type="button" data-download-vendor-sheet="'+targetIndex+'">Download entire vendor sheet</button></div><p data-vendor-sheet-status role="status"></p><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Include</th><th>Vendor</th><th>Product</th><th>SKU</th><th>Status</th><th>Available</th><th>Minimum</th><th>Price</th><th>Cost</th><th>Vendor reorder number</th><th>Vendor product image</th></tr></thead><tbody></tbody></table></div><div class="admin-vendor-custom-lines"><button type="button" data-add-vendor-custom-line>Add custom order line</button><div data-vendor-custom-editor></div></div>';const before=vendorGroupsForOrderForm.querySelectorAll('[data-vendor-group]')[targetIndex]||null;vendorGroupsForOrderForm.insertBefore(section,before);targetSection=section;}else targetSection=vendorGroupsForOrderForm.querySelectorAll('[data-vendor-group]')[targetIndex];const targetGroup=vendorGroups[targetIndex];if(!targetGroup.allRecords)targetGroup.allRecords=[...(targetGroup.records||[])];else if(targetGroup.allRecords===targetGroup.records)targetGroup.allRecords=[...targetGroup.allRecords];targetGroup.records=targetGroup.records||[];targetGroup.allRecords.push(savedRecord);if(selected)targetGroup.records.push(savedRecord);if(checkbox)checkbox.dataset.vendorPrintGroup=String(targetIndex);targetSection?.querySelector('tbody')?.append(row);reindexVendorReportGroups();updateVendorReportGroupSummary(sourceSection);updateVendorReportGroupSummary(targetSection);}const lowStatus=view.querySelector('[data-low-status]');if(lowStatus)lowStatus.textContent='Saved vendor, reorder number, and image to '+savedRecord.sku+'.'+(oldName.toLowerCase()!==nextName.toLowerCase()?' Moved it to '+nextName+'.':'');});}catch(error){const lowStatus=view.querySelector('[data-low-status]');if(lowStatus)lowStatus.textContent='Could not edit vendor details: '+(error.message||'Unknown error.');}finally{if(editButton.isConnected)editButton.disabled=false;}});
     let vendorGroups=[];
      const groupContainer=view.querySelector('[data-low-vendor-groups]');
      const moveVendorReportRow=async(record,row,previousVendor)=>{
        const oldName=String(previousVendor||'').trim()||'No preferred vendor';
        const nextName=String(record.preferred_vendor||'').trim()||'No preferred vendor';
        row.cells[0].innerHTML=await renderVendorChoiceCell(record);
        row.cells[row.cells.length-2].innerHTML=await renderVendorReorderCell(record);
        row.cells[row.cells.length-1].innerHTML=await renderVendorProductImageCell(record);
        if(oldName.toLowerCase()===nextName.toLowerCase())return;
        const sourceIndex=vendorGroups.findIndex((group)=>(group.allRecords||group.records||[]).includes(record));
        const sourceGroup=sourceIndex<0?null:vendorGroups[sourceIndex];
        const sourceSection=vendorGroupsForOrderForm.querySelectorAll('[data-vendor-group]')[sourceIndex];
        const checkbox=row.querySelector('[data-vendor-print-group]');
        const selected=checkbox?checkbox.checked:record.vendorOrderPrintSelected!==false;
        record.vendorOrderPrintSelected=selected;
        if(sourceGroup){sourceGroup.allRecords=(sourceGroup.allRecords||sourceGroup.records||[]).filter((item)=>item!==record);sourceGroup.records=(sourceGroup.records||[]).filter((item)=>item!==record);}
        let targetIndex=vendorGroups.findIndex((group)=>group.name.toLowerCase()===nextName.toLowerCase());
        let targetSection;
        if(targetIndex<0){targetIndex=vendorGroups.findIndex((group)=>group.name.localeCompare(nextName,undefined,{sensitivity:'base'})>0);if(targetIndex<0)targetIndex=vendorGroups.length;vendorGroups.splice(targetIndex,0,{name:nextName,records:[],allRecords:[]});const section=document.createElement('section');section.className='admin-card admin-vendor-order-group';section.dataset.vendorGroup='';section.innerHTML='<div class="admin-heading"><div><h4>'+adminSafe(nextName)+'</h4><p>0 low/out-of-stock SKUs</p></div><button type="button" data-download-vendor-sheet="'+targetIndex+'">Download entire vendor sheet</button></div><p data-vendor-sheet-status role="status"></p><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Include</th><th>Vendor</th><th>Product</th><th>SKU</th><th>Status</th><th>Available</th><th>Minimum</th><th>Price</th><th>Cost</th><th>Vendor reorder number</th><th>Vendor product image</th></tr></thead><tbody></tbody></table></div><div class="admin-vendor-custom-lines"><button type="button" data-add-vendor-custom-line>Add custom order line</button><div data-vendor-custom-editor></div></div>';const before=vendorGroupsForOrderForm.querySelectorAll('[data-vendor-group]')[targetIndex]||null;vendorGroupsForOrderForm.insertBefore(section,before);targetSection=section;}
        else targetSection=vendorGroupsForOrderForm.querySelectorAll('[data-vendor-group]')[targetIndex];
        const targetGroup=vendorGroups[targetIndex];if(!targetGroup.allRecords)targetGroup.allRecords=[...(targetGroup.records||[])];else if(targetGroup.allRecords===targetGroup.records)targetGroup.allRecords=[...targetGroup.allRecords];targetGroup.records=targetGroup.records||[];targetGroup.allRecords.push(record);if(selected)targetGroup.records.push(record);if(checkbox)checkbox.dataset.vendorPrintGroup=String(targetIndex);targetSection?.querySelector('tbody')?.append(row);reindexVendorReportGroups();updateVendorReportGroupSummary(sourceSection);updateVendorReportGroupSummary(targetSection);
      };
      vendorGroupsForOrderForm.addEventListener('change',async(event)=>{const selector=event.target.closest('[data-select-vendor-option]');if(!selector)return;const recordId=selector.dataset.selectVendorOption;const record=vendorGroups.flatMap((group)=>group.allRecords||group.records||[]).find((item)=>item.id===recordId);const option=(record?.vendor_options||[]).find((item)=>item.id===selector.value);if(!record||!option)return;const previousVendor=record.preferred_vendor||'';selector.disabled=true;try{const result=await cloudAdmin().from('inventory_skus').update({preferred_vendor:option.vendor_name,vendor_reorder_number:option.vendor_reorder_number,updated_at:new Date().toISOString()}).eq('id',record.id).select('id,preferred_vendor,vendor_reorder_number,vendor_product_image_path').maybeSingle();if(result.error)throw result.error;if(!result.data)throw new Error('The SKU was not updated. Refresh the report and try again.');Object.assign(record,result.data);record.vendor_options=record.vendor_options.map((item)=>({...item,is_preferred:item.id===option.id}));await moveVendorReportRow(record,selector.closest('tr'),previousVendor);const lowStatus=view.querySelector('[data-low-status]');if(lowStatus)lowStatus.textContent='Preferred vendor changed to '+option.vendor_name+' for '+record.sku+'.';}catch(error){selector.value=(record.vendor_options||[]).find((item)=>item.is_preferred)?.id||'';const lowStatus=view.querySelector('[data-low-status]');if(lowStatus)lowStatus.textContent='Vendor was not changed: '+(error.message||'Unknown database error.');}finally{if(selector.isConnected)selector.disabled=false;}});
      vendorGroupsForOrderForm.addEventListener('click',async(event)=>{const editButton=event.target.closest('[data-edit-vendor-details]');if(!editButton)return;const skuId=editButton.dataset.editVendorDetails;const row=editButton.closest('tr');const record=vendorGroups.flatMap((group)=>group.allRecords||group.records||[]).find((item)=>item.id===skuId);if(!record||!row)return;editButton.disabled=true;try{await openVendorSkuDetailsEditor(record,async(savedRecord,previousVendor)=>{await moveVendorReportRow(savedRecord,row,previousVendor);const lowStatus=view.querySelector('[data-low-status]');if(lowStatus)lowStatus.textContent='Saved vendor options to '+savedRecord.sku+'.'+(String(previousVendor||'').toLowerCase()!==String(savedRecord.preferred_vendor||'').toLowerCase()?' Moved it to '+(savedRecord.preferred_vendor||'No preferred vendor')+'.':'');});}catch(error){const lowStatus=view.querySelector('[data-low-status]');if(lowStatus)lowStatus.textContent='Could not edit vendor details: '+(error.message||'Unknown error.');}finally{if(editButton.isConnected)editButton.disabled=false;}});
      groupContainer.addEventListener('click',(event)=>{const imageButton=event.target.closest('[data-download-vendor-image]');if(imageButton){void downloadVendorProductImage(imageButton.dataset.downloadVendorImage,imageButton.dataset.vendorImageReorder,imageButton.dataset.vendorImageSku,imageButton);return;}const sheetButton=event.target.closest('[data-download-vendor-sheet]');if(!sheetButton)return;const group=vendorGroups[Number(sheetButton.dataset.downloadVendorSheet)];if(group)void downloadVendorOrderSheet(group.records,group.name,sheetButton);});
      const status=view.querySelector('[data-low-status]');try{const records=await inventoryVendorReportAll(mode);if(!isCurrent())return;const grouped=new Map();records.forEach((record)=>{const name=String(record.preferred_vendor||'').trim()||'No preferred vendor';if(!grouped.has(name))grouped.set(name,[]);grouped.get(name).push(record);});vendorGroups=[...grouped.entries()].sort(([left],[right])=>left.localeCompare(right,undefined,{sensitivity:'base'})).map(([name,groupRecords])=>({name,records:groupRecords.sort((left,right)=>String(left.name||left.sku).localeCompare(String(right.name||right.sku),undefined,{sensitivity:'base'}))}));const sections=await Promise.all(vendorGroups.map(async(group,index)=>'<section class="admin-card admin-vendor-order-group" data-vendor-group><div class="admin-heading"><div><h4>'+adminSafe(group.name)+'</h4><p>'+group.records.length+' low/out-of-stock SKU'+(group.records.length===1?'':'s')+'</p></div><button type="button" data-download-vendor-sheet="'+index+'">Download entire vendor sheet</button></div><p data-vendor-sheet-status role="status"></p><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Vendor</th><th>Product</th><th>SKU</th><th>Status</th><th>Available</th><th>Minimum</th><th>Price</th><th>Cost</th><th>Vendor reorder number</th><th>Vendor product image</th></tr></thead><tbody>'+ (await Promise.all(group.records.map(async(record)=>'<tr><td>'+await renderVendorChoiceCell(record)+'</td><td>'+adminSafe(record.name||record.sku)+'</td><td>'+adminSkuLink(record.sku,'')+'</td><td>'+(adminNetAvailable(record)<=0?'Out of stock':'Low stock')+'</td><td>'+adminNetAvailable(record)+'</td><td>'+Number(record.reorder_point||0)+'</td><td>$'+Number(record.price||0).toFixed(2)+'</td><td>'+(record.cost===null||record.cost===undefined?'—':'$'+Number(record.cost).toFixed(2))+'</td><td>'+adminSafe(record.vendor_reorder_number||'—')+'</td><td>'+await renderVendorProductImageCell(record)+'</td></tr>'))).join('')+'</tbody></table></div></section>'));groupContainer.innerHTML=sections.join('')||'<div class="admin-empty">No low or out-of-stock SKUs found.</div>';status.textContent=records.length+' low/out-of-stock SKU'+(records.length===1?'':'s')+' across '+vendorGroups.length+' preferred-vendor group'+(vendorGroups.length===1?'':'s')+'.';}catch(error){status.textContent='Unable to load low/out-of-stock inventory: '+(error.message||'Unknown error.');groupContainer.innerHTML='<div class="admin-empty">Report could not be loaded.</div>';}return;
   }
   if(tab==='free-shipping'){if(!isCurrent())return;renderFreeShippingReport(view,orders,download);return;}
   if(tab==='sales'){
     if(!isCurrent())return;view.innerHTML='<section class="admin-card"><h3>Record an outside sale</h3><p>Enter each canonical SKU, quantity sold, and its line subtotal before discounts. Inventory parents with recipes deduct their physical recipe components; inventory SKUs deduct directly. SKU cost is captured when saved. Tax is recorded separately from revenue.</p><form class="admin-form" data-custom-sale-form><div class="admin-form-grid"><label>Date sold<input name="sold_at" type="date" required value="'+new Date().toISOString().slice(0,10)+'"></label><label>Sale source<select name="channel"><option value="cash">Cash</option><option value="facebook">Facebook</option><option value="other">Other</option></select></label><label>Reference (optional)<input name="reference" maxlength="200" placeholder="Customer, receipt, or order reference"></label></div><div data-custom-sale-lines></div><div class="admin-form-grid"><label>Discount<input name="discount_amount" type="number" min="0" step="0.01" value="0"></label><label>Shipping collected<input name="shipping_collected" type="number" min="0" step="0.01" value="0"></label><label>Tax collected<input name="tax_collected" type="number" min="0" step="0.01" value="0"></label><strong data-custom-sale-total>Enter sale lines to calculate amount collected.</strong></div><div class="admin-actions"><button type="button" data-custom-sale-add>Add SKU</button><button type="submit" class="cta">Save sale and deduct inventory</button></div><label>Notes (optional)<textarea name="notes" rows="2" maxlength="2000"></textarea></label><p data-custom-sale-status role="status"></p></form></section><div class="admin-heading"><div><h3>Sales by child SKU</h3><p>Recipe-parent sales roll into the physical canonical SKU that receives the deduction. Non-inventory SKUs without a disposition remain out of this report.</p></div><label>Date range<select data-sales-period><option value="week">Weekly</option><option value="month">Monthly</option><option value="year">Yearly</option><option value="all">All time</option></select></label><button type="button" data-download-sales>Download CSV</button></div><div class="admin-stat-summary" data-sales-summary></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Category</th><th>Product</th><th>Canonical child SKU</th><th>Qty deducted</th><th>Cost</th><th>Gross sales attributed</th></tr></thead><tbody></tbody></table></div><div class="admin-pagination" data-sales-pagination></div><section class="admin-card"><h3>Recent outside sales</h3><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Date</th><th>Source</th><th>SKUs</th><th>Items</th><th>Discount</th><th>Shipping</th><th>Tax</th><th>Total charged</th><th>Cost</th><th>Status</th><th></th></tr></thead><tbody data-custom-sale-history></tbody></table></div></section>';
    const customSaleLines=view.querySelector('[data-custom-sale-lines]');const totalCollected=view.querySelector('[data-custom-sale-total]');const updateCustomSaleTotal=()=>{const itemTotal=[...customSaleLines.querySelectorAll('[data-custom-sale-amount]')].reduce((sum,input)=>sum+(Number(input.value)||0),0);const saleForm=view.querySelector('[data-custom-sale-form]');const discount=Number(saleForm.elements.discount_amount.value)||0;const shipping=Number(saleForm.elements.shipping_collected.value)||0;const tax=Number(saleForm.elements.tax_collected.value)||0;totalCollected.textContent=discount>itemTotal?'Discount cannot exceed item subtotal.':'Item subtotal $'+itemTotal.toFixed(2)+' − discount $'+discount.toFixed(2)+' + shipping $'+shipping.toFixed(2)+' + tax $'+tax.toFixed(2)+' = total charged $'+(itemTotal-discount+shipping+tax).toFixed(2);};const addCustomSaleLine=()=>{const row=document.createElement('div');row.className='admin-form-grid';row.dataset.customSaleLine='';row.innerHTML='<label>Search inventory SKU<input data-custom-sale-search autocomplete="off" placeholder="Type SKU or name" required><small data-custom-sale-match></small></label><label>Quantity sold<input data-custom-sale-quantity type="number" min="1" step="1" value="1" required></label><label>Line item subtotal before discount<input data-custom-sale-amount type="number" min="0" step="0.01" placeholder="0.00" required></label><button type="button" data-custom-sale-remove>Remove</button>';row.querySelector('[data-custom-sale-remove]').onclick=()=>{if(customSaleLines.children.length>1){row.remove();updateCustomSaleTotal();}};row.querySelector('[data-custom-sale-amount]').oninput=updateCustomSaleTotal;const input=row.querySelector('[data-custom-sale-search]');let searchRequest=0;input.oninput=async()=>{const thisSearch=++searchRequest;const status=row.querySelector('[data-custom-sale-match]');row.dataset.customSaleSku='';status.textContent='Searching…';const result=await inventoryLookupPage(input.value,'all',1,20);if(thisSearch!==searchRequest)return;if(result.error){status.textContent='SKU search failed: '+result.error.message;return;}const options=(result.data||[]).filter((record)=>record.sku).map((record)=>'<option value="'+adminSafe(record.sku)+'">'+adminSafe(record.name||record.sku)+' · '+adminSafe(record.sku)+' · On hand '+Number(record.quantity_on_hand||0)+'</option>').join('');let list=row.querySelector('datalist');if(!list){list=document.createElement('datalist');list.id='custom-sale-options-'+Math.random().toString(36).slice(2);input.setAttribute('list',list.id);row.append(list);}list.innerHTML=options;const exact=(result.data||[]).find((record)=>normalizeSku(record.sku)===normalizeSku(input.value));row.dataset.customSaleSku=exact?.sku||'';status.textContent=exact?'Matched '+exact.sku+' · current on hand '+Number(exact.quantity_on_hand||0):options?'Choose an exact SKU from the suggestions.':'No matching inventory SKUs.';};input.onchange=async()=>{const request=++searchRequest;const result=await inventoryLookupPage(input.value,'all',1,20);if(request!==searchRequest)return;const exact=(result.data||[]).find((record)=>normalizeSku(record.sku)===normalizeSku(input.value));row.dataset.customSaleSku=exact?.sku||'';row.querySelector('[data-custom-sale-match]').textContent=exact?'Matched '+exact.sku+' · current on hand '+Number(exact.quantity_on_hand||0):'Select an existing canonical inventory SKU.';};customSaleLines.append(row);updateCustomSaleTotal();};addCustomSaleLine();view.querySelector('[data-custom-sale-add]').onclick=addCustomSaleLine;['discount_amount','shipping_collected','tax_collected'].forEach((name)=>customSaleForm.elements[name].addEventListener('input',updateCustomSaleTotal));
    const customSaleForm=view.querySelector('[data-custom-sale-form]');customSaleForm.onsubmit=async(event)=>{event.preventDefault();const status=customSaleForm.querySelector('[data-custom-sale-status]');const rows=[...customSaleLines.querySelectorAll('[data-custom-sale-line]')];const lines=rows.map((row)=>({sku:row.dataset.customSaleSku,quantity:Number(row.querySelector('[data-custom-sale-quantity]').value),charged_amount:row.querySelector('[data-custom-sale-amount]').value}));const itemSubtotal=lines.reduce((sum,line)=>sum+(Number(line.charged_amount)||0),0);const discount=Number(customSaleForm.elements.discount_amount.value)||0;const shipping=Number(customSaleForm.elements.shipping_collected.value)||0;const tax=Number(customSaleForm.elements.tax_collected.value)||0;if(lines.some((line)=>!line.sku||!Number.isInteger(line.quantity)||line.quantity<1||line.charged_amount===''||!Number.isFinite(Number(line.charged_amount))||Number(line.charged_amount)<0)){status.textContent='Choose an existing SKU for every line and enter a positive whole quantity and line subtotal.';return;}if(discount>itemSubtotal){status.textContent='Discount cannot exceed the item subtotal.';return;}if([discount,shipping,tax].some((amount)=>!Number.isFinite(amount)||amount<0)){status.textContent='Discount, shipping, and tax must be zero or greater.';return;}if(!cloud){status.textContent='Saving custom sales requires the connected inventory database.';return;}const fields=Object.fromEntries(new FormData(customSaleForm));const soldAt=new Date(fields.sold_at+'T12:00:00').toISOString();const saveButton=customSaleForm.querySelector('[type="submit"]');saveButton.disabled=true;status.textContent='Saving the sale and deducting inventory…';try{const result=await cloudAdmin().rpc('record_manual_custom_sale',{p_sold_at:soldAt,p_channel:fields.channel,p_customer_reference:fields.reference||null,p_notes:fields.notes||null,p_discount_amount:discount,p_shipping_collected:shipping,p_tax_collected:tax,p_lines:lines});if(result.error)throw result.error;const data=result.data||{};status.textContent='Saved. Total charged $'+Number(data.total_charged||0).toFixed(2)+' · SKU-based cost $'+Number(data.total_cost||0).toFixed(2)+' · inventory deductions applied.'+(data.missing_cost_skus?.length?' Missing SKU cost: '+data.missing_cost_skus.join(', '):'');await invalidateAdminAccountingInventoryCaches();await renderInventoryTools('sales',true,true);}catch(error){status.textContent='Sale was not saved: '+(error.message||'Unknown error.');saveButton.disabled=false;}};
    const periodRows=()=>{const period=view.querySelector('[data-sales-period]').value;const start=period==='week'?Date.now()-7*86400000:period==='month'?Date.now()-30*86400000:period==='year'?Date.now()-365*86400000:0;const grouped=new Map();allSalesRows.filter((row)=>!start||!row.date||Date.parse(row.date)>=start).forEach((sale)=>{const customCostBySku=new Map((sale.costBreakdown||[]).map((part)=>[normalizeSku(part.sku),part]));const expandedRows=expandSaleSku(sale.sku,sale.quantity);const totalExpanded=expandedRows.reduce((sum,item)=>sum+Number(item.quantity||0),0);expandedRows.forEach((expanded)=>{const key=normalizeSku(expanded.sku);const child=inventoryBySku.get(key);if(!child)return;const current=grouped.get(key)||{category:child.category||sale.category||'uncategorized',product:child.name||sale.product,sku:child.sku,quantity:0,cost:Number(child.cost||0),totalCost:0,gross:0};current.quantity+=expanded.quantity;if(sale.source==='Custom'){const part=customCostBySku.get(key);const unitCost=part?.unit_cost===null||part?.unit_cost===undefined?0:Number(part.unit_cost)||0;current.totalCost+=unitCost*expanded.quantity;current.gross+=totalExpanded?Number(sale.gross||0)*expanded.quantity/totalExpanded:0;}else{const grossPerUnit=sale.quantity?Number(sale.gross||0)/sale.quantity:0;current.totalCost+=Number(child.cost||0)*expanded.quantity;current.gross+=grossPerUnit*expanded.quantity;}current.cost=current.quantity?current.totalCost/current.quantity:0;grouped.set(key,current);});});return [...grouped.values()].sort((left,right)=>right.quantity-left.quantity||left.sku.localeCompare(right.sku));};
     let salesPager;const drawSales=()=>{const rows=periodRows();const units=rows.reduce((sum,row)=>sum+row.quantity,0);const gross=rows.reduce((sum,row)=>sum+row.gross,0);const cogs=rows.reduce((sum,row)=>sum+row.totalCost,0);view.querySelector('[data-sales-summary]').textContent=units+' child units deducted · Gross sales attributed: $'+gross.toFixed(2)+' · COGS: $'+cogs.toFixed(2);salesPager=paginate(periodRows,view.querySelector('tbody'),view.querySelector('[data-sales-pagination]'),(row)=>'<tr><td>'+adminSafe(row.category)+'</td><td>'+adminSafe(row.product)+'</td><td>'+adminSkuLink(row.sku,'')+'</td><td>'+row.quantity+'</td><td>$'+row.cost.toFixed(2)+'</td><td>$'+row.gross.toFixed(2)+'</td></tr>','No child sales in this range.',6);salesPager.draw();};
     view.querySelector('[data-sales-period]').onchange=drawSales;view.querySelector('[data-download-sales]').onclick=()=>{const rows=periodRows();download([['Category','Product name','Canonical child SKU','Quantity deducted','Cost','Gross sales attributed'],...rows.map((row)=>[row.category,row.product,row.sku,row.quantity,row.cost,row.gross])],'sales-by-child-sku.csv');};const historyBody=view.querySelector('[data-custom-sale-history]');historyBody.innerHTML=manualSalesHistory.map((sale)=>'<tr><td>'+adminSafe(sale.sold_at?new Date(sale.sold_at).toLocaleDateString():'')+'</td><td>'+adminSafe(sale.sales_channel)+'</td><td>'+adminSafe(sale.line_summary||'')+(sale.customer_reference?' · '+adminSafe(sale.customer_reference):'')+'</td><td>$'+Number(sale.total_revenue||0).toFixed(2)+'</td><td>$'+Number(sale.discount_amount||0).toFixed(2)+'</td><td>$'+Number(sale.shipping_collected||0).toFixed(2)+'</td><td>$'+Number(sale.tax_collected||0).toFixed(2)+'</td><td>$'+Number(sale.total_charged||0).toFixed(2)+'</td><td>$'+Number(sale.total_cost||0).toFixed(2)+'</td><td>'+(sale.voided_at?'Reversed':'Recorded')+'</td><td>'+(!sale.voided_at?'<button type="button" data-void-custom-sale="'+adminSafe(sale.sale_id)+'">Reverse sale</button>':'')+'</td></tr>').join('')||'<tr><td colspan="11">No outside sales recorded yet.</td></tr>';historyBody.querySelectorAll('[data-void-custom-sale]').forEach((button)=>button.onclick=async()=>{if(!window.confirm('Reverse this sale? This restores the exact inventory quantities deducted and removes the sale from sales metrics.'))return;button.disabled=true;const result=await cloudAdmin().rpc('void_manual_custom_sale',{p_sale_id:button.dataset.voidCustomSale});if(result.error){button.disabled=false;window.alert('Sale was not reversed: '+result.error.message);return;}await invalidateAdminAccountingInventoryCaches();await renderInventoryTools('sales',true,true);});drawSales();return;
  }
  if(tab==='packs'){
    const packRows=[...recipeChildrenBySku.entries()].map(([key,children])=>{const parent=inventoryBySku.get(key);if(!parent||String(parent.item_type||'Inventory').toLowerCase()!=='non-inventory')return null;const sales=allSalesRows.filter((row)=>normalizeSku(row.sku)===key);const units=sales.reduce((sum,row)=>sum+row.quantity,0);const gross=sales.reduce((sum,row)=>sum+Number(row.gross||0),0);return{parent,children,units,gross};}).filter((row)=>row&&row.units>0).sort((left,right)=>right.units-left.units||left.parent.sku.localeCompare(right.parent.sku));
    if(!isCurrent())return;view.innerHTML='<div class="admin-heading"><div><h3>Multi-pack sales</h3><p>Only pack SKUs with recorded sales are shown. The child-SKU report separately shows the physical units deducted by those sales.</p></div><button type="button" data-download-packs>Download CSV</button></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Parent SKU</th><th>Product / pack</th><th>Packs sold</th><th>Gross sales</th><th>Recipe children</th></tr></thead><tbody></tbody></table></div><div class="admin-pagination" data-packs-pagination></div>';
    const packPagination=paginate(()=>packRows,view.querySelector('tbody'),view.querySelector('[data-packs-pagination]'),(row)=>'<tr><td>'+adminSkuLink(row.parent.sku,'')+'</td><td>'+adminSafe(row.parent.name||row.parent.sku)+'</td><td>'+row.units+'</td><td>$'+row.gross.toFixed(2)+'</td><td>'+adminSafe(row.children.map((child)=>child.quantity+' × '+child.sku).join(' · '))+'</td></tr>','No recipe-parent sales found.',5);packPagination.draw();
    view.querySelector('[data-download-packs]').onclick=()=>download([['Parent SKU','Product / pack','Packs sold','Gross sales','Recipe children'],...packRows.map((row)=>[row.parent.sku,row.parent.name||row.parent.sku,row.units,row.gross,row.children.map((child)=>child.quantity+' × '+child.sku).join(' · ')])],'multi-pack-sales.csv');return;
  }
  if(tab==='bulk-create'){
    const childHeaders=['SKU','Product name','Price','Unit','Cost','Weight','Weight unit','Qty','Reserve buffer','Low stock'];
    const parentRecipeHeaders=['Parent SKU','Parent name','Parent price','Child SKU','Qty used per pack'];
    const templateRows=[
      {name:'Child SKUs',rows:[childHeaders,['EXAMPLE-BLUE-1PK','Blue bead',0.14,'Each',0.05,0.1,'oz',100,0,10]]},
      {name:'Parent Recipes',rows:[parentRecipeHeaders,['EXAMPLE-BLUE-5PK','Blue bead 5 pack',0.65,'EXAMPLE-BLUE-1PK',5]]}
    ];
    if(!isCurrent())return;
    view.innerHTML='<div class="admin-heading"><div><p class="kicker">INVENTORY SETUP</p><h3>Bulk SKU creator</h3><p>Upload one two-tab workbook: Child SKUs on the first tab, then parent SKUs and their recipe components together on the second. Nothing is saved until the workbook passes validation.</p></div><button type="button" data-download-bulk-sku-template>Download two-tab workbook template</button></div><div class="admin-card"><h4>Upload new SKUs</h4><p class="inventory-help"><strong>Child SKUs:</strong> enter the same inventory fields as the year-end audit. <strong>Parent Recipes:</strong> enter one row per child component; repeat the parent SKU, name, and price for each component in that parent recipe. The example parent uses 5 units of its 1PK child.</p><label>Bulk SKU workbook<input type="file" data-bulk-sku-file accept=".xml,application/xml"></label><p data-bulk-sku-status role="status">No bulk SKU workbook selected.</p><div class="admin-actions"><button type="button" class="cta" data-apply-bulk-skus disabled>Create validated SKUs</button></div></div><div class="admin-card" data-bulk-sku-preview hidden></div>';
    const fileInput=view.querySelector('[data-bulk-sku-file]');
    const status=view.querySelector('[data-bulk-sku-status]');
    const preview=view.querySelector('[data-bulk-sku-preview]');
    const applyButton=view.querySelector('[data-apply-bulk-skus]');
    let pendingSkuRows=[];
    let pendingRecipeRows=[];
    const downloadTemplate=()=>{const url=URL.createObjectURL(new Blob([auditWorkbookXml(templateRows)],{type:'application/xml;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='bulk-sku-creator-template.xml';link.click();URL.revokeObjectURL(url);};
    view.querySelector('[data-download-bulk-sku-template]').onclick=downloadTemplate;
    const bulkValue=(row,aliases)=>String(auditHeader(row,aliases)||'').trim();
    const bulkNumber=(value,label,rowNumber,{integer=false,required=false}={})=>auditNumber(value,label,rowNumber,{integer,required});
    const existingBySku=new Map(inventoryRecords.filter((record)=>record.sku).map((record)=>[normalizeSku(record.sku),record]));
    const validateWorkbook=async(file)=>{
      const sheets=await auditWorkbookSheets(file);
      const childSheet=sheets.find((sheet)=>/^child/i.test(sheet.name));
      const parentRecipeSheet=sheets.find((sheet)=>/^parent/i.test(sheet.name));
      if(!childSheet||!parentRecipeSheet||sheets.length!==2)throw new Error('Upload the two-tab workbook with Child SKUs and Parent Recipes. CSV files are not supported for bulk SKU creation.');
      const errors=[];
      const incomingBySku=new Map();
      const childRows=[];
      const parentRows=[];
      const readPrice=(row,rowNumber)=>bulkNumber(bulkValue(row,['price','sellingprice']),'Price',rowNumber,{required:true});
      const registerSku=(sku,type,rowNumber)=>{const key=normalizeSku(sku);if(!sku){errors.push((type==='parent'?'Parent':'Child')+' row '+rowNumber+': SKU is required.');return false;}if(incomingBySku.has(key)){errors.push('Row '+rowNumber+': duplicate SKU '+sku+'.');return false;}if(existingBySku.has(key)){errors.push('Row '+rowNumber+': SKU already exists in canonical inventory: '+sku+'.');return false;}incomingBySku.set(key,{sku,type});return true;};
      (childSheet.rows||[]).forEach((row,index)=>{const rowNumber=index+2;const sku=bulkValue(row,['sku','canonicalsku','inventorysku']);if(!registerSku(sku,'child',rowNumber))return;const name=bulkValue(row,['productname','name']);if(!name)errors.push('Child row '+rowNumber+': Product name is required.');const price=readPrice(row,rowNumber);if(price.error)errors.push('Child row '+rowNumber+': '+price.error.replace('Row '+rowNumber+': ',''));const unit=bulkValue(row,['unit','unittype']);if(!unit)errors.push('Child row '+rowNumber+': Unit is required.');const cost=bulkNumber(bulkValue(row,['cost','unitcost']),'Cost',rowNumber);if(cost.error)errors.push(cost.error);const weight=bulkNumber(bulkValue(row,['weight','weightvalue']),'Weight',rowNumber);if(weight.error)errors.push(weight.error);const quantity=bulkNumber(bulkValue(row,['qty','quantity','quantityonhand','onhand']),'Qty',rowNumber,{integer:true,required:true});if(quantity.error)errors.push(quantity.error);const reserve=bulkNumber(bulkValue(row,['reservebuffer','reservequantity','reserved']),'Reserve buffer',rowNumber,{integer:true,required:true});if(reserve.error)errors.push(reserve.error);const lowStock=bulkNumber(bulkValue(row,['lowstock','lowstockminimum','reorderpoint','lowstockthreshold','minimum']),'Low stock',rowNumber,{integer:true,required:true});if(lowStock.error)errors.push(lowStock.error);const weightUnit=(bulkValue(row,['weightunit','unitofweight'])||'oz').toLowerCase();if(!['oz','lb','g','kg'].includes(weightUnit))errors.push('Child row '+rowNumber+': Weight unit must be oz, lb, g, or kg.');if(name&&!price.error&&unit&&!quantity.error&&!reserve.error&&!lowStock.error)childRows.push({sku,sku_type:'child',product_name:name,price:price.value,unit,cost:cost.value,weight:weight.value,weight_unit:weightUnit,qty:quantity.value,reserve_buffer:reserve.value,low_stock:lowStock.value});});
      const parentRowsBySku=new Map();
      const recipeRows=[];
      (parentRecipeSheet?.rows||[]).forEach((row,index)=>{const rowNumber=index+2;const sku=bulkValue(row,['parentsku','sku','canonicalsku','inventorysku']);const name=bulkValue(row,['parentname','productname','name']);const childSku=bulkValue(row,['childsku','componentsku']);const price=readPrice(row,rowNumber);const quantity=bulkNumber(bulkValue(row,['qtyusedperpack','quantity','qty']),'Qty used per pack',rowNumber,{integer:true,required:true});const key=normalizeSku(sku);if(!sku){errors.push('Parent recipe row '+rowNumber+': Parent SKU is required.');return;}if(!name)errors.push('Parent recipe row '+rowNumber+': Parent name is required.');if(price.error)errors.push('Parent recipe row '+rowNumber+': '+price.error.replace('Row '+rowNumber+': ',''));if(!childSku)errors.push('Parent recipe row '+rowNumber+': Child SKU is required.');if(quantity.error)errors.push('Parent recipe row '+rowNumber+': '+quantity.error.replace('Row '+rowNumber+': ',''));const existingParent=parentRowsBySku.get(key);if(existingParent){if(existingParent.product_name!==name||(!price.error&&existingParent.price!==price.value))errors.push('Parent recipe row '+rowNumber+': Repeated parent SKU '+sku+' must use the same parent name and price on every component row.');}else if(registerSku(sku,'parent',rowNumber)){const parent={sku,sku_type:'parent',product_name:name,price:price.value};parentRowsBySku.set(key,parent);parentRows.push(parent);}if(!childSku||quantity.error||!incomingBySku.has(key))return;const childKey=normalizeSku(childSku);if(key===childKey){errors.push('Parent recipe row '+rowNumber+': A parent cannot use itself as a child.');return;}const child=incomingBySku.get(childKey)||existingBySku.get(childKey);if(!child){errors.push('Parent recipe row '+rowNumber+': Child SKU '+childSku+' does not exist in the workbook or canonical inventory.');return;}if(child.type==='parent'||String(child.item_type||'Inventory').toLowerCase()==='non-inventory'){errors.push('Parent recipe row '+rowNumber+': Child SKU '+childSku+' must be a physical inventory SKU.');return;}if(recipeRows.some((recipe)=>normalizeSku(recipe.parent_sku)+'|'+normalizeSku(recipe.child_sku)===key+'|'+childKey)){errors.push('Parent recipe row '+rowNumber+': Duplicate parent/child component.');return;}recipeRows.push({parent_sku:sku,child_sku:childSku,quantity:quantity.value});});
      if(!childRows.length&&!parentRows.length)errors.push('The workbook does not contain any valid new SKUs.');
      return{errors,skuRows:[...childRows,...parentRows],recipeRows,autoGenerated:[],childCount:childRows.length,parentCount:parentRows.length};
    };
    fileInput.onchange=async()=>{pendingSkuRows=[];pendingRecipeRows=[];applyButton.disabled=true;preview.hidden=true;const file=fileInput.files?.[0];if(!file){status.textContent='No bulk SKU workbook selected.';return;}try{const result=await validateWorkbook(file);pendingSkuRows=result.skuRows;pendingRecipeRows=result.recipeRows;status.textContent=result.errors.length?'Workbook rejected: '+result.errors.length+' validation issue(s).':'Validated '+result.skuRows.length+' new SKUs and '+result.recipeRows.length+' recipe components. Nothing has changed yet.';preview.hidden=false;preview.textContent=(result.errors.length?result.errors.slice(0,20).join('\n')+'\n\n':'')+'Child SKUs: '+result.childCount+'\nParent SKUs: '+result.parentCount+'\nRecipe components: '+result.recipeRows.length+'\n'+(result.autoGenerated.length?'Auto-generated recipes:\n'+result.autoGenerated.join('\n')+'\n':'')+(result.errors.length?'\nCorrect the workbook and upload it again.':'Ready to create.');applyButton.disabled=Boolean(result.errors.length||!result.skuRows.length||!cloud);}catch(error){status.textContent='Workbook rejected: '+(error.message||'Unknown error.');preview.hidden=false;preview.textContent=error.message||'Unknown error.';applyButton.disabled=true;}};
    applyButton.onclick=async()=>{if(applyButton.disabled)return;applyButton.disabled=true;status.textContent='Creating canonical SKUs and recipes…';const result=await cloudAdmin().rpc('create_inventory_sku_batch',{sku_rows:pendingSkuRows,recipe_rows:pendingRecipeRows});if(result.error){status.textContent='Bulk creation stopped: '+(result.error.message||'Unknown database error.');applyButton.disabled=false;return;}const summary=result.data||{};status.textContent='Created '+Number(summary.created_skus||0)+' SKUs and '+Number(summary.created_recipe_components||0)+' recipe components across '+Number(summary.parents_with_recipes||0)+' parent recipes.';preview.textContent+='\n\nCreated successfully. Product pages still need to be created separately.';};
    return;
  }
  if(tab==='audit'){
    const auditHeaders=['SKU','Name','Price','Weight (oz)','Qty','Reserve buffer','Low stock'];
    const auditRows=[auditHeaders,...inventoryRecords.filter((record)=>record.sku).sort((left,right)=>String(left.sku).localeCompare(String(right.sku))).map((record)=>[record.sku,record.name??'',Number(record.price??0),record.weight_value??'',Number(record.quantity_on_hand??0),Number(record.reserve_quantity??0),Number(record.reorder_point??0)])];
    if(!isCurrent())return;
    view.innerHTML='<div class="admin-heading"><div><h3>Year-end inventory audit</h3><p>Use one inventory tab. SKU is the immutable match key. Every other listed column overwrites that field on the matching canonical inventory item.</p></div><button type="button" data-download-audit>Download audit CSV (opens in Excel)</button></div><div class="admin-card"><h4>Upload completed audit CSV</h4><label>Audit CSV or existing Excel/XML file<input type="file" data-audit-file accept=".xml,.xls,.csv,text/xml,application/vnd.ms-excel,text/csv"></label><p data-audit-status>Nothing changes until the full inventory list validates and you apply it.</p><div class="admin-actions"><button type="button" class="cta" data-apply-audit disabled>Apply validated workbook</button></div></div><div class="admin-card" data-audit-preview hidden></div>';
    view.querySelector('[data-download-audit]').onclick=()=>download(auditRows,'year-end-inventory-audit.csv');
    const fileInput=view.querySelector('[data-audit-file]');const status=view.querySelector('[data-audit-status]');const preview=view.querySelector('[data-audit-preview]');const applyButton=view.querySelector('[data-apply-audit]');let pendingRows=[];let validationErrors=[];
    const normalizedHeader=(value)=>String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,'');
    const validateSheet=(sheet)=>{const errors=[];const required=[
      ['SKU',['sku','canonicalsku','inventorysku']],
      ['Product name',['productname','name']],
      ['Price',['price','sellingprice']],
      ['Weight',['weightoz','weight','weightvalue']],
      ['Qty',['qty','quantity','quantityonhand','onhand']],
      ['Reserve buffer',['reservebuffer','reservequantity','reserved']],
      ['Low stock',['lowstock','lowstockminimum','reorderpoint','lowstockthreshold','minimum']]
    ];
      const available=new Set(Object.keys(sheet?.rows?.[0]||{}).map(normalizedHeader));required.forEach(([label,aliases])=>{if(!aliases.some((alias)=>available.has(alias)))errors.push('Inventory tab is missing the '+label+' column.');});
      if(errors.length)return{errors,rows:[]};
      const seen=new Set();const rows=[];
      (sheet.rows||[]).forEach((row,index)=>{const rowNumber=index+2;const sku=String(auditHeader(row,['sku','canonicalsku','inventorysku'])).trim();const key=normalizeSku(sku);if(!sku){errors.push('Row '+rowNumber+': SKU is required.');return;}if(seen.has(key)){errors.push('Row '+rowNumber+': duplicate SKU '+sku+'.');return;}seen.add(key);if(!inventoryBySku.has(key)){errors.push('Row '+rowNumber+': SKU is not in canonical inventory: '+sku+'.');return;}const name=String(auditHeader(row,['productname','name'])).trim();if(!name)errors.push('Row '+rowNumber+': Product name is required.');const price=auditNumber(auditHeader(row,['price','sellingprice']),'Price',rowNumber,{required:true});if(price.error)errors.push(price.error);const weight=auditNumber(auditHeader(row,['weightoz','weight','weightvalue']),'Weight (oz)',rowNumber);if(weight.error)errors.push(weight.error);const quantity=auditNumber(auditHeader(row,['qty','quantity','quantityonhand','onhand']),'Qty',rowNumber,{integer:true,required:true});if(quantity.error)errors.push(quantity.error);const reserve=auditNumber(auditHeader(row,['reservebuffer','reservequantity','reserved']),'Reserve buffer',rowNumber,{integer:true,required:true});if(reserve.error)errors.push(reserve.error);const lowStock=auditNumber(auditHeader(row,['lowstock','lowstockminimum','reorderpoint','lowstockthreshold','minimum']),'Low stock',rowNumber,{integer:true,required:true});if(lowStock.error)errors.push(lowStock.error);if(!price.error&&!quantity.error&&!reserve.error&&!lowStock.error&&!weight.error&&name)rows.push({sku,product_name:name,price:price.value,weight_value:weight.value,weight_unit:'oz',quantity:quantity.value,reserve_quantity:reserve.value,reorder_point:lowStock.value});});
      const expected=new Set(inventoryRecords.filter((record)=>record.sku).map((record)=>normalizeSku(record.sku)));seen.forEach((key)=>{if(!expected.has(key))errors.push('Inventory tab contains an unexpected SKU: '+key+'.');});expected.forEach((key)=>{if(!seen.has(key))errors.push('Inventory tab is missing canonical SKU: '+key+'.');});return{errors,rows};};
    fileInput.onchange=async()=>{pendingRows=[];validationErrors=[];applyButton.disabled=true;preview.hidden=true;const file=fileInput.files?.[0];if(!file){status.textContent='No audit workbook selected.';return;}try{const sheets=await auditWorkbookSheets(file);if(sheets.length!==1)throw new Error('Upload a workbook with exactly one inventory tab, or a single-tab CSV.');const result=validateSheet(sheets[0]);pendingRows=result.rows;validationErrors=result.errors;status.textContent=validationErrors.length?'Workbook rejected: '+validationErrors.length+' validation issue(s).':'Validated '+pendingRows.length+' canonical SKU rows. SKU will only be used to match rows; all other audit columns will overwrite their canonical fields.';preview.hidden=false;preview.textContent=(validationErrors.length?validationErrors.slice(0,16).join('\n')+'\n':'')+'Canonical SKU rows: '+pendingRows.length+'\n'+(validationErrors.length?'Correct the workbook and upload it again.':'Ready to apply.');applyButton.disabled=Boolean(validationErrors.length||!pendingRows.length||!cloud);}catch(error){validationErrors=[error.message];status.textContent='Workbook rejected: '+error.message;preview.hidden=false;preview.textContent=error.message;applyButton.disabled=true;}};
    applyButton.onclick=async()=>{if(applyButton.disabled)return;applyButton.disabled=true;status.textContent='Applying canonical inventory audit…';const result=await cloudAdmin().rpc('apply_inventory_audit_complete',{audit_rows:pendingRows});if(result.error){status.textContent='Audit was not applied: '+result.error.message;applyButton.disabled=false;return;}clearAdminRowsCachePrefix('inventory:');status.textContent='Overwrote '+Number(result.data||0)+' canonical inventory rows. SKU values were not changed.';await renderInventoryTools('audit',true);};
    return;
  }
  if(tab==='adjust'){
    const adjustmentLookup=new Map();let adjustmentLookupRequest=0;
    const findAdjustment=async(sku)=>{const needle=String(sku||'').trim();if(!needle)return null;const key=normalizeSku(needle);if(adjustmentLookup.has(key))return adjustmentLookup.get(key);const request=++adjustmentLookupRequest;const result=await inventoryLookupPage(needle,'all',1,5);if(request!==adjustmentLookupRequest)return null;const match=(result.data||[]).find((record)=>normalizeSku(record.sku)===key)||null;if(match)adjustmentLookup.set(key,match);return match;};
    const makeRow=()=>{const row=document.createElement('div');row.className='admin-inventory-adjust-row';row.innerHTML='<label>SKU<input data-adjust-sku list="admin-sku-list" placeholder="Enter SKU"></label><span data-adjust-match>Enter a SKU to load its product and quantity.</span><label>Adjustment<input data-adjust-delta type="number" step="1" value="0"></label><label>Note<input data-adjust-note placeholder="Miscount, damage, loss, or found stock"></label><button type="button" data-remove-adjust>Remove</button>';row.querySelector('[data-remove-adjust]').onclick=()=>row.remove();row.querySelector('[data-adjust-sku]').oninput=async()=>{const input=row.querySelector('[data-adjust-sku]');const match=await findAdjustment(input.value);row._inventoryMatch=match;row.querySelector('[data-adjust-match]').textContent=match?(match.name||match.sku)+' · Current on-hand '+Number(match.quantity_on_hand||0):'SKU not found';};return row;};
    let bundleComponentRows=[];
     if(cloud)bundleComponentRows=bundleComponents||[];
     const inventoryById=new Map(inventoryRecords.map((record)=>[record.id,record]));
    const recipeByBundleId=new Map();bundleComponentRows.forEach((row)=>{const bundle=inventoryById.get(row.bundle_sku_id);const component=inventoryById.get(row.component_sku_id);if(!bundle?.sku||!component?.sku)return;const recipe=recipeByBundleId.get(bundle.id)||{bundle,components:[]};recipe.components.push({id:component.id,sku:component.sku,name:component.name||component.sku,quantity:Number(row.quantity)||1});recipeByBundleId.set(bundle.id,recipe);});
    const bundleRecipes=[...recipeByBundleId.values()].sort((left,right)=>String(left.bundle.name||left.bundle.sku).localeCompare(String(right.bundle.name||right.bundle.sku)));
     const initialAdjustmentResult=await inventoryLookupPage('', 'physical', 1, 100);
     const initialAdjustmentRows=(initialAdjustmentResult.data||[]).map((record)=>({sku:record.sku,product:{name:record.name,external_id:record.sku,category_slug:record.category||'uncategorized'},quantity:Number(record.quantity_on_hand)||0,record}));
     initialAdjustmentRows.forEach((row)=>adjustmentLookup.set(normalizeSku(row.sku),row.record));
     if(!isCurrent())return;view.innerHTML=`
      <div class="admin-heading"><div><p class="kicker">INVENTORY OPERATIONS</p><h3>Inventory changes</h3><p>Choose the workflow that matches what happened. Recipe components are the exact inventory items deducted when you build a bundle.</p></div></div>
      <section class="admin-card inventory-step"><div class="inventory-step-heading"><span>1</span><div><h3>Adjust counted stock</h3><p>Use this for a correction, damage, loss, or found stock. Enter a negative number to reduce quantity. SKU searches are capped and run only as you type.</p></div><button type="button" data-add-adjust>Add SKU</button></div><datalist id="admin-sku-list">${initialAdjustmentRows.filter((row)=>row.sku).map((row)=>'<option value="'+adminSafe(row.sku)+'">'+adminSafe(title(row.product))+'</option>').join('')}</datalist><div data-adjust-list></div><div class="admin-actions"><button type="button" class="cta" data-apply-adjustments>Apply stock adjustments</button></div></section>
      <section class="admin-card inventory-step"><div class="inventory-step-heading"><span>2</span><div><h3>Record a purchase</h3><p>Use this when new stock arrives. Upload one CSV and review the validation message before importing.</p></div></div><p class="inventory-help"><strong>Required columns:</strong> SKU, Quantity, Total cost, Vendor, Purchase date. Reference and Notes are optional. Quantity and weighted-average cost update only after you press Import purchases.</p><div class="admin-form-grid"><label>Default vendor<input data-purchase-default-vendor placeholder="Used when a CSV row has no vendor"></label><label>Purchase CSV<input type="file" data-purchase-file accept=".csv,text/csv"></label></div><div class="admin-actions"><button type="button" data-download-purchase-template>Download CSV template</button><button type="button" class="cta" data-import-purchases disabled>Import purchases</button></div><p data-purchase-status role="status">No purchase file selected.</p></section>
       <section class="admin-card inventory-step inventory-recipe-builder"><div class="inventory-step-heading"><span>3</span><div><h3>Create or edit a bundle recipe</h3><p>A recipe is the saved rule for one sellable pack or finished kit. Components must already exist as inventory so availability, cost, weight, and deductions stay traceable.</p></div></div><form data-bundle-recipe-form><div class="admin-form-grid inventory-recipe-lookup"><label>Search saved recipes<input type="search" data-recipe-search placeholder="Type bundle name or SKU"></label><label>Saved recipes<select data-recipe-existing><option value="">Choose an existing recipe</option>${bundleRecipes.map((recipe)=>'<option value="'+adminSafe(recipe.bundle.id)+'">'+adminSafe(recipe.bundle.name||recipe.bundle.sku)+' · '+adminSafe(recipe.bundle.sku)+'</option>').join('')||'<option value="">No saved recipes yet</option>'}</select></label><button type="button" data-new-recipe>Start new recipe</button></div><div class="admin-form-grid"><label>Pack type<select data-recipe-bundle-type><option value="Non-inventory">Auto-calculated sellable pack</option><option value="Inventory">Finished inventory kit</option></select></label><label>Bundle SKU<input data-recipe-bundle-sku required placeholder="Example: BLUE-BEADS-5PK"></label><label>Bundle name<input data-recipe-bundle-name required placeholder="Example: Blue beads 5 pack"></label></div><div class="inventory-component-picker"><label>Search component inventory<input type="search" data-recipe-component-search placeholder="Search by component name or SKU"></label><label>Matching inventory<select data-recipe-component-select><option value="">Type to search components above</option></select></label><label>Qty used per pack<input data-recipe-component-quantity type="number" min="1" step="1" value="1"></label><button type="button" data-add-recipe-component>Add component</button></div><div class="inventory-recipe-components" data-recipe-components><p class="inventory-help">No components selected yet.</p></div><div class="inventory-deduction-preview" data-recipe-deduction-preview>Save at least one component to define the pack.</div><div class="admin-actions"><button type="submit" class="cta">Save recipe</button><p data-recipe-status role="status"></p></div></form></section>
       <section class="admin-card inventory-step"><div class="inventory-step-heading"><span>4</span><div><h3>Build finished inventory kits</h3><p>Convert 1 pc SKUs into an inventoried bundle. This will deduct from the 1 pc now to create the premade mixed bundle as an inventoried item.</p></div></div><form data-bundle-conversion-form><div class="admin-form-grid conversion-recipe-controls"><label>Search saved recipes<input type="search" data-build-recipe-search placeholder="Type kit name or SKU"></label><label>Saved finished kit recipe<select data-bundle-sku><option value="">Choose a finished kit recipe</option>${bundleRecipes.filter((recipe)=>String(recipe.bundle.item_type||'Inventory').toLowerCase()!=='non-inventory').map((recipe)=>'<option value="'+adminSafe(recipe.bundle.sku)+'">'+adminSafe(recipe.bundle.name||recipe.bundle.sku)+' · '+adminSafe(recipe.bundle.sku)+'</option>').join('')||'<option value="">Create a finished kit recipe above first</option>'}</select></label><label>Quantity to build<input data-bundle-quantity type="number" min="1" step="1" value="1"></label></div><div class="inventory-deduction-preview" data-bundle-deduction-preview>Choose a finished kit recipe to see exactly what will be deducted.</div><label>Conversion note<input data-bundle-note required placeholder="Example: built 10 finished kits"></label><div class="admin-actions"><button type="submit" class="cta">Build finished kits</button><p data-bundle-status role="status"></p></div></form></section>
      `;
     const createSkuSection='<section class="admin-card inventory-step"><div class="inventory-step-heading"><span>1</span><div><h3>Create inventory SKU</h3><p>Create the inventory record first. Product pages can only use existing inventory SKUs.</p></div></div><form data-create-sku-form><div class="admin-form-grid"><label>SKU<input name="sku" required placeholder="Example: ACC-GEM-BLK-10MM-1PK"></label><label>Product name<input name="name" required placeholder="Example: Gem Spacers"></label><label>SKU type<select name="disposition"><option value="inventory">Inventory / child</option><option value="recipe_parent">Parent / non-inventory</option></select></label><label>Price<input name="price" type="number" min="0" step="0.01" placeholder="Optional"></label><label>Low stock minimum<input name="reorder_point" type="number" min="0" step="1" value="0"></label><label>Reserve buffer<input name="reserve_quantity" type="number" min="0" step="1" value="0"></label><label>Weight<input name="weight_value" type="number" min="0" step="0.001" placeholder="Optional"></label><label>Weight unit<select name="weight_unit"><option value="oz">oz</option><option value="lb">lb</option><option value="g">g</option><option value="kg">kg</option></select></label><label>Unit type<input name="unit_type" value="Each"></label><label>Preferred vendor<input name="preferred_vendor" placeholder="Optional"></label></div><label class="admin-toggle"><input name="taxable" type="checkbox" checked> Taxable</label><label class="admin-toggle"><input name="auto_product_page" type="checkbox" data-auto-product-page> Auto-create product page</label><label data-create-category-wrap hidden>Category<select name="category_slug" data-create-category disabled><option value="">Choose a category</option></select></label><label class="admin-toggle"><input name="visible" type="checkbox" data-create-visible disabled> List product page in storefront</label><div class="admin-actions"><button type="submit" class="cta">Create inventory SKU</button><p data-create-sku-status role="status"></p></div></form></section>';
    view.insertAdjacentHTML('afterbegin',createSkuSection);
    if(adminUrlParams.has('recipe')){
      panel.querySelector(':scope > .admin-heading')?.remove();
      panel.querySelector('.inventory-tabs')?.remove();
      view.querySelectorAll('.inventory-step:not(.inventory-recipe-builder)').forEach((section)=>{section.hidden=true;});
      const heading=view.querySelector('.admin-heading h3');
      const description=view.querySelector('.admin-heading p:not(.kicker)');
      const recipeHeading=view.querySelector('.inventory-recipe-builder .inventory-step-heading h3');
      const recipeDescription=view.querySelector('.inventory-recipe-builder .inventory-step-heading p');
      if(heading)heading.textContent='Edit recipe';
      if(description)description.textContent='Edit the canonical recipe for this bundle. Changes are saved directly to the recipe used for inventory deductions.';
      if(recipeHeading)recipeHeading.textContent='Edit bundle recipe';
      if(recipeDescription)recipeDescription.textContent='Update the child SKUs and quantities used by this bundle. Nothing changes until you save the recipe.';
    }
    const createSkuForm=view.querySelector('[data-create-sku-form]');
    if(createSkuForm){
      const autoPage=createSkuForm.querySelector('[data-auto-product-page]');const categoryWrap=createSkuForm.querySelector('[data-create-category-wrap]');const category=createSkuForm.querySelector('[data-create-category]');const visible=createSkuForm.querySelector('[data-create-visible]');const disposition=createSkuForm.querySelector('[name=disposition]');const status=createSkuForm.querySelector('[data-create-sku-status]');
      const categoryResult=await cloudAdmin().from('categories').select('slug,name').eq('active',true).order('sort_order').order('name').range(0,99);if(categoryResult.error){status.textContent='Categories could not be loaded.';}else{(categoryResult.data||[]).forEach((row)=>{const option=document.createElement('option');option.value=row.slug;option.textContent=row.name;category.append(option);});}
        const syncCreateSkuFields=()=>{const enabled=autoPage.checked;categoryWrap.hidden=!enabled;category.disabled=!enabled;category.required=enabled;visible.disabled=!enabled;if(!enabled)visible.checked=false;};autoPage.addEventListener('change',syncCreateSkuFields);disposition.addEventListener('change',syncCreateSkuFields);syncCreateSkuFields();
        createSkuForm.onsubmit=async(event)=>{event.preventDefault();if(!cloud){status.textContent='Creating inventory SKUs requires the connected store database.';return;}const fields=Object.fromEntries(new FormData(createSkuForm));const sku=String(fields.sku||'').trim();const name=String(fields.name||'').trim();if(!sku||!name){status.textContent='SKU and product name are required.';return;}if(autoPage.checked&&!category.value){status.textContent='Choose a category when auto-creating the product page.';return;}const selectedDisposition=String(fields.disposition||'inventory');const value={label:name,sku,inventory_sku:sku,price:fields.price===''?0:Math.max(0,Number(fields.price)||0),cost:null,unit_type:String(fields.unit_type||'Each').trim()||'Each',weight_value:fields.weight_value===''?null:Math.max(0,Number(fields.weight_value)||0),weight_unit:fields.weight_unit||'oz',quantity:0,low_stock_threshold:Math.max(0,Number(fields.reorder_point)||0),reserve_quantity:Math.max(0,Number(fields.reserve_quantity)||0),item_type:selectedDisposition==='recipe_parent'?'Non-inventory':'Inventory',preferred_vendor:String(fields.preferred_vendor||'').trim(),taxable:fields.taxable==='on',disposition:selectedDisposition};status.textContent='Creating inventory SKU…';try{const inventory=await cloudAdmin().from('inventory_skus').insert({sku,name,quantity_on_hand:0,reorder_point:value.low_stock_threshold,reserve_quantity:value.reserve_quantity,price:value.price,cost:null,unit_type:value.unit_type,weight_value:value.weight_value,weight_unit:value.weight_unit,item_type:value.item_type,hierarchy:value.item_type==='Non-inventory'?'Parent':null,preferred_vendor:value.preferred_vendor||null,taxable:value.taxable,source_system:'admin',source_metadata:{disposition:value.disposition},discontinued:false}).select('id,sku').single();if(inventory.error)throw inventory.error;if(autoPage.checked){fields.sku_data=JSON.stringify([{name:'SKU',required:true,values:[value]}]);fields.name=name;fields.category_slug=category.value;fields.visible=visible.checked?'on':'';await saveCloudProduct(null,fields,createSkuForm);}status.textContent=autoPage.checked?'Inventory SKU and product page created.':'Inventory SKU created. Add it to a product page from Products/SKUs.';createSkuForm.reset();syncCreateSkuFields();await renderInventoryTools('adjust',true);}catch(error){status.textContent='SKU was not created: '+(error?.message||'Unknown error.');}};
    }

    // SKU creation is intentionally inventory-only. Product pages are added
    // separately from the Products editor to prevent duplicate pages.
    const skuCreator=createSkuForm;
    const autoCreateControl=skuCreator?.querySelector('[data-auto-product-page]');
    if(autoCreateControl)autoCreateControl.checked=false;
    autoCreateControl?.closest('label')?.remove();
    skuCreator?.querySelector('[data-create-category-wrap]')?.remove();
    skuCreator?.querySelector('[data-create-visible]')?.closest('label')?.remove();


    const purchaseSection=view.querySelector('[data-purchase-file]')?.closest('.inventory-step');const purchaseGrid=purchaseSection?.querySelector('.admin-form-grid');if(purchaseSection&&purchaseGrid){const purchaseDetails=document.createElement('div');purchaseDetails.className='admin-form-grid inventory-purchase-details';purchaseDetails.innerHTML='<label>Purchase date<input data-purchase-date type="date" required value="'+new Date().toISOString().slice(0,10)+'"></label><label>Reference / PO number<input data-purchase-reference placeholder="Optional receipt or PO number"></label><label>Tax total<input data-purchase-tax type="number" min="0" step="0.01" value="0" placeholder="0.00"></label><label>Shipping / handling<input data-purchase-shipping type="number" min="0" step="0.01" value="0" placeholder="0.00"></label><label>Other fees<input data-purchase-fees type="number" min="0" step="0.01" value="0" placeholder="0.00"></label><label>Discount<input data-purchase-discount type="number" min="0" step="0.01" value="0" placeholder="0.00"></label><label>Receipt copies<input data-purchase-receipt type="file" accept="image/*,.pdf,application/pdf" multiple></label>';purchaseGrid.after(purchaseDetails);const purchaseNotes=document.createElement('label');purchaseNotes.innerHTML='Purchase notes<textarea data-purchase-notes rows="3" placeholder="What was purchased, and any notes from the receipt?"></textarea>';purchaseSection.querySelector('.admin-actions')?.before(purchaseNotes);const purchaseTotal=document.createElement('p');purchaseTotal.className='inventory-help';purchaseTotal.dataset.purchaseTotal='';purchaseTotal.innerHTML='<strong>Purchase total:</strong> $0.00 <span>(upload a CSV to calculate the merchandise subtotal)</span>';purchaseSection.querySelector('.admin-actions')?.before(purchaseTotal);}

     const vendorInput=view.querySelector('[data-purchase-default-vendor]');if(vendorInput){vendorInput.placeholder='Choose an existing vendor or type a new one';vendorInput.setAttribute('list','admin-vendor-list');const vendorLabel=vendorInput.closest('label');if(vendorLabel?.firstChild)vendorLabel.firstChild.textContent='Vendor (existing or new)';const vendorList=document.createElement('datalist');vendorList.id='admin-vendor-list';[...new Set(inventoryRecords.map((record)=>String(record.preferred_vendor||'').trim()).filter(Boolean))].sort((left,right)=>left.localeCompare(right)).forEach((vendor)=>{const option=document.createElement('option');option.value=vendor;vendorList.append(option);});vendorInput.parentElement.append(vendorList);}
    const conversionSection=view.querySelector('[data-bundle-conversion-form]')?.closest('.inventory-step');const conversionHeading=conversionSection?.querySelector('.inventory-step-heading h3');if(conversionHeading)conversionHeading.textContent='CONVERT Recipe from Inventory';const conversionButton=conversionSection?.querySelector('[type="submit"]');if(conversionButton)conversionButton.textContent='Convert recipe from inventory';
    const list=view.querySelector('[data-adjust-list]');const add=()=>{if(list.children.length>=10)return;list.append(makeRow());};view.querySelector('[data-add-adjust]').onclick=add;add();
      view.querySelector('[data-apply-adjustments]').onclick=async()=>{const rows=[...list.querySelectorAll('.admin-inventory-adjust-row')];const changes=await Promise.all(rows.map(async(row)=>({match:row._inventoryMatch||await findAdjustment(row.querySelector('[data-adjust-sku]').value),delta:Number(row.querySelector('[data-adjust-delta]').value)||0,note:row.querySelector('[data-adjust-note]').value.trim()})));if(changes.some((change)=>!change.match||!change.delta||!change.note)){alert('Enter a valid SKU, non-zero adjustment, and note for every row.');return;}if(!cloud){alert('Inventory adjustments require the connected store database.');return;}const result=await cloudAdmin().rpc('adjust_inventory_skus',{adjustment_rows:changes.map((change)=>({sku:change.match.sku,quantity_delta:change.delta,note:change.note}))});if(result.error){alert(result.error.message);return;}await renderInventoryTools('adjust');};
     const purchaseHelp=purchaseSection?.querySelector('.inventory-help');if(purchaseHelp)purchaseHelp.innerHTML='<strong>CSV columns:</strong> SKU, Quantity, Line total cost. Enter the vendor, purchase date, tax, shipping, fees, discount, reference, notes, and all receipt copies below.';const purchaseCsvLabel=purchaseSection?.querySelector('[data-purchase-file]')?.closest('label');if(purchaseCsvLabel?.firstChild)purchaseCsvLabel.firstChild.textContent='Line-item CSV';const purchaseFile=view.querySelector('[data-purchase-file]');const purchaseButton=view.querySelector('[data-import-purchases]');const purchaseStatus=view.querySelector('[data-purchase-status]');let pendingPurchases=[];const normalizedHeader=(value)=>String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,'');const purchaseValue=(row,aliases)=>{const keys=Object.keys(row);const key=keys.find((entry)=>aliases.includes(normalizedHeader(entry)));return key?row[key]:'';};purchaseFile.onchange=async()=>{pendingPurchases=[];purchaseButton.disabled=true;const file=purchaseFile.files?.[0];if(!file)return;try{const rows=parseCsv(await file.text());const defaultVendor=view.querySelector('[data-purchase-default-vendor]').value.trim();const errors=[];pendingPurchases=rows.map((row,index)=>{const number=index+2;const sku=String(purchaseValue(row,['sku','inventorysku'])).trim();const quantity=Number(purchaseValue(row,['quantity','qty']));const totalCost=Number(purchaseValue(row,['linetotalcost','totalcost','cost','totalpurchasecost']));const vendor=String(purchaseValue(row,['vendor','preferredvendor'])).trim()||defaultVendor;const dateText=String(purchaseValue(row,['purchasedate','date','transactiondate'])).trim();const date=dateText?new Date(dateText):null;if(!sku)errors.push('Row '+number+': SKU is required.');if(!Number.isInteger(quantity)||quantity<=0)errors.push('Row '+number+': Quantity must be a positive whole number.');if(!Number.isFinite(totalCost)||totalCost<0)errors.push('Row '+number+': Line total cost must be zero or greater.');if(date&&Number.isNaN(date.getTime()))errors.push('Row '+number+': Purchase date is invalid.');return{sku,quantity,total_cost:totalCost,vendor,purchase_date:date&&!Number.isNaN(date.getTime())?date.toISOString():'',reference_number:String(purchaseValue(row,['reference','referencenumber','ponumber'])).trim(),notes:String(purchaseValue(row,['notes','note'])).trim()};}).filter((row)=>row.sku&&row.quantity>0&&Number.isFinite(row.total_cost));if(errors.length){pendingPurchases=[];purchaseStatus.textContent='Purchase CSV rejected: '+errors.slice(0,8).join(' · ');}else{purchaseButton.disabled=!pendingPurchases.length;purchaseStatus.textContent='Validated '+pendingPurchases.length+' line items. Receipt details are entered below. Nothing has changed yet.';}}catch(error){purchaseStatus.textContent='Purchase CSV rejected: '+error.message;}};view.querySelector('[data-download-purchase-template]').onclick=()=>{const csv='SKU,Quantity,Line total cost\nEXAMPLE-SKU,10,12.50\n';const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));link.download='inventory-purchase-template.csv';link.click();};
     const purchaseDateInput=view.querySelector('[data-purchase-date]');const purchaseReferenceInput=view.querySelector('[data-purchase-reference]');const purchaseTaxInput=view.querySelector('[data-purchase-tax]');const purchaseShippingInput=view.querySelector('[data-purchase-shipping]');const purchaseFeesInput=view.querySelector('[data-purchase-fees]');const purchaseDiscountInput=view.querySelector('[data-purchase-discount]');const purchaseNotesInput=view.querySelector('[data-purchase-notes]');const purchaseReceiptInput=view.querySelector('[data-purchase-receipt]');const purchaseTotalOutput=view.querySelector('[data-purchase-total]');const readPurchaseMoney=(input)=>{const value=Number(input?.value||0);return Number.isFinite(value)&&value>=0?value:null;};const refreshPurchaseTotal=()=>{const subtotal=pendingPurchases.reduce((sum,row)=>sum+Number(row.total_cost||0),0);const tax=readPurchaseMoney(purchaseTaxInput)??0;const shipping=readPurchaseMoney(purchaseShippingInput)??0;const fees=readPurchaseMoney(purchaseFeesInput)??0;const discount=readPurchaseMoney(purchaseDiscountInput)??0;const total=subtotal+tax+shipping+fees-discount;if(purchaseTotalOutput)purchaseTotalOutput.innerHTML='<strong>Merchandise subtotal:</strong> $'+subtotal.toFixed(2)+' &nbsp; <strong>Purchase total:</strong> $'+total.toFixed(2)+' <span>(tax, shipping, fees, and discount included)</span>';return{subtotal,tax,shipping,fees,discount,total};};[purchaseTaxInput,purchaseShippingInput,purchaseFeesInput,purchaseDiscountInput].forEach((input)=>input?.addEventListener('input',refreshPurchaseTotal));purchaseFile.addEventListener('change',()=>setTimeout(refreshPurchaseTotal,0));refreshPurchaseTotal();purchaseButton.onclick=async()=>{const costs=refreshPurchaseTotal();const vendor=vendorInput.value.trim();const csvVendors=[...new Set(pendingPurchases.map((row)=>row.vendor).filter(Boolean))];const csvReferences=[...new Set(pendingPurchases.map((row)=>row.reference_number).filter(Boolean))];const csvNotes=[...new Set(pendingPurchases.map((row)=>row.notes).filter(Boolean))];const resolvedVendor=vendor||csvVendors[0]||'';const reference=purchaseReferenceInput.value.trim()||csvReferences[0]||'';const notes=purchaseNotesInput.value.trim()||csvNotes[0]||'';const receiptFiles=[...(purchaseReceiptInput.files||[])];if(!pendingPurchases.length){purchaseStatus.textContent='Choose and validate a purchase CSV first.';return;}if(!resolvedVendor){purchaseStatus.textContent='Choose an existing vendor or type a new one.';return;}if(!vendor&&csvVendors.length>1){purchaseStatus.textContent='This CSV contains multiple vendors. Enter the vendor for this receipt above.';return;}if(!purchaseDateInput.value){purchaseStatus.textContent='Enter the purchase date.';return;}if([costs.tax,costs.shipping,costs.fees,costs.discount].some((value)=>value===null)){purchaseStatus.textContent='Tax, shipping, fees, and discount must be zero or greater.';return;}if(costs.discount>costs.subtotal){purchaseStatus.textContent='Discount cannot be greater than the merchandise subtotal.';return;}if(receiptFiles.some((receipt)=>receipt.size>10*1024*1024)){purchaseStatus.textContent='Each receipt file must be 10 MB or smaller.';return;}if(!cloud){purchaseStatus.textContent='Purchase import requires the connected store database.';return;}purchaseButton.disabled=true;purchaseStatus.textContent='Saving purchase and receipt copies…';let purchaseSaved=false;const uploadedReceipts=[];try{const currentUser=await cloudAdmin().auth.getUser();const userId=currentUser.data?.user?.id;if(!userId)throw new Error('Your admin session has expired. Sign in again.');for(const [index,receipt] of receiptFiles.entries()){const safeName=receipt.name.toLowerCase().replace(/[^a-z0-9._-]+/g,'-')||'receipt';const receiptPath=userId+'/'+Date.now()+'-'+index+'-'+safeName;const upload=await cloudAdmin().storage.from('expense-receipts').upload(receiptPath,receipt,{upsert:false,contentType:receipt.type||undefined});if(upload.error)throw upload.error;uploadedReceipts.push({receipt_path:receiptPath,receipt_name:receipt.name,content_type:receipt.type||null,size_bytes:receipt.size});}const purchase={purchase_date:new Date(purchaseDateInput.value+'T12:00:00Z').toISOString(),vendor:resolvedVendor,reference_number:reference,notes,subtotal:costs.subtotal,tax_amount:costs.tax,shipping_amount:costs.shipping,other_fees:costs.fees,discount_amount:costs.discount,receipt_path:uploadedReceipts[0]?.receipt_path||null,receipt_name:uploadedReceipts[0]?.receipt_name||null,receipt_files:uploadedReceipts,lines:pendingPurchases.map((row)=>({sku:row.sku,quantity:row.quantity,total_cost:row.total_cost}))};const result=await cloudAdmin().rpc('import_inventory_purchase_with_receipts',{purchase_payload:purchase});if(result.error)throw result.error;purchaseSaved=true;purchaseStatus.textContent='Imported '+Number(result.data?.lines||pendingPurchases.length)+' purchase lines and '+Number(result.data?.receipt_count||0)+' receipt copies. Total recorded: $'+costs.total.toFixed(2)+'.';await invalidateAdminAccountingInventoryCaches();await renderInventoryTools('adjust');}catch(error){if(!purchaseSaved&&uploadedReceipts.length)await cloudAdmin().storage.from('expense-receipts').remove(uploadedReceipts.map((receipt)=>receipt.receipt_path));purchaseStatus.textContent=purchaseSaved?'Purchase imported, but the inventory view could not refresh: '+error.message:'Purchase import stopped: '+error.message;purchaseButton.disabled=purchaseSaved;}};
 const recipeForm=view.querySelector('[data-bundle-recipe-form]');const recipeSearch=recipeForm.querySelector('[data-recipe-search]');const existingRecipe=recipeForm.querySelector('[data-recipe-existing]');const bundleTypeInput=recipeForm.querySelector('[data-recipe-bundle-type]');const bundleSkuInput=recipeForm.querySelector('[data-recipe-bundle-sku]');const bundleNameInput=recipeForm.querySelector('[data-recipe-bundle-name]');const componentSearch=recipeForm.querySelector('[data-recipe-component-search]');const componentSelect=recipeForm.querySelector('[data-recipe-component-select]');const componentQuantity=recipeForm.querySelector('[data-recipe-component-quantity]');const componentList=recipeForm.querySelector('[data-recipe-components]');const recipePreview=recipeForm.querySelector('[data-recipe-deduction-preview]');const recipeStatus=recipeForm.querySelector('[data-recipe-status]');let selectedRecipe=null;let selectedComponents=[];let bundleSkuLookupRequest=0;let bundleSkuSearchTimer=null;const bundleSkuSuggestions=document.createElement('datalist');bundleSkuSuggestions.id='bundle-recipe-skus-'+Math.random().toString(36).slice(2);bundleSkuInput.setAttribute('list',bundleSkuSuggestions.id);bundleSkuInput.after(bundleSkuSuggestions);const bundleSkuHint=document.createElement('small');bundleSkuHint.className='inventory-help';bundleSkuHint.setAttribute('aria-live','polite');bundleSkuHint.textContent='Choose an existing canonical inventory SKU. Create the SKU first in SKU Search or inventory setup.';bundleSkuInput.after(bundleSkuHint);
const deleteRecipeButton=document.createElement('button');deleteRecipeButton.type='button';deleteRecipeButton.textContent='Delete selected recipe';deleteRecipeButton.disabled=true;recipeForm.querySelector('.inventory-recipe-lookup').append(deleteRecipeButton);
    const recipeLookupCache=new Map();let recipeLookupRows=[];let recipeLookupRequest=0;
    const recipeRowsFromLookup=(rows)=>{const grouped=new Map();(rows||[]).forEach((row)=>{const bundleId=row.bundle_id;if(!bundleId)return;const recipe=grouped.get(bundleId)||{bundle:{id:bundleId,sku:row.bundle_sku,name:row.bundle_name,item_type:row.bundle_item_type},components:[]};if(row.component_id)recipe.components.push({id:row.component_id,sku:row.component_sku,name:row.component_name||row.component_sku,quantity:Number(row.component_quantity)||1});grouped.set(bundleId,recipe);});return [...grouped.values()];};
    const loadRecipeLookup=async(query='',finishedOnly=false)=>{const key=(finishedOnly?'finished:':'all:')+query.trim().toLowerCase();const cached=recipeLookupCache.get(key);if(cached)return cached;const promise=cloudAdmin().rpc('admin_inventory_recipe_lookup',{p_search:query.trim()||null,p_finished_only:finishedOnly,p_limit:50}).then(async(result)=>{if(result.error)throw result.error;const rows=recipeRowsFromLookup(result.data||[]);if(rows.length)return rows;/* Keep the builder usable if an older live schema has not exposed the new RPC yet. */const direct=await cloudAdmin().from('inventory_bundle_components').select('bundle_sku_id,component_sku_id,quantity,sort_order,bundle_sku,component_sku').order('bundle_sku').range(0,249);if(direct.error)throw direct.error;const fallback=recipeRowsFromLookup((direct.data||[]).map((row)=>({bundle_id:row.bundle_sku_id,bundle_sku:row.bundle_sku,bundle_name:inventoryRecords.find((record)=>record.id===row.bundle_sku_id)?.name||row.bundle_sku,bundle_item_type:inventoryRecords.find((record)=>record.id===row.bundle_sku_id)?.item_type,component_id:row.component_sku_id,component_sku:row.component_sku,component_name:inventoryRecords.find((record)=>record.id===row.component_sku_id)?.name||row.component_sku,component_quantity:row.quantity,component_sort_order:row.sort_order})).filter((row)=>!finishedOnly||String(row.bundle_item_type||'').toLowerCase()!=='non-inventory'));const needle=query.trim().toLowerCase();return needle?fallback.filter((recipe)=>[recipe.bundle.name,recipe.bundle.sku,...recipe.components.map((component)=>component.sku)].join(' ').toLowerCase().includes(needle)):fallback;});recipeLookupCache.set(key,promise);try{return await promise;}catch(error){recipeLookupCache.delete(key);throw error;}};
    const drawRecipeOptions=async()=>{const request=++recipeLookupRequest;const query=recipeSearch.value.trim();existingRecipe.innerHTML='<option value="">Searching saved recipes…</option>';try{const matches=await loadRecipeLookup(query,false);if(request!==recipeLookupRequest)return;recipeLookupRows=matches;existingRecipe.innerHTML='<option value="">'+(matches.length?'Choose an existing recipe':'No matching recipes')+'</option>'+matches.map((recipe)=>'<option value="'+adminSafe(recipe.bundle.id)+'">'+adminSafe(recipe.bundle.name||recipe.bundle.sku)+' · '+adminSafe(recipe.bundle.sku)+'</option>').join('');if(selectedRecipe&&matches.some((recipe)=>recipe.bundle.id===selectedRecipe.bundle.id))existingRecipe.value=selectedRecipe.bundle.id;}catch(error){if(request===recipeLookupRequest){recipeLookupRows=[];existingRecipe.innerHTML='<option value="">Recipe lookup unavailable</option>';recipeStatus.textContent='Saved recipes could not be loaded: '+(error?.message||'Unknown database error.');}}};
    let componentLookupRows=[];
    const drawComponentOptions=async()=>{const query=componentSearch.value.trim();if(!query){componentLookupRows=[];componentSelect.innerHTML='<option value="">Type a name or SKU above</option>';return;}const result=await inventoryLookupPage(query,'physical',1,60);componentLookupRows=(result.data||[]).filter((record)=>!bundleSkuInput.value.trim()||normalizeSku(record.sku)!==normalizeSku(bundleSkuInput.value));componentSelect.innerHTML='<option value="">'+(componentLookupRows.length?'Choose a component':'No matching inventory found')+'</option>'+componentLookupRows.map((record)=>'<option value="'+adminSafe(record.id)+'">'+adminSafe(record.name||record.sku)+' · '+adminSafe(record.sku)+' · On hand '+Number(record.quantity_on_hand||0)+'</option>').join('');};
     const drawRecipeComponents=()=>{componentList.innerHTML=selectedComponents.map((component,index)=>'<div class="inventory-recipe-component"><div><strong>'+adminSafe(component.name)+'</strong><span>'+adminSafe(component.sku)+'</span></div><label>Qty used<input type="number" min="1" step="1" data-recipe-component-quantity-index="'+index+'" value="'+Number(component.quantity||1)+'"></label><button type="button" data-remove-recipe-component="'+index+'">Remove</button></div>').join('')||'<p class="inventory-help">No components selected yet.</p>';const packType=bundleTypeInput.value;const detail=selectedComponents.map((component)=>Number(component.quantity||1)+' × '+component.name+' ('+component.sku+')').join(' · ');recipePreview.textContent=selectedComponents.length?(packType==='Non-inventory'?'Sellable quantity, cost, and weight will update automatically from: ':'Building 1 finished kit will deduct: ')+detail:'Save at least one component to define the pack.';componentList.querySelectorAll('[data-remove-recipe-component]').forEach((button)=>button.addEventListener('click',()=>{selectedComponents.splice(Number(button.dataset.removeRecipeComponent),1);drawRecipeComponents();}));componentList.querySelectorAll('[data-recipe-component-quantity-index]').forEach((input)=>input.addEventListener('change',()=>{selectedComponents[Number(input.dataset.recipeComponentQuantityIndex)].quantity=Math.max(1,Number(input.value)||1);drawRecipeComponents();}));};
 const setRecipe=(recipe)=>{selectedRecipe=recipe;selectedComponents=(recipe?.components||[]).map((component)=>({...component}));bundleTypeInput.value=String(recipe?.bundle.item_type||'Non-inventory').toLowerCase()==='inventory'?'Inventory':'Non-inventory';bundleSkuInput.value=recipe?.bundle.sku||'';bundleNameInput.value=recipe?.bundle.name||recipe?.bundle.sku||'';deleteRecipeButton.disabled=!recipe;recipeStatus.textContent='';void drawRecipeOptions();drawComponentOptions();drawRecipeComponents();};
deleteRecipeButton.onclick=async()=>{if(!selectedRecipe||!window.confirm('Delete this saved recipe? The bundle inventory SKU will remain.'))return;deleteRecipeButton.disabled=true;recipeStatus.textContent='Deleting recipe…';const result=await cloudAdmin().from('inventory_bundle_components').delete().eq('bundle_sku_id',selectedRecipe.bundle.id);if(result.error){deleteRecipeButton.disabled=false;recipeStatus.textContent='Recipe was not deleted: '+result.error.message;return;}recipeLookupRows=recipeLookupRows.filter((recipe)=>recipe.bundle.id!==selectedRecipe.bundle.id);recipeLookupCache.clear();setRecipe(null);await drawRecipeOptions();await drawBuildRecipeOptions();recipeStatus.textContent='Recipe deleted. The bundle inventory SKU was kept.';};
     const drawBundleSkuSuggestions=async()=>{const request=++bundleSkuLookupRequest;const query=bundleSkuInput.value.trim();if(!query){bundleSkuSuggestions.replaceChildren();bundleSkuHint.textContent='Choose an existing canonical inventory SKU. Create the SKU first in SKU Search or inventory setup.';return;}try{const result=await inventoryLookupPage(query,'all',1,100);if(request!==bundleSkuLookupRequest)return;if(result.error)throw result.error;const matches=result.data||[];bundleSkuSuggestions.innerHTML=matches.map((record)=>'<option value="'+adminSafe(record.sku)+'" label="'+adminSafe((record.name||record.sku)+' · '+record.sku)+'"></option>').join('');const exact=matches.find((record)=>normalizeSku(record.sku)===normalizeSku(query));bundleSkuHint.textContent=exact?'Existing canonical SKU: '+(exact.name||exact.sku)+' · '+exact.sku:matches.length?'Choose an exact matching SKU from the suggestions. The bundle SKU must already exist.':'No canonical SKU matches yet. Create the SKU first, then add its recipe.';}catch(error){if(request===bundleSkuLookupRequest)bundleSkuHint.textContent='Canonical SKU suggestions could not be loaded. Save will still verify that the SKU exists.';}};
     const syncRecipeType=()=>{recipeStatus.textContent='Pack type set to '+(bundleTypeInput.value==='Inventory'?'Finished inventory kit':'Auto-calculated sellable pack')+'. Save recipe to apply it.';drawRecipeComponents();};recipeSearch.oninput=()=>{void drawRecipeOptions();};existingRecipe.onchange=()=>{const recipe=recipeLookupRows.find((entry)=>entry.bundle.id===existingRecipe.value);setRecipe(recipe||null);};bundleTypeInput.addEventListener('change',syncRecipeType);bundleTypeInput.addEventListener('input',syncRecipeType);componentSearch.oninput=()=>{void drawComponentOptions();};bundleSkuInput.oninput=()=>{bundleSkuLookupRequest+=1;window.clearTimeout(bundleSkuSearchTimer);bundleSkuSearchTimer=window.setTimeout(()=>void drawBundleSkuSuggestions(),180);void drawComponentOptions();};bundleSkuInput.onchange=()=>{void drawBundleSkuSuggestions();};view.querySelector('[data-new-recipe]').onclick=()=>{setRecipe(null);bundleSkuInput.focus();};
     const requestedRecipeSku=adminUrlParams.get('recipe');if(requestedRecipeSku){void loadRecipeLookup(requestedRecipeSku,false).then((matches)=>{const requestedRecipe=matches.find((entry)=>normalizeSku(entry.bundle.sku)===normalizeSku(requestedRecipeSku));if(requestedRecipe){recipeLookupRows=matches;setRecipe(requestedRecipe);existingRecipe.value=requestedRecipe.bundle.id;}}).catch(()=>{});}
    const routeRecipeSku=adminUrlParams.get('recipe');if(routeRecipeSku){void loadRecipeLookup(routeRecipeSku,false).then((matches)=>{if(matches.some((entry)=>normalizeSku(entry.bundle.sku)===normalizeSku(routeRecipeSku)))return;bundleSkuInput.value=routeRecipeSku;bundleNameInput.value=routeRecipeSku;recipeStatus.textContent='No saved recipe exists for this pack yet. Add the child SKUs and save it here.';drawComponentOptions();}).catch(()=>{});}
    void drawRecipeOptions();
    existingRecipe.addEventListener('change',()=>{const recipe=recipeLookupRows.find((entry)=>entry.bundle.id===existingRecipe.value);if(recipe?.bundle&&!inventoryRecords.some((record)=>record.id===recipe.bundle.id))inventoryRecords.push(recipe.bundle);});
     view.querySelector('[data-add-recipe-component]').onclick=()=>{const record=componentLookupRows.find((entry)=>String(entry.id)===String(componentSelect.value));const quantity=Math.max(1,Number(componentQuantity.value)||1);if(!record){recipeStatus.textContent='Search for and choose an inventory component first.';return;}if(normalizeSku(record.sku)===normalizeSku(bundleSkuInput.value)){recipeStatus.textContent='A bundle cannot deduct itself.';return;}if(selectedComponents.some((component)=>component.id===record.id)){recipeStatus.textContent='That component is already in the recipe. Change its quantity below.';return;}selectedComponents.push({id:record.id,sku:record.sku,name:record.name||record.sku,quantity});componentQuantity.value='1';recipeStatus.textContent='';drawRecipeComponents();};
     recipeForm.onsubmit=async(event)=>{event.preventDefault();if(!cloud){recipeStatus.textContent='Recipe saving requires the connected store database.';return;}const requestedBundleSku=bundleSkuInput.value.trim();const bundleName=bundleNameInput.value.trim()||requestedBundleSku;const bundleType=bundleTypeInput.value;if(!requestedBundleSku){recipeStatus.textContent='Enter the SKU for the pack you want to make.';return;}if(!selectedComponents.length){recipeStatus.textContent='Add at least one child SKU so the recipe is defined.';return;}if(selectedComponents.some((component)=>!Number.isInteger(Number(component.quantity))||Number(component.quantity)<1)){recipeStatus.textContent='Each child SKU quantity must be a positive whole number.';return;}recipeStatus.textContent='Checking canonical bundle SKU…';try{let lookup=await cloudAdmin().from('inventory_skus').select('id,sku,name,quantity_on_hand,reorder_point,item_type,category,taxable,unit_type,source_system').eq('sku',requestedBundleSku).maybeSingle();if(lookup.error)throw lookup.error;let bundle=lookup.data;if(!bundle){const matches=await inventoryLookupPage(requestedBundleSku,'all',1,60);if(matches.error)throw matches.error;bundle=(matches.data||[]).find((record)=>normalizeSku(record.sku)===normalizeSku(requestedBundleSku))||null;}if(!bundle?.id){recipeStatus.textContent='Bundle SKU '+requestedBundleSku+' does not exist in canonical inventory. Create it first, then return here to add its recipe.';bundleSkuInput.focus();return;}const bundleSku=bundle.sku;if(selectedComponents.some((component)=>normalizeSku(component.sku)===normalizeSku(bundleSku))){recipeStatus.textContent='A bundle cannot use itself as a recipe component.';return;}recipeStatus.textContent='Saving recipe…';const updates={name:bundleName,item_type:bundleType,updated_at:new Date().toISOString()};const updated=await cloudAdmin().from('inventory_skus').update(updates).eq('id',bundle.id);if(updated.error)throw updated.error;const remove=await cloudAdmin().from('inventory_bundle_components').delete().eq('bundle_sku_id',bundle.id);if(remove.error)throw remove.error;const insert=await cloudAdmin().from('inventory_bundle_components').insert(selectedComponents.map((component,index)=>({bundle_sku_id:bundle.id,component_sku_id:component.id,quantity:Number(component.quantity),sort_order:index})));if(insert.error)throw insert.error;recipeStatus.textContent=bundleType==='Non-inventory'?'Recipe saved. Available packs, cost, and weight will follow the child SKUs automatically.':'Recipe saved. Building 1 finished kit will deduct '+selectedComponents.map((component)=>Number(component.quantity)+' × '+component.name).join(' · ')+'.';await renderInventoryTools('adjust');}catch(error){recipeStatus.textContent='Recipe was not saved: '+(error?.message||'Unknown error.');}};
     const buildRecipeSearch=view.querySelector('[data-build-recipe-search]');const buildRecipeSelect=view.querySelector('[data-bundle-sku]');const buildQuantity=view.querySelector('[data-bundle-quantity]');const buildPreview=view.querySelector('[data-bundle-deduction-preview]');let buildRecipeRows=[];const buildableRecipes=()=>buildRecipeRows;const updateBuildPreview=()=>{const recipe=buildableRecipes().find((entry)=>entry.bundle.sku===buildRecipeSelect.value);const quantity=Math.max(1,Number(buildQuantity.value)||1);buildPreview.textContent=recipe?'This build will deduct: '+recipe.components.map((component)=>Number(component.quantity)*quantity+' × '+component.name+' ('+component.sku+')').join(' · '):'Choose a finished kit recipe to see exactly what will be deducted.';};const drawBuildRecipeOptions=async()=>{const query=buildRecipeSearch.value.trim();const selected=buildRecipeSelect.value;buildRecipeSelect.innerHTML='<option value="">Searching finished kits…</option>';try{const matches=await loadRecipeLookup(query,true);buildRecipeRows=matches;buildRecipeSelect.innerHTML='<option value="">'+(matches.length?'Choose a finished kit recipe':'No matching finished kits')+'</option>'+matches.map((recipe)=>'<option value="'+adminSafe(recipe.bundle.sku)+'">'+adminSafe(recipe.bundle.name||recipe.bundle.sku)+' · '+adminSafe(recipe.bundle.sku)+'</option>').join('');if(matches.some((recipe)=>recipe.bundle.sku===selected))buildRecipeSelect.value=selected;updateBuildPreview();}catch(error){buildRecipeRows=[];buildRecipeSelect.innerHTML='<option value="">Recipe lookup unavailable</option>';buildPreview.textContent='Finished kit recipes could not be loaded.';}};buildRecipeSearch.oninput=()=>{void drawBuildRecipeOptions();};buildRecipeSelect.onchange=updateBuildPreview;buildQuantity.oninput=updateBuildPreview;void drawBuildRecipeOptions();
    view.querySelector('[data-bundle-conversion-form]').onsubmit=async(event)=>{event.preventDefault();const form=event.currentTarget;const status=form.querySelector('[data-bundle-status]');const bundleSku=buildRecipeSelect.value;const quantity=Number(buildQuantity.value);const note=form.querySelector('[data-bundle-note]').value.trim();if(!bundleSku||!Number.isInteger(quantity)||quantity<1||!note){status.textContent='Choose a saved recipe, enter a positive whole quantity, and add a conversion note.';return;}if(!cloud){status.textContent='Bundle building requires the connected store database.';return;}status.textContent='Building bundles…';const result=await cloudAdmin().rpc('convert_inventory_bundle',{bundle_sku_value:bundleSku,bundle_quantity:quantity,conversion_note:note});if(result.error){status.textContent='Bundle build failed: '+result.error.message;return;}status.textContent='Built '+quantity+' bundle(s). The listed components were deducted and bundle inventory increased.';await renderInventoryTools('adjust');};return;
  }
   if(tab==='sku'){
     if(!isCurrent())return;
     view.innerHTML='<div class="admin-heading"><div><h3>SKU Search</h3><p>Search the canonical inventory table on the server. Results are limited to 25 rows per page so opening this screen does not download the whole catalog. Product-page links open in a new tab for one page, or list every page when the SKU appears on multiple pages. Delete SKU is for mistaken unused records and refuses SKUs with recipe, adjustment, or purchase history.</p></div><label>Search SKUs<input type="search" data-sku-search placeholder="SKU or product"></label><button type="button" data-download-sku>Download matching CSV</button></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Product name</th><th>SKU</th><th>Product page</th><th>On hand</th><th>Price</th><th>Cost</th><th>Preferred vendor</th><th>Discontinued</th><th>Action</th></tr></thead><tbody></tbody></table></div><div class="admin-pagination" data-sku-pagination></div>';
     const searchInput=view.querySelector('[data-sku-search]');
     const tbody=view.querySelector('tbody');
     const pagination=view.querySelector('[data-sku-pagination]');
     let page=1;const pageSize=25;let request=0;let debounce=null;
     const loadProductPages=async(records)=>{
       const ids=records.map((record)=>record.id).filter(Boolean);
       const skus=records.map((record)=>String(record.sku||'').trim()).filter(Boolean);
       const lookups=await Promise.all([
         ids.length?adminBatchRows(ids,(batch)=>cloudAdmin().from('product_option_values').select('inventory_sku_id,product_options!inner(product_id)').in('inventory_sku_id',batch)):Promise.resolve({data:[],error:null}),
         skus.length?adminBatchRows(skus,(batch)=>cloudAdmin().from('product_option_values').select('inventory_sku,product_options!inner(product_id)').in('inventory_sku',batch)):Promise.resolve({data:[],error:null}),
         skus.length?adminBatchRows(skus,(batch)=>cloudAdmin().from('product_option_values').select('sku,product_options!inner(product_id)').in('sku',batch)):Promise.resolve({data:[],error:null}),
         skus.length?adminBatchRows(skus,(batch)=>cloudAdmin().from('products').select('id,external_id,name,sku').in('sku',batch)):Promise.resolve({data:[],error:null})
       ]);
       const failed=lookups.find((result)=>result.error);
       if(failed)throw failed.error;
       const recordById=new Map(records.map((record)=>[record.id,record]));
       const recordIdBySku=new Map(records.map((record)=>[String(record.sku||'').trim().toLowerCase(),record.id]));
       const productIdsByRecord=new Map(records.map((record)=>[record.id,new Set()]));
       const addPlacement=(row,recordId)=>{
         const productId=row.product_options?.product_id;
         if(productId&&productIdsByRecord.has(recordId))productIdsByRecord.get(recordId).add(productId);
       };
       lookups[0].data.forEach((row)=>addPlacement(row,recordById.get(row.inventory_sku_id)?.id));
       lookups[1].data.forEach((row)=>addPlacement(row,recordIdBySku.get(String(row.inventory_sku||'').trim().toLowerCase())));
       lookups[2].data.forEach((row)=>addPlacement(row,recordIdBySku.get(String(row.sku||'').trim().toLowerCase())));
       lookups[3].data.forEach((product)=>{
         const recordId=recordIdBySku.get(String(product.sku||'').trim().toLowerCase());
         if(recordId&&product.id)productIdsByRecord.get(recordId).add(product.id);
       });
       const productIds=[...new Set([...productIdsByRecord.values()].flatMap((productIdsForSku)=>[...productIdsForSku]))];
       const productsResult=productIds.length?await adminBatchRows(productIds,(batch)=>cloudAdmin().from('products').select('id,external_id,name').in('id',batch)):{data:[],error:null};
       if(productsResult.error)throw productsResult.error;
       const productById=new Map([...lookups[3].data,...productsResult.data].map((product)=>[product.id,product]));
       return records.map((record)=>({...record,productPages:[...(productIdsByRecord.get(record.id)||[])].map((productId)=>productById.get(productId)).filter(Boolean).map((product)=>({id:product.id,name:product.name||product.external_id||product.id,href:'admin.html?edit='+encodeURIComponent(product.id)})).sort((left,right)=>left.name.localeCompare(right.name))}));
     };
     const drawSku=async()=>{
       const current=++request;const search=searchInput.value.trim();
       tbody.innerHTML='<tr><td colspan="9">Searching canonical inventory…</td></tr>';pagination.innerHTML='';
       const result=await inventoryLookupPage(search,'all',page,pageSize);
       if(current!==request||!isCurrent())return;
       if(result.error){tbody.innerHTML='<tr><td colspan="9">Unable to search canonical inventory: '+adminSafe(result.error.message||'Unknown database error.')+'</td></tr>';return;}
       const rows=result.data||[];const total=Number(rows[0]?.total_count)||0;const pageCount=Math.max(1,Math.ceil(total/pageSize));page=Math.min(page,pageCount);
       let rowsWithPages=rows;let pageLookupError=null;
       try{rowsWithPages=await loadProductPages(rows);}catch(error){pageLookupError=error;}
       if(current!==request||!isCurrent())return;
       const productPageCell=(record)=>{const pages=record.productPages||[];if(pages.length===1)return'<a class="admin-sku-link" href="'+adminSafe(pages[0].href)+'">Open product page</a>';if(pages.length>1)return'<button type="button" class="admin-page-count-link" data-sku-pages="'+adminSafe(JSON.stringify(pages))+'">'+pages.length+' product pages</button>';return'—';};
       tbody.innerHTML=rowsWithPages.map((record)=>'<tr><td>'+adminSafe(record.name||record.sku)+'</td><td>'+adminSkuLink(record.sku,'')+'</td><td>'+productPageCell(record)+'</td><td>'+Number(record.quantity_on_hand||0)+'</td><td>$'+Number(record.price||0).toFixed(2)+'</td><td>'+(record.cost===null||record.cost===undefined?'—':'$'+Number(record.cost).toFixed(2))+'</td><td>'+adminSafe(record.preferred_vendor||'—')+'</td><td><button type="button" data-toggle-discontinued="'+adminSafe(record.id)+'">'+(record.discontinued?'YES':'NO')+'</button></td><td><div class="admin-sku-row-actions"><button type="button" data-edit-inventory-sku="'+adminSafe(record.id)+'">Edit</button><button type="button" data-delete-inventory-sku="'+adminSafe(record.id)+'">Delete SKU</button></div></td></tr>').join('')||'<tr><td colspan="9">No canonical SKUs match this search.</td></tr>';
       if(pageLookupError)tbody.insertAdjacentHTML('afterbegin','<tr><td colspan="9">Product-page links could not be loaded: '+adminSafe(pageLookupError.message||'Unknown database error.')+'</td></tr>');
       pagination.innerHTML='<button type="button" data-sku-prev '+(page===1?'disabled':'')+'>Previous</button><span>Page '+page+' of '+pageCount+' · '+total+' canonical SKUs</span><button type="button" data-sku-next '+(page===pageCount?'disabled':'')+'>Next</button>';
       pagination.querySelector('[data-sku-prev]').onclick=()=>{page=Math.max(1,page-1);void drawSku();};pagination.querySelector('[data-sku-next]').onclick=()=>{page=Math.min(pageCount,page+1);void drawSku();};
     };
     const routeSku=adminUrlParams.get('sku');if(routeSku)searchInput.value=routeSku;
     searchInput.oninput=()=>{clearTimeout(debounce);debounce=setTimeout(()=>{page=1;void drawSku();},250);};
     view.querySelector('[data-download-sku]').onclick=async()=>{const button=view.querySelector('[data-download-sku]');button.disabled=true;try{const rows=await inventoryLookupAll('all',searchInput.value.trim());download([['Product name','SKU','Quantity on hand','Price','Cost','Preferred vendor','Discontinued'],...rows.map((record)=>[record.name||record.sku,record.sku,Number(record.quantity_on_hand||0),record.price,record.cost??'',record.preferred_vendor||'',record.discontinued?'YES':'NO'])],'sku-inventory-report.csv');}catch(error){tbody.insertAdjacentHTML('afterbegin','<tr><td colspan="9">Unable to export canonical inventory: '+adminSafe(error.message||'Unknown database error.')+'</td></tr>');}finally{button.disabled=false;}};
     view.addEventListener('click',async(event)=>{const pagesButton=event.target.closest('[data-sku-pages]');if(pagesButton){let pages=[];try{pages=JSON.parse(pagesButton.dataset.skuPages||'[]');}catch(error){pages=[];}const dialog=document.createElement('dialog');dialog.className='admin-sku-pages-dialog';dialog.innerHTML='<form method="dialog"><button type="submit" aria-label="Close">×</button><h3>Product pages for this SKU</h3><ul>'+pages.map((product)=>'<li><a href="'+adminSafe(product.href)+'" target="_blank" rel="noopener noreferrer">'+adminSafe(product.name||product.id)+'</a></li>').join('')+'</ul></form>';document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();return;}const editButton=event.target.closest('[data-edit-inventory-sku]');if(editButton?.dataset.editInventorySku){editButton.disabled=true;await openInventorySkuEditor(editButton.dataset.editInventorySku,drawSku);editButton.disabled=false;return;}const deleteButton=event.target.closest('[data-delete-inventory-sku]');if(deleteButton?.dataset.deleteInventorySku){const row=deleteButton.closest('tr');const sku=row?.querySelector('.admin-sku-link')?.textContent?.trim()||'this SKU';if(!window.confirm('Delete '+sku+' from canonical inventory? This cannot be undone.'))return;deleteButton.disabled=true;deleteButton.textContent='Deleting…';const result=await cloudAdmin().rpc('delete_unused_inventory_sku',{inventory_sku_id_value:deleteButton.dataset.deleteInventorySku});if(result.error){deleteButton.disabled=false;deleteButton.textContent='Delete SKU';tbody.insertAdjacentHTML('afterbegin','<tr><td colspan="9">SKU was not deleted: '+adminSafe(result.error.message||'Unknown database error.')+'</td></tr>');return;}await drawSku();return;}const button=event.target.closest('[data-toggle-discontinued]');if(!button?.dataset.toggleDiscontinued)return;button.disabled=true;const next=button.textContent!=='YES';const result=await cloudAdmin().from('inventory_skus').update({discontinued:next}).eq('id',button.dataset.toggleDiscontinued);if(result.error){button.disabled=false;tbody.insertAdjacentHTML('afterbegin','<tr><td colspan="9">Unable to update discontinued status: '+adminSafe(result.error.message||'Unknown database error.')+'</td></tr>');return;}void drawSku();});
     void drawSku();return;
   }
   if(!isCurrent())return;view.innerHTML='<div class="admin-heading"><div><h3>SKU Search</h3><p>Find any individual canonical inventory SKU. Product-page placements are summarized instead of duplicated.</p></div><label>Search SKUs<input type="search" data-sku-search placeholder="SKU or product"></label><button type="button" data-download-sku>Download CSV</button></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Product pages</th><th>Product name</th><th>SKU</th><th>Inventory</th><th>Price</th><th>Cost</th><th>Preferred vendor</th><th>Sold</th><th>Discontinued</th><th>Promo</th><th>Clearance</th></tr></thead><tbody></tbody></table></div><div class="admin-pagination" data-sku-pagination></div>';
  const drawSku=()=>{const matches=()=>canonicalSearchRows.filter((row)=>[title(row.product),row.record?.name||'',row.sku,row.inventorySku,(row.linkedPages||[]).map((page)=>page.name).join(' ')].join(' ').toLowerCase().includes(view.querySelector('[data-sku-search]').value.trim().toLowerCase()));const canonicalName=(row)=>row.record?.name||'Missing canonical name';const pager=paginate(matches,view.querySelector('tbody'),view.querySelector('[data-sku-pagination]'),(row)=>'<tr><td>'+(row.linkedPageCount?'<button type="button" class="admin-page-count-link" data-sku-pages="'+adminSafe(JSON.stringify(row.linkedPages||[]))+'">'+row.linkedPageCount+' page'+(row.linkedPageCount===1?'':'s')+'</button>':'—')+'</td><td>'+adminSafe(canonicalName(row))+'</td><td>'+adminSkuLink(row.sku,row.linkedPageCount?row.product.id:'')+'</td><td>'+row.quantity+'</td><td>$'+Number(row.price||0).toFixed(2)+'</td><td>'+(row.cost===null||row.cost===undefined||row.cost===''?'—':'$'+Number(row.cost).toFixed(2))+'</td><td>'+adminSafe(row.vendor||'—')+'</td><td>'+Number(soldCounts[row.sku]||0)+'</td><td><button type="button" data-toggle-discontinued="'+adminSafe(row.record?.id||'')+'" '+(row.record?.id?'':'disabled')+'>'+(row.record?.discontinued?'YES':'NO')+'</button></td><td>'+ (row.linkedPageCount&&activePromo(row.product)?'YES':'NO')+'</td><td>'+ (row.linkedPageCount&&clearance(row.product)?'YES':'NO')+'</td></tr>','No matching SKUs.',11);pager.draw();};view.querySelector('[data-sku-search]').oninput=drawSku;view.querySelector('[data-download-sku]').onclick=()=>download([['Product pages','Product name','SKU','Inventory','Price','Cost','Preferred vendor','Sold','Discontinued','Active promo','Active clearance'],...canonicalSearchRows.map((row)=>[row.linkedPageCount?row.linkedPageCount+' page'+(row.linkedPageCount===1?'':'s'):'—',row.record?.name||'Missing canonical name',row.sku,row.quantity,row.price,row.cost??'',row.vendor||'',Number(soldCounts[row.sku]||0),row.record?.discontinued?'YES':'NO',row.linkedPageCount&&activePromo(row.product)?'YES':'NO',row.linkedPageCount&&clearance(row.product)?'YES':'NO'])],'sku-inventory-report.csv');drawSku();view.addEventListener('click',async(event)=>{const pageButton=event.target.closest('[data-sku-pages]');if(pageButton){let pages=[];try{pages=JSON.parse(pageButton.dataset.skuPages||'[]');}catch(error){pages=[];}const dialog=document.createElement('dialog');dialog.className='admin-sku-pages-dialog';dialog.innerHTML='<form method="dialog"><button type="submit" aria-label="Close">×</button><h3>Product pages for this SKU</h3><ul>'+pages.map((page)=>'<li><a href="admin.html?edit='+encodeURIComponent(page.id)+'">'+adminSafe(page.name||page.id)+'</a></li>').join('')+'</ul></form>';document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();return;}const button=event.target.closest('[data-toggle-discontinued]');if(!button?.dataset.toggleDiscontinued)return;button.disabled=true;const next=button.textContent!=='YES';const result=await cloudAdmin().from('inventory_skus').update({discontinued:next}).eq('id',button.dataset.toggleDiscontinued);if(result.error){button.disabled=false;return;}await renderInventoryTools('sku');});
}

const adminFailure=(error)=>{throw new Error(error?.message||'Supabase did not save the change.');};
const patchAdminStoreSettings=async(patch)=>{if(!window.beadSupabase)throw new Error('The store database is unavailable.');const result=await cloudAdmin().rpc('admin_patch_store_settings',{p_patch:patch});if(result.error)adminFailure(result.error);return result.data||null;};
const adminSlug=(value)=>String(value||'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const optimizeAdminImage=async(file)=>{if(!file||!file.type.startsWith('image/'))throw new Error('Choose an image file.');if(file.size>10*1024*1024)throw new Error('Images must be 10 MB or smaller.');if(typeof createImageBitmap!=='function')throw new Error('This browser cannot optimize images.');let bitmap=null;try{bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});const maxDimension=2400;const scale=Math.min(1,maxDimension/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));const context=canvas.getContext('2d');if(!context)throw new Error('The browser could not prepare the image.');context.drawImage(bitmap,0,0,canvas.width,canvas.height);const blob=await new Promise((resolve)=>canvas.toBlob(resolve,'image/webp',0.82));if(!blob)throw new Error('The browser could not compress the image.');const baseName=file.name.replace(/\.[^.]+$/,'').replace(/[^a-z0-9._-]+/gi,'-').replace(/^-|-$/g,'')||'media';return new File([blob],`${baseName}.webp`,{type:'image/webp',lastModified:file.lastModified});}catch(error){throw new Error(error?.message||'Image optimization failed.');}finally{bitmap?.close?.();}};
const optimizeAdminVideo=async(file)=>{if(!file||!file.type.startsWith('video/')||typeof MediaRecorder==='undefined')return file;const sourceUrl=URL.createObjectURL(file);const video=document.createElement('video');video.muted=true;video.playsInline=true;video.src=sourceUrl;let stream=null;try{await new Promise((resolve,reject)=>{video.onloadedmetadata=resolve;video.onerror=reject;});stream=video.captureStream?.();const mimeType=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find((type)=>MediaRecorder.isTypeSupported(type));if(!stream||!mimeType)return file;const chunks=[];const recorder=new MediaRecorder(stream,{mimeType,videoBitsPerSecond:2000000,audioBitsPerSecond:128000});const finished=new Promise((resolve,reject)=>{recorder.ondataavailable=(event)=>{if(event.data.size)chunks.push(event.data);};recorder.onerror=()=>reject(recorder.error||new Error('Video compression failed.'));recorder.onstop=()=>resolve(new Blob(chunks,{type:mimeType}));});await video.play();recorder.start();await new Promise((resolve,reject)=>{video.onended=resolve;video.onerror=reject;});recorder.stop();const blob=await finished;if(!blob||blob.size>=file.size)return file;const baseName=file.name.replace(/\.[^.]+$/,'').replace(/[^a-z0-9._-]+/gi,'-').replace(/^-|-$/g,'')||'video';return new File([blob],`${baseName}.webm`,{type:mimeType,lastModified:file.lastModified});}catch(error){return file;}finally{stream?.getTracks().forEach((track)=>track.stop());URL.revokeObjectURL(sourceUrl);}};
// Storefront/category/review uploads are checked against bounded canonical references after the save window.
// Product-scoped uploads are protected by the save transaction and are never removed by this generic timer;
// their canonical SKU references live in inventory_skus.source_metadata.product_pages.
const scheduleAdminMediaOrphanCheck=(path,url)=>{if(String(path||'').startsWith('products/'))return;window.setTimeout(async()=>{try{const client=cloudAdmin();if(!client)return;const [imageReference,settingsReference,categoryReference,optionReference,reviewReference]=await Promise.all([client.from('product_images').select('id',{count:'exact',head:true}).eq('url',url),client.from('site_settings').select('value').eq('key','store').maybeSingle(),client.from('categories').select('id',{count:'exact',head:true}).eq('cover_photo',url),client.from('product_option_values').select('id',{count:'exact',head:true}).eq('image_url',url),client.from('reviews').select('id',{count:'exact',head:true}).contains('photos',[url])]);if(imageReference.error||settingsReference.error||categoryReference.error||optionReference.error||reviewReference.error)return;const settingsJson=JSON.stringify(settingsReference.data?.value||{});if(Number(imageReference.count||0)>0||Number(categoryReference.count||0)>0||Number(optionReference.count||0)>0||Number(reviewReference.count||0)>0||settingsJson.includes(url))return;const removal=await client.storage.from('product-media').remove([path]);if(removal.error)console.warn('Unreferenced admin media cleanup failed.',removal.error);}catch(error){console.warn('Unreferenced admin media check failed.',error);}},5*60*1000);};
let activeAdminMediaScope=null;const uploadAdminMedia=async(file,folder,options={})=>{if(!file)return null;if(file.type.startsWith('video/')&&file.size>100*1024*1024)throw new Error('Videos must be 100 MB or smaller.');const optimized=file.type.startsWith('video/')?await optimizeAdminVideo(file):await optimizeAdminImage(file);if(optimized.type.startsWith('video/')&&optimized.size>100*1024*1024)throw new Error('Videos must be 100 MB or smaller.');const safeName=optimized.name.toLowerCase().replace(/[^a-z0-9._-]+/g,'-');const canonicalKey=String(options.canonicalKey||'').trim();const path=canonicalKey?`${folder}/${adminSlug(canonicalKey)}.webp`:`${folder}/${Date.now()}-${safeName}`;const canonical=Boolean(canonicalKey);const result=await cloudAdmin().storage.from('product-media').upload(path,optimized,{upsert:canonical,contentType:optimized.type||undefined,cacheControl:canonical?'60':'31536000'});if(result.error)adminFailure(result.error);const baseUrl=cloudAdmin().storage.from('product-media').getPublicUrl(path).data.publicUrl;const url=canonical?`${baseUrl}?v=${Date.now()}`:baseUrl;if(!canonical){activeAdminMediaScope?.push({path,url});scheduleAdminMediaOrphanCheck(path,url);}return url;};
const adminProductDetail=async(id)=>{const result=await cloudAdmin().from('products').select('id,external_id,sku,category_slug,subcategory_slug,name,seo_title,search_text,description,item_details,shipping_details,etsy_units_per_sale,price,promo_price,promo_starts_at,promo_ends_at,promo_discount_percent,promo_skus,quantity,visible,waitlist_enabled,estimated_cost,low_stock_threshold,badges,sku_filter_definitions,product_images(id,url,alt_text,media_type,sort_order)').eq('id',id).order('sort_order',{foreignTable:'product_images'}).maybeSingle();if(result.error)adminFailure(result.error);return result.data?[result.data]:[];};
const adminProductId=(product)=>product.external_id||product.id;
const adminProductSearch=(fields)=>[fields.name,fields.seo_title,fields.description,fields.item_details,fields.shipping_details].filter(Boolean).join(' ');
const syncAdminNonInventoryFields=(row)=>{if(!row)return;const type=row.querySelector('[data-variant-item-type]');const managed=String(type?.value||'Inventory').toLowerCase()==='non-inventory';row.classList.toggle('admin-non-inventory-row',managed);['[data-variant-quantity]','[data-variant-threshold]','[data-variant-reserve]'].forEach((selector)=>{const field=row.querySelector(selector);if(!field)return;if(managed){if(field.dataset.inventoryValue===undefined)field.dataset.inventoryValue=field.value;field.type='text';field.value='N/A';field.disabled=true;field.required=false;field.title='Managed by the single-pack child SKU recipe';}else{field.type='number';field.disabled=false;field.required=true;if(field.dataset.inventoryValue!==undefined){field.value=field.dataset.inventoryValue;delete field.dataset.inventoryValue;}field.title='';}});};
const saveCloudProduct=async(id,fields,form)=>{const currentProduct=id?await cloudAdmin().from("products").select("external_id").eq("id",id).maybeSingle():null;if(currentProduct?.error)adminFailure(currentProduct.error);const externalId=currentProduct?.data?.external_id||id||"product-"+Date.now();let options=[];try{options=JSON.parse(fields.sku_data||"[]");if(!Array.isArray(options))throw new Error("SKUs are invalid.");}catch(error){throw new Error("SKUs are invalid: "+error.message);}const skuValues=options.flatMap((option)=>Array.isArray(option.values)?option.values:[]);if(!skuValues.length||skuValues.some((value)=>!String(value.label||"").trim()||!String(value.sku||"").trim()))throw new Error("Every SKU needs a product name and SKU.");const normalizedSkus=skuValues.map((value)=>String(value.sku).trim().toLowerCase());if(new Set(normalizedSkus).size!==normalizedSkus.length)throw new Error("Each SKU must be unique within this product.");const inventorySkuForValue=(value)=>String(value.inventory_sku||value.inventorySku||value.sku||"").trim();const canonicalCandidates=[...new Set(skuValues.flatMap((value)=>[String(value.sku||"").trim(),inventorySkuForValue(value)]).filter(Boolean))];const canonicalResult=await adminBatchRows(canonicalCandidates,(batch)=>cloudAdmin().from("inventory_skus").select("id,sku").in("sku",batch));if(canonicalResult.error)adminFailure(canonicalResult.error);const canonicalBySku=new Map((canonicalResult.data||[]).map((row)=>[String(row.sku||"").trim().toLowerCase(),row]));const missingCanonical=canonicalCandidates.filter((sku)=>!canonicalBySku.has(sku.toLowerCase()));if(missingCanonical.length)throw new Error("Every product-page SKU must match an existing canonical inventory SKU. Choose it with the ? search button: "+missingCanonical.join(", "));skuValues.forEach((value)=>{const canonicalSku=canonicalBySku.get(String(value.sku).trim().toLowerCase());const affectedSku=canonicalBySku.get(inventorySkuForValue(value).toLowerCase());value.sku=canonicalSku.sku;value.inventory_sku=affectedSku.sku;});const inventoryIdBySku=new Map([...canonicalBySku.values()].map((row)=>[String(row.sku).trim().toLowerCase(),row.id]));const primary=skuValues[0];const basePrice=Math.max(0,Number(primary.price??primary.price_delta)||0);let promoSkus=[];try{promoSkus=JSON.parse(fields.promo_skus||"[]");if(!Array.isArray(promoSkus))promoSkus=[];}catch(error){promoSkus=[];}const productPayload={external_id:externalId,sku:null,category_slug:fields.category_slug||"uncategorized",subcategory_slug:fields.subcategory_slug||null,name:String(fields.name||"").trim(),seo_title:String(fields.name||"").trim(),description:fields.description||null,item_details:fields.item_details||null,shipping_details:fields.shipping_override==="on"?String(fields.shipping_details||"").trim()||null:null,etsy_units_per_sale:1,price:basePrice,...(primary.cost===null||primary.cost===undefined||String(primary.cost).trim()===""?{}:{estimated_cost:Math.max(0,Number(primary.cost)||0)}),promo_price:null,promo_starts_at:fields.promo_starts_at||null,promo_ends_at:fields.promo_ends_at||null,promo_discount_percent:Math.min(100,Math.max(0,Number(fields.promo_discount_percent)||0)),promo_skus:promoSkus.filter((sku)=>normalizedSkus.includes(String(sku).toLowerCase())),quantity:skuValues.reduce((total,value)=>total+Math.max(0,Number(value.quantity)||0),0),visible:fields.visible==="on",waitlist_enabled:fields.waitlist_enabled==="on",badges:form?Array.from(form.querySelectorAll("input[name=badges]:checked")).map((input)=>input.value):[]};productPayload.search_text=adminProductSearch(productPayload);let result=id?await cloudAdmin().from("products").update(productPayload).eq("id",id).select("id,external_id").single():await cloudAdmin().from("products").upsert(productPayload,{onConflict:"external_id"}).select("id,external_id").single();if(result.error)adminFailure(result.error);const productId=result.data.id;const existingMedia=Array.from(form?.querySelectorAll("[data-existing-media]")||[]);for(const [sortOrder,row] of existingMedia.entries()){const mediaId=row.dataset.mediaId;const url=row.querySelector("[data-existing-url]").value.trim();if(!mediaId)continue;if(row.querySelector("[data-remove-media]").checked||!url){const remove=await cloudAdmin().from("product_images").delete().eq("id",mediaId);if(remove.error)adminFailure(remove.error);continue;}const update=await cloudAdmin().from("product_images").update({url,media_type:row.querySelector("[data-existing-type]").value,alt_text:row.querySelector("[data-display-name]")?.value.trim()||adminMediaName(url,""),sort_order:sortOrder}).eq("id",mediaId);if(update.error)adminFailure(update.error);}const manualMedia=Array.from(form?.querySelectorAll("[data-manual-media]")||[]).map((row)=>({url:row.querySelector("[data-manual-url]").value.trim(),display_name:row.querySelector("[data-display-name]")?.value.trim()||"",media_type:row.querySelector("[data-manual-type]").value})).filter((entry)=>entry.url);if(manualMedia.length){const mediaResult=await cloudAdmin().from("product_images").insert(manualMedia.map((entry,index)=>({...entry,product_id:productId,alt_text:entry.display_name||adminMediaName(entry.url,""),sort_order:existingMedia.length+index})));if(mediaResult.error)adminFailure(mediaResult.error);}const files=Array.from(form?.querySelector("[name=media]")?.files||[]);const media=[];for(const file of files){const url=await uploadAdminMedia(file,"products/"+externalId);if(url)media.push({product_id:productId,url,alt_text:file.name,sort_order:existingMedia.length+manualMedia.length+media.length,media_type:file.type.startsWith("video/")?"video":"image"});}if(media.length){const mediaResult=await cloudAdmin().from("product_images").insert(media);if(mediaResult.error)adminFailure(mediaResult.error);}const existingSkuOption=await cloudAdmin().from("product_options").select("id").eq("product_id",productId).eq("name","SKU").maybeSingle();if(existingSkuOption.error)adminFailure(existingSkuOption.error);let optionResult;if(existingSkuOption.data?.id){const removeSkuValues=await cloudAdmin().from("product_option_values").delete().eq("option_id",existingSkuOption.data.id);if(removeSkuValues.error)adminFailure(removeSkuValues.error);optionResult={data:{id:existingSkuOption.data.id},error:null};}else{optionResult=await cloudAdmin().from("product_options").insert({product_id:productId,name:"SKU",required:true,sort_order:0}).select("id").single();if(optionResult.error)adminFailure(optionResult.error);}const valuesResult=await cloudAdmin().from("product_option_values").insert(skuValues.map((value,valueIndex)=>{const price=Math.max(0,Number(value.price??(basePrice+Number(value.price_delta||0)))||0);return{option_id:optionResult.data.id,inventory_sku_id:inventoryIdBySku.get(String(value.sku).trim().toLowerCase())||null,label:String(value.label).trim(),price_delta:price-basePrice,sku:String(value.sku).trim(),unit_type:String(value.unit_type||value.unitType||"Each").trim()||"Each",inventory_sku:String(value.inventory_sku||value.inventorySku||value.sku).trim(),inventory_units:Math.max(1,Number(value.inventory_units??value.inventoryUnits)||1),quantity:Math.max(0,Number(value.quantity)||0),low_stock_threshold:Math.max(0,Number(value.low_stock_threshold)||0),image_url:String(value.image_url||value.imageUrl||"").trim()||null,sort_order:valueIndex};}));if(valuesResult.error)adminFailure(valuesResult.error);if(window.beadSupabase){const setupResult=await adminBatchRows([...inventoryIdBySku.values()],(batch)=>cloudAdmin().from("inventory_skus").select("id,item_type,source_metadata").in("id",batch));if(setupResult.error)adminFailure(setupResult.error);const setupById=new Map((setupResult.data||[]).map((row)=>[row.id,row]));for(const value of skuValues){const inventoryId=inventoryIdBySku.get(String(value.sku).trim().toLowerCase());const record=setupById.get(inventoryId);if(!record||record.source_metadata?.setup_locked===true||String(record.item_type||"Inventory").toLowerCase()==="non-inventory")continue;const update=await cloudAdmin().from("inventory_skus").update({quantity_on_hand:Math.max(0,Number(value.quantity)||0),reorder_point:Math.max(0,Number(value.low_stock_threshold)||0),reserve_quantity:Math.max(0,Number(value.reserve_quantity)||0),unit_type:String(value.unit_type||value.unitType||"Each").trim()||"Each",weight_value:value.weight_value==null||String(value.weight_value).trim()===""?null:Math.max(0,Number(value.weight_value)||0),weight_unit:String(value.weight_unit||"oz"),cost:value.cost==null||String(value.cost).trim()===""?null:Math.max(0,Number(value.cost)||0),price:Math.max(0,Number(value.price??(basePrice+Number(value.price_delta||0)))||0),updated_at:new Date().toISOString()}).eq("id",inventoryId);if(update.error)adminFailure(update.error);}}return result.data;};
 const saveCloudProductCategories=async(productId,fields,form)=>{const primary=String(fields.category_slug||'').trim();const additional=String(form?.querySelector('[data-additional-category]')?.value||'').trim();const clearanceSelected=Boolean(form?.querySelector('input[name="badges"][value="Clearance"]:checked'));const slugs=[...new Set([primary,additional,clearanceSelected?'clearance-section':''].filter(Boolean))];if(!productId||!slugs.length)return;const remove=await cloudAdmin().from('product_categories').delete().eq('product_id',productId);if(remove.error)throw remove.error;const insert=await cloudAdmin().from('product_categories').insert(slugs.map((category_slug)=>({product_id:productId,category_slug})));if(insert.error)throw insert.error;};
const syncCanonicalProductPageAnswers=(form)=>{const input=form?.querySelector('[name="sku_filter_definitions"]');if(!input)return;let definitions=[];try{definitions=JSON.parse(input.value||'[]');}catch(error){definitions=[];}if(!Array.isArray(definitions))definitions=[];definitions=definitions.slice(0,3).map((definition)=>({label:String(definition?.label||'').trim(),options:definition?.options&&typeof definition.options==='object'?{...definition.options}:{}}));form.querySelectorAll('[data-variant-row]').forEach((row)=>{const sku=String(row.querySelector('[data-variant-sku]')?.value||'').trim();if(!sku)return;row.querySelectorAll('[data-product-page-answer]').forEach((field)=>{const index=Number(field.dataset.productPageAnswer);const definition=definitions[index];if(!definition)return;const answer=String(field.value||'').trim();if(answer)definition.options[sku]=answer;else delete definition.options[sku];});});input.value=JSON.stringify(definitions.filter((definition)=>definition.label));};
const saveCanonicalProductPageOptions=async(productId,form)=>{const input=form?.querySelector('[name="sku_filter_definitions"]');if(!productId||!input||!window.beadSupabase)return;const value=[...form.querySelectorAll('[data-product-page-filter-name]')].map((field)=>({label:String(field.value||'').trim()})).filter((definition)=>definition.label).slice(0,3);input.value=JSON.stringify(value);const result=await cloudAdmin().from('products').update({sku_filter_definitions:value}).eq('id',productId);if(result.error)throw result.error;};
const saveCanonicalInventoryPageOptions=async(form)=>{
  if(!window.beadSupabase)return;
  const productId=String(form?.dataset.productId||'').trim();
  if(!form||!productId)return;
  if(form._productPageOptionsReadyPromise){
    const recovered=await form._productPageOptionsReadyPromise;
    if(!recovered)throw new Error('Product page option values could not be loaded. Refresh the editor before saving so existing selections stay safe.');
  }
  const definitionNames=[...form.querySelectorAll('[data-product-page-filter-name]')].map((field)=>String(field.value||'').trim()).filter(Boolean).slice(0,3);
  const rows=[...form.querySelectorAll('[data-variant-row]')];
  const answersBySku=new Map();
  rows.forEach((row)=>{
    const sku=String(row.querySelector('[data-variant-sku]')?.value||'').trim();
    if(!sku)return;
    const answerFields=[...row.querySelectorAll('[data-product-page-answer]')];
    if(definitionNames.length&&answerFields.length!==definitionNames.length)throw new Error('Product page options are still loading. Wait for the option fields to appear, then save again.');
    const answers=answerFields.map((field)=>({name:definitionNames[Number(field.dataset.productPageAnswer)]||'',value:String(field.value||'').trim()})).filter((answer)=>answer.name&&answer.value);
    answersBySku.set(sku,answers);
  });
  const skus=[...answersBySku.keys()];
  if(!skus.length)return;
  const payload=[...answersBySku.entries()].map(([sku,options])=>({sku,options}));
  const definitions=definitionNames.map((label)=>({label}));
  const rpc=await withAdminEditorTimeout(cloudAdmin().rpc('save_product_page_sku_answers',{p_product_id:productId,p_definitions:definitions,p_answers:payload}),'Saving product page option answers');
  if(rpc.error&&!/function .*save_product_page_sku_answers.*does not exist|could not find the function/i.test(String(rpc.error.message||'')))throw rpc.error;
  if(rpc.error){
    const result=await adminBatchRows(skus,(batch)=>cloudAdmin().from('inventory_skus').select('id,sku,source_metadata').in('sku',batch));
    if(result.error)throw result.error;
    const updatedAt=new Date().toISOString();
    const updates=(result.data||[]).map((record)=>{
      const key=String(record.sku||'').trim();
      const metadata=record.source_metadata&&typeof record.source_metadata==='object'?record.source_metadata:{};
      const pages=metadata.product_pages&&typeof metadata.product_pages==='object'?metadata.product_pages:{};
      const existingPage=pages[productId]&&typeof pages[productId]==='object'?pages[productId]:{};
      return cloudAdmin().from('inventory_skus').update({source_metadata:{...metadata,product_pages:{...pages,[productId]:{...existingPage,options:answersBySku.get(key)||[]}}},updated_at:updatedAt}).eq('id',record.id);
    });
    const updatesResult=await Promise.all(updates);
    const failed=updatesResult.find((update)=>update.error);
    if(failed)throw failed.error;
  }
  // The selected product photo is page-scoped inventory metadata.  The legacy
  // product_option_values.image_url column is not canonical and is not enough
  // to survive a product page rebuild, so persist the selection beside the
  // canonical page answers.
  const mediaBySku=new Map(rows.map((row)=>{
    const sku=String(row.querySelector('[data-variant-sku]')?.value||'').trim();
    const imageUrl=String(row.querySelector('[data-variant-photo]')?.value||'').trim();
    return [sku,imageUrl||null];
  }).filter(([sku])=>sku));
  if(mediaBySku.size){
    const mediaResult=await adminBatchRows([...mediaBySku.keys()],(batch)=>cloudAdmin().from('inventory_skus').select('id,sku,source_metadata').in('sku',batch));
    if(mediaResult.error)throw mediaResult.error;
    const updatedAt=new Date().toISOString();
    const updates=(mediaResult.data||[]).filter((record)=>mediaBySku.has(String(record.sku||'').trim())).map((record)=>{
      const key=String(record.sku||'').trim();
      const metadata=record.source_metadata&&typeof record.source_metadata==='object'?record.source_metadata:{};
      const pages=metadata.product_pages&&typeof metadata.product_pages==='object'?metadata.product_pages:{};
      const existingPage=pages[productId]&&typeof pages[productId]==='object'?pages[productId]:{};
      const nextPage={...existingPage,image_url:mediaBySku.get(key)};
      return cloudAdmin().from('inventory_skus').update({source_metadata:{...metadata,product_pages:{...pages,[productId]:nextPage}},updated_at:updatedAt}).eq('id',record.id);
    });
    const updatesResult=await Promise.all(updates);
    const failed=updatesResult.find((update)=>update.error);
    if(failed)throw failed.error;
  }
  const verify=await withAdminEditorTimeout(adminBatchRows(skus,(batch)=>cloudAdmin().from('inventory_skus').select('sku,source_metadata').in('sku',batch)),'Verifying product page option answers');
  if(verify.error)throw verify.error;
  const verifiedBySku=new Map((verify.data||[]).map((record)=>[String(record.sku||'').trim().toLowerCase(),record]));
  for(const [sku,expected] of answersBySku){
    const record=verifiedBySku.get(sku.toLowerCase());
    const actual=record?.source_metadata?.product_pages?.[productId]?.options;
    if(JSON.stringify(actual||[])!==JSON.stringify(expected||[]))throw new Error('The canonical SKU option answers did not round-trip to inventory for '+sku+'.');
    const expectedImage=mediaBySku.get(sku)||null;
    const actualImage=record?.source_metadata?.product_pages?.[productId]?.image_url||null;
    if(actualImage!==expectedImage)throw new Error('The linked product photo did not round-trip to canonical inventory for '+sku+'.');
  }
};
 const normalizeCanonicalProductPageDefinitions=(form)=>{const input=form?.querySelector('[name="sku_filter_definitions"]');if(!input)return;input.value=JSON.stringify([...form.querySelectorAll('[data-product-page-filter-name]')].map((field)=>({label:String(field.value||'').trim()})).filter((definition)=>definition.label).slice(0,3));};
const saveCanonicalInventoryFields=async(productId,fields)=>{
  if(!window.beadSupabase||!productId)return;
  let options=[];
  try{options=JSON.parse(fields?.sku_data||'[]');}catch(error){return;}
  const values=options.flatMap((option)=>Array.isArray(option.values)?option.values:[]).map((value)=>({sku:String(value.inventory_sku||value.inventorySku||value.sku||'').trim(),name:String(value.label||'').trim(),price:Math.max(0,Number(value.price)||0),unitType:String(value.unit_type||value.unitType||'Each').trim()||'Each',quantity:Math.max(0,Number(value.quantity)||0),reorderPoint:Math.max(0,Number(value.low_stock_threshold)||0),reserveQuantity:Math.max(0,Number(value.reserve_quantity)||0),cost:value.cost==null||String(value.cost).trim()===''?null:Math.max(0,Number(value.cost)||0),weight:value.weight_value==null||String(value.weight_value).trim()===''?null:Math.max(0,Number(value.weight_value)||0),weightUnit:String(value.weight_unit||'oz').trim()||'oz',itemType:String(value.item_type||'Inventory').trim()||'Inventory',vendor:String(value.preferred_vendor||'').trim()||null,taxable:value.taxable!==false})).filter((value)=>value.sku&&value.name);
  if(!values.length)return;
  const uniqueSkus=[...new Set(values.map((value)=>value.sku))];
  const result=await adminBatchRows(uniqueSkus,(batch)=>cloudAdmin().from('inventory_skus').select('id,sku,name,item_type,source_metadata,quantity_on_hand,reorder_point,reserve_quantity,price,cost,unit_type,weight_value,weight_unit,preferred_vendor,taxable').in('sku',batch));
  if(result.error)throw result.error;
  const bySku=new Map((result.data||[]).map((record)=>[String(record.sku||'').trim().toLowerCase(),record]));
  const writes=[];
  for(const value of values){
    const record=bySku.get(value.sku.toLowerCase());
    if(!record)continue;
    const metadata=record.source_metadata&&typeof record.source_metadata==='object'?record.source_metadata:{};
    const locked=metadata.setup_locked===true;
    const parent=String(record.item_type||'').toLowerCase()==='non-inventory'||String(metadata.disposition||'').toLowerCase()==='recipe_parent';
    // This is the one canonical write for the editable SKU fields. The page
    // editor also displays calculated stock for recipe/non-inventory parents;
    // never write those calculated values back over inventory truth.
    const update={
      name:value.name,
      price:value.price,
      unit_type:value.unitType,
      preferred_vendor:value.vendor,
      taxable:value.taxable,
      updated_at:new Date().toISOString()
    };
    if(!parent){
      update.cost=value.cost;
      update.weight_value=value.weight;
      update.weight_unit=value.weightUnit;
    }
    if(!locked&&!parent){
      update.quantity_on_hand=value.quantity;
      update.reorder_point=value.reorderPoint;
      update.reserve_quantity=value.reserveQuantity;
      update.item_type=value.itemType;
    }
    writes.push({value,record,update,locked,parent});
  }
  const results=await Promise.all(writes.map(({record,update})=>cloudAdmin().from('inventory_skus').update(update).eq('id',record.id)));
  const failed=results.find((result)=>result.error);
  if(failed)throw failed.error;
  const verify=await adminBatchRows(writes.map(({record})=>record.id),(batch)=>cloudAdmin().from('inventory_skus').select('id,name,price,cost,unit_type,weight_value,weight_unit,preferred_vendor,taxable,quantity_on_hand,reorder_point,reserve_quantity,item_type').in('id',batch));
  if(verify.error)throw verify.error;
  const persistedById=new Map((verify.data||[]).map((record)=>[record.id,record]));
  const mismatch=(actual,expected)=>{
    if(expected===null||expected===undefined)return actual!==null&&actual!==undefined;
    return String(actual??'')!==String(expected);
  };
  for(const {value,record,update,locked,parent} of writes){
    const persisted=persistedById.get(record.id)||{};
    const editableFields=parent?['name','price','unit_type','preferred_vendor','taxable']:['name','price','cost','unit_type','weight_value','weight_unit','preferred_vendor','taxable'];
    for(const field of editableFields){
      if(mismatch(persisted[field],update[field]))throw new Error('Canonical inventory field did not round-trip for '+value.sku+': '+field+'.');
    }
    if(!locked&&!parent){
      for(const field of ['quantity_on_hand','reorder_point','reserve_quantity','item_type']){
        if(mismatch(persisted[field],update[field]))throw new Error('Canonical inventory field did not round-trip for '+value.sku+': '+field+'.');
      }
    }
    Object.assign(record,persisted);
  }
};
const saveCloudProductWithMappings=async(id,fields,form)=>{const uploadScope=[];const previousUploadScope=activeAdminMediaScope;activeAdminMediaScope=uploadScope;let result=null;try{const snapshot=id?captureAdminProductEdit(form):null;const run=async(label,operation)=>{try{return await operation();}catch(error){throw new Error(label+': '+(error?.message||'Unknown save error.'));}};if(id)await run('Saving canonical SKU answers',()=>saveCanonicalInventoryPageOptions(form));result=await run('Saving product page',()=>saveCloudProduct(id,fields,form));if(form)form.dataset.productId=result.id;await run('Saving canonical inventory fields',()=>saveCanonicalInventoryFields(result.id,fields));await run('Saving categories',()=>saveCloudProductCategories(result.id,fields,form));if(window.saveAdminProductFilterAssignments)await run('Saving category filter assignments',()=>window.saveAdminProductFilterAssignments(result.id,form));normalizeCanonicalProductPageDefinitions(form);await run('Saving product page filter names',()=>saveCanonicalProductPageOptions(result.id,form));if(!id)await run('Saving canonical SKU answers',()=>saveCanonicalInventoryPageOptions(form));if(snapshot)await run('Recording product changes',()=>recordAdminProductChanges(snapshot,fields));window.dispatchEvent(new CustomEvent('admin-product-saved',{detail:{id:result.id}}));return result;}catch(error){const productId=String(result?.id||id||'').trim();let cleanupError=null;if(productId&&uploadScope.length){try{const urls=uploadScope.map((entry)=>entry.url);const mediaRows=await cloudAdmin().from('product_images').select('id').eq('product_id',productId).in('url',urls);if(mediaRows.error)throw mediaRows.error;const ids=(mediaRows.data||[]).map((row)=>row.id).filter(Boolean);if(ids.length){const removeRows=await cloudAdmin().from('product_images').delete().in('id',ids);if(removeRows.error)throw removeRows.error;}}catch(error){cleanupError=error;}}if(uploadScope.length){try{const removeObjects=await cloudAdmin().storage.from('product-media').remove(uploadScope.map((entry)=>entry.path));if(removeObjects.error)throw removeObjects.error;}catch(error){cleanupError=cleanupError||error;}}if(cleanupError)console.warn("Product media cleanup failed after product save failure.",cleanupError);throw error;}finally{activeAdminMediaScope=previousUploadScope;}};
const installCanonicalProductPageOptions=async(form)=>{if(!form||form.dataset.productPageOptionsInstalled)return;form.dataset.productPageOptionsInstalled='true';const input=form.querySelector('[name="sku_filter_definitions"]'),definitions=()=>{try{const value=JSON.parse(input?.value||'[]');return Array.isArray(value)?value.slice(0,3).map((entry)=>({label:String(entry?.label||''),options:entry?.options&&typeof entry.options==='object'?entry.options:{}})):[];}catch(error){return[];}};const definitionList=form.querySelector('[data-product-page-filter-definitions]');const renderAnswers=()=>{const current=definitions();form.querySelectorAll('.admin-product-page-options-row').forEach((row)=>row.remove());form.querySelectorAll('[data-variant-row]').forEach((row)=>{if(!current.length)return;const sku=String(row.querySelector('[data-variant-sku]')?.value||'').trim();const box=document.createElement('section');box.className='admin-product-page-options-row';box.innerHTML='<strong>Product page options</strong>'+current.map((definition,index)=>'<label>'+adminSafe(definition.label||('Option '+(index+1)))+'<input data-product-page-answer="'+index+'" value="'+adminSafe(definition.options?.[sku]||'')+'" placeholder="Enter answer"></label>').join('');box.querySelectorAll('[data-product-page-answer]').forEach((field)=>field.addEventListener('input',()=>syncCanonicalProductPageAnswers(form)));const filterEditor=row.querySelector('.admin-sku-filter-editor');if(filterEditor)filterEditor.after(box);else row.querySelector('.admin-sku-internal')?.before(box);});};const syncDefinitions=()=>{syncCanonicalProductPageAnswers(form);const current=[...definitionList.querySelectorAll('[data-product-page-filter-name]')].map((field)=>({label:field.value.trim(),options:{}}));const previous=definitions();current.forEach((entry,index)=>{entry.options=previous[index]?.options||{};});input.value=JSON.stringify(current);renderAnswers();};const renderDefinitions=()=>{const current=definitions();definitionList.innerHTML=current.map((definition,index)=>'<label>Filter '+(index+1)+' name<input data-product-page-filter-name value="'+adminSafe(definition.label)+'" placeholder="Color, Quantity, or another option"><button type="button" data-remove-product-page-filter="'+index+'">Delete</button></label>').join('');definitionList.querySelectorAll('[data-product-page-filter-name]').forEach((field)=>field.addEventListener('input',syncDefinitions));definitionList.querySelectorAll('[data-remove-product-page-filter]').forEach((button)=>button.addEventListener('click',()=>{syncCanonicalProductPageAnswers(form);const next=definitions();next.splice(Number(button.dataset.removeProductPageFilter),1);input.value=JSON.stringify(next);renderDefinitions();renderAnswers();}));};form.querySelector('[data-add-product-page-filter]')?.addEventListener('click',()=>{syncCanonicalProductPageAnswers(form);const current=definitions();if(current.length>=3)return;current.push({label:'',options:{}});input.value=JSON.stringify(current);renderDefinitions();renderAnswers();});form.addEventListener('sku-list-changed',()=>{syncCanonicalProductPageAnswers(form);renderAnswers();});form.addEventListener('product-page-options-recovered',()=>{form.dataset.productPageOptionsHydrating='false';renderDefinitions();renderAnswers();});form.dataset.productPageOptionsHydrating='true';renderDefinitions();renderAnswers();};const cloudCategoryRows=async()=>{const result=await cloudAdmin().from('categories').select('id,slug,name,cover_photo,active,sort_order').order('sort_order').order('name').range(0,99);if(result.error)adminFailure(result.error);return result.data||[];};
const initializeAdminDefaultImageEditor=(field,storageKey,label,editorSelector)=>{const editor=panel?.querySelector(editorSelector);if(!editor||editor.dataset.ready)return;editor.dataset.ready='true';const form=editor.querySelector('form');const input=form?.elements?.[field];const preview=editor.querySelector('[data-default-'+field+'-preview]');const status=editor.querySelector('[data-default-'+field+'-status]');if(!form||!input||!preview)return;const currentUrl=()=>{const settings=adminData().settings||{};return safeAdminThemeImageUrl(settings.themeDefaultSnapshot?.[storageKey]??settings[storageKey]??window.productStoreConfig?.[storageKey]);};const render=(url=currentUrl(),message='')=>{if(preview.dataset.objectUrl)URL.revokeObjectURL(preview.dataset.objectUrl);delete preview.dataset.objectUrl;preview.hidden=!url;preview.src=url||'';if(status)status.textContent=message||(url?'Custom default '+label.toLowerCase()+' is loaded.':'The built-in default '+label.toLowerCase()+' will be used.');};input.addEventListener('change',()=>{const file=input.files?.[0];if(!file){render();return;}if(!file.type.startsWith('image/')||file.size>10*1024*1024){input.value='';render('', 'Choose an image no larger than 10 MB.');return;}const objectUrl=URL.createObjectURL(file);if(preview.dataset.objectUrl)URL.revokeObjectURL(preview.dataset.objectUrl);preview.dataset.objectUrl=objectUrl;preview.hidden=false;preview.src=objectUrl;if(status)status.textContent='New default '+label.toLowerCase()+' selected. Save to replace the default.';});const persist=async(url)=>{let data=adminData();let value={config:{...(window.productStoreConfig||{})},admin:{...(data.settings||{})}};if(window.beadSupabase){const result=await cloudAdmin().from('site_settings').select('value').eq('key','store').maybeSingle();if(result.error)throw result.error;if(result.data?.value)value=result.data.value;}const existingAdmin=value.admin&&typeof value.admin==='object'?value.admin:{};const existingConfig=value.config&&typeof value.config==='object'?value.config:{};const existingSnapshot=existingAdmin.themeDefaultSnapshot||data.settings?.themeDefaultSnapshot||{};const previousDefault=safeAdminThemeImageUrl(existingSnapshot[storageKey]);const nextPresets=(Array.isArray(existingAdmin.themePresets)?existingAdmin.themePresets:[]).map((preset)=>previousDefault&&safeAdminThemeImageUrl(preset?.[storageKey])===previousDefault?{...preset,[storageKey]:''}:preset);const nextSnapshot={...existingSnapshot,[storageKey]:url};const activePreset=nextPresets.find((preset)=>JSON.stringify(preset?.theme||{})===JSON.stringify(existingConfig.theme||{}));const activeOverride=activePreset?safeAdminThemeImageUrl(activePreset[storageKey]):'';const currentActiveUrl=safeAdminThemeImageUrl(existingConfig[storageKey]??existingAdmin[storageKey]);const useAsActiveDefault=!activePreset||!activeOverride||currentActiveUrl===previousDefault;const nextAdmin={...existingAdmin,themeDefaultSnapshot:nextSnapshot,themePresets:nextPresets};const nextConfig={...existingConfig};if(useAsActiveDefault){nextAdmin[storageKey]=url;nextConfig[storageKey]=url;}data={...data,settings:nextAdmin};if(!window.beadSupabase)throw new Error('The store database is unavailable.');const result=await patchAdminStoreSettings({config:nextConfig,admin:nextAdmin});if(!result)throw new Error('The store database rejected the default image update.');saveAdminData(data);window.productStoreConfig=nextConfig;localStorage.setItem('beadDifferentProductConfig',JSON.stringify(nextConfig));render(url);if(status)status.textContent='Default '+label.toLowerCase()+' replaced successfully.';};form.addEventListener('submit',async(event)=>{event.preventDefault();const file=input.files?.[0];if(!file){if(status)status.textContent='Choose a new '+label.toLowerCase()+' first.';return;}if(!window.beadSupabase){if(status)status.textContent=label+' uploads require the connected store database.';return;}const button=form.querySelector('button[type="submit"]');button.disabled=true;if(status)status.textContent='Uploading default '+label.toLowerCase()+'…';try{const url=await uploadAdminMedia(file,'storefront',{canonicalKey:`default-${field}`});await persist(url);input.value='';}catch(error){if(status)status.textContent='Default '+label.toLowerCase()+' was not saved: '+(error.message||'Unknown error.');}finally{button.disabled=false;}});render();};const initializeAdminDefaultHeroEditor=()=>initializeAdminDefaultImageEditor('hero','heroUrl','hero image','[data-default-hero-editor]');const initializeAdminDefaultStoryEditor=()=>initializeAdminDefaultImageEditor('story','storyUrl','Our Story image','[data-default-story-editor]');
const renderCloudError=(error)=>{const message=error?.message||'Unable to save this change.';const form=panel.querySelector('.admin-item-form');if(form){form.dataset.bundleSubmitHandled='';const notice=document.createElement('p');notice.className='admin-saved admin-save-error';notice.textContent='Save failed: '+message;form.querySelector('.admin-save-error')?.remove();(form.querySelector('.admin-actions')||form).prepend(notice);const saveButton=form.querySelector('button.cta');if(saveButton){saveButton.disabled=false;saveButton.textContent='Save item';}}else{panel.innerHTML=`<div class="admin-empty admin-save-error">${adminSafe(message)}</div>`;}};
renderCategories=async()=>{if(!cloudAdmin()){renderCloudError(new Error('Supabase is not connected.'));return;}try{const categories=await cloudCategoryRows();panel.innerHTML=`<div class="admin-heading"><div><p class="kicker">CATALOG STRUCTURE</p><h2>Categories</h2><p>Changes here update the shared storefront category navigation. Manage each category’s storefront filters here.</p></div><button class="cta" data-action="new-category">Add category</button></div><section class="admin-card admin-default-hero" data-default-hero-editor><div class="admin-heading"><div><h3>Default homepage hero</h3><p>Set the hero used by the locked Default theme. Saved themes keep their own hero images.</p></div></div><form class="admin-default-hero-form"><label>Hero image<input name="hero" type="file" accept="image/*"></label><img data-default-hero-preview alt="" hidden><div class="admin-actions"><button type="submit" class="cta">Save default hero</button></div></form></section><section class="admin-card admin-default-hero" data-default-story-editor><div class="admin-heading"><div><h3>Default Our Story image</h3><p>Set the default image used by the Our Story section. Saved themes keep their own Story images.</p></div></div><form class="admin-default-hero-form"><label>Our Story image<input name="story" type="file" accept="image/*"></label><img data-default-story-preview alt="" hidden><div class="admin-actions"><button type="submit" class="cta">Save default Story image</button></div></form></section><div class="admin-list admin-category-list">${categories.map((category,index)=>`<article><div>${category.cover_photo?`<img class="admin-category-thumbnail" src="${adminSafe(category.cover_photo)}" alt="${adminSafe(category.name)} category image">`:'<span class="admin-category-no-image" aria-hidden="true">No image</span>'}<strong>${adminSafe(category.name)}</strong><span>${adminSafe(category.slug)} · ${category.active?'Active':'Off'}</span></div><div class="admin-category-actions"><button data-move-category="${category.id}" data-direction="up" ${index===0?'disabled':''}>↑</button><button data-move-category="${category.id}" data-direction="down" ${index===categories.length-1?'disabled':''}>↓</button><button data-edit-category="${category.id}">Edit</button><button data-edit-category-filters="${adminSafe(category.slug)}">Edit filters</button><button data-delete-category="${category.id}">Delete</button></div></article>`).join('')||'<div class="admin-empty">No categories yet.</div>'}</div>`;initializeAdminDefaultHeroEditor();initializeAdminDefaultStoryEditor();panel.querySelector('[data-action="new-category"]').addEventListener('click',()=>cloudCategoryForm());panel.querySelectorAll('[data-edit-category]').forEach((button)=>button.addEventListener('click',()=>cloudCategoryForm(button.dataset.editCategory)));panel.querySelectorAll('[data-edit-category-filters]').forEach((button)=>button.addEventListener('click',()=>renderAdminCategoryFilterManager(button.dataset.editCategoryFilters)));panel.querySelectorAll('[data-move-category]').forEach((button)=>button.addEventListener('click',async()=>{const index=categories.findIndex((entry)=>entry.id===button.dataset.moveCategory);const swapIndex=index+(button.dataset.direction==='up'?-1:1);if(index<0||swapIndex<0||swapIndex>=categories.length)return;const current=categories[index],swap=categories[swapIndex];const first=await cloudAdmin().from('categories').update({sort_order:swap.sort_order}).eq('id',current.id);if(first.error)return renderCloudError(first.error);const second=await cloudAdmin().from('categories').update({sort_order:current.sort_order}).eq('id',swap.id);if(second.error)return renderCloudError(second.error);renderCloudCategories();}));panel.querySelectorAll('[data-delete-category]').forEach((button)=>button.addEventListener('click',async()=>{if(!confirm('Delete this category? Products assigned to it will be moved to uncategorized.'))return;const category=categories.find((entry)=>entry.id===button.dataset.deleteCategory);const move=await cloudAdmin().from('products').update({category_slug:'uncategorized'}).eq('category_slug',category.slug);if(move.error)return renderCloudError(move.error);const result=await cloudAdmin().from('categories').delete().eq('id',category.id);if(result.error)return renderCloudError(result.error);renderCloudCategories();}));}catch(error){renderCloudError(error);}};
const renderCloudCategories=()=>renderCategories();
const cloudCategoryForm=async(id=null)=>{let category={name:'',slug:'',cover_photo:'',active:true};if(id){const categories=await cloudCategoryRows();category=categories.find((entry)=>entry.id===id)||category;}panel.innerHTML=`<div class="admin-heading"><div><p class="kicker">CATEGORY EDITOR</p><h2>${id?'Edit category':'Add category'}</h2></div></div><form class="admin-form" id="cloud-category-form"><label>Name<input name="name" required value="${adminSafe(category.name)}"></label><label>Slug (optional; custom slugs are supported)<input name="slug" value="${adminSafe(category.slug)}" placeholder="Generated from name"><small>Changing a slug updates products assigned to this category.</small></label><fieldset class="admin-media-editor"><legend>Category image</legend><label>Image source<select name="cover_source"><option value="url" ${category.cover_photo?'selected':''}>Image URL</option><option value="upload" ${category.cover_photo?'':'selected'}>Upload image</option></select></label><label>Image URL<input name="cover_photo" type="url" value="${adminSafe(category.cover_photo||'')}" placeholder="https://..."></label><label>Upload image<input name="cover" type="file" accept="image/*"></label></fieldset><label class="admin-toggle"><input name="active" type="checkbox" ${category.active?'checked':''}> Visible in storefront navigation</label><div class="admin-actions"><button class="cta">Save category</button><button type="button" data-cancel>Cancel</button></div></form>`;const form=panel.querySelector('form');const source=form.querySelector('[name="cover_source"]');const syncImageSource=()=>{const useUrl=source.value==='url';form.querySelector('[name="cover_photo"]').disabled=!useUrl;form.querySelector('[name="cover"]').disabled=useUrl;};source.addEventListener('change',syncImageSource);syncImageSource();panel.querySelector('[data-cancel]').addEventListener('click',renderCloudCategories);form.addEventListener('submit',async(event)=>{event.preventDefault();const fields=Object.fromEntries(new FormData(form));const slug=adminSlug(fields.slug||fields.name);if(!slug)return renderCloudError(new Error('Category name is required.'));const file=form.querySelector('[name="cover"]').files[0];try{let cover=source.value==='url'?String(fields.cover_photo||'').trim()||null:category.cover_photo||null;if(source.value==='upload'&&file)cover=await uploadAdminMedia(file,`categories/${slug}`,{canonicalKey:`category-${slug}`});const payload={slug,name:fields.name,cover_photo:cover,active:form.active.checked,sort_order:category.sort_order??999};const result=id?await cloudAdmin().from('categories').update(payload).eq('id',id).select('id,slug').single():await cloudAdmin().from('categories').insert(payload).select('id,slug').single();if(result.error)adminFailure(result.error);if(id&&category.slug!==slug){const move=await cloudAdmin().from('products').update({category_slug:slug}).eq('category_slug',category.slug);if(move.error)adminFailure(move.error);}renderCloudCategories();}catch(error){renderCloudError(error);}});};


const cloudItemForm=async(id=null)=>{const [products,categories,children]=await Promise.all([id?adminProductDetail(id):Promise.resolve([]),cloudCategoryRows(),id?loadAdminProductChildren(id):Promise.resolve({options:[],mappings:[]})]);const product=products.find((entry)=>entry.id===id)||{name:'',sku:'',category_slug:'',description:'',item_details:'',shipping_details:'',promo_discount_percent:0,estimated_cost:'',promo_skus:[],visible:false,waitlist_enabled:false,badges:[],product_images:[]};const badges=['Acrylic','Silicone','Rhinestones','10mm','12mm','12mm Lentil','14mm','14mm Abacus','15mm','16mm','18mm','20mm','Fits on Beadable Pen','On Sale','Clearance','Low Stock','Out of Stock'];const existingMedia=product.product_images||[];const savedProductFilterDefinitions=(()=>{const value=product.sku_filter_definitions;if(Array.isArray(value))return value.slice(0,3);if(typeof value==='string'){try{const parsed=JSON.parse(value);return Array.isArray(parsed)?parsed.slice(0,3):[];}catch(error){return[];}}return[];})();const recoveredProductFilterDefinitions=savedProductFilterDefinitions.map((definition)=>({label:String(definition?.label||'').trim()})).filter((definition)=>definition.label);product.sku_filter_definitions=recoveredProductFilterDefinitions;panel.innerHTML=`<div class="admin-heading"><div><p class="kicker">ITEM EDITOR</p><h2>${id?'Edit product page':'Add a product page'}</h2><p>Each product page is a group of customer-selectable SKUs.</p></div></div><form class="admin-form admin-item-form" id="cloud-item-form" data-product-id="${id||""}"><label>Product name<input name="name" required value="${adminSafe(product.name)}"></label><div class="admin-item-meta-row"><label>Category<select name="category_slug" required><option value="">Choose a category</option>${categories.map((category)=>`<option value="${adminSafe(category.slug)}" ${product.category_slug===category.slug?'selected':''}>${adminSafe(category.name)}</option>`).join('')}</select></label><label class="admin-toggle"><input name="visible" type="checkbox" ${product.visible?'checked':''}><span>On / listed in storefront</span></label><label class="admin-toggle"><input name="waitlist_enabled" type="checkbox" ${product.waitlist_enabled?'checked':''}><span>Waitlist available</span></label></div><input type="hidden" name="sku_filter_definitions" value="${adminSafe(JSON.stringify(product.sku_filter_definitions||[]))}"><details class="admin-product-page-filter-editor" open><summary>Product page SKU filters</summary><section class="admin-product-page-filters"><h3>Product page SKU filters</h3><p>Define the customer-facing options for this product page, then enter each SKU’s answer below.</p><div data-product-page-filter-definitions></div><button type="button" data-add-product-page-filter>Add filter</button></section></details><input type="hidden" name="sku_data" value=""><details class="admin-variant-editor" open><summary>SKUs</summary><p>Start with one SKU. Add, remove, or reorder unlimited SKUs; the first row is shown first on the product page.</p><div data-variant-list></div><button type="button" data-add-variant>Add another SKU</button></details><details class="admin-promo-editor" open><summary>Promos</summary><div class="admin-form-grid"><label>Discount %<input name="promo_discount_percent" type="number" min="0" max="100" step="1" value="${Number(product.promo_discount_percent)||0}"></label><label>Starts<input name="promo_starts_at" type="datetime-local" value="${product.promo_starts_at?product.promo_starts_at.slice(0,16):''}"></label><label>Ends<input name="promo_ends_at" type="datetime-local" value="${product.promo_ends_at?product.promo_ends_at.slice(0,16):''}"></label></div><p>Select which SKUs this promotion affects.</p><div data-promo-sku-list></div><input type="hidden" name="promo_skus" value=""></details><fieldset class="admin-badge-picker"><legend>Badges</legend>${badges.map((badge)=>`<label><input type="checkbox" name="badges" value="${adminSafe(badge)}" ${(product.badges||[]).includes(badge)?'checked':''}> <span class="product-badge badge-${adminSlug(badge)}">${adminSafe(badge)}</span></label>`).join('')}</fieldset><fieldset class="admin-media-editor"><legend>Photos and videos</legend><p>Existing media can be edited or removed. Uploaded images are compressed before storage.</p>${existingMedia.map((media)=>`<div class="admin-media-row" data-existing-media data-media-id="${adminSafe(media.id)}"><input data-display-name value="${adminSafe(adminMediaName(media.url,media.alt_text))}" aria-label="Photo display name" placeholder="Display name"><input data-existing-url value="${adminSafe(media.url||'')}" aria-label="Media URL"><select data-existing-type aria-label="Media type"><option value="image" ${media.media_type!=='video'?'selected':''}>Image</option><option value="video" ${media.media_type==='video'?'selected':''}>Video</option></select><button type="button" data-remove-media>Remove</button></div>`).join('')||'<p>No media saved yet.</p>'}<div data-manual-url-list><div class="admin-media-row" data-manual-media><input data-display-name placeholder="Display name (optional)" aria-label="New media display name"><input data-manual-url placeholder="https://..." aria-label="New media URL"><select data-manual-type aria-label="New media type"><option value="image">Image</option><option value="video">Video</option></select><button type="button" data-remove-manual>Remove</button></div></div><button type="button" data-add-manual>Add media link</button><label>Upload new photos or videos<input name="media" type="file" accept="image/*,video/*" multiple><small>Videos are limited to 100 MB.</small></label></fieldset><label>Full product description<textarea name="description" rows="5">${adminSafe(product.description||'')}</textarea></label><label>Item details for search only<textarea name="item_details" rows="4" placeholder="Not shown to customers. Add keywords, materials, sizing, and internal search terms.">${adminSafe(product.item_details||'')}</textarea></label><section class="admin-shipping-editor"><h3>Shipping details</h3><p>Uses the default shipping and returns policy from Store settings unless you enable the override.</p><label class="admin-toggle admin-shipping-override"><input name="shipping_override" type="checkbox" ${product.shipping_details?'checked':''}><span>Override default shipping details for this product</span></label><textarea name="shipping_details" rows="4" ${product.shipping_details?'':'disabled'}>${adminSafe(product.shipping_details||'')}</textarea></section><label class="admin-toggle admin-setup-lock"><input name="finalize_inventory_setup" type="checkbox"> Finalize inventory setup after saving this page</label><p class="inventory-help">Leave this unchecked while setting up the SKU. Once finalized, its inventory classification and stock-control fields can only be changed through the Year-end audit CSV.</p><div class="admin-actions"><button class="cta">Save item</button><button type="button" data-cancel>Cancel</button></div></form>`;const form=panel.querySelector('form');const makeManualMediaRow=()=>{const row=document.createElement('div');row.className='admin-media-row';row.dataset.manualMedia='';row.innerHTML='<input data-display-name placeholder="Display name (optional)" aria-label="New media display name"><input data-manual-url placeholder="https://..." aria-label="New media URL"><select data-manual-type aria-label="New media type"><option value="image">Image</option><option value="video">Video</option></select><button type="button" data-remove-manual>Remove</button>';row.querySelector('[data-remove-manual]').onclick=()=>row.remove();return row;};form.querySelectorAll('[data-existing-media]').forEach((row)=>{const removeButton=row.querySelector('[data-remove-media]');removeButton.checked=false;removeButton.onclick=()=>{removeButton.checked=true;row.hidden=true;};});renderAdminVariantEditor(form,children.options,existingMedia,product);renderAdminPromoEditor(form,product.promo_skus||[]);organizeAdminBadges(form);initializeAdminCollapsibleSections(form);initializeAdminSkuLayout(form);void renderAdminRecipeSummaries(form);ensureAdminQtySoldBadgeChoice(form);setupAdminExistingSkuLookup(form);void renderAdminInventoryHistory(form);if(!id)form.dataset.bundleEditorInitialized='disabled';const saveButton=form.querySelector('button.cta');if(!id)form.dataset.bundleEditorInitialized='disabled';const shippingOverride=form.querySelector('[name="shipping_override"]');const shippingDetails=form.querySelector('[name="shipping_details"]');shippingOverride.addEventListener('change',()=>{shippingDetails.disabled=!shippingOverride.checked;if(!shippingOverride.checked)shippingDetails.value='';});panel.querySelector('[data-cancel]').addEventListener('click',renderItems);panel.querySelector('[data-add-manual]').addEventListener('click',()=>form.querySelector('[data-manual-url-list]').append(makeManualMediaRow()));form.querySelectorAll('[data-manual-media] [data-remove-manual]').forEach((button)=>button.addEventListener('click',()=>button.closest('[data-manual-media]').remove()));form.addEventListener('submit',async(event)=>{event.preventDefault();try{const fields=Object.fromEntries(new FormData(event.currentTarget));await saveCloudProductWithMappings(id,fields,event.currentTarget);if(fields.finalize_inventory_setup==='on'&&window.beadSupabase){const values=JSON.parse(fields.sku_data||'[]').flatMap((option)=>option.values||[]);const skus=[...new Set(values.map((value)=>String(value.inventory_sku||value.sku||'').trim()).filter(Boolean))];const lookup=await cloudAdmin().from('inventory_skus').select('id').in('sku',skus);if(lookup.error)throw lookup.error;const result=await cloudAdmin().rpc('finalize_inventory_sku_setup',{inventory_sku_ids:(lookup.data||[]).map((row)=>row.id)});if(result.error)throw result.error;}renderItems();}catch(error){renderCloudError(error);}});};

const loadAdminProductChildren=async(id)=>{if(!id)return{options:[],mappings:[]};const optionResult=await cloudAdmin().from('product_options').select('id,name,required,sort_order,product_option_values(id,inventory_sku_id,sort_order,image_url)').eq('product_id',id).order('sort_order');if(optionResult.error)adminFailure(optionResult.error);const options=optionResult.data||[];const optionIds=options.map((option)=>option.id).filter(Boolean);const nestedValues=options.flatMap((option)=>option.product_option_values||[]);if(optionIds.length&&options.length&&!nestedValues.length){const valueResult=await cloudAdmin().from('product_option_values').select('id,option_id,inventory_sku_id,sort_order,image_url').in('option_id',optionIds).order('sort_order');if(valueResult.error)adminFailure(valueResult.error);const valuesByOption=new Map();(valueResult.data||[]).forEach((value)=>{const list=valuesByOption.get(value.option_id)||[];list.push(value);valuesByOption.set(value.option_id,list);});options.forEach((option)=>{option.product_option_values=valuesByOption.get(option.id)||[];});}const values=options.flatMap((option)=>option.product_option_values||[]);const inventoryIds=[...new Set(values.map((value)=>value.inventory_sku_id).filter(Boolean))];const inventoryResult=await adminBatchRows(inventoryIds,(batch)=>cloudAdmin().from('inventory_skus').select('id,sku,name,quantity_on_hand,reorder_point,item_type,taxable,price,cost,preferred_vendor,unit_type,weight_value,weight_unit,reserve_quantity,source_metadata').in('id',batch));if(inventoryResult.error)adminFailure(inventoryResult.error);const inventoryById=new Map((inventoryResult.data||[]).map((row)=>[row.id,row]));options.forEach((option)=>{(option.product_option_values||[]).forEach((value)=>{const inventory=inventoryById.get(value.inventory_sku_id)||null;value.inventory_skus=inventory;const page=inventory?.source_metadata?.product_pages?.[id];value.image_url=String(page?.image_url||value.image_url||'').trim()||null;});});return{options,mappings:[]};};
const renderAdminVariantEditor=(form,options,media=[],fallback={})=>{const list=form.querySelector('[data-variant-list]');const skuOption=(options||[]).find((option)=>String(option.name||'').trim().toLowerCase()==='sku');const optionValues=skuOption?.product_option_values||(options||[]).flatMap((option)=>option.product_option_values||[]);const seenSkus=new Set();const values=optionValues.filter((value)=>{const sku=String(value.inventory_skus?.sku||value.inventory_sku||value.sku||'').trim().toLowerCase();if(!sku||seenSkus.has(sku))return false;seenSkus.add(sku);return true;}).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0));const initial=values.length?values:[{label:'',sku:'',price:0,unit_type:'Each',quantity:0,low_stock_threshold:0,inventory_sku:'',inventory_units:1,weight_value:null,weight_unit:'oz',cost:null,reserve_quantity:0}];const photoOptions=media.filter((entry)=>entry.media_type!=='video');const makeRow=(value={})=>{const inventory=value.inventory_skus||{};const row=document.createElement('div');row.className='admin-sku-row';row.dataset.variantRow='';const selectedPhoto=value.image_url||value.imageUrl||'';row.innerHTML='<div class="admin-sku-order"><strong>SKU order</strong><label class="admin-sku-position">Position<input data-variant-position type="number" min="1" step="1" value="'+(list.children.length+1)+'"></label><button type="button" data-move-variant="up" aria-label="Move SKU up">↑</button><button type="button" data-move-variant="down" aria-label="Move SKU down">↓</button></div><label>Product name<input data-variant-label value="'+adminSafe(inventory.name||value.label||'')+'" required></label><label>SKU<div class="admin-sku-picker"><input data-variant-sku value="'+adminSafe(inventory.sku||value.sku||'')+'" autocomplete="off" required><button type="button" class="admin-sku-help" data-sku-picker aria-label="Search canonical inventory SKUs" title="Search canonical inventory SKUs">?</button></div><div class="admin-sku-suggestions" data-sku-suggestions hidden></div></label><label>Price<div class="admin-price-unit"><input data-variant-price type="number" min="0" step="0.01" value="'+(Number(inventory.price??value.price??(Number(fallback.price||0)+Number(value.price_delta||0)))||0).toFixed(2)+'" required><input data-variant-unit-type value="'+adminSafe(inventory.unit_type||value.unit_type||value.unitType||'Each')+'" aria-label="Unit type" placeholder="Unit type" required></div><div class="admin-sku-cost"><span>Cost</span><input data-variant-cost type="number" min="0" step="0.01" value="'+(inventory.cost??value.cost??'')+'"></div></label><label>Weight<input data-variant-weight type="number" min="0" step="0.001" value="'+(inventory.weight_value??value.weight_value??'')+'" placeholder="0.000"></label><label>Weight unit<select data-variant-weight-unit><option value="oz" '+(inventory.weight_unit==='oz'||(!inventory.weight_unit&&!value.weight_unit)?'selected':'')+'>oz</option><option value="lb" '+(inventory.weight_unit==='lb'||value.weight_unit==='lb'?'selected':'')+'>lb</option><option value="g" '+(inventory.weight_unit==='g'||value.weight_unit==='g'?'selected':'')+'>g</option><option value="kg" '+(inventory.weight_unit==='kg'||value.weight_unit==='kg'?'selected':'')+'>kg</option></select></label><label>Qty available<input data-variant-quantity type="number" min="0" step="1" value="'+Number(inventory.quantity_on_hand??value.quantity??0)+'" required></label><label>Low stock minimum<input data-variant-threshold type="number" min="0" step="1" value="'+Number(inventory.reorder_point??value.low_stock_threshold??0)+'" required></label><label>Linked product photo<select data-variant-photo><option value="">No linked photo</option>'+photoOptions.map((photo)=>'<option value="'+adminSafe(photo.url)+'" '+(selectedPhoto===photo.url?'selected':'')+'>'+adminSafe(adminMediaName(photo.url,photo.alt_text))+'</option>').join('')+'</select></label><details class="admin-sku-internal"><summary>Internal inventory details</summary><div class="admin-form-grid"><label>Item type<select data-variant-item-type><option value="Inventory" '+(String(inventory.item_type||'Inventory').toLowerCase()==='inventory'?'selected':'')+'>Inventory</option><option value="Non-inventory" '+(String(inventory.item_type||'').toLowerCase()==='non-inventory'?'selected':'')+'>Non-inventory</option></select></label><label>Preferred vendor<input data-variant-vendor value="'+adminSafe(inventory.preferred_vendor||'')+'"></label><label>Reserved buffer<input data-variant-reserve type="number" min="0" step="1" value="'+Number(inventory.reserve_quantity??value.reserve_quantity??0)+'"></label><label class="admin-toggle"><input data-variant-taxable type="checkbox" '+(inventory.taxable!==false?'checked':'')+'> Taxable</label></div></details><button type="button" data-remove-variant>Remove SKU</button>';row.querySelector('[data-remove-variant]').onclick=()=>{row.remove();if(!list.children.length)makeRow();sync(true);};row.querySelectorAll('[data-move-variant]').forEach((button)=>button.onclick=()=>{const target=button.dataset.moveVariant==='up'?row.previousElementSibling:row.nextElementSibling;if(target){if(button.dataset.moveVariant==='up')list.insertBefore(row,target);else list.insertBefore(target,row);sync();}});list.append(row);row.querySelector('[data-variant-position]')?.addEventListener('change',()=>{const desired=Math.max(1,Math.min(list.children.length,Number(row.querySelector('[data-variant-position]').value)||1))-1;const rows=[...list.children];const target=rows[desired];if(target&&target!==row){list.insertBefore(row,desired>=rows.indexOf(row)?target.nextSibling:target);sync();}});};const sync=(notify=false)=>{[...list.children].forEach((entry,index)=>{const position=entry.querySelector('[data-variant-position]');if(position)position.value=String(index+1);});const values=[...list.querySelectorAll('[data-variant-row]')].map((row)=>({label:row.querySelector('[data-variant-label]').value.trim(),sku:row.querySelector('[data-variant-sku]').value.trim(),price:Math.max(0,Number(row.querySelector('[data-variant-price]').value)||0),cost:row.querySelector('[data-variant-cost]').value.trim()===''?null:Math.max(0,Number(row.querySelector('[data-variant-cost]').value)||0),unit_type:row.querySelector('[data-variant-unit-type]').value.trim()||'Each',weight_value:row.querySelector('[data-variant-weight]').value.trim()===''?null:Math.max(0,Number(row.querySelector('[data-variant-weight]').value)||0),weight_unit:row.querySelector('[data-variant-weight-unit]').value,quantity:Math.max(0,Number(row.querySelector('[data-variant-quantity]').value)||0),low_stock_threshold:Math.max(0,Number(row.querySelector('[data-variant-threshold]').value)||0),reserve_quantity:Math.max(0,Number(row.querySelector('[data-variant-reserve]').value)||0),inventory_sku:row.querySelector('[data-variant-inventory-sku]')?.value.trim()||row.querySelector('[data-variant-sku]')?.value.trim()||'',inventory_units:Math.max(1,Number(row.querySelector('[data-variant-inventory-units]')?.value)||1),image_url:row.querySelector('[data-variant-photo]').value||null,item_type:row.querySelector('[data-variant-item-type]').value,preferred_vendor:row.querySelector('[data-variant-vendor]').value.trim(),taxable:row.querySelector('[data-variant-taxable]').checked})).filter((value)=>value.label||value.sku);form.elements.sku_data.value=JSON.stringify(values.length?[{name:'SKU',required:true,values}]:[]);if(notify)form.dispatchEvent(new Event('sku-list-changed'));};list.replaceChildren();initial.forEach(makeRow);form.querySelector('[data-add-variant]').onclick=()=>{makeRow();initializeAdminSkuLayout(form);setupAdminExistingSkuLookup(form);sync(true);};form.oninput=(event)=>{if(event.target.closest('[data-variant-row]'))sync();};sync();initializeAdminSkuLayout(form);};
const renderAdminPromoEditor=(form,promoSkus=[])=>{const list=form.querySelector('[data-promo-sku-list]');let selected=new Set((promoSkus||[]).map((sku)=>String(sku).toLowerCase()));const sync=()=>{const current=[...list.querySelectorAll('[data-promo-sku]:checked')].map((input)=>input.value);selected=new Set(current.map((sku)=>String(sku).toLowerCase()));form.elements.promo_skus.value=JSON.stringify(current);};const draw=()=>{const rows=JSON.parse(form.elements.sku_data.value||'[]').flatMap((option)=>option.values||[]).filter((value)=>value.sku);list.innerHTML=rows.length?rows.map((value)=>'<label><input type="checkbox" data-promo-sku value="'+adminSafe(value.sku)+'" '+(selected.has(String(value.sku).toLowerCase())?'checked':'')+'> '+adminSafe(value.label)+' ('+adminSafe(value.sku)+')</label>').join(''):'<p>Add SKUs above before assigning a promo.</p>';list.querySelectorAll('[data-promo-sku]').forEach((input)=>input.addEventListener('change',sync));sync();};form.addEventListener('sku-list-changed',draw);draw();};
const organizeAdminBadges=(form)=>{const fieldset=form.querySelector('.admin-badge-picker');if(!fieldset||fieldset.dataset.organized)return;fieldset.dataset.organized='true';const groups=[['Qty sold by',['Single Bead','Multi-Pack']],['Material',['Silicone','Acrylic','Rhinestones']],['Size',['10mm','12mm','12mm Lentil','14mm','14mm Abacus','15mm','16mm','18mm','20mm']],['Inventory status',['Clearance']],['Other',['Fits on Beadable Pen']]];const labels=new Map([...fieldset.querySelectorAll(':scope > label')].map((label)=>[label.querySelector('input')?.value,label]));const legend=fieldset.querySelector('legend');fieldset.replaceChildren(legend);groups.forEach(([title,values])=>{const group=document.createElement('div');group.className='admin-badge-group admin-badge-group-'+adminSlug(title);const heading=document.createElement('h4');heading.textContent=title;group.append(heading);values.forEach((value)=>{let label=labels.get(value);if(!label){label=document.createElement('label');label.innerHTML='<input type="checkbox" name="badges" value="'+adminSafe(value)+'"> <span class="product-badge badge-'+adminSlug(value)+'">'+adminSafe(value)+'</span>';}label.classList.add('admin-badge-option','admin-badge-option-'+adminSlug(value));group.append(label);});fieldset.append(group);});};
const renderAdminMediaPreviews=(form)=>{const openImage=(url,alt)=>{const dialog=document.createElement('dialog');dialog.className='admin-media-viewer';const image=document.createElement('img');image.src=url;image.alt=alt||'Enlarged media preview';dialog.append(image);dialog.addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>dialog.remove(),{once:true});document.body.append(dialog);dialog.showModal();};const renderRow=(row)=>{row.querySelector('[data-media-preview]')?.remove();const url=row.querySelector('[data-existing-url]')?.value.trim()||row.querySelector('[data-manual-url]')?.value.trim();const type=row.querySelector('[data-existing-type]')?.value||row.querySelector('[data-manual-type]')?.value||'image';if(!url)return;const preview=type==='video'?document.createElement('video'):document.createElement('img');preview.dataset.mediaPreview='';preview.className='admin-media-preview';preview.src=window.storefrontCardImageUrl?.(url)||url;if(type==='video'){preview.controls=true;preview.preload='metadata';}else{preview.alt='Media preview';preview.title='Click to enlarge';preview.addEventListener('click',()=>openImage(url,preview.alt));}row.prepend(preview);};form.querySelectorAll('[data-existing-media],[data-manual-media]').forEach((row)=>{renderRow(row);});form.addEventListener('input',(event)=>{const row=event.target.closest('[data-existing-media],[data-manual-media]');if(row&&(event.target.matches('[data-existing-url],[data-manual-url]')))renderRow(row);});form.addEventListener('change',(event)=>{const row=event.target.closest('[data-existing-media],[data-manual-media]');if(row&&(event.target.matches('[data-existing-type],[data-manual-type]')))renderRow(row);});const fileInput=form.querySelector('[name=media]');if(fileInput){fileInput.addEventListener('change',()=>{form.querySelector('[data-upload-preview]')?.remove();const wrapper=document.createElement('div');wrapper.dataset.uploadPreview='';wrapper.className='admin-upload-previews';Array.from(fileInput.files||[]).forEach((file)=>{const preview=file.type.startsWith('video/')?document.createElement('video'):document.createElement('img');preview.className='admin-media-preview';preview.src=URL.createObjectURL(file);if(preview.tagName==='VIDEO'){preview.controls=true;preview.muted=true;}else{preview.alt=file.name;preview.title='Click to enlarge';preview.addEventListener('click',()=>openImage(preview.src,file.name));}wrapper.append(preview);});fileInput.parentElement.append(wrapper);});}};
const renderAdminInventoryHistory=async(form)=>{const productId=form?.dataset.productId;if(!productId||form.dataset.inventoryHistoryLoaded)return;form.dataset.inventoryHistoryLoaded='loading';const [changeResult,adjustmentResult]=await Promise.all([cloudAdmin().from('product_change_history').select('id,inventory_sku,field_name,previous_value,new_value,change_type,note,created_at').eq('product_id',productId).order('created_at',{ascending:false}).range(0,199),cloudAdmin().from('inventory_adjustments').select('id,inventory_sku,quantity_delta,quantity_after,note,adjustment_type,cost_impact,created_at').eq('product_id',productId).order('created_at',{ascending:false}).range(0,199)]);if(!form.isConnected)return;if(changeResult.error||adjustmentResult.error){form.dataset.inventoryHistoryLoaded='error';return;}const entries=[...(changeResult.data||[]).map((entry)=>({...entry,historyType:'change'})),...(adjustmentResult.data||[]).map((entry)=>({inventory_sku:entry.inventory_sku,field_name:'Inventory quantity',previous_value:String(Number(entry.quantity_after)-Number(entry.quantity_delta)),new_value:String(entry.quantity_after),change_type:'updated',note:entry.note,adjustment_type:entry.adjustment_type,cost_impact:entry.cost_impact,created_at:entry.created_at,historyType:'adjustment'}))].sort((first,second)=>Date.parse(second.created_at)-Date.parse(first.created_at));const formatEntry=(entry)=>'<li><strong>'+adminSafe(entry.field_name)+'</strong><span>'+adminSafe(entry.inventory_sku||'Product')+' · '+new Date(entry.created_at).toLocaleString()+' · '+adminSafe(entry.change_type)+'</span><p>Previous: '+adminSafe(entry.previous_value??'—')+' → New: '+adminSafe(entry.new_value??'—')+(entry.note?' · '+adminSafe(entry.note):'')+(entry.historyType==='adjustment'?' · Source: '+adminSafe(String(entry.adjustment_type||'manual').replace(/_/g,' '))+(Number(entry.cost_impact)?' · Cost impact: $'+Number(entry.cost_impact).toFixed(2):''):'')+'</p></li>';const section=document.createElement('details');section.className='admin-card admin-inventory-history';section.innerHTML='<summary>Product change history</summary><p>Important product and inventory changes recorded for review.</p><ul>'+((entries.map(formatEntry).join(''))||'<li>No product changes recorded.</li>')+'</ul>';const actions=form.querySelector('.admin-actions');if(actions)actions.before(section);else form.append(section);form.dataset.inventoryHistoryLoaded='true';};
const initializeAdminSkuLayout=(form)=>{form.querySelectorAll('[data-variant-row]').forEach((row)=>{if(row.dataset.skuLayoutInitialized)return;const markField=(selector,className)=>{const label=row.querySelector(selector)?.closest('label');label?.classList.add(className);return label;};const nameLabel=markField('[data-variant-label]','admin-sku-name-field');markField('[data-variant-sku]','admin-sku-sku-field');const priceLabel=markField('[data-variant-price]','admin-sku-price-field');const priceInput=row.querySelector('[data-variant-price]');const unitInput=row.querySelector('[data-variant-unit-type]');const priceUnitWrap=unitInput?.closest('.admin-price-unit');if(priceLabel&&priceInput&&unitInput&&priceUnitWrap){priceUnitWrap.replaceWith(priceInput);const unitLabel=document.createElement('label');unitLabel.className='admin-sku-unit-field';unitLabel.append('Unit',unitInput);priceLabel.after(unitLabel);}const weightLabel=markField('[data-variant-weight]','admin-sku-weight-field');const weightInput=row.querySelector('[data-variant-weight]');const weightUnitLabel=row.querySelector('[data-variant-weight-unit]')?.closest('label');const weightUnitInput=row.querySelector('[data-variant-weight-unit]');if(weightLabel&&weightInput&&weightUnitLabel&&weightUnitInput){const weightInputs=document.createElement('div');weightInputs.className='admin-sku-weight-inputs';weightInput.replaceWith(weightInputs);weightInputs.append(weightInput,weightUnitInput);weightUnitLabel.remove();}const cost=row.querySelector('.admin-sku-cost');const costInput=cost?.querySelector('[data-variant-cost]');if(cost&&costInput){const costLabel=document.createElement('label');costLabel.className='admin-sku-cost-field';costLabel.append('Cost',costInput);cost.replaceWith(costLabel);weightLabel?.after(costLabel);}markField('[data-variant-quantity]','admin-sku-inventory-field');const thresholdLabel=markField('[data-variant-threshold]','admin-sku-threshold-field');const reserveInput=row.querySelector('[data-variant-reserve]');const reserveLabel=reserveInput?.closest('label');if(reserveInput&&reserveLabel&&thresholdLabel){const reserveField=document.createElement('label');reserveField.className='admin-sku-reserve-field';reserveField.append('Reserve buffer',reserveInput);reserveLabel.remove();thresholdLabel.after(reserveField);}markField('[data-variant-inventory-sku]','admin-sku-affected-field');markField('[data-variant-inventory-units]','admin-sku-deducted-field');markField('[data-variant-photo]','admin-sku-photo-field');['[data-variant-cost]','[data-variant-quantity]','[data-variant-item-type]'].forEach((selector)=>{const field=row.querySelector(selector);if(!field)return;field.readOnly=field.tagName!=='SELECT';field.disabled=field.tagName==='SELECT';field.classList.add('admin-sku-locked-field');field.title='Edit in Inventory adjustments';});row.dataset.skuLayoutInitialized='true';});};

const wrapAdminSection=(element,summaryText,className='admin-collapsible-section')=>{if(!element||element.closest('details'))return element?.closest('details')||element;const details=document.createElement('details');details.className=className;const summary=document.createElement('summary');summary.textContent=summaryText;details.append(summary);element.replaceWith(details);details.append(element);return details;};
const initializeAdminCollapsibleSections=(form)=>{if(!form||form.dataset.collapsibleSectionsInitialized)return;form.dataset.collapsibleSectionsInitialized='true';form.querySelectorAll('.admin-variant-editor,.admin-promo-editor,.admin-etsy-editor').forEach((section)=>section.removeAttribute('open'));wrapAdminSection(form.querySelector('.admin-badge-picker'),'Badges','admin-collapsible-section admin-badges-section');wrapAdminSection(form.querySelector('.admin-media-editor'),'Photos and videos','admin-collapsible-section admin-photos-section');const description=wrapAdminSection(form.querySelector('textarea[name="description"]')?.closest('label'),'Description','admin-collapsible-section admin-content-editor-section');const itemDetails=wrapAdminSection(form.querySelector('textarea[name="item_details"]')?.closest('label'),'Item details','admin-collapsible-section admin-content-editor-section');const shipping=form.querySelector('.admin-shipping-editor');if(shipping&&shipping.tagName==='SECTION'){const shippingDetails=document.createElement('details');shippingDetails.className='admin-collapsible-section admin-content-editor-section admin-shipping-editor';const summary=document.createElement('summary');summary.textContent='Shipping details';shippingDetails.append(summary);[...shipping.childNodes].forEach((child)=>{if(child.nodeType===1&&child.matches('h3'))return;shippingDetails.append(child);});shipping.replaceWith(shippingDetails);}const makeFixedSection=(details,title)=>{if(!details?.matches('details'))return details;const section=document.createElement('section');section.className=details.className;const heading=document.createElement('h3');heading.textContent=title;section.append(heading,...[...details.childNodes].filter((child)=>child!==details.querySelector('summary')));details.replaceWith(section);return section;};const contentSections=[makeFixedSection(description,'Description'),makeFixedSection(itemDetails,'Item details'),makeFixedSection(form.querySelector('.admin-shipping-editor'),'Shipping details')].filter(Boolean);if(contentSections.length&&!form.querySelector('.admin-content-editor-group')){const group=document.createElement('details');group.className='admin-content-editor-group';const summary=document.createElement('summary');summary.textContent='Content and shipping';group.append(summary);contentSections[0].before(group);contentSections.forEach((section)=>group.append(section));}};
const adminHistoryValue=(value)=>{
  const text=String(value??'').trim();
  if(!text)return null;
  // Treat equivalent numeric spellings as the same value so saves such as
  // `.60` -> `0.6` do not create misleading no-op history entries.
  if(/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(text)){
    const numeric=Number(text);
    if(Number.isFinite(numeric))return String(numeric);
  }
  return text;
};
const adminHistoryWeight=(value)=>{const weight=adminHistoryValue(value.weight_value);return weight?weight+' '+(adminHistoryValue(value.weight_unit)||'oz'):null;};
const adminHistoryMapping=(value)=>{if(!value)return null;const etsySku=adminHistoryValue(value.etsy_sku);const inventorySku=adminHistoryValue(value.inventory_sku);if(!etsySku&&!inventorySku)return null;return [etsySku||'—',inventorySku?'→ '+inventorySku:'',value.inventory_units?'× '+value.inventory_units:''].filter(Boolean).join(' ');};
const captureAdminProductEdit=(form)=>({productId:form.dataset.productId,category:form.elements.category_slug?.value||'',variants:[...form.querySelectorAll('[data-variant-row]')].map((row)=>({label:row.querySelector('[data-variant-label]')?.value||'',sku:row.querySelector('[data-variant-sku]')?.value||'',weight_value:row.querySelector('[data-variant-weight]')?.value||'',weight_unit:row.querySelector('[data-variant-weight-unit]')?.value||'',cost:row.querySelector('[data-variant-cost]')?.value||'',price:row.querySelector('[data-variant-price]')?.value||'',preferred_vendor:row.querySelector('[data-variant-vendor]')?.value||''})),mappings:[...form.querySelectorAll('[data-etsy-row]')].map((row)=>({etsy_sku:row.querySelector('[data-etsy-sku]')?.value||'',inventory_sku:row.querySelector('[data-etsy-inventory-sku]')?.value||'',inventory_units:row.querySelector('[data-etsy-inventory-units]')?.value||''}))});
const parseAdminProductEdit=(fields)=>{let options=[];let mappings=[];try{options=JSON.parse(fields.sku_data||'[]');}catch(error){options=[];}try{mappings=JSON.parse(fields.etsy_mappings||'[]');}catch(error){mappings=[];}return{category:fields.category_slug||'',variants:(options||[]).flatMap((option)=>option.values||[]),mappings:mappings||[]};};
const recordAdminProductChanges=async(snapshot,fields)=>{if(!snapshot.productId||!window.beadSupabase)return;const next=parseAdminProductEdit(fields);const entries=[];const addEntry=(inventorySku,fieldName,previousValue,newValue)=>{const previous=adminHistoryValue(previousValue);const nextValue=adminHistoryValue(newValue);if(previous===nextValue)return;entries.push({product_id:snapshot.productId,inventory_sku:adminHistoryValue(inventorySku),field_name:fieldName,previous_value:previous,new_value:nextValue,change_type:previous===null?'added':nextValue===null?'removed':'updated',note:'Product page edit'});};addEntry(null,'Category',snapshot.category,next.category);const usedVariants=new Set();next.variants.forEach((variant,index)=>{const oldVariant=snapshot.variants.find((candidate,candidateIndex)=>!usedVariants.has(candidateIndex)&&adminHistoryValue(candidate.sku)===adminHistoryValue(variant.sku))||snapshot.variants.find((candidate,candidateIndex)=>!usedVariants.has(candidateIndex)&&adminHistoryValue(candidate.label)===adminHistoryValue(variant.label))||(snapshot.variants.length===next.variants.length?snapshot.variants[index]:null);if(oldVariant){const oldIndex=snapshot.variants.indexOf(oldVariant);usedVariants.add(oldIndex);}const inventorySku=adminHistoryValue(variant.sku)||adminHistoryValue(oldVariant?.sku);addEntry(inventorySku,'SKU',oldVariant?.sku,variant.sku);if(oldVariant){addEntry(inventorySku,'Weight',adminHistoryWeight(oldVariant),adminHistoryWeight(variant));addEntry(inventorySku,'Cost',oldVariant.cost,variant.cost);addEntry(inventorySku,'Price',oldVariant.price,variant.price);addEntry(inventorySku,'Preferred vendor',oldVariant.preferred_vendor,variant.preferred_vendor);}else{addEntry(inventorySku,'Weight',null,adminHistoryWeight(variant));addEntry(inventorySku,'Cost',null,variant.cost);addEntry(inventorySku,'Price',null,variant.price);addEntry(inventorySku,'Preferred vendor',null,variant.preferred_vendor);}});snapshot.variants.forEach((variant,index)=>{if(usedVariants.has(index))return;addEntry(variant.sku,'SKU',variant.sku,null);});const mappingCount=Math.max(snapshot.mappings.length,next.mappings.length);for(let index=0;index<mappingCount;index+=1)addEntry(next.mappings[index]?.inventory_sku||snapshot.mappings[index]?.inventory_sku,'Etsy mapping SKU',adminHistoryMapping(snapshot.mappings[index]),adminHistoryMapping(next.mappings[index]));if(!entries.length)return;const result=await window.beadSupabase.from('product_change_history').insert(entries);if(result.error)console.warn('Unable to record product change history.',result.error);};
const saveAdminEtsyMappings=async(productId,fields)=>{
  let mappings=[];
  try{mappings=JSON.parse(fields.etsy_mappings||'[]');if(!Array.isArray(mappings))throw new Error('Etsy mappings are invalid.');}
  catch(error){throw new Error('Etsy mappings are invalid: '+error.message);}
  const rows=mappings.map((mapping,index)=>({etsySku:String(mapping.etsy_sku||'').trim(),components:(mapping.components||[]).map((component)=>({inventorySku:String(component.inventory_sku||'').trim(),units:Number(component.inventory_units)})).filter((component)=>component.inventorySku),active:mapping.active!==false,sortOrder:index})).filter((mapping)=>mapping.etsySku);
  if(rows.some((mapping)=>!mapping.components.length||mapping.components.some((component)=>!Number.isInteger(component.units)||component.units<1)))throw new Error('Each Etsy mapping needs at least one inventory component and a whole-number quantity.');
  if(!rows.length){const existing=await cloudAdmin().from('product_etsy_mappings').select('id').eq('product_id',productId);if(existing.error)adminFailure(existing.error);const existingIds=(existing.data||[]).map((mapping)=>mapping.id);if(existingIds.length){const removeComponents=await cloudAdmin().from('product_etsy_mapping_components').delete().in('mapping_id',existingIds);if(removeComponents.error)adminFailure(removeComponents.error);}const removeMappings=await cloudAdmin().from('product_etsy_mappings').delete().eq('product_id',productId);if(removeMappings.error)adminFailure(removeMappings.error);return;}
  const skus=[...new Set(rows.flatMap((mapping)=>mapping.components.map((component)=>component.inventorySku)))];
  const lookup=await adminBatchRows(skus,(batch)=>cloudAdmin().from('inventory_skus').select('id,sku').in('sku',batch));
  if(lookup.error)adminFailure(lookup.error);
  const idBySku=new Map((lookup.data||[]).map((row)=>[row.sku.toLowerCase(),row.id]));
  if(rows.some((mapping)=>mapping.components.some((component)=>!idBySku.has(component.inventorySku.toLowerCase()))))throw new Error('Every Etsy mapping component SKU must exist in canonical inventory.');
  const existing=await cloudAdmin().from('product_etsy_mappings').select('id').eq('product_id',productId);
  if(existing.error)adminFailure(existing.error);
  const existingIds=(existing.data||[]).map((mapping)=>mapping.id);
  if(existingIds.length){const removeComponents=await cloudAdmin().from('product_etsy_mapping_components').delete().in('mapping_id',existingIds);if(removeComponents.error)adminFailure(removeComponents.error);}
  const removeMappings=await cloudAdmin().from('product_etsy_mappings').delete().eq('product_id',productId);
  if(removeMappings.error)adminFailure(removeMappings.error);
  const base=await cloudAdmin().from('product_etsy_mappings').insert(rows.map((mapping)=>({product_id:productId,etsy_sku:mapping.etsySku,inventory_sku:mapping.components[0].inventorySku,inventory_sku_id:idBySku.get(mapping.components[0].inventorySku.toLowerCase()),inventory_units:mapping.components[0].units,active:mapping.active,sort_order:mapping.sortOrder}))).select('id,etsy_sku');
  if(base.error)adminFailure(base.error);
  const mappingIds=new Map((base.data||[]).map((mapping)=>[mapping.etsy_sku.toLowerCase(),mapping.id]));
  const components=rows.flatMap((mapping)=>mapping.components.map((component,index)=>({mapping_id:mappingIds.get(mapping.etsySku.toLowerCase()),inventory_sku_id:idBySku.get(component.inventorySku.toLowerCase()),inventory_sku:component.inventorySku,inventory_units:component.units,sort_order:index}))).filter((component)=>component.mapping_id);
  if(components.length){const result=await cloudAdmin().from('product_etsy_mapping_components').insert(components);if(result.error)adminFailure(result.error);}
};
const renderAdminEtsyEditor=(form,mappings=[])=>{organizeAdminBadges(form);renderAdminMediaPreviews(form);const editor=form.querySelector('.admin-etsy-editor');editor?.removeAttribute('open');const list=editor?.querySelector('[data-etsy-list]');if(!list)return;const makeComponent=(componentList,value={})=>{const row=document.createElement('div');row.className='admin-etsy-component-row';row.dataset.etsyComponent='';row.innerHTML='<label>Inventory SKU<input data-etsy-inventory-sku value="'+adminSafe(value.inventory_sku||'')+'" placeholder="Canonical inventory SKU" required></label><label>Qty deducted<input data-etsy-inventory-units type="number" min="1" step="1" value="'+Math.max(1,Number(value.inventory_units)||1)+'" required></label><button type="button" data-remove-etsy-component>Remove component</button>';row.querySelector('[data-remove-etsy-component]').onclick=()=>{row.remove();sync();};componentList.append(row);};const makeMapping=(mapping={})=>{const card=document.createElement('section');card.className='admin-etsy-mapping';card.dataset.etsyRow='';card.innerHTML='<div class="admin-etsy-mapping-heading"><label>Etsy SKU<input data-etsy-sku value="'+adminSafe(mapping.etsy_sku||'')+'" placeholder="Comma-separated Etsy values become separate mappings" required></label><label class="admin-toggle"><input data-etsy-active type="checkbox" '+(mapping.active!==false?'checked':'')+'><span>Active</span></label><button type="button" data-remove-etsy>Remove mapping</button></div><div data-etsy-component-list></div><button type="button" data-add-etsy-component>Add inventory component</button>';const componentList=card.querySelector('[data-etsy-component-list]');const initial=mapping.components?.length?mapping.components:[{inventory_sku:mapping.inventory_sku||'',inventory_units:mapping.inventory_units||1}];initial.forEach((component)=>makeComponent(componentList,component));card.querySelector('[data-add-etsy-component]').onclick=()=>makeComponent(componentList);card.querySelector('[data-remove-etsy]').onclick=()=>{card.remove();sync();};list.append(card);};const sync=()=>{form.elements.etsy_mappings.value=JSON.stringify([...list.querySelectorAll('[data-etsy-row]')].map((card)=>({etsy_sku:card.querySelector('[data-etsy-sku]').value.trim(),components:[...card.querySelectorAll('[data-etsy-component]')].map((row)=>({inventory_sku:row.querySelector('[data-etsy-inventory-sku]').value.trim(),inventory_units:Number(row.querySelector('[data-etsy-inventory-units]').value)})).filter((component)=>component.inventory_sku),active:card.querySelector('[data-etsy-active]').checked})).filter((mapping)=>mapping.etsy_sku));};list.replaceChildren();(mappings||[]).forEach(makeMapping);form.querySelector('[data-add-etsy]').onclick=()=>makeMapping();list.addEventListener('input',sync);list.addEventListener('change',sync);sync();};
const renderAdminRecipeSummaries=async(form)=>{if(!form)return;const requestId=String((Number(form.dataset.recipeSummaryRequest)||0)+1);form.dataset.recipeSummaryRequest=requestId;const rows=[...form.querySelectorAll('[data-variant-row]')];const recipeRows=rows.filter((row)=>String(row.querySelector('[data-variant-disposition]')?.value||'')==='recipe_parent');const placeSummary=(row,summary)=>{const target=row.querySelector('.admin-sku-filter-editor')||row.querySelector('.admin-product-page-options-row')||row.querySelector('.admin-sku-internal');if(target)target.before(summary);};rows.forEach((row)=>row.querySelector('.admin-recipe-component-summary')?.remove());if(!recipeRows.length)return;const addMessage=(row,message)=>{if(form.dataset.recipeSummaryRequest!==requestId)return;row.querySelector('.admin-recipe-component-summary')?.remove();const body=row;const summary=document.createElement('section');summary.className='admin-recipe-component-summary';summary.innerHTML='<strong>Recipe pulls from</strong><p>'+adminSafe(message)+'</p>';placeSummary(body,summary);};recipeRows.forEach((row)=>addMessage(row,'Checking for a saved recipe…'));if(!window.beadSupabase){recipeRows.forEach((row)=>addMessage(row,'Recipe lookup requires the connected store database.'));return;}const skus=[...new Set(recipeRows.map((row)=>String(row.querySelector('[data-variant-sku]')?.value||'').trim()).filter(Boolean))];if(!skus.length){recipeRows.forEach((row)=>addMessage(row,'No recipe is configured for this parent SKU yet. Build it in Inventory & Reports → Recipe Builder.'));return;}const parents=await adminBatchRows(skus,(batch)=>cloudAdmin().from('inventory_skus').select('id,sku').in('sku',batch));if(parents.error){recipeRows.forEach((row)=>addMessage(row,'The recipe could not be loaded. Try again or check Inventory & Reports → Recipe Builder.'));return;}const parentIds=(parents.data||[]).map((row)=>row.id).filter(Boolean);if(!parentIds.length){recipeRows.forEach((row)=>addMessage(row,'No recipe is configured for this parent SKU yet. Build it in Inventory & Reports → Recipe Builder.'));return;}const recipes=await adminBatchRows(parentIds,(batch)=>cloudAdmin().from('inventory_bundle_components').select('bundle_sku_id,component_sku_id,quantity,sort_order').in('bundle_sku_id',batch).order('sort_order'));if(recipes.error){recipeRows.forEach((row)=>addMessage(row,'The recipe could not be loaded. Try again or check Inventory & Reports → Recipe Builder.'));return;}const childIds=[...new Set((recipes.data||[]).map((row)=>row.component_sku_id).filter(Boolean))];const children=await adminBatchRows(childIds,(batch)=>cloudAdmin().from('inventory_skus').select('id,sku,name').in('id',batch));if(children.error){recipeRows.forEach((row)=>addMessage(row,'The recipe children could not be loaded. Try again or check Inventory & Reports → Recipe Builder.'));return;}const childById=new Map((children.data||[]).map((row)=>[row.id,row]));const parentBySku=new Map((parents.data||[]).map((row)=>[String(row.sku||'').trim().toLowerCase(),row.id]));const componentsByParent=new Map();(recipes.data||[]).forEach((row)=>{const list=componentsByParent.get(row.bundle_sku_id)||[];const child=childById.get(row.component_sku_id);if(child?.sku)list.push({sku:child.sku,name:child.name||child.sku,quantity:Math.max(1,Number(row.quantity)||1)});componentsByParent.set(row.bundle_sku_id,list);});if(form.dataset.recipeSummaryRequest!==requestId)return;recipeRows.forEach((row)=>{const parentId=parentBySku.get(String(row.querySelector('[data-variant-sku]')?.value||'').trim().toLowerCase());const components=componentsByParent.get(parentId)||[];const body=row;row.querySelector('.admin-recipe-component-summary')?.remove();const summary=document.createElement('section');summary.className='admin-recipe-component-summary';summary.innerHTML=components.length?'<strong>Recipe pulls from</strong><ul>'+components.map((component)=>'<li><span>'+adminSafe(String(component.quantity))+' × '+adminSafe(component.name)+'</span><code>'+adminSafe(component.sku)+'</code></li>').join('')+'</ul><small>Available quantity and deductions follow this saved recipe.</small>':'<strong>Recipe pulls from</strong><p>No recipe is configured for this parent SKU yet. Build it in Inventory & Reports → Recipe Builder.</p>';placeSummary(body,summary);});};
const ensureAdminQtySoldBadgeChoice=(form,product=null)=>{const group=form.querySelector('.admin-badge-group-qty-sold-by');if(!group)return;let combined=group.querySelector('input[value="Single Bead & Multi-Pack"]');if(!combined){const label=document.createElement('label');label.className='admin-badge-option admin-badge-option-single-bead-multi-pack';label.innerHTML='<input type="checkbox" name="badges" value="Single Bead & Multi-Pack"> <span class="product-badge badge-single-bead-multi-pack">Single Bead &amp; Multi-Pack</span>';group.append(label);combined=label.querySelector('input');}if(group.dataset.singleBadgeChoice)return;group.dataset.singleBadgeChoice='true';group.addEventListener('change',(event)=>{if(!event.target.matches('input[name="badges"]'))return;if(event.target.checked)group.querySelectorAll('input[name="badges"]').forEach((input)=>{if(input!==event.target)input.checked=false;});});if(product?.badges?.includes('Single Bead & Multi-Pack'))combined.checked=true;};
const fetchAdminRowsAll=async(buildQuery)=>{
  const signature=String(buildQuery);
  // Read-only admin reports reuse the same reference tables across tab
  // switches. Keep those bounded/paginated reads cached for the same short
  // window as the existing products/orders/expenses reports.
  const cacheable=/\.from\('(products|orders|business_expenses|inventory_skus|product_option_values|product_etsy_mappings|product_etsy_mapping_components|inventory_bundle_components)'/.test(signature)&&!/[.]eq\(|[.]in\(|[.]gte\(|[.]lt\(/.test(signature);
  // The uncategorized report only needs products whose category is blank.
  // Apply that predicate at the source instead of downloading the complete
  // catalog and filtering it in the browser.
  const sourceQuery=signature.includes(".from('products').select('id,external_id,name,sku,category_slug,visible')")
    ? ()=>buildQuery().or('category_slug.is.null,category_slug.eq.""')
    : buildQuery;
  const load=async()=>{const rows=[];for(let page=0;;page+=1){const result=await sourceQuery().range(page*1000,page*1000+999);if(result.error)throw result.error;rows.push(...(result.data||[]));if((result.data||[]).length<1000)return{data:rows,error:null};}};
  if(!cacheable)return(await load()).data;
  const result=await adminCachedRows('admin-full:'+signature,load);
  if(result.error)throw result.error;
  return result.data||[];
};
const setupAdminExistingSkuLookup=(form)=>{
  if(!form)return;
    const selectFields='id,sku,name,quantity_on_hand,reorder_point,reserve_quantity,price,cost,unit_type,weight_value,weight_unit,item_type,preferred_vendor,taxable';
  const queryInventory=async(term)=>{
    let query=cloudAdmin().from('inventory_skus').select(selectFields).limit(12);
    const clean=String(term||'').trim().replace(/[,%()]/g,' ');
    if(clean)query=query.or('sku.ilike.%'+clean+'%,name.ilike.%'+clean+'%');
    else query=query.order('sku');
    const result=await query;
    return result.error?[]:result.data||[];
  };
  form.querySelectorAll('[data-variant-row]').forEach((row)=>{
    const skuInput=row.querySelector('[data-variant-sku]');
    const suggestions=row.querySelector('[data-sku-suggestions]');
    const picker=row.querySelector('[data-sku-picker]');
    if(!skuInput||!suggestions||!picker||skuInput.dataset.existingSkuLookup)return;
    skuInput.dataset.existingSkuLookup='true';
    let searchTimer=null;
    let requestId=0;
    const hideSuggestions=()=>{suggestions.hidden=true;suggestions.replaceChildren();};
    const setValue=(selector,value)=>{const field=row.querySelector(selector);if(field&&value!==null&&value!==undefined)field.value=value;};
    const applyRecord=(record,productName='')=>{
      setValue('[data-variant-sku]',record.sku);
      setValue('[data-variant-inventory-sku]',record.sku);
      setValue('[data-variant-label]',productName||record.name||'');
      setValue('[data-variant-price]',Number(record.price||0).toFixed(2));
      setValue('[data-variant-cost]',record.cost??'');
      setValue('[data-variant-unit-type]',record.unit_type||'Each');
      setValue('[data-variant-weight]',record.weight_value??'');
      setValue('[data-variant-weight-unit]',record.weight_unit||'oz');
      setValue('[data-variant-quantity]',Number(record.quantity_on_hand)||0);
      setValue('[data-variant-threshold]',Number(record.reorder_point)||0);
      setValue('[data-variant-reserve]',Number(record.reserve_quantity)||0);
      setValue('[data-variant-item-type]',record.item_type||'Inventory');
      setValue('[data-variant-vendor]',record.preferred_vendor||'');
      const taxable=row.querySelector('[data-variant-taxable]');
      if(taxable)taxable.checked=record.taxable!==false;
      skuInput.dataset.canonicalSku=record.sku||'';
      skuInput.dataset.canonicalInventoryId=record.id||'';
      skuInput.setCustomValidity('');
      skuInput.dataset.applyingCanonical='true';
      skuInput.dispatchEvent(new Event('input',{bubbles:true}));
      delete skuInput.dataset.applyingCanonical;
      hideSuggestions();
    };
    const showSuggestions=async(term)=>{
      const currentRequest=++requestId;
      suggestions.hidden=false;
      suggestions.replaceChildren();
      const loading=document.createElement('div');
      loading.className='admin-sku-suggestion-status';
      loading.textContent='Searching canonical inventory…';
      suggestions.append(loading);
      const records=await queryInventory(term);
      if(currentRequest!==requestId)return;
      suggestions.replaceChildren();
      if(!records.length){
        const empty=document.createElement('div');
        empty.className='admin-sku-suggestion-status';
        empty.textContent='No matching canonical inventory SKU.';
        suggestions.append(empty);
        return;
      }
      const buttons=new Map();
      records.forEach((record)=>{
        const productName=record.name||'';
        const option=document.createElement('button');
        option.type='button';
        option.className='admin-sku-suggestion';
        option.addEventListener('mousedown',(event)=>event.preventDefault());
        option.addEventListener('click',async()=>{applyRecord(record,record.name||'');});
        const sku=document.createElement('strong');
        sku.textContent=record.sku||'';
        const name=document.createElement('span');
        name.textContent=productName;
        option.append(sku,name);
        suggestions.append(option);
        buttons.set(String(record.sku||'').trim().toLowerCase(),{option,name});
      });
      Promise.resolve(new Map(records.map((record)=>[String(record.sku||'').trim().toLowerCase(),record.name||'']))).then((productNames)=>{
        if(currentRequest!==requestId)return;
        buttons.forEach(({name},sku)=>{name.textContent=productNames.get(sku)||name.textContent;});
      }).catch(()=>{});
    };
    skuInput.addEventListener('input',()=>{
      if(skuInput.dataset.applyingCanonical==='true')return;
      delete skuInput.dataset.canonicalSku;
      delete skuInput.dataset.canonicalInventoryId;
      skuInput.setCustomValidity(skuInput.value.trim()?'Choose a canonical inventory SKU from the suggestions.':'A canonical inventory SKU is required.');
      requestId+=1;
      suggestions.hidden=true;
      suggestions.replaceChildren();
      clearTimeout(searchTimer);
      const term=skuInput.value.trim();
      searchTimer=setTimeout(()=>showSuggestions(term),220);
    });
    skuInput.addEventListener('change',async()=>{
      const candidate=skuInput.value.trim();
      if(!candidate){skuInput.setCustomValidity('A canonical inventory SKU is required.');return;}
      const exactResult=await cloudAdmin().from('inventory_skus').select(selectFields).ilike('sku',candidate).maybeSingle();
      const exact=exactResult.error?null:exactResult.data;
      if(exact){applyRecord(exact,exact.name||'');}
      else skuInput.setCustomValidity('Choose a canonical inventory SKU from the suggestions.');
    });
    skuInput.addEventListener('focus',()=>{if(skuInput.value.trim())showSuggestions(skuInput.value.trim());});
    skuInput.addEventListener('blur',()=>{requestId+=1;setTimeout(hideSuggestions,160);});
    picker.addEventListener('click',()=>showSuggestions(skuInput.value.trim()));
  });
};
const initializeAdminNonInventoryState=()=>{panel?.querySelectorAll('[data-variant-row]').forEach((row)=>{syncAdminNonInventoryFields(row);const type=row.querySelector('[data-variant-item-type]');if(type&&!type.dataset.nonInventoryStateReady){type.dataset.nonInventoryStateReady='true';type.addEventListener('change',()=>syncAdminNonInventoryFields(row));}});};
new MutationObserver(()=>initializeAdminNonInventoryState()).observe(panel,{childList:true,subtree:true});
const clearAdminCatalogCoverageCache=async()=>{clearAdminRowsCachePrefix('catalog-part:');await clearAdminReportCache('report:catalog-part:');};
const renderAdminSkuCoverageReport=async(kind='orphans',fresh=false)=>{
  const view=panel.querySelector('#inventory-view');
  if(!view)return;
  const productPageReport=kind==='orphans';
  const heading=productPageReport?'SKUs without product pages':'Non-inventory SKUs without recipes';
  const statusAttribute=productPageReport?'data-orphan-report-status':'data-missing-recipe-report-status';
  const refreshAttribute=productPageReport?'data-refresh-orphan-report':'data-refresh-missing-recipe-report';
  const downloadAttribute=productPageReport?'data-download-orphan-report':'data-download-missing-recipe-report';
  view.innerHTML='<div class="admin-heading"><div><h3>'+heading+'</h3><p>'+(productPageReport?'Canonical SKUs not used by any product page or product variant. Mark expected stock-only SKUs to move them into a separate group; they remain listed.':'Canonical non-inventory SKUs that do not have a saved recipe.')+'</p></div><button type="button" '+refreshAttribute+'>Refresh report</button><button type="button" '+downloadAttribute+'>Download CSV</button></div><p '+statusAttribute+'>Loading canonical SKU records…</p><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>SKU</th><th>Name</th>'+(productPageReport?'<th>Page expectation</th>':'')+'</tr></thead><tbody></tbody></table></div>';
  const status=view.querySelector('['+statusAttribute+']');
  try{
    if(fresh)await clearAdminCatalogCoverageCache();
    const snapshotResult=await adminCatalogSnapshot('inventory:coverage-report',productPageReport,productPageReport,!productPageReport,false,true,true,true);
    if(snapshotResult.error)throw snapshotResult.error;
    const snapshot=adminCatalogSnapshotParts(snapshotResult);
    if(productPageReport){
      const pageExpectationRows=[];
      for(let offset=0;;offset+=1000){
        const result=await cloudAdmin().from('inventory_skus').select('sku,product_page_not_required').order('sku',{ascending:true}).range(offset,offset+999);
        if(result.error)throw result.error;
        pageExpectationRows.push(...(result.data||[]));
        if((result.data||[]).length<1000)break;
      }
      const pageExpectationBySku=new Map(pageExpectationRows.map((record)=>[String(record.sku||'').trim().toLowerCase(),record.product_page_not_required===true]));
      snapshot.inventory.forEach((record)=>{record.product_page_not_required=pageExpectationBySku.get(String(record.sku||'').trim().toLowerCase())===true;});
    }
    const referencedSkus=new Set();
    if(productPageReport){
      const inventorySkuById=new Map(snapshot.inventory.map((record)=>[String(record.id),String(record.sku||'').trim().toLowerCase()]));
      const addPageSkus=(value)=>String(value||'').split(',').map((sku)=>sku.trim().toLowerCase()).filter(Boolean).forEach((sku)=>referencedSkus.add(sku));
      snapshot.products.forEach((product)=>addPageSkus(product.sku));
      snapshot.options.forEach((group)=>(group.product_option_values||[]).forEach((option)=>addPageSkus(option.inventory_sku||option.sku||inventorySkuById.get(String(option.inventory_sku_id||'')))));
    }else snapshot.recipes.forEach((recipe)=>{if(recipe.bundle_sku_id)referencedSkus.add(String(recipe.bundle_sku_id));});
    const rows=snapshot.inventory.filter((record)=>{
      if(productPageReport)return !referencedSkus.has(String(record.sku||'').trim().toLowerCase());
      return String(record.item_type||'').trim().toLowerCase()==='non-inventory'&&!referencedSkus.has(String(record.id||''));
    }).sort((left,right)=>String(left.sku||'').localeCompare(String(right.sku||'')));
    const tbody=view.querySelector('tbody');
    const renderRows=()=>{
      const missingPageRows=rows.filter((record)=>record.product_page_not_required!==true);
      const expectedNoPageRows=rows.filter((record)=>record.product_page_not_required===true);
      const renderGroup=(label,groupRows,expected)=>'<tr class="admin-report-group"><th colspan="'+(productPageReport?'3':'2')+'" scope="rowgroup">'+adminSafe(label)+' ('+groupRows.length+')</th></tr>'+(groupRows.map((record)=>'<tr><td>'+adminSkuLink(record.sku)+'</td><td>'+adminSafe(record.name||'—')+'</td>'+(productPageReport?'<td><label><input type="checkbox" data-orphan-page-plan="'+adminSafe(record.sku)+'" '+(expected?'checked':'')+'> No product page planned</label></td>':'')+'</tr>').join('')||'<tr><td colspan="'+(productPageReport?'3':'2')+'">'+(expected?'No SKUs marked as not needing a page.':'No matching SKUs found.')+'</td></tr>');
      tbody.innerHTML=productPageReport?renderGroup('Missing product page',missingPageRows,false)+renderGroup('No product page planned',expectedNoPageRows,true):rows.map((record)=>'<tr><td>'+adminSkuLink(record.sku)+'</td><td>'+adminSafe(record.name||'—')+'</td></tr>').join('')||'<tr><td colspan="2">No matching SKUs found.</td></tr>';
      status.textContent=productPageReport?missingPageRows.length+' need a product page · '+expectedNoPageRows.length+' marked no page planned. All '+rows.length+' SKUs remain listed.':rows.length+' SKU'+(rows.length===1?'':'s')+' found.';
    };
    renderRows();
    if(productPageReport)tbody.querySelectorAll('[data-orphan-page-plan]').forEach((checkbox)=>checkbox.addEventListener('change',async()=>{
      const sku=checkbox.dataset.orphanPagePlan;
      const record=rows.find((candidate)=>String(candidate.sku||'')===sku);
      if(!record)return;
      const planned=checkbox.checked;
      checkbox.disabled=true;
      try{
        const result=await cloudAdmin().from('inventory_skus').update({product_page_not_required:planned}).eq('sku',sku).select('sku,product_page_not_required').maybeSingle();
        if(result.error)throw result.error;
        if(!result.data)throw new Error('No SKU was updated. Refresh the report and try again.');
        record.product_page_not_required=result.data.product_page_not_required===true;
        renderRows();
      }catch(error){
        checkbox.checked=!planned;
        checkbox.disabled=false;
        status.textContent='Could not save the page expectation for '+sku+': '+(error.message||'Unknown database error.');
      }
    }));
    view.querySelector('['+downloadAttribute+']').onclick=()=>{const quote=(value)=>'"'+String(value??'').replace(/"/g,'""')+'"';const csv=[productPageReport?['SKU','Name','Page expectation']:['SKU','Name'],...rows.map((record)=>productPageReport?[record.sku,record.name||'',record.product_page_not_required?'No product page planned':'Missing product page']:[record.sku,record.name||''])].map((row)=>row.map(quote).join(',')).join('\n');const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));link.download=productPageReport?'skus-without-product-pages.csv':'non-inventory-skus-without-recipes.csv';link.click();URL.revokeObjectURL(link.href);};
    view.querySelector('['+refreshAttribute+']').onclick=()=>void renderAdminSkuCoverageReport(kind,true);
  }catch(error){status.textContent='Unable to load '+heading.toLowerCase()+': '+(error.message||'Unknown error.');}
};
const renderAdminMissingCostPriceReport=async()=>{
  const view=panel.querySelector('#inventory-view');
  if(!view)return;
  view.innerHTML='<div class="admin-heading"><div><h3>SKUs missing cost or price</h3><p>Canonical SKUs with a blank or zero unit cost or retail price. This report is read-only.</p></div><button type="button" data-refresh-missing-cost-price>Refresh report</button><button type="button" data-download-missing-cost-price>Download CSV</button></div><p data-missing-cost-price-status>Loading matching inventory SKUs…</p><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>SKU</th><th>Name</th><th>Type</th><th>On hand</th><th>Price</th><th>Cost</th><th>Missing</th><th>Discontinued</th></tr></thead><tbody></tbody></table></div><div class="admin-pagination" data-missing-cost-price-pagination></div>';
  const status=view.querySelector('[data-missing-cost-price-status]');
  try{
    if(!window.beadSupabase)throw new Error('The store database is unavailable.');
    const rows=[];
    for(let offset=0;;offset+=1000){
      const result=await cloudAdmin().from('inventory_skus').select('sku,name,item_type,quantity_on_hand,price,cost,discontinued').or('cost.is.null,cost.eq.0,price.is.null,price.eq.0').order('sku',{ascending:true}).range(offset,offset+999);
      if(result.error)throw result.error;
      rows.push(...(result.data||[]));
      if((result.data||[]).length<1000)break;
    }
    const missingFields=(record)=>{const missing=[];if(record.cost===null||record.cost===undefined||Number(record.cost)<=0)missing.push('Cost');if(record.price===null||record.price===undefined||Number(record.price)<=0)missing.push('Price');return missing.join(', ');};
    const tbody=view.querySelector('tbody');
    const pagination=view.querySelector('[data-missing-cost-price-pagination]');
    const pageSize=25;let page=1;
    const draw=()=>{const pageCount=Math.max(1,Math.ceil(rows.length/pageSize));page=Math.min(page,pageCount);const visible=rows.slice((page-1)*pageSize,page*pageSize);tbody.innerHTML=visible.map((record)=>'<tr><td>'+adminSkuLink(record.sku)+'</td><td>'+adminSafe(record.name||'—')+'</td><td>'+adminSafe(record.item_type||'—')+'</td><td>'+Number(record.quantity_on_hand||0)+'</td><td>'+(record.price===null||record.price===undefined?'—':'$'+Number(record.price).toFixed(2))+'</td><td>'+(record.cost===null||record.cost===undefined?'—':'$'+Number(record.cost).toFixed(2))+'</td><td>'+adminSafe(missingFields(record))+'</td><td>'+(record.discontinued?'Yes':'No')+'</td></tr>').join('')||'<tr><td colspan="8">No SKUs are missing cost or price.</td></tr>';pagination.innerHTML='<button type="button" data-missing-cost-price-prev '+(page===1?'disabled':'')+'>Previous</button><span>Page '+page+' of '+pageCount+' · '+rows.length+' SKUs</span><button type="button" data-missing-cost-price-next '+(page===pageCount?'disabled':'')+'>Next</button>';pagination.querySelector('[data-missing-cost-price-prev]').onclick=()=>{page=Math.max(1,page-1);draw();};pagination.querySelector('[data-missing-cost-price-next]').onclick=()=>{page=Math.min(pageCount,page+1);draw();};};
    status.textContent=rows.length+' SKU'+(rows.length===1?'':'s')+' found. Blank or zero values are treated as missing.';
    draw();
    view.querySelector('[data-download-missing-cost-price]').onclick=()=>{const quote=(value)=>'"'+String(value??'').replace(/"/g,'""')+'"';const csv=[['SKU','Name','Type','On hand','Price','Cost','Missing fields','Discontinued'],...rows.map((record)=>[record.sku,record.name||'',record.item_type||'',record.quantity_on_hand,record.price??'',record.cost??'',missingFields(record),record.discontinued?'Yes':'No'])].map((row)=>row.map(quote).join(',')).join('\n');const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));link.download='skus-missing-cost-or-price.csv';link.click();URL.revokeObjectURL(link.href);};
    view.querySelector('[data-refresh-missing-cost-price]').onclick=()=>void renderAdminMissingCostPriceReport();
  }catch(error){status.textContent='Unable to load SKUs missing cost or price: '+(error.message||'Unknown error.');}
};
const renderAdminUncategorizedReportTab=async()=>{const view=panel.querySelector('#inventory-view');if(!view)return;view.innerHTML='<div class="admin-heading"><div><h3>Products with no category</h3><p>Products that do not have a category assigned. Assign one from the Products/SKUs editor.</p></div><button type="button" data-refresh-uncategorized-report>Refresh report</button><button type="button" data-download-uncategorized-report>Download CSV</button></div><p data-uncategorized-report-status>Loading products…</p><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Product</th><th>SKU(s)</th><th>Storefront</th><th>Product ID</th></tr></thead><tbody></tbody></table></div>';const status=view.querySelector('[data-uncategorized-report-status]');try{const result=await adminCatalogSnapshot('inventory:uncategorized-snapshot',true,true,false,false);if(result.error)throw result.error;const snapshot=adminCatalogSnapshotParts(result);const products=snapshot.products;const skuByProduct=new Map();snapshot.options.forEach((group)=>{(group.product_option_values||[]).forEach((row)=>{const productId=group.product_id;if(!productId)return;const values=skuByProduct.get(productId)||[];const sku=String(row.inventory_sku||row.sku||'').trim();if(sku&&!values.includes(sku))values.push(sku);skuByProduct.set(productId,values);});});const uncategorized=products.filter((product)=>!String(product.category_slug||'').trim()).map((product)=>({...product,displaySkus:(skuByProduct.get(product.id)||[]).join(', ')||product.sku||'—'}));view.querySelector('tbody').innerHTML=uncategorized.map((product)=>'<tr><td>'+adminSafe(product.name||product.external_id||'Untitled product')+'</td><td>'+((skuByProduct.get(product.id)||[product.sku||'—']).map((sku)=>adminSkuLink(sku,product.id)).join(' , '))+'</td><td>'+ (product.visible?'ON':'OFF')+'</td><td>'+adminSafe(product.id)+'</td></tr>').join('')||'<tr><td colspan="4">No uncategorized products found.</td></tr>';status.textContent=uncategorized.length+' uncategorized product'+(uncategorized.length===1?'':'s')+' found.';view.querySelector('[data-download-uncategorized-report]').onclick=()=>{const link=document.createElement('a');const csv=[['Product','SKU(s)','Storefront','Product ID'],...uncategorized.map((product)=>[product.name||product.external_id||'Untitled product',product.displaySkus,product.visible?'ON':'OFF',product.id])].map((row)=>row.map((value)=>'"'+String(value??'').replace(/"/g,'""')+'"').join(',')).join('\n');link.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));link.download='uncategorized-products.csv';link.click();};view.querySelector('[data-refresh-uncategorized-report]').onclick=()=>void renderAdminUncategorizedReportTab();}catch(error){status.textContent='Unable to load uncategorized products: '+error.message;}};
const renderAdminUncategorizedReportServer=async()=>{const view=panel.querySelector('#inventory-view');if(!view)return;view.innerHTML='<div class="admin-heading"><div><h3>Products with no category</h3><p>Only uncategorized products are requested from the server. Assign a category from Products/SKUs.</p></div><button type="button" data-refresh-uncategorized-report>Refresh report</button><button type="button" data-download-uncategorized-report>Download CSV</button></div><p data-uncategorized-report-status>Loading products…</p><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Product</th><th>SKU(s)</th><th>Storefront</th><th>Product ID</th></tr></thead><tbody></tbody></table></div>';const status=view.querySelector('[data-uncategorized-report-status]');try{const result=await cloudAdmin().rpc('admin_uncategorized_product_page',{p_page:1,p_page_size:100});if(result.error)throw result.error;const products=result.data||[];const ids=products.map((product)=>product.id).filter(Boolean);const optionResult=ids.length?await cloudAdmin().from('product_options').select('product_id,product_option_values(sku,inventory_sku)').in('product_id',ids):{data:[],error:null};if(optionResult.error)throw optionResult.error;const skuByProduct=new Map();(optionResult.data||[]).forEach((group)=>{(group.product_option_values||[]).forEach((row)=>{const values=skuByProduct.get(group.product_id)||[];const sku=String(row.inventory_sku||row.sku||'').trim();if(sku&&!values.includes(sku))values.push(sku);skuByProduct.set(group.product_id,values);});});const displayRows=products.map((product)=>({...product,displaySkus:(skuByProduct.get(product.id)||[]).join(', ')||product.sku||'—'}));view.querySelector('tbody').innerHTML=displayRows.map((product)=>'<tr><td>'+adminSafe(product.name||product.external_id||'Untitled product')+'</td><td>'+((skuByProduct.get(product.id)||[product.sku||'—']).map((sku)=>adminSkuLink(sku,product.id)).join(' , '))+'</td><td>'+ (product.visible?'ON':'OFF')+'</td><td>'+adminSafe(product.id)+'</td></tr>').join('')||'<tr><td colspan="4">No uncategorized products found.</td></tr>';const total=Number(products[0]?.total_count)||0;status.textContent=total+' uncategorized product'+(total===1?'':'s')+' found.'+(total>products.length?' Showing the first '+products.length+'.':'');view.querySelector('[data-download-uncategorized-report]').onclick=()=>{const link=document.createElement('a');const csv=[['Product','SKU(s)','Storefront','Product ID'],...displayRows.map((product)=>[product.name||product.external_id||'Untitled product',product.displaySkus,product.visible?'ON':'OFF',product.id])].map((row)=>row.map((value)=>'"'+String(value??'').replace(/"/g,'""')+'"').join(',')).join('\n');link.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));link.download='uncategorized-products.csv';link.click();};view.querySelector('[data-refresh-uncategorized-report]').onclick=()=>void renderAdminUncategorizedReportServer();}catch(error){status.textContent='Unable to load uncategorized products: '+error.message;}};
const adminThemeDefaults={buttonColor:'#050505',buttonTextColor:'#ffffff',bannerColor:'#e482a4',headerTextColor:'#111111',cartBadgeColor:'#e482a4',pageBackgroundColor:'#fffdfb',accentBackgroundColor:'#fff1f5',footerBackgroundColor:'#111111',footerHeaderTextColor:'#f185aa',footerButtonColor:'#f185aa',footerTextColor:'#ffffff'};
const normalizeAdminTheme=(source={})=>Object.fromEntries(Object.entries(adminThemeDefaults).map(([key,fallback])=>[key,/^#[0-9a-f]{6}$/i.test(String(source[key]||''))?String(source[key]):fallback]));
const safeAdminThemeImageUrl=(value)=>{const url=String(value||'').trim();if(!url)return'';try{const parsed=new URL(url,window.location.href);if(!['http:','https:'].includes(parsed.protocol))return'';return parsed.href.replace(/["\\)]/g,'');}catch(error){return'';}};
const initializeAdminThemeSettings=async()=>{if(!panel||panel.querySelector('[data-theme-settings]'))return;const settingsForm=panel.querySelector('#settings-form');if(!settingsForm)return;const data=adminData();let settings=data.settings||{};let config=window.productStoreConfig||{};const normalizeAdminThemePhotos=(source={})=>Object.fromEntries(Object.entries(source||{}).map(([key,value])=>[key,safeAdminThemeImageUrl(value)]).filter(([,value])=>value));let currentTheme;let currentHeroUrl;let currentLogoUrl;let currentStoryUrl;let currentBackgroundUrl;let currentFooterLogoUrl;let currentCategoryPhotos;let presets=Array.isArray(settings.themePresets)?settings.themePresets:[];let themeCategories=[];let themeCategoryError='';const section=document.createElement('section');section.className='admin-card admin-theme-settings';section.dataset.themeSettings='';section.innerHTML='<div class="admin-heading"><div><h3>Storefront theme</h3><p>Choose a saved theme to load it automatically. Edit the settings and save one complete theme.</p></div></div><form class="admin-form" data-theme-form><div class="admin-theme-presets"><label>Saved themes<select name="theme_preset"><option value="">Choose a saved theme</option></select></label><label>Theme name<input name="theme_preset_name" placeholder="Christmas"></label><button type="button" data-theme-new>Add new theme</button><button type="button" data-theme-delete-preset>Delete selected theme</button></div><div class="admin-form-grid admin-theme-colors"><label>Button color<input name="buttonColor" type="color"></label><label>Button text<input name="buttonTextColor" type="color"></label><label>Top banner<input name="bannerColor" type="color"></label><label>Header text<input name="headerTextColor" type="color"></label><label>Cart quantity badge<input name="cartBadgeColor" type="color"></label><label>Page background<input name="pageBackgroundColor" type="color"></label><label>Accent background<input name="accentBackgroundColor" type="color"></label><label>Footer background<input name="footerBackgroundColor" type="color"></label><label>Footer heading text<input name="footerHeaderTextColor" type="color"></label><label>Footer subscribe button<input name="footerButtonColor" type="color"></label><label>Footer general text<input name="footerTextColor" type="color"></label></div><label>Homepage hero image<input name="hero" type="file" accept="image/*"><small data-theme-hero-status></small></label><label>Main logo<input name="logo" type="file" accept="image/*"><small data-theme-logo-status></small></label><label>Our Story image<input name="story" type="file" accept="image/*"><small data-theme-story-status></small></label><label>Page background image<input name="background" type="file" accept="image/*"><small data-theme-background-status></small></label><label>Footer logo<input name="footerLogo" type="file" accept="image/*"><small data-theme-footer-logo-status></small></label><div class="admin-theme-category-editor"><h4>Category photo overrides</h4><p>Upload alternate category photos for this theme. Categories without an override keep their normal photo.</p><div data-theme-category-list></div></div><div class="admin-theme-preview" data-theme-preview><div data-theme-preview-banner>Announcement banner</div><strong>Header text preview</strong><button type="button" data-theme-preview-button>Button preview</button><span data-theme-preview-badge>3</span><div data-theme-preview-hero></div></div><div class="admin-actions"><button type="submit" class="cta">Save storefront theme</button></div><p data-theme-status role="status"></p></form>';panel.append(section);if(window.beadSupabase){try{const result=await withAdminEditorTimeout(cloudAdmin().from('site_settings').select('value').eq('key','store').maybeSingle(),'Theme settings request');if(!result.error){const cloudValue=result.data?.value||{};if(cloudValue.admin&&typeof cloudValue.admin==='object')settings=cloudValue.admin;if(cloudValue.config&&typeof cloudValue.config==='object')config={...config,...cloudValue.config};const cloudPresets=cloudValue.admin?.themePresets;if(Array.isArray(cloudPresets))presets=cloudPresets;}}catch(error){}}if(window.beadSupabase){try{themeCategories=(await cloudCategoryRows()).filter((category)=>category.active&&category.slug&&category.slug!=='shop-all').map((category)=>[category.slug,category.name,safeAdminThemeImageUrl(category.cover_photo)]);}catch(error){themeCategoryError='Category photos could not load. Reload before saving theme changes.';}}currentTheme=normalizeAdminTheme(settings.theme||config.theme);currentHeroUrl=safeAdminThemeImageUrl(settings.heroUrl??config.heroUrl);currentLogoUrl=safeAdminThemeImageUrl(settings.logoUrl??config.logoUrl);currentStoryUrl=safeAdminThemeImageUrl(settings.storyUrl??config.storyUrl);currentBackgroundUrl=safeAdminThemeImageUrl(settings.pageBackgroundImageUrl??config.pageBackgroundImageUrl);currentFooterLogoUrl=safeAdminThemeImageUrl(settings.footerLogoUrl??config.footerLogoUrl);currentCategoryPhotos=normalizeAdminThemePhotos(settings.categoryPhotos||config.categoryPhotos);const form=section.querySelector('[data-theme-form]');const preview=section.querySelector('[data-theme-preview]');const heroPreview=section.querySelector('[data-theme-preview-hero]');const categoryList=section.querySelector('[data-theme-category-list]');const status=section.querySelector('[data-theme-status]');const logoStatus=section.querySelector('[data-theme-logo-status]');const storyStatus=section.querySelector('[data-theme-story-status]');const backgroundStatus=section.querySelector('[data-theme-background-status]');const footerLogoStatus=section.querySelector('[data-theme-footer-logo-status]');const heroStatus=section.querySelector('[data-theme-hero-status]');const presetSelect=form.elements.theme_preset;const readTheme=()=>normalizeAdminTheme(Object.fromEntries(Object.keys(adminThemeDefaults).map((key)=>[key,form.elements[key].value])));const setTheme=(theme)=>{const values=normalizeAdminTheme(theme);Object.entries(values).forEach(([key,value])=>{form.elements[key].value=value;preview.style.setProperty('--theme-preview-'+key.replace(/[A-Z]/g,(character)=>'-'+character.toLowerCase()),value);});};const setHeroPreview=(url)=>{const safeUrl=safeAdminThemeImageUrl(url)||safeAdminThemeImageUrl(settings.themeDefaultSnapshot?.heroUrl);heroPreview.style.backgroundImage=safeUrl?'url("'+safeUrl+'")':'';heroStatus.textContent=safeUrl?'Current hero image is ready to use.':'No custom hero uploaded; the built-in hero will be used.';};const setLogoStatus=()=>{logoStatus.textContent=currentLogoUrl?'Custom logo is active.':'Default logo will be used.';};const setStoryStatus=()=>{storyStatus.textContent=currentStoryUrl?'Custom Our Story image is active.':'Default Our Story image will be used.';};const setBackgroundStatus=()=>{backgroundStatus.textContent=currentBackgroundUrl?'Custom page background image is active.':'No custom background image; the selected background color will be used.';};const setFooterLogoStatus=()=>{footerLogoStatus.textContent=currentFooterLogoUrl?'Custom footer logo is active.':'Default footer logo will be used.';};const drawCategoryPhotos=()=>{const categories=themeCategories;categoryList.innerHTML=themeCategoryError?'<p class="admin-action-status">'+adminSafe(themeCategoryError)+'</p>':categories.map(([slug,label,defaultPhoto])=>'<label class="admin-theme-category-row"><span>'+adminSafe(label)+'</span><input type="file" accept="image/*" data-theme-category="'+adminSafe(slug)+'" data-theme-category-current="'+adminSafe(currentCategoryPhotos[slug]||'')+'" data-theme-category-default="'+adminSafe(defaultPhoto||'')+'"><small>'+(currentCategoryPhotos[slug]?'Theme override active':'Uses default category photo')+'</small><button type="button" data-theme-category-clear="'+adminSafe(slug)+'">Use default</button></label>').join('');categoryList.querySelectorAll('[data-theme-category-clear]').forEach((button)=>button.addEventListener('click',()=>{delete currentCategoryPhotos[button.dataset.themeCategoryClear];const input=categoryList.querySelector('[data-theme-category="'+button.dataset.themeCategoryClear+'"]');if(input)input.value='';drawCategoryPhotos();applyPreview();}));};const readCategoryPhotos=()=>{const next={...currentCategoryPhotos};categoryList.querySelectorAll('[data-theme-category]').forEach((input)=>{if(input.files?.[0])next[input.dataset.themeCategory]=input.files[0];});return next;};const drawPresets=()=>{presetSelect.innerHTML='<option value="">Choose a saved theme</option><option value="__locked_default__">Default (locked)</option>'+presets.map((preset,index)=>/^default(?:\s*\(locked\))?$/i.test(String(preset?.name||'').trim())?'':'<option value="'+index+'">'+adminSafe(preset.name)+'</option>').join('');};const applyPreview=()=>{const values=readTheme();Object.entries(values).forEach(([key,value])=>preview.style.setProperty('--theme-preview-'+key.replace(/[A-Z]/g,(character)=>'-'+character.toLowerCase()),value));const backgroundFile=form.elements.background.files?.[0];if(backgroundFile){const objectUrl=URL.createObjectURL(backgroundFile);preview.style.backgroundImage='url("'+objectUrl+'")';backgroundStatus.textContent='New background image selected. Save the theme to upload it.';}else{preview.style.backgroundImage=currentBackgroundUrl?'url("'+currentBackgroundUrl+'")':'';setBackgroundStatus();}const file=form.elements.hero.files?.[0];if(file){const objectUrl=URL.createObjectURL(file);heroPreview.style.backgroundImage='url("'+objectUrl+'")';heroStatus.textContent='New hero selected. Save the theme to upload it.';}else setHeroPreview(currentHeroUrl);};const persistTheme=async(theme,heroUrl,nextPresets=presets,nextCategoryPhotos=currentCategoryPhotos,logoUrl=currentLogoUrl,storyUrl=currentStoryUrl,pageBackgroundImageUrl=currentBackgroundUrl,footerLogoUrl=currentFooterLogoUrl,preserveExistingPresets=false)=>{let persistedPresets=nextPresets;const resolvedCategoryPhotos={};for(const [slug,value] of Object.entries(nextCategoryPhotos||{})){if(value instanceof File){if(!value.type.startsWith('image/')||value.size>10*1024*1024)throw new Error('Category photos must be images no larger than 10 MB.');resolvedCategoryPhotos[slug]=await uploadAdminMedia(value,'storefront/categories',{canonicalKey:`theme-${adminSlug(String(form.elements.theme_preset_name.value||'active'))}-category-${adminSlug(slug)}`});}else{const safeUrl=safeAdminThemeImageUrl(value);if(safeUrl)resolvedCategoryPhotos[slug]=safeUrl;}}if(preserveExistingPresets&&window.beadSupabase){const latest=await cloudAdmin().from('site_settings').select('value').eq('key','store').maybeSingle();if(!latest.error){const serverPresets=latest.data?.value?.admin?.themePresets;if(Array.isArray(serverPresets)){const merged=new Map(serverPresets.filter((preset)=>preset?.name).map((preset)=>[String(preset.name).trim().toLowerCase(),preset]));(nextPresets||[]).filter((preset)=>preset?.name).forEach((preset)=>merged.set(String(preset.name).trim().toLowerCase(),preset));persistedPresets=[...merged.values()];}}}const fallbackImage=(value,key)=>safeAdminThemeImageUrl(value)||safeAdminThemeImageUrl(settings.themeDefaultSnapshot?.[key]);const effectiveHeroUrl=fallbackImage(heroUrl,'heroUrl');const effectiveLogoUrl=fallbackImage(logoUrl,'logoUrl');const effectiveStoryUrl=fallbackImage(storyUrl,'storyUrl');const effectiveBackgroundUrl=fallbackImage(pageBackgroundImageUrl,'pageBackgroundImageUrl');const effectiveFooterLogoUrl=fallbackImage(footerLogoUrl,'footerLogoUrl');const next=adminData();next.settings={...settings,theme,heroUrl:effectiveHeroUrl,logoUrl:effectiveLogoUrl,storyUrl:effectiveStoryUrl,pageBackgroundImageUrl:effectiveBackgroundUrl,footerLogoUrl:effectiveFooterLogoUrl,categoryPhotos:resolvedCategoryPhotos,themePresets:persistedPresets};const nextConfig={...(window.productStoreConfig||{}),theme,heroUrl:effectiveHeroUrl,logoUrl:effectiveLogoUrl,storyUrl:effectiveStoryUrl,pageBackgroundImageUrl:effectiveBackgroundUrl,footerLogoUrl:effectiveFooterLogoUrl,categoryPhotos:resolvedCategoryPhotos};if(!window.beadSupabase)throw new Error('The store database is unavailable.');const result=await patchAdminStoreSettings({config:nextConfig,admin:next.settings});if(!result)throw new Error('The store database rejected the theme update.');saveAdminData(next);window.productStoreConfig=nextConfig;localStorage.setItem('beadDifferentProductConfig',JSON.stringify(nextConfig));settings=next.settings;currentCategoryPhotos=resolvedCategoryPhotos;currentLogoUrl=logoUrl;currentStoryUrl=storyUrl;currentBackgroundUrl=pageBackgroundImageUrl;currentFooterLogoUrl=footerLogoUrl;window.applyStoreTheme?.(theme,effectiveHeroUrl,resolvedCategoryPhotos,effectiveLogoUrl,effectiveStoryUrl,effectiveBackgroundUrl,effectiveFooterLogoUrl);return persistedPresets;};const loadSelectedPreset=()=>{if(presetSelect.value==='__locked_default__'){const snapshot=settings.themeDefaultSnapshot||{};form.elements.theme_preset_name.value='';currentTheme=normalizeAdminTheme(snapshot.theme||adminThemeDefaults);currentHeroUrl=safeAdminThemeImageUrl(snapshot.heroUrl);currentLogoUrl=safeAdminThemeImageUrl(snapshot.logoUrl);currentStoryUrl=safeAdminThemeImageUrl(snapshot.storyUrl);currentBackgroundUrl=safeAdminThemeImageUrl(snapshot.pageBackgroundImageUrl);currentFooterLogoUrl=safeAdminThemeImageUrl(snapshot.footerLogoUrl);currentCategoryPhotos=normalizeAdminThemePhotos(snapshot.categoryPhotos);['hero','logo','story','background','footerLogo'].forEach((name)=>{form.elements[name].value='';});setTheme(currentTheme);setHeroPreview(currentHeroUrl);setLogoStatus();setStoryStatus();setBackgroundStatus();setFooterLogoStatus();drawCategoryPhotos();applyPreview();status.textContent='Loaded Default. Its colors and images are restored.';return;}if(!presetSelect.value)return;const preset=presets[Number(presetSelect.value)];if(!preset)return;form.elements.theme_preset_name.value=preset.name;currentTheme=normalizeAdminTheme(preset.theme);currentHeroUrl=safeAdminThemeImageUrl(preset.heroUrl);currentLogoUrl=safeAdminThemeImageUrl(preset.logoUrl);currentStoryUrl=safeAdminThemeImageUrl(preset.storyUrl);currentBackgroundUrl=safeAdminThemeImageUrl(preset.pageBackgroundImageUrl);currentFooterLogoUrl=safeAdminThemeImageUrl(preset.footerLogoUrl);currentCategoryPhotos=normalizeAdminThemePhotos(preset.categoryPhotos);setTheme(currentTheme);setHeroPreview(currentHeroUrl);setLogoStatus();setStoryStatus();setBackgroundStatus();setFooterLogoStatus();drawCategoryPhotos();applyPreview();status.textContent='Loaded '+preset.name+'. Edit the settings, then save the storefront theme.';};setTheme(currentTheme);drawPresets();setHeroPreview(currentHeroUrl);setLogoStatus();setStoryStatus();setBackgroundStatus();setFooterLogoStatus();drawCategoryPhotos();applyPreview();form.elements.hero.addEventListener('change',applyPreview);form.elements.logo.addEventListener('change',()=>{logoStatus.textContent=form.elements.logo.files?.[0]?'New logo selected. Save the theme to upload it.':(currentLogoUrl?'Custom logo is active.':'Default logo will be used.');});form.elements.story.addEventListener('change',()=>{storyStatus.textContent=form.elements.story.files?.[0]?'New Our Story image selected. Save the theme to upload it.':(currentStoryUrl?'Custom Our Story image is active.':'Default Our Story image will be used.');});form.elements.background.addEventListener('change',()=>{backgroundStatus.textContent=form.elements.background.files?.[0]?'New background image selected. Save the theme to upload it.':(currentBackgroundUrl?'Custom page background image is active.':'No custom background image; the selected background color will be used.');});form.elements.footerLogo.addEventListener('change',()=>{footerLogoStatus.textContent=form.elements.footerLogo.files?.[0]?'New footer logo selected. Save the theme to upload it.':(currentFooterLogoUrl?'Custom footer logo is active.':'Default footer logo will be used.');});form.addEventListener('input',applyPreview);const startNewTheme=()=>{const defaultSnapshot=settings.themeDefaultSnapshot||{};currentTheme=normalizeAdminTheme(defaultSnapshot.theme||adminThemeDefaults);currentHeroUrl=safeAdminThemeImageUrl(defaultSnapshot.heroUrl);currentLogoUrl=safeAdminThemeImageUrl(defaultSnapshot.logoUrl);currentStoryUrl=safeAdminThemeImageUrl(defaultSnapshot.storyUrl);currentBackgroundUrl=safeAdminThemeImageUrl(defaultSnapshot.pageBackgroundImageUrl);currentFooterLogoUrl=safeAdminThemeImageUrl(defaultSnapshot.footerLogoUrl);currentCategoryPhotos=normalizeAdminThemePhotos(defaultSnapshot.categoryPhotos);presetSelect.value='';form.elements.theme_preset_name.value='';form.elements.theme_preset_name.dispatchEvent(new Event('input',{bubbles:true}));form.elements.hero.value='';form.elements.logo.value='';form.elements.story.value='';form.elements.background.value='';form.elements.footerLogo.value='';setTheme(currentTheme);setHeroPreview(currentHeroUrl);setLogoStatus();setStoryStatus();setBackgroundStatus();setFooterLogoStatus();drawCategoryPhotos();applyPreview();status.textContent='New theme started with the default settings. Name it, edit it, and save the storefront theme.';};form.querySelector('[data-theme-new]').addEventListener('click',startNewTheme);presetSelect.addEventListener('change',async()=>{presetSelect.dataset.userSelected='true';loadSelectedPreset();if(!presetSelect.value||presetSelect.value==='__locked_default__')return;const selected=presets[Number(presetSelect.value)];if(!selected)return;presetSelect.disabled=true;status.textContent='Applying '+selected.name+' storefront theme…';try{presets=await persistTheme(currentTheme,currentHeroUrl,presets,currentCategoryPhotos,currentLogoUrl,currentStoryUrl,currentBackgroundUrl,currentFooterLogoUrl,true);drawPresets();presetSelect.value=String(presets.findIndex((preset)=>String(preset.name||'').toLowerCase()===String(selected.name||'').toLowerCase()));status.textContent='Active storefront theme: '+selected.name+'.';}catch(error){status.textContent='Could not activate '+selected.name+': '+error.message;}finally{presetSelect.disabled=false;}});form.querySelector('[data-theme-delete-preset]').addEventListener('click',async()=>{const index=Number(presetSelect.value);if(!Number.isInteger(index)||!presets[index]){status.textContent='Choose a saved theme to delete.';return;}const name=presets[index].name;presets.splice(index,1);try{presets=await persistTheme(readTheme(),currentHeroUrl,presets,currentCategoryPhotos,currentLogoUrl,currentStoryUrl,currentBackgroundUrl,currentFooterLogoUrl);drawPresets();status.textContent='Deleted theme preset: '+name+'.';}catch(error){status.textContent='Theme preset was not deleted: '+error.message;}});form.addEventListener('submit',async(event)=>{event.preventDefault();if(presetSelect.value==='__locked_default__'){const saveButton=form.querySelector('button.cta');saveButton.disabled=true;status.textContent='Applying Default storefront theme…';try{const snapshot=settings.themeDefaultSnapshot||{};const defaultTheme=normalizeAdminTheme(snapshot.theme||adminThemeDefaults);const defaultHeroUrl=safeAdminThemeImageUrl(snapshot.heroUrl);const defaultLogoUrl=safeAdminThemeImageUrl(snapshot.logoUrl);const defaultStoryUrl=safeAdminThemeImageUrl(snapshot.storyUrl);const defaultBackgroundUrl=safeAdminThemeImageUrl(snapshot.pageBackgroundImageUrl);const defaultFooterLogoUrl=safeAdminThemeImageUrl(snapshot.footerLogoUrl);const defaultCategoryPhotos=normalizeAdminThemePhotos(snapshot.categoryPhotos);const nextSettings={...settings,theme:defaultTheme,heroUrl:defaultHeroUrl,logoUrl:defaultLogoUrl,storyUrl:defaultStoryUrl,pageBackgroundImageUrl:defaultBackgroundUrl,footerLogoUrl:defaultFooterLogoUrl,categoryPhotos:defaultCategoryPhotos};const nextConfig={...config,theme:defaultTheme,heroUrl:defaultHeroUrl,logoUrl:defaultLogoUrl,storyUrl:defaultStoryUrl,pageBackgroundImageUrl:defaultBackgroundUrl,footerLogoUrl:defaultFooterLogoUrl,categoryPhotos:defaultCategoryPhotos};const next={...adminData(),settings:nextSettings};if(!window.beadSupabase)throw new Error('The store database is unavailable.');const result=await patchAdminStoreSettings({config:nextConfig,admin:nextSettings});if(!result)throw new Error('The store database rejected the default theme update.');saveAdminData(next);settings=nextSettings;config=nextConfig;window.productStoreConfig=nextConfig;localStorage.setItem('beadDifferentProductConfig',JSON.stringify(nextConfig));currentTheme=defaultTheme;currentHeroUrl=defaultHeroUrl;currentLogoUrl=defaultLogoUrl;currentStoryUrl=defaultStoryUrl;currentBackgroundUrl=defaultBackgroundUrl;currentFooterLogoUrl=defaultFooterLogoUrl;currentCategoryPhotos=defaultCategoryPhotos;setTheme(currentTheme);setHeroPreview(currentHeroUrl);setLogoStatus();setStoryStatus();setBackgroundStatus();setFooterLogoStatus();drawCategoryPhotos();applyPreview();window.applyStoreTheme?.(defaultTheme,defaultHeroUrl,defaultCategoryPhotos,defaultLogoUrl,defaultStoryUrl,defaultBackgroundUrl,defaultFooterLogoUrl);status.textContent='Default storefront theme applied.';}catch(error){status.textContent='Default storefront theme was not applied: '+(error.message||'Unknown error.');}finally{saveButton.disabled=false;}return;}const saveButton=form.querySelector('button.cta');const file=form.elements.hero.files?.[0];const logoFile=form.elements.logo.files?.[0];const storyFile=form.elements.story.files?.[0];const backgroundFile=form.elements.background.files?.[0];const footerLogoFile=form.elements.footerLogo.files?.[0];const pendingCategoryPhotos=readCategoryPhotos();if((file&&(!file.type.startsWith('image/')||file.size>10*1024*1024))||(logoFile&&(!logoFile.type.startsWith('image/')||logoFile.size>10*1024*1024))||(storyFile&&(!storyFile.type.startsWith('image/')||storyFile.size>10*1024*1024))||(backgroundFile&&(!backgroundFile.type.startsWith('image/')||backgroundFile.size>10*1024*1024))||(footerLogoFile&&(!footerLogoFile.type.startsWith('image/')||footerLogoFile.size>10*1024*1024))){status.textContent='Choose images no larger than 10 MB.';return;}currentCategoryPhotos=pendingCategoryPhotos;saveButton.disabled=true;status.textContent='Saving storefront theme…';try{for(const [slug,value] of Object.entries(currentCategoryPhotos)){if(value instanceof File){if(!value.type.startsWith('image/')||value.size>10*1024*1024)throw new Error('Category photos must be images no larger than 10 MB.');if(!window.beadSupabase)throw new Error('Category photo uploads require the connected store database.');currentCategoryPhotos[slug]=await uploadAdminMedia(value,'storefront/categories',{canonicalKey:`theme-${adminSlug(String(form.elements.theme_preset_name.value||'active'))}-category-${adminSlug(slug)}`});}}let heroUrl=currentHeroUrl;let logoUrl=currentLogoUrl;let storyUrl=currentStoryUrl;let pageBackgroundImageUrl=currentBackgroundUrl;let footerLogoUrl=currentFooterLogoUrl;if(file){if(!window.beadSupabase)throw new Error('Hero uploads require the connected store database.');heroUrl=await uploadAdminMedia(file,'storefront',{canonicalKey:`theme-${adminSlug(String(form.elements.theme_preset_name.value||'active'))}-hero`});currentHeroUrl=heroUrl;}if(logoFile){if(!window.beadSupabase)throw new Error('Logo uploads require the connected store database.');logoUrl=await uploadAdminMedia(logoFile,'storefront',{canonicalKey:`theme-${adminSlug(String(form.elements.theme_preset_name.value||'active'))}-logo`});currentLogoUrl=logoUrl;}if(storyFile){if(!window.beadSupabase)throw new Error('Our Story uploads require the connected store database.');storyUrl=await uploadAdminMedia(storyFile,'storefront',{canonicalKey:`theme-${adminSlug(String(form.elements.theme_preset_name.value||'active'))}-story`});currentStoryUrl=storyUrl;}if(backgroundFile){if(!window.beadSupabase)throw new Error('Background image uploads require the connected store database.');pageBackgroundImageUrl=await uploadAdminMedia(backgroundFile,'storefront',{canonicalKey:`theme-${adminSlug(String(form.elements.theme_preset_name.value||'active'))}-background`});currentBackgroundUrl=pageBackgroundImageUrl;}if(footerLogoFile){if(!window.beadSupabase)throw new Error('Footer logo uploads require the connected store database.');footerLogoUrl=await uploadAdminMedia(footerLogoFile,'storefront',{canonicalKey:`theme-${adminSlug(String(form.elements.theme_preset_name.value||'active'))}-footer-logo`});currentFooterLogoUrl=footerLogoUrl;}currentTheme=readTheme();const themeName=String(form.elements.theme_preset_name.value||'').trim();const defaultImageValue=(value,key)=>{const safeValue=safeAdminThemeImageUrl(value);const defaultValue=safeAdminThemeImageUrl(settings.themeDefaultSnapshot?.[key]);return safeValue&&safeValue!==defaultValue?safeValue:'';};let nextPresets=presets;if(themeName&&themeName.toLowerCase()!=='default'){const existing=presets.findIndex((preset)=>String(preset.name||'').toLowerCase()===themeName.toLowerCase());const preset={name:themeName,theme:currentTheme,heroUrl:defaultImageValue(heroUrl,'heroUrl'),logoUrl:defaultImageValue(logoUrl,'logoUrl'),storyUrl:defaultImageValue(storyUrl,'storyUrl'),pageBackgroundImageUrl:defaultImageValue(pageBackgroundImageUrl,'pageBackgroundImageUrl'),footerLogoUrl:defaultImageValue(footerLogoUrl,'footerLogoUrl'),categoryPhotos:{...currentCategoryPhotos}};nextPresets=[...presets];if(existing>=0)nextPresets.splice(existing,1,preset);else nextPresets.push(preset);}presets=await persistTheme(currentTheme,heroUrl,nextPresets,currentCategoryPhotos,logoUrl,storyUrl,pageBackgroundImageUrl,footerLogoUrl,true);drawPresets();if(themeName&&themeName.toLowerCase()!=='default')presetSelect.value=String(presets.findIndex((preset)=>String(preset.name||'').toLowerCase()===themeName.toLowerCase()));form.elements.hero.value='';form.elements.logo.value='';form.elements.story.value='';form.elements.background.value='';form.elements.footerLogo.value='';setHeroPreview(currentHeroUrl);setLogoStatus();setStoryStatus();setBackgroundStatus();setFooterLogoStatus();drawCategoryPhotos();status.textContent=themeName&&themeName.toLowerCase()!=='default'?'Saved and activated theme: '+themeName+'.':'Storefront theme saved.';}catch(error){status.textContent='Storefront theme was not saved: '+error.message;}finally{saveButton.disabled=false;}});};
const restoreAdminThemeDefault=()=>{const raw=localStorage.getItem('beadDifferentThemeDefault');if(!raw)return;try{const snapshot=JSON.parse(raw);const data=adminData();if(data.settings?.themeDefaultSnapshot)return;saveAdminData({...data,settings:{...(data.settings||{}),themeDefaultSnapshot:snapshot}});}catch(error){localStorage.removeItem('beadDifferentThemeDefault');}};
const rememberAdminThemeDefault=()=>{const data=adminData();const snapshot=data.settings?.themeDefaultSnapshot;if(snapshot)localStorage.setItem('beadDifferentThemeDefault',JSON.stringify(snapshot));};
const initializeAdminThemeDisclosure=()=>{const section=panel?.querySelector('[data-theme-settings]');if(!section||section.querySelector('[data-theme-disclosure]'))return;const data=adminData();const settings=data.settings||{};const config=window.productStoreConfig||{};const normalizePhotos=(source={})=>Object.fromEntries(Object.entries(source||{}).map(([key,value])=>[key,safeAdminThemeImageUrl(value)]).filter(([,value])=>value));const defaultSnapshot=settings.themeDefaultSnapshot||{theme:normalizeAdminTheme(settings.theme||config.theme),heroUrl:safeAdminThemeImageUrl(settings.heroUrl??config.heroUrl),logoUrl:safeAdminThemeImageUrl(settings.logoUrl??config.logoUrl),storyUrl:safeAdminThemeImageUrl(settings.storyUrl??config.storyUrl),pageBackgroundImageUrl:safeAdminThemeImageUrl(settings.pageBackgroundImageUrl??config.pageBackgroundImageUrl),footerLogoUrl:safeAdminThemeImageUrl(settings.footerLogoUrl??config.footerLogoUrl),categoryPhotos:normalizePhotos(settings.categoryPhotos||config.categoryPhotos)};if(!settings.themeDefaultSnapshot){const next={...data,settings:{...settings,themeDefaultSnapshot:defaultSnapshot}};saveAdminData(next);}const content=document.createElement('div');content.className='admin-theme-content';while(section.firstChild)content.append(section.firstChild);const heading=content.querySelector('.admin-heading h3');if(heading)heading.hidden=true;const header=document.createElement('button');header.type='button';header.className='admin-theme-summary';header.dataset.themeDisclosure='';header.setAttribute('aria-expanded','true');header.innerHTML='<span>Themes</span><small>Colors, images, and saved presets</small><span aria-hidden="true">⌃</span>';section.append(header,content);header.addEventListener('click',()=>{const open=header.getAttribute('aria-expanded')==='true';header.setAttribute('aria-expanded',String(!open));header.lastElementChild.textContent=open?'⌄':'⌃';content.hidden=open;});const form=content.querySelector('[data-theme-form]');const presetSelect=form?.elements?.theme_preset;const deleteButton=form?.querySelector('[data-theme-delete-preset]');const saveButton=form?.querySelector('button[type="submit"]');const nameInput=form?.elements?.theme_preset_name;const status=form?.querySelector('[data-theme-status]');const loadDefault=()=>{form.elements.theme_preset_name.value='';form.elements.theme_preset_name.dispatchEvent(new Event('input',{bubbles:true}));Object.entries(normalizeAdminTheme(defaultSnapshot.theme)).forEach(([key,value])=>{form.elements[key].value=value;});['hero','logo','story','background','footerLogo'].forEach((name)=>{form.elements[name].value='';});form.dispatchEvent(new Event('input',{bubbles:true}));content.querySelector('[data-theme-hero-status]').textContent=defaultSnapshot.heroUrl?'Default hero image is ready to use.':'Default hero image will be used.';content.querySelector('[data-theme-logo-status]').textContent=defaultSnapshot.logoUrl?'Default logo image is ready to use.':'Default logo will be used.';content.querySelector('[data-theme-story-status]').textContent=defaultSnapshot.storyUrl?'Default Our Story image is ready to use.':'Default Our Story image will be used.';content.querySelector('[data-theme-background-status]').textContent=defaultSnapshot.pageBackgroundImageUrl?'Default page background image is ready to use.':'No default background image; the selected background color will be used.';content.querySelector('[data-theme-footer-logo-status]').textContent=defaultSnapshot.footerLogoUrl?'Default footer logo image is ready to use.':'Default footer logo will be used.';status.textContent='Loaded Default. It is locked and cannot be overwritten or deleted.';};if(presetSelect){presetSelect.addEventListener('change',()=>{if(presetSelect.value==='__locked_default__')loadDefault();});}if(deleteButton)deleteButton.addEventListener('click',()=>{if(presetSelect?.value==='__locked_default__'){status.textContent='Default is locked and cannot be deleted.';}});const updatePresetLock=()=>{const defaultSelected=presetSelect?.value==='__locked_default__';const locked=defaultSelected||String(nameInput?.value||'').trim().toLowerCase()==='default';form?.querySelectorAll('input[name="theme_preset_name"],input[type="color"],input[type="file"],button[data-theme-category-clear],button[data-theme-delete-preset],button[type="submit"]').forEach((control)=>{control.disabled=locked;});if(saveButton)saveButton.disabled=!defaultSelected&&locked;if(locked&&status)status.textContent=defaultSelected?'Default is locked for editing. Save to apply it as the active theme.':'Default is locked. Choose Add new theme or another saved theme to edit.';};nameInput?.addEventListener('input',updatePresetLock);presetSelect?.addEventListener('change',updatePresetLock);updatePresetLock();};
const adminRequestTimeoutMs=12000;
const withAdminEditorTimeout=(request,label,timeout=adminRequestTimeoutMs)=>Promise.race([request,new Promise((_,reject)=>setTimeout(()=>reject(new Error(label+' timed out. The editor kept the existing values safe; retry the load before saving.')),timeout))]);
const installCanonicalSettingsSave=()=>{const form=document.querySelector('#settings-form');if(!form||form.dataset.canonicalSave)return;form.dataset.canonicalSave='true';form.addEventListener('submit',async(event)=>{event.preventDefault();event.stopImmediatePropagation();const fields=Object.fromEntries(new FormData(form));const richEditor=form.querySelector('[data-rich-editor]');if(richEditor)fields.shippingPolicy=`<div style="line-height:${richEditor.style.lineHeight||'1.5'}">${richEditor.innerHTML}</div>`;const numberOr=(value,fallback)=>{const parsed=Number(value);return Number.isFinite(parsed)?parsed:fallback;};const data=adminData();const currentSettings=data.settings||{};const nextSettings={...currentSettings,supportEmail:String(fields.supportEmail||'').trim(),smallBusinessMessage:String(fields.smallBusinessMessage||'').trim()||'SMALL BUSINESS',bigCreativityMessage:String(fields.bigCreativityMessage||'').trim()||'BIG CREATIVITY',shippingPolicy:fields.shippingPolicy,seoDescription:String(fields.seoDescription||'')};const nextConfig={...(window.productStoreConfig||{}),msrpMarkupPercent:Math.max(0,numberOr(fields.msrpMarkupPercent,100)),rewardThreshold:Math.max(0.01,numberOr(fields.rewardThreshold,35)),rewardDiscountPercent:Math.min(100,Math.max(0.01,numberOr(fields.rewardDiscountPercent,5))),shippingFrom:String(fields.shippingFrom||'').trim()||'Ohio',shippingOriginPostalCode:String(fields.shippingOriginPostalCode||'').trim(),shippingOriginCity:String(fields.shippingOriginCity||'').trim(),shippingOriginState:String(fields.shippingOriginState||'').trim().toUpperCase(),processingDays:Math.max(0,numberOr(fields.processingDays,3)),freeShippingThreshold:Math.max(0,numberOr(fields.freeShippingThreshold,50)),shippingCarrier:'usps',shippingBoxes:[...form.querySelectorAll('[data-shipping-box]')].map((row)=>({name:row.querySelector('[data-box-name]').value.trim(),maxWeightOz:row.querySelector('[data-box-max-weight]').value.trim(),lengthIn:row.querySelector('[data-box-length]').value.trim(),widthIn:row.querySelector('[data-box-width]').value.trim(),heightIn:row.querySelector('[data-box-height]').value.trim(),fallbackRate:row.querySelector('[data-box-rate]').value.trim()})).filter((box)=>box.name||box.maxWeightOz||box.lengthIn||box.widthIn||box.heightIn||box.fallbackRate),salesFrozen:Boolean(form.elements.salesFrozen?.checked),etsyImportsFrozen:Boolean(form.elements.etsyImportsFrozen?.checked)};const next={...data,settings:nextSettings};const notice=document.createElement('p');notice.className='admin-saved';notice.textContent='Saving settings to the store…';form.prepend(notice);const saveButton=form.querySelector('button.cta');if(saveButton)saveButton.disabled=true;try{if(!window.beadSupabase)throw new Error('The store database is unavailable.');const result=await patchAdminStoreSettings({config:nextConfig,admin:nextSettings});if(!result)throw new Error('The store database rejected the settings update.');window.productStoreConfig=nextConfig;localStorage.setItem('beadDifferentProductConfig',JSON.stringify(nextConfig));localStorage.setItem(adminDataKey,JSON.stringify(next));window.updateAnnouncementBar?.({freeShippingThreshold:nextConfig.freeShippingThreshold,smallBusiness:nextSettings.smallBusinessMessage,bigCreativity:nextSettings.bigCreativityMessage});notice.textContent='Settings saved to the store.';}catch(error){notice.className='admin-saved admin-save-error';notice.textContent='Settings were not saved to the store: '+(error.message||'Unknown error')+' Try again.';}finally{if(saveButton)saveButton.disabled=false;}},true);};
const renderStoreContent=async()=>{
  if(activeTab!=='content')return;
  let value={};
  if(window.beadSupabase)value=await loadAdminStoreSettings(true);
  const admin=value.admin&&typeof value.admin==='object'?value.admin:{};
  const links=admin.socialLinks&&typeof admin.socialLinks==='object'?admin.socialLinks:{};
    const nextConfig=value.config&&typeof value.config==='object'?value.config:{...(window.productStoreConfig||{})};
    const heroLink=String(nextConfig.heroLink??admin.heroLink??'category.html?category=new-arrivals').trim()||'category.html?category=new-arrivals';
  const faqItems=Array.isArray(admin.faqItems)?admin.faqItems:[];
  const faqMarkup=faqItems.map((item,index)=>`<div class="admin-content-faq-row" data-faq-row><label>Question<input name="faq_question_${index}" value="${adminSafe(item.question)}" maxlength="200"></label><label>Answer<textarea name="faq_answer_${index}" rows="4" maxlength="10000">${adminSafe(item.answer)}</textarea></label><button type="button" data-remove-faq>Remove question</button></div>`).join('');
  panel.innerHTML=`<div class="admin-heading"><div><p class="kicker">STOREFRONT CONTENT</p><h2>Store content</h2><p>Manage the public footer, About Us page, FAQ, and contact address. This content is separate from the product-page shipping summary.</p></div></div><form class="admin-form admin-content-form" data-content-form><section class="admin-card"><h3>Social media links</h3><p>Enter a complete link for each account. Blank fields hide that social button from the footer.</p><div class="admin-form-grid"><label>Facebook<input name="facebook" type="url" placeholder="https://facebook.com/…" value="${adminSafe(links.facebook||'')}"></label><label>Instagram<input name="instagram" type="url" placeholder="https://instagram.com/…" value="${adminSafe(links.instagram||'')}"></label><label>TikTok<input name="tiktok" type="url" placeholder="https://tiktok.com/@…" value="${adminSafe(links.tiktok||'')}"></label><label>Pinterest<input name="pinterest" type="url" placeholder="https://pinterest.com/…" value="${adminSafe(links.pinterest||'')}"></label><label>YouTube<input name="youtube" type="url" placeholder="https://youtube.com/@…" value="${adminSafe(links.youtube||'')}"></label><label>Resend-facing contact email<input name="contactEmail" type="email" placeholder="hello@example.com" value="${adminSafe(admin.contactEmail||'')}"></label></div></section><section class="admin-card"><h3>About Us / Our Story</h3><label>Page title<input name="storyTitle" maxlength="160" value="${adminSafe(admin.storyTitle||'Our Story')}"></label><label>Story content<textarea name="storyBody" rows="10" maxlength="20000">${adminSafe(admin.storyBody||'')}</textarea></label></section><section class="admin-card"><h3>Footer Shipping & Returns</h3><p>This is the full policy shown on the Shipping & Returns page. The shorter product-page shipping editor remains unchanged.</p><label>Full footer policy<textarea name="footerShippingPolicy" rows="14" maxlength="30000">${adminSafe(admin.footerShippingPolicy||'')}</textarea></label></section><section class="admin-card"><div class="admin-heading"><div><h3>Frequently Asked Questions</h3><p>Questions are displayed in expandable rows on the public FAQ page.</p></div><button type="button" data-add-faq>Add FAQ question</button></div><div class="admin-content-faq-list" data-faq-list>${faqMarkup||'<p class="admin-empty">No custom questions yet. Add one below.</p>'}</div></section><div class="admin-actions"><button class="cta" type="submit">Save store content</button></div><p data-content-status role="status"></p></form>`;
  const form=panel.querySelector('[data-content-form]');const list=panel.querySelector('[data-faq-list]');const status=panel.querySelector('[data-content-status]');const featuredSection=document.createElement('section');featuredSection.className='admin-card';featuredSection.innerHTML=`<h3>Homepage Featured section</h3><p>This content appears beside the products you mark Featured on the Products/SKUs page. Use the formatting tools below; the saved content is sanitized before it reaches the storefront.</p><label>Featured content<div class="admin-rich-editor featured-rich-editor"><div class="rich-toolbar" role="toolbar" aria-label="Featured content formatting"><button type="button" data-rich-command="bold"><strong>B</strong></button><button type="button" data-rich-command="italic"><em>I</em></button><button type="button" data-rich-command="underline"><u>U</u></button><select data-rich-command="formatBlock" aria-label="Text style"><option value="p">Paragraph</option><option value="h2">Heading</option><option value="h3">Subheading</option><option value="blockquote">Quote</option></select><select data-rich-command="fontName" aria-label="Font"><option value="Arial">Arial</option><option value="Georgia">Georgia</option><option value="Verdana">Verdana</option><option value="Trebuchet MS">Trebuchet MS</option></select><select data-rich-command="fontSize" aria-label="Text size"><option value="3">Normal</option><option value="4">Large</option><option value="5">Larger</option><option value="2">Small</option></select><select data-rich-command="lineHeight" aria-label="Line spacing"><option value="1.2">Tight spacing</option><option value="1.5" selected>Comfortable spacing</option><option value="2">Loose spacing</option></select><button type="button" data-rich-command="justifyLeft">Left</button><button type="button" data-rich-command="justifyCenter">Center</button><button type="button" data-rich-command="insertUnorderedList">• List</button><button type="button" data-rich-command="removeFormat">Clear</button></div><div class="rich-content featured-rich-content" contenteditable="true" data-rich-editor role="textbox" aria-multiline="true">${adminRichText(admin.featuredText||'')}</div><input type="hidden" name="featuredText" data-rich-value value="${adminSafe(admin.featuredText||'')}"></div></label>`;form.querySelector('section')?.before(featuredSection);initializeAdminRichEditor(featuredSection);
  panel.querySelector('[data-add-faq]').onclick=()=>{const empty=list.querySelector('.admin-empty');empty?.remove();const index=list.querySelectorAll('[data-faq-row]').length;const row=document.createElement('div');row.className='admin-content-faq-row';row.dataset.faqRow='';row.innerHTML=`<label>Question<input name="faq_question_${index}" maxlength="200"></label><label>Answer<textarea name="faq_answer_${index}" rows="4" maxlength="10000"></textarea></label><button type="button" data-remove-faq>Remove question</button>`;list.append(row);row.querySelector('input').focus();};
  list.addEventListener('click',(event)=>{if(event.target.closest('[data-remove-faq]')){event.target.closest('[data-faq-row]').remove();if(!list.querySelector('[data-faq-row]'))list.innerHTML='<p class="admin-empty">No custom questions yet. Add one below.</p>';}});
  form.addEventListener('submit',async(event)=>{event.preventDefault();const featuredEditor=featuredSection.querySelector('[data-rich-editor]');const featuredInput=featuredSection.querySelector('[data-rich-value]');if(featuredEditor&&featuredInput){const source=normalizeAdminRichTextSource(featuredEditor.innerHTML);featuredInput.value=window.sanitizeRichText?window.sanitizeRichText(source):source;}const fields=Object.fromEntries(new FormData(form));const nextFaq=[...list.querySelectorAll('[data-faq-row]')].map((row)=>({question:String(row.querySelector('input')?.value||'').trim(),answer:String(row.querySelector('textarea')?.value||'').trim()})).filter((item)=>item.question&&item.answer);const contactEmail=String(fields.contactEmail||'').trim().toLowerCase();if(contactEmail&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)){status.textContent='Enter a valid contact email address or leave it blank.';return;}const nextAdmin={...admin,socialLinks:{facebook:String(fields.facebook||'').trim(),instagram:String(fields.instagram||'').trim(),tiktok:String(fields.tiktok||'').trim(),pinterest:String(fields.pinterest||'').trim(),youtube:String(fields.youtube||'').trim()},contactEmail,storyTitle:String(fields.storyTitle||'').trim()||'Our Story',storyBody:String(fields.storyBody||'').trim(),footerShippingPolicy:String(fields.footerShippingPolicy||'').trim(),featuredText:String(fields.featuredText||'').trim(),faqItems:nextFaq};const nextValue={...value,admin:nextAdmin};const saveButton=form.querySelector('button[type="submit"]');saveButton.disabled=true;status.textContent='Saving store content to the store…';try{if(!window.beadSupabase)throw new Error('The store database is unavailable.');const result=await patchAdminStoreSettings({config:nextConfig,admin:nextAdmin});if(!result)throw new Error('The store database rejected the content update.');clearAdminStoreSettingsCache();window.clearStorefrontSiteSettingsCache?.();const data=adminData();saveAdminData({...data,settings:{...(data.settings||{}),...nextAdmin}});window.siteContent={...nextAdmin};window.productStoreConfig={...(window.productStoreConfig||{}),...nextAdmin};window.applyStoreContent?.(window.siteContent);status.textContent='Store content saved to the store.';}catch(error){status.textContent='Store content was not saved to the store: '+(error.message||'Unknown error.')+' Try again.';}finally{saveButton.disabled=false;}});
};
const renderContactMessagesRecovered=async()=>{
  if(activeTab!=='contacts')return;
  if(!window.beadSupabase){panel.innerHTML='<div class="admin-empty">Contact messages require the connected store database.</div>';return;}
  // Keep the admin inbox bounded: the screen only needs the latest page of messages.
  // The exact count is retained for the pagination/status copy without downloading the archive.
  const result=await cloudAdmin().from('contact_messages').select('id,user_id,name,email,subject,message,status,admin_response,created_at,responded_at',{count:'exact'}).order('created_at',{ascending:false}).range(0,99);
  if(result.error)throw result.error;
  const messages=result.data||[];
  const totalMessageCount=Number(result.count)||messages.length;
  const state={tab:'open',query:'',page:1,pageSize:10};
  const render=()=>{
    const query=state.query.trim().toLowerCase();
    const filtered=messages.filter((message)=>{const closed=message.status==='closed';if(state.tab==='closed'&&!closed)return false;if(state.tab==='open'&&closed)return false;return !query||[message.name,message.email,message.subject,message.message,message.status].some((value)=>String(value||'').toLowerCase().includes(query));});
    const pageCount=Math.max(1,Math.ceil(filtered.length/state.pageSize));state.page=Math.min(Math.max(1,state.page),pageCount);const visible=filtered.slice((state.page-1)*state.pageSize,state.page*state.pageSize);
    const card=(message)=>`<article class="admin-card admin-contact-message" data-contact-message="${adminSafe(message.id)}"><div class="admin-heading"><div><h3>${adminSafe(message.subject)}</h3><p>${adminSafe(message.name)} · <a href="mailto:${adminSafe(message.email)}">${adminSafe(message.email)}</a> · ${adminSafe(message.created_at?new Date(message.created_at).toLocaleString():'Unknown date')}</p></div><strong>${adminSafe(message.status)}</strong></div><p class="admin-contact-message-body">${adminSafe(message.message)}</p>${message.admin_response?`<div class="admin-contact-response"><b>Response sent</b><p>${adminSafe(message.admin_response)}</p></div>`:''}${message.status!=='responded'&&message.status!=='closed'?`<form class="admin-form" data-contact-reply-form="${adminSafe(message.id)}"><label>Reply by email<textarea name="body" rows="5" required maxlength="10000"></textarea></label><div class="admin-actions"><button class="cta" type="submit">Send email reply</button><button type="button" data-contact-read="${adminSafe(message.id)}">Mark read</button></div><p data-contact-status role="status"></p></form>`:''}<div class="admin-actions">${message.status==='new'?`<button type="button" data-contact-read="${adminSafe(message.id)}">Mark read</button>`:''}${message.status!=='closed'?`<button type="button" data-contact-close="${adminSafe(message.id)}">Close message</button>`:''}</div></article>`;
    panel.querySelector('[data-contact-results]').innerHTML=visible.map(card).join('')||'<div class="admin-empty">No matching messages.</div>';
    panel.querySelector('[data-contact-page-status]').textContent=`Page ${state.page} of ${pageCount} · ${filtered.length} message${filtered.length===1?'':'s'}`;
    panel.querySelector('[data-contact-prev]').disabled=state.page===1;panel.querySelector('[data-contact-next]').disabled=state.page===pageCount;
    panel.querySelectorAll('[data-contact-tab]').forEach((button)=>{button.classList.toggle('active',button.dataset.contactTab===state.tab);button.setAttribute('aria-selected',String(button.dataset.contactTab===state.tab));});
    bindActions();
  };
  const bindActions=()=>{
    panel.querySelectorAll('[data-contact-reply-form]').forEach((form)=>form.addEventListener('submit',async(event)=>{event.preventDefault();const status=form.querySelector('[data-contact-status]');const button=form.querySelector('button[type="submit"]');const body=String(form.elements.body.value||'').trim();if(!body)return;button.disabled=true;status.textContent='Sending reply…';try{if(!window.sendAdminStoreEmail)throw new Error('The email sender is unavailable.');const result=await window.sendAdminStoreEmail({action:'contact_response',contactId:form.dataset.contactReplyForm,body});const savedReply=result?.alreadySent?String(messages.find((entry)=>entry.id===form.dataset.contactReplyForm)?.admin_response||body):body;status.textContent=result?.alreadySent?'Reply was already sent; saved its status without sending another email.':'Reply sent and saved.';const message=messages.find((entry)=>entry.id===form.dataset.contactReplyForm);if(message){message.admin_response=savedReply;message.status='responded';}render();}catch(error){const detail=error.message||'Unknown error.';status.textContent=detail.includes('reply was sent')||detail.includes('Reply was sent')?'Delivery may have succeeded, but could not be confirmed: '+detail:'Reply was not sent: '+detail;button.disabled=false;}}));
    panel.querySelectorAll('[data-contact-read]').forEach((button)=>button.addEventListener('click',async()=>{button.disabled=true;const update=await cloudAdmin().from('contact_messages').update({status:'read',updated_at:new Date().toISOString()}).eq('id',button.dataset.contactRead).neq('status','responded');if(update.error){button.disabled=false;return;}const message=messages.find((entry)=>entry.id===button.dataset.contactRead);if(message)message.status='read';render();}));
    panel.querySelectorAll('[data-contact-close]').forEach((button)=>button.addEventListener('click',async()=>{button.disabled=true;const update=await cloudAdmin().from('contact_messages').update({status:'closed',updated_at:new Date().toISOString()}).eq('id',button.dataset.contactClose);if(update.error){button.disabled=false;return;}const message=messages.find((entry)=>entry.id===button.dataset.contactClose);if(message)message.status='closed';render();}));
  };
  panel.innerHTML=`<div class="admin-heading"><div><p class="kicker">CUSTOMER COMMUNICATION</p><h2>Contact messages</h2><p>Account-linked messages stay with the customer record when available. Replies are sent through Resend and saved here for reference.</p></div></div><div class="admin-stat-summary">${messages.filter((message)=>message.status==='new').length} new message${messages.filter((message)=>message.status==='new').length===1?'':'s'} in the latest ${messages.length} loaded · ${totalMessageCount} total stored</div><p class="admin-muted">Showing the latest 100 messages to keep this screen fast. Use the search box to find a message in the loaded set.</p><div class="admin-contact-toolbar"><label>Search messages<input type="search" data-contact-search placeholder="Search name, email, subject, or message"></label><div class="admin-tabs" role="tablist"><button type="button" data-contact-tab="open" aria-selected="true">Open</button><button type="button" data-contact-tab="closed" aria-selected="false">Closed</button></div></div><div class="admin-contact-list" data-contact-results></div><div class="admin-pagination"><button type="button" data-contact-prev>Previous</button><span data-contact-page-status></span><button type="button" data-contact-next>Next</button></div>`;
  panel.querySelector('[data-contact-search]').addEventListener('input',(event)=>{state.query=event.target.value;state.page=1;render();});panel.querySelectorAll('[data-contact-tab]').forEach((button)=>button.addEventListener('click',()=>{state.tab=button.dataset.contactTab;state.page=1;render();}));panel.querySelector('[data-contact-prev]').addEventListener('click',()=>{state.page-=1;render();});panel.querySelector('[data-contact-next]').addEventListener('click',()=>{state.page+=1;render();});render();
};
const renderContactMessages=async()=>renderContactMessagesRecovered();
const withAdminTimeout=(request,label)=>{let timeout;return Promise.race([Promise.resolve(request),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error(label+' timed out. Retry this section; the rest of Store Control remains available.')),adminRequestTimeoutMs);})]).finally(()=>clearTimeout(timeout));};
const printAdminPackingSlip=(order)=>{const items=(order.order_items||[]).map((item)=>({...item,quantity:Math.max(0,Number(item.quantity||0)-Number(item.refunded_quantity||0))})).filter((item)=>item.quantity>0);const label=order.order_number?`BD-${String(order.order_number).padStart(6,'0')}`:String(order.id||'').slice(0,8).toUpperCase();const address=order.shipping_address&&typeof order.shipping_address==='object'?[order.shipping_address.address_line1||order.shipping_address.line1||order.shipping_address.address,order.shipping_address.address_line2||order.shipping_address.line2,[order.shipping_address.city,[order.shipping_address.state,order.shipping_address.postal_code].filter(Boolean).join(' ')].filter(Boolean).join(', '),order.shipping_address.country].filter(Boolean).join('\n'):String(order.shipping_address||'No shipping address');const slip=window.open('','_blank','width=800,height=900');if(!slip){alert('Allow pop-ups to print the packing slip.');return;}slip.document.open();slip.document.write(`<!doctype html><html><head><title>Packing slip ${adminSafe(label)}</title><style>body{font-family:Arial,sans-serif;color:#20152a;max-width:760px;margin:40px auto;padding:0 28px}h1{font-size:28px;margin:0 0 6px}h2{font-size:16px;margin:28px 0 10px;border-bottom:1px solid #ddd;padding-bottom:8px}.muted{color:#665e5b}.brand{letter-spacing:.18em;text-transform:uppercase;font-size:12px;font-weight:700;color:#6d315f}.row{display:flex;justify-content:space-between;gap:20px;padding:12px 0;border-bottom:1px solid #eee}.qty{font-weight:700;min-width:60px}.sku{color:#665e5b;font-size:13px;margin-top:4px}@media print{body{margin:0 auto;padding:0 18px}}</style></head><body><p class="brand">Bead Different Co.</p><h1>Packing slip</h1><p class="muted">Order ${adminSafe(label)} · ${adminSafe(order.created_at?new Date(order.created_at).toLocaleDateString():'')}</p><h2>Ship to</h2><p>${adminSafe(order.shipping_name||'Customer')}<br>${adminSafe(address).replace(/\n/g,'<br>')}</p><h2>Items</h2>${items.map((item)=>`<div class="row"><div><strong>${adminSafe(item.product_name||item.sku||'Item')}</strong><div class="sku">SKU: ${adminSafe(item.sku||'—')}</div></div><span class="qty">Qty ${item.quantity}</span></div>`).join('')||'<p>No remaining items on this order.</p>'}<p class="muted" style="margin-top:36px">Thank you for your order!</p><script>window.addEventListener('load',()=>{window.print();});</script></body></html>`);slip.document.close();};
const openAdminOrderModal=async(orderId)=>{
  if(!orderId||!window.beadSupabase)return;
  document.querySelector('[data-admin-order-modal]')?.remove();
  const root=document.createElement('div');root.className='admin-order-modal-backdrop';root.dataset.adminOrderModal='';root.innerHTML='<div class="admin-order-modal" role="dialog" aria-modal="true" aria-labelledby="admin-order-modal-title"><button type="button" class="admin-order-modal-close" data-close-admin-order aria-label="Close order">×</button><div data-admin-order-modal-body><div class="admin-empty">Loading order…</div></div></div>';
  document.body.append(root);const close=()=>root.remove();root.addEventListener('click',(event)=>{if(event.target===root||event.target.closest('[data-close-admin-order]'))close();});
  const [orderResult,eventsResult,notesResult,emailLogResult,supportResult,refundsResult]=await Promise.all([
    cloudAdmin().from('orders').select('id,user_id,order_number,status,total,subtotal,discount,shipping_amount,shipping_cost,refunded_amount,refunded_shipping_amount,tax_amount,shipping_name,shipping_address,customer_email,carrier,tracking_number,created_at,order_items(id,product_name,sku,quantity,refunded_quantity,unit_price)').eq('id',orderId).maybeSingle(),
    cloudAdmin().from('order_financial_events').select('created_at,event_type,quantity,amount,reason').eq('order_id',orderId).order('created_at',{ascending:false}).range(0,99),
    cloudAdmin().from('order_notes').select('note,created_at').eq('order_id',orderId).order('created_at',{ascending:false}).range(0,99),
    cloudAdmin().from('admin_email_log').select('recipient,subject,body,created_at').eq('order_id',orderId).order('created_at',{ascending:false}).range(0,99),
    cloudAdmin().from('order_support_requests').select('id,request_type,name,email,subject,message,priority,status,created_at').eq('order_id',orderId).order('created_at',{ascending:false}).range(0,99),
    cloudAdmin().from('stripe_refunds').select('stripe_refund_id,amount,status,reason,created_at,resolved_at').eq('order_id',orderId).order('created_at',{ascending:false}).range(0,99)
  ]);
  if(orderResult.error||!orderResult.data){root.querySelector('[data-admin-order-modal-body]').innerHTML='<div class="admin-empty">Unable to load this order.</div>';return;}
  const order=orderResult.data,items=order.order_items||[],events=eventsResult.data||[],refunds=refundsResult.data||[],orderNotes=notesResult.data||[],emailLogs=emailLogResult.data||[],supportRequests=supportResult.data||[],label=order.order_number?`BD-${String(order.order_number).padStart(6,'0')}`:String(order.id).slice(0,8).toUpperCase();
   const address=adminShippingAddressMarkup(order.shipping_address,order.shipping_name||'');
  const customerHref=order.user_id?`admin.html?member=${encodeURIComponent(order.user_id)}`:(order.customer_email?`admin.html?customer=${encodeURIComponent(order.customer_email)}`:'');
  const customerLabel=order.shipping_name||order.customer_email||'Guest';
  const money=(value)=>`$${Number(value||0).toFixed(2)}`;
   const stripeRefundLog=refunds.map((refund)=>`<div><time>${adminSafe(new Date(refund.created_at).toLocaleString())}</time><strong>Stripe refund ${adminSafe(String(refund.status||'pending').replaceAll('_',' '))} · ${money(refund.amount)}</strong><span>${adminSafe(refund.reason||'Stripe confirmation pending.')}</span></div>`).join('');
   root.querySelector('[data-admin-order-modal-body]').innerHTML=`<div class="admin-order-modal-heading"><div><p class="kicker">ORDER DETAILS</p><h2 id="admin-order-modal-title">${adminSafe(label)}</h2><p>${adminSafe(order.created_at?new Date(order.created_at).toLocaleString():'Unknown date')} · ${adminSafe(order.shipping_name||order.customer_email||'Guest')}</p></div><span class="admin-order-modal-status">${adminSafe(String(order.status||'pending').replaceAll('_',' '))}</span></div><div class="admin-order-modal-grid"><section class="admin-order-modal-section"><div class="admin-order-section-heading"><h3>Order lines</h3><span>Select quantities to return</span></div><div data-admin-return-lines>${items.map((item)=>{const eligible=Math.max(0,Number(item.quantity||0)-Number(item.refunded_quantity||0));return `<label class="admin-return-line"><input type="checkbox" data-return-line="${adminSafe(item.id)}" ${eligible?'':'disabled'}><span><strong>${adminSafe(item.product_name||item.sku||'Item')}</strong><small>SKU ${adminSafe(item.sku||'—')} · ${money(item.unit_price)} each · ${eligible} available to return</small></span><input type="number" min="1" max="${eligible}" value="${eligible?'1':'0'}" data-return-quantity="${adminSafe(item.id)}" ${eligible?'':'disabled'}></label>`;}).join('')||'<p class="admin-empty">No order lines.</p>'}</div><div class="admin-order-refund-actions"><button type="button" data-return-selected ${items.length?'':'disabled'}>Return selected lines</button><button type="button" data-return-all ${items.length?'':'disabled'}>Return entire order</button><label>Reason<input type="text" data-return-reason placeholder="Customer returned item, damaged, etc."></label></div><div class="admin-order-refund-actions"><label>Customer satisfaction refund<input type="number" min="0.01" max="${Math.max(0,Number(order.total||0)-Number(order.refunded_amount||0)).toFixed(2)}" step="0.01" data-satisfaction-amount placeholder="Amount"></label><label>Reason<input type="text" data-satisfaction-reason placeholder="Goodwill adjustment"></label><button type="button" data-satisfaction-refund>Issue satisfaction refund</button></div><p data-admin-order-action-status class="admin-action-status" role="status"></p></section><aside class="admin-order-modal-section admin-order-totals"><h3>Financial summary</h3><dl><div><dt>Subtotal</dt><dd>${money(order.subtotal)}</dd></div><div><dt>Discounts</dt><dd>−${money(order.discount)}</dd></div><div><dt>Shipping</dt><dd>${money(order.shipping_amount||order.shipping_cost)}</dd></div><div><dt>Tax</dt><dd>${money(order.tax_amount)}</dd></div><div><dt>Order total</dt><dd>${money(order.total)}</dd></div><div class="is-emphasis"><dt>Refunded</dt><dd>−${money(order.refunded_amount)}</dd></div><div class="is-emphasis"><dt>Remaining</dt><dd>${money(Math.max(0,Number(order.total||0)-Number(order.refunded_amount||0)))}</dd></div></dl><h3>Shipping</h3><p>${address}</p><p>${adminSafe(order.carrier||'Carrier pending')} ${adminSafe(order.tracking_number||'')}</p></aside></div><section class="admin-order-modal-section"><div class="admin-order-section-heading"><h3>Refund and return log</h3><button type="button" data-sync-stripe-refunds>Sync Stripe status</button></div><div class="admin-order-event-log">${stripeRefundLog}${events.map((event)=>`<div><time>${adminSafe(new Date(event.created_at).toLocaleString())}</time><strong>${adminSafe(String(event.event_type).replaceAll('_',' '))} ${event.quantity?`· ${event.quantity} item${event.quantity===1?'':'s'}`:''} · ${money(event.amount)}</strong><span>${adminSafe(event.reason||'No reason provided')}</span></div>`).join('')||(!stripeRefundLog?'<p class="admin-empty">No refunds or returns recorded.</p>':'')}</div></section>`;
  const customerLine=root.querySelector('.admin-order-modal-heading p:last-child');
  if(customerLine&&customerHref){customerLine.innerHTML=`${adminSafe(order.created_at?new Date(order.created_at).toLocaleString():'Unknown date')} · <button type="button" class="admin-customer-profile-link" data-admin-member-profile data-admin-member-id="${adminSafe(order.user_id||'')}" data-admin-member-email="${adminSafe(order.customer_email||'')}" data-admin-member-name="${adminSafe(customerLabel)}" title="Open customer profile">${adminSafe(customerLabel)}</button>`;}
  const printPackingSlipButton=document.createElement('button');printPackingSlipButton.type='button';printPackingSlipButton.className='admin-print-packing-slip';printPackingSlipButton.textContent='Print packing slip';printPackingSlipButton.addEventListener('click',()=>printAdminPackingSlip(order));root.querySelector('.admin-order-modal-heading > div')?.append(printPackingSlipButton);
  const body=root.querySelector('[data-admin-order-modal-body]'),status=body.querySelector('[data-admin-order-action-status]');
   body.querySelector('[data-sync-stripe-refunds]')?.addEventListener('click',async(event)=>{const button=event.currentTarget;button.disabled=true;status.textContent='Checking refund status with Stripe…';try{const response=await window.beadSupabase.functions.invoke('stripe-payments',{body:{action:'reconcile_order_refunds',order_id:order.id}});if(response.error){let detail=null;try{detail=await response.error.context?.json();}catch(error){}throw new Error(detail?.error||response.error.message||'Unable to check Stripe.');}if(response.data?.error)throw new Error(response.data.error);window.dispatchEvent(new CustomEvent('admin-order-changed',{detail:{orderId:order.id}}));await openAdminOrderModal(order.id);const refreshedStatus=root.querySelector('[data-admin-order-action-status]');if(refreshedStatus)refreshedStatus.textContent=`${response.data?.message||'Stripe status checked.'} ${Number(response.data?.synced||0)} updated; ${Number(response.data?.pending||0)} still pending; ${Number(response.data?.failed||0)} failed.`;}catch(error){status.textContent='Stripe status check failed: '+(error.message||'Unknown error.');button.disabled=false;}});
  const notesSection=document.createElement('section');notesSection.className='admin-order-modal-section admin-order-notes';notesSection.innerHTML='<div class="admin-order-section-heading"><h3>Order notes &amp; email history</h3><span>Shared across order support requests</span></div><div data-order-notes-list></div><form class="admin-order-note-form"><textarea name="note" rows="3" maxlength="10000" placeholder="Add an internal order note…" required></textarea><button type="submit" class="cta">Save order note</button><p data-order-note-status class="admin-action-status" role="status"></p></form>';body.append(notesSection);
  if(supportRequests.length){notesSection.insertAdjacentHTML('afterbegin',`<div class="admin-original-support-history"><div class="admin-order-section-heading"><h3>Customer requests</h3><span>Original notifications</span></div>${supportRequests.map((request)=>`<div class="admin-original-support-entry"><time>${adminSafe(new Date(request.created_at).toLocaleString())}</time><div><strong>${adminSafe(request.request_type==='cancellation'?'Cancellation request':'Reported issue')}</strong><span>${adminSafe(request.subject||'Customer request')}</span></div><button type="button" data-open-original-request="${adminSafe(request.id)}">View original request</button></div>`).join('')}</div>`);notesSection.querySelectorAll('[data-open-original-request]').forEach((button)=>button.addEventListener('click',()=>{const request=supportRequests.find((entry)=>entry.id===button.dataset.openOriginalRequest);if(!request)return;const dialog=document.createElement('dialog');dialog.className='admin-original-request-dialog';dialog.innerHTML=`<button type="button" class="admin-dialog-close" data-close-original-request aria-label="Close">×</button><p class="kicker">${adminSafe(request.priority||'high')} priority · ${adminSafe(request.request_type==='cancellation'?'Cancellation request':'Reported issue')}</p><h3>${adminSafe(request.subject||'Customer request')}</h3><p class="admin-original-request-meta">${adminSafe(request.name||'Customer')} · ${adminSafe(request.email||'No email')} · ${adminSafe(new Date(request.created_at).toLocaleString())}</p><div class="admin-original-request-message">${adminSafe(request.message||'No message provided.')}</div><p class="admin-original-request-status">Status: ${adminSafe(String(request.status||'new').replaceAll('_',' '))}</p>`;document.body.append(dialog);dialog.querySelector('[data-close-original-request]').addEventListener('click',()=>{dialog.close();dialog.remove();});dialog.addEventListener('click',(event)=>{if(event.target===dialog){dialog.close();dialog.remove();}});dialog.addEventListener('cancel',(event)=>{event.preventDefault();dialog.close();dialog.remove();});dialog.showModal();}));}
  const notesList=notesSection.querySelector('[data-order-notes-list]');const renderOrderNotes=()=>{const notesMarkup=orderNotes.map((note)=>`<div class="admin-order-note"><time>${adminSafe(new Date(note.created_at).toLocaleString())}</time><p>${adminSafe(note.note)}</p></div>`).join('');const emailMarkup=emailLogs.map((email)=>`<div class="admin-order-note admin-order-email-log"><time>${adminSafe(new Date(email.created_at).toLocaleString())}</time><p><strong>Email sent to ${adminSafe(email.recipient)}</strong><br>${adminSafe(email.subject)}</p><details><summary>View copy</summary><pre>${adminSafe(email.body)}</pre></details></div>`).join('');notesList.innerHTML=notesMarkup+emailMarkup||( '<p class="admin-empty">No order notes or sent emails yet.</p>');};renderOrderNotes();notesSection.querySelector('form').addEventListener('submit',async(event)=>{event.preventDefault();const form=event.currentTarget,field=form.elements.note,note=String(field.value||'').trim(),noteStatus=form.querySelector('[data-order-note-status]'),button=form.querySelector('button[type="submit"]');if(!note)return;button.disabled=true;noteStatus.textContent='Saving…';const result=await cloudAdmin().rpc('add_order_note',{order_id_value:order.id,note_value:note});if(result.error){noteStatus.textContent='Note was not saved: '+result.error.message;button.disabled=false;return;}if(result.data)orderNotes.unshift(result.data);field.value='';noteStatus.textContent='Order note saved.';button.disabled=false;renderOrderNotes();});
  const returnActions=body.querySelector('[data-return-selected]')?.parentElement;
  if(returnActions){returnActions.querySelector('[data-return-selected]').textContent='Select all available lines';returnActions.querySelector('[data-return-all]').textContent='Select entire order';const shippingLabel=document.createElement('label');shippingLabel.className='admin-checkbox-label';shippingLabel.innerHTML='<input type="checkbox" data-return-shipping> Include shipping';returnActions.append(shippingLabel);const previewBox=document.createElement('div');previewBox.className='admin-return-preview';previewBox.dataset.returnPreview='';previewBox.innerHTML='<strong>Refund preview</strong><span>Select lines and quantities to calculate the refund. Nothing has been processed.</span>';returnActions.after(previewBox);const confirmRow=document.createElement('div');confirmRow.className='admin-order-refund-actions';confirmRow.innerHTML='<button type="button" class="cta" data-confirm-return disabled>Confirm return &amp; issue refund</button><span class="admin-stripe-handoff-note">Stripe refunds stay pending until Stripe confirms them; inventory is unchanged while pending.</span>';previewBox.after(confirmRow);}
  const selectedLines=(all=false)=>items.map((item)=>{const eligible=Math.max(0,Number(item.quantity||0)-Number(item.refunded_quantity||0));const checked=all||body.querySelector(`[data-return-line="${CSS.escape(item.id)}"]`)?.checked;const quantity=all?eligible:Number(body.querySelector(`[data-return-quantity="${CSS.escape(item.id)}"]`)?.value||0);return checked&&quantity>0?{item_id:item.id,quantity}:null;}).filter(Boolean);
  const shippingRemaining=()=>Math.max(0,Math.round((Number(order.shipping_amount||order.shipping_cost||0)-Number(order.refunded_shipping_amount||0))*100)/100);
   const remainingOrderBalance=()=>Math.max(0,Math.round((Number(order.total||0)-Number(order.refunded_amount||0))*100)/100);
   const estimate=(selected,includeShipping=false)=>{const subtotal=Number(order.subtotal||0),discount=Number(order.discount||0),tax=Number(order.tax_amount||0),discountedSubtotal=Math.max(0,subtotal-discount);let total=selected.reduce((sum,line)=>{const item=items.find((entry)=>entry.id===line.item_id);const gross=Number(item?.unit_price||0)*line.quantity;const lineDiscount=subtotal>0?discount*gross/subtotal:0;const lineTax=discountedSubtotal>0?tax*Math.max(0,gross-lineDiscount)/discountedSubtotal:0;return sum+Math.max(0,gross-lineDiscount+lineTax);},0);if(includeShipping)total+=shippingRemaining();return Math.min(remainingOrderBalance(),Math.round(total*100)/100);};
  const preview=()=>{const selected=selectedLines();const includeShipping=Boolean(body.querySelector('[data-return-shipping]')?.checked);const shipping=shippingRemaining();const amount=estimate(selected,includeShipping);const shippingOnly=!selected.length&&includeShipping&&shipping>0;const target=body.querySelector('[data-return-preview]');if(target)target.innerHTML=selected.length?`<strong>Refund preview</strong><span>${selected.reduce((sum,line)=>sum+line.quantity,0)} item${selected.reduce((sum,line)=>sum+line.quantity,0)===1?'':'s'} selected${includeShipping&&shipping>0?' + shipping':''} · estimated refund <b>${money(amount)}</b></span>`:shippingOnly?`<strong>Refund preview</strong><span>Shipping only · estimated refund <b>${money(shipping)}</b>. Nothing has been processed.</span>`:'<strong>Refund preview</strong><span>Select lines or refundable shipping to calculate the refund. Nothing has been processed.</span>';const confirmButton=body.querySelector('[data-confirm-return]');if(confirmButton)confirmButton.disabled=(!selected.length&&!shippingOnly)||amount<=0;};
   const refundRequestIds=new Map();
   const invokeStripeRefund=async(body)=>{const key=JSON.stringify(body);const requestId=refundRequestIds.get(key)||crypto.randomUUID();refundRequestIds.set(key,requestId);const response=await window.beadSupabase.functions.invoke('stripe-payments',{body:{...body,request_id:requestId}});if(response.error){let detail=null;try{detail=await response.error.context?.json();}catch(error){}throw new Error(detail?.error||response.error.message||'Refund failed.');}if(response.data?.error)throw new Error(response.data.error);refundRequestIds.delete(key);return response.data||{};};
   const confirmReturn=async()=>{const selected=selectedLines();const includeShipping=Boolean(body.querySelector('[data-return-shipping]')?.checked);const shipping=shippingRemaining();const reason=body.querySelector('[data-return-reason]').value.trim();const amount=estimate(selected,includeShipping);if(!selected.length&&!(includeShipping&&shipping>0)){status.textContent='Select a return line or choose refundable shipping.';return;}if(!reason){status.textContent='Add a reason so the return is auditable.';return;}if(!confirm(`Submit return and refund ${money(amount)}? Inventory changes only after Stripe confirms the refund.`))return;status.textContent='Submitting refund to Stripe…';let result;try{result=await invokeStripeRefund({action:'refund_return',order_id:order.id,line_items:selected,refund_shipping:includeShipping,reason});}catch(error){status.textContent='Refund failed: '+(error.message||'Unknown refund error.');return;}if(result.status==='pending'){status.textContent=`Refund submitted to Stripe: ${money(result.refund_amount||amount)}. Inventory remains unchanged until Stripe confirms it.`;window.dispatchEvent(new CustomEvent('admin-order-changed',{detail:{orderId:order.id}}));setTimeout(()=>openAdminOrderModal(order.id),700);return;}status.textContent=`Refund recorded: ${money(result.refund_amount)}.${result.receipt_email_status==='sent'?' The customer receipt was emailed.':' The refund is confirmed, but the customer receipt email failed; no second refund was submitted.'}`;window.dispatchEvent(new CustomEvent('admin-order-changed',{detail:{orderId:order.id}}));setTimeout(()=>openAdminOrderModal(order.id),700);};
  body.querySelector('[data-return-selected]')?.addEventListener('click',()=>{body.querySelectorAll('[data-return-line]').forEach((input)=>{input.checked=!input.disabled;});preview();});body.querySelector('[data-return-all]')?.addEventListener('click',()=>{body.querySelectorAll('[data-return-line]').forEach((input)=>{input.checked=!input.disabled;const quantity=body.querySelector(`[data-return-quantity="${CSS.escape(input.dataset.returnLine)}"]`);if(quantity)quantity.value=quantity.max;});body.querySelector('[data-return-shipping]').checked=true;preview();});body.querySelectorAll('[data-return-line],[data-return-quantity],[data-return-shipping]').forEach((input)=>input.addEventListener('input',preview));body.querySelector('[data-confirm-return]')?.addEventListener('click',()=>void confirmReturn());body.querySelector('[data-satisfaction-refund]')?.addEventListener('click',async()=>{const amount=Number(body.querySelector('[data-satisfaction-amount]').value||0),reason=body.querySelector('[data-satisfaction-reason]').value.trim();if(!amount||!reason){status.textContent='Enter an amount and reason for the customer satisfaction refund.';return;}status.textContent='Submitting refund to Stripe…';let result;try{result=await invokeStripeRefund({action:'refund_order',refund_kind:'satisfaction',order_id:order.id,amount,full:false,reason});}catch(error){status.textContent='Refund failed: '+(error.message||'Unknown refund error.');return;}if(result.status==='pending'){status.textContent=`Refund submitted to Stripe: ${money(result.refund_amount||amount)}. Inventory and order totals remain unchanged until Stripe confirms it.`;window.dispatchEvent(new CustomEvent('admin-order-changed',{detail:{orderId:order.id}}));setTimeout(()=>openAdminOrderModal(order.id),500);return;}status.textContent=`Refund recorded: ${money(result.refund_amount)}.${result.receipt_email_status==='sent'?' The customer receipt was emailed.':' The refund is confirmed, but the customer receipt email failed; no second refund was submitted.'}`;window.dispatchEvent(new CustomEvent('admin-order-changed',{detail:{orderId:order.id}}));setTimeout(()=>openAdminOrderModal(order.id),500);});preview();
};
const openAdminMemberDashboard=async({id='',email='',name='Customer'}={})=>{const dialog=document.createElement('dialog');dialog.className='profile-dialog admin-review-member-dialog';dialog.innerHTML='<button type="button" class="profile-dialog-close" data-close-admin-member aria-label="Close profile">×</button><p class="kicker">MEMBER PROFILE</p><p class="admin-member-record-status" role="status">Loading member dashboard…</p>';document.body.append(dialog);const close=()=>{if(dialog.open)dialog.close();dialog.remove();};dialog.querySelector('[data-close-admin-member]').onclick=close;dialog.addEventListener('cancel',(event)=>{event.preventDefault();close();});dialog.addEventListener('click',(event)=>{if(event.target===dialog)close();});dialog.showModal();try{let profile=null;let profileResult=null;if(id)profileResult=await cloudAdmin().from('profiles').select('id,email,full_name,status,created_at').eq('id',id).maybeSingle();else if(email)profileResult=await cloudAdmin().from('profiles').select('id,email,full_name,status,created_at').ilike('email',email.trim()).maybeSingle();if(profileResult?.error)throw profileResult.error;profile=profileResult?.data||null;const effectiveId=profile?.id||'';const customerEmail=String(profile?.email||email||'').trim().toLowerCase();let ordersResult,notesResult,reviewsResult={data:[],count:0};if(effectiveId){[ordersResult,notesResult,reviewsResult]=await Promise.all([cloudAdmin().from('orders').select('id,order_number,status,payment_status,refunded_amount,total,created_at,tracking_number,order_items(product_name,sku,quantity,unit_price)',{count:'exact'}).eq('user_id',effectiveId).order('created_at',{ascending:false}).range(0,99),cloudAdmin().from('member_notes').select('id,note,created_at',{count:'exact'}).eq('member_id',effectiveId).order('created_at',{ascending:false}).range(0,99),cloudAdmin().from('reviews').select('id,review_type,rating,body,created_at,products(name)',{count:'exact'}).eq('user_id',effectiveId).order('created_at',{ascending:false}).range(0,99)]);}else{ordersResult=await cloudAdmin().from('orders').select('id,order_number,status,payment_status,refunded_amount,total,created_at,tracking_number,customer_email,order_items(product_name,sku,quantity,unit_price)',{count:'exact'}).ilike('customer_email',customerEmail).order('created_at',{ascending:false}).range(0,99);const orderIds=(ordersResult.data||[]).map((order)=>order.id);notesResult=orderIds.length?await cloudAdmin().from('order_notes').select('id,note,created_at',{count:'exact'}).in('order_id',orderIds).order('created_at',{ascending:false}).range(0,99):{data:[],count:0};}if(ordersResult?.error||notesResult?.error||reviewsResult?.error)throw ordersResult?.error||notesResult?.error||reviewsResult?.error;const orders=ordersResult.data||[],notes=notesResult.data||[],reviews=reviewsResult.data||[],orderCount=Number(ordersResult.count)||orders.length,noteCount=Number(notesResult.count)||notes.length,reviewCount=Number(reviewsResult.count)||reviews.length,historyCapNote=[orderCount>orders.length,noteCount>notes.length,reviewCount>reviews.length].some(Boolean)?' Showing the latest 100 records in each section.':'',displayName=profile?.full_name||name||profile?.email||customerEmail||'Customer',totalSpent=orders.filter((order)=>['paid','partially_refunded','refunded'].includes(String(order.payment_status||'').toLowerCase())).reduce((sum,order)=>sum+Math.max(0,(Number(order.total)||0)-(Number(order.refunded_amount)||0)),0);const status=dialog.querySelector('.admin-member-record-status');if(status)status.remove();dialog.insertAdjacentHTML('beforeend',`<div class="admin-member-profile-heading"><div><h3>${adminSafe(displayName)}</h3><p>${adminSafe(customerEmail||'Not available')}</p></div>${customerEmail?`<button type="button" class="admin-member-email-button" data-admin-email data-email-to="${adminSafe(customerEmail)}" data-email-name="${adminSafe(displayName)}" data-email-subject="Message from Bead Different Co.">Send message</button>`:''}</div><dl class="admin-review-member-profile"><div><dt>Member since</dt><dd>${adminSafe(profile?.created_at?new Date(profile.created_at).toLocaleDateString():'Temporary email record')}</dd></div><div><dt>Status</dt><dd>${adminSafe(profile?.status||'temporary')}</dd></div></dl><p class="admin-member-history-note">${adminSafe(historyCapNote)}</p><div class="admin-member-dashboard"><button type="button" class="admin-member-stat active" data-admin-member-section="orders"><span>Orders</span><strong>${orderCount}</strong></button><div class="admin-member-stat admin-member-stat-total"><span>Total spent${historyCapNote?' (latest 100)':''}</span><strong>${totalSpent.toFixed(2)}</strong></div><button type="button" class="admin-member-stat" data-admin-member-section="notes"><span>Notes</span><strong>${noteCount}</strong></button><button type="button" class="admin-member-stat" data-admin-member-section="reviews"><span>Reviews</span><strong>${reviewCount}</strong></button></div><section class="admin-member-drilldown" data-admin-member-drilldown></section>`);const drilldown=dialog.querySelector('[data-admin-member-drilldown]');const sectionRows=(section)=>section==='orders'?orders:section==='notes'?notes:reviews;const renderSection=(section)=>{const rows=sectionRows(section);const title=section==='orders'?'Orders':section==='notes'?'Notes':'Reviews';const markup=section==='orders'?rows.map((order)=>`<a class="admin-member-order-row" href="admin.html?order=${encodeURIComponent(order.id)}"><span class="admin-member-order-summary"><strong>Order ${adminSafe(order.order_number?`BD-${String(order.order_number).padStart(6,'0')}`:String(order.id).slice(0,8))}</strong><small>${adminSafe(String(order.status||'unknown').replaceAll('_',' '))} · ${adminSafe(order.created_at?new Date(order.created_at).toLocaleDateString():'Unknown date')}</small></span><span class="admin-member-order-total"><strong>$${Number(order.total||0).toFixed(2)}</strong></span><span class="admin-member-order-open">View order&nbsp;›</span></a>`).join(''):section==='notes'?rows.map((note)=>`<article class="admin-member-record-item"><div class="admin-member-record-heading"><strong>Private note</strong><span>${adminSafe(note.created_at?new Date(note.created_at).toLocaleString():'Unknown date')}</span></div><p>${adminSafe(note.note||'')}</p></article>`).join(''):rows.map((review)=>`<article class="admin-member-record-item"><div class="admin-member-record-heading"><strong>${adminSafe(review.products?.name||'Website review')}</strong><span>${Number(review.rating||0)}/5 · ${adminSafe(review.created_at?new Date(review.created_at).toLocaleDateString():'Unknown date')}</span></div><p>${adminSafe(window.decodeReviewText(review.body||''))}</p><a class="admin-member-canonical-link" href="admin.html?review=${encodeURIComponent(review.id)}">View review</a></article>`).join('');drilldown.innerHTML=`<div class="admin-member-drilldown-header"><h4>${title}</h4><span>${section==='orders'?orderCount:section==='notes'?noteCount:reviewCount} total · latest ${rows.length}</span></div><div class="admin-member-record-list">${markup||`<p class="admin-member-empty">No ${title.toLowerCase()} yet.</p>`}</div>`;};dialog.querySelectorAll('[data-admin-member-section]').forEach((button)=>button.onclick=()=>{dialog.querySelectorAll('[data-admin-member-section]').forEach((entry)=>entry.classList.toggle('active',entry===button));renderSection(button.dataset.adminMemberSection);});renderSection('orders');}catch(error){const status=dialog.querySelector('.admin-member-record-status');if(status)status.textContent='Unable to load the customer dashboard: '+(error.message||'Unknown error.');}};
const decorateSupportCustomerLinks=(root,requests)=>{root.querySelectorAll('.admin-order-support-request').forEach((article)=>{const field=article.querySelector('[data-order-support-note-entry]');const request=requests.find((entry)=>entry.id===field?.dataset.orderSupportNoteEntry);const linked=request?.orders||{};const email=String(request?.email||linked.customer_email||'').trim();const name=String(request?.name||linked.shipping_name||'Customer').trim();const line=article.querySelector('.admin-support-card-top > div > p:not(.kicker)');if(!line||line.dataset.profileLinkReady)return;line.dataset.profileLinkReady='true';line.innerHTML=email?`<button type="button" class="admin-customer-profile-link" data-admin-member-profile data-admin-member-email="${adminSafe(email)}" data-admin-member-name="${adminSafe(name)}">${adminSafe(name)} · ${adminSafe(email)}</button>`:`${adminSafe(name)} · ${adminSafe(email)}`;});};
const setupSupportBuckets=(root)=>{const toolbar=root.querySelector('.admin-request-toolbar');const list=root.querySelector('[data-order-support-list]');if(!toolbar||!list||toolbar.dataset.bucketsReady)return;toolbar.dataset.bucketsReady='true';const typeLabel=toolbar.querySelector('[data-request-type]')?.closest('label');const statusLabel=toolbar.querySelector('[data-request-status]')?.closest('label');if(typeLabel)typeLabel.hidden=true;if(statusLabel)statusLabel.hidden=true;const searchLabel=toolbar.querySelector('[data-request-search]')?.closest('label');if(searchLabel)toolbar.prepend(searchLabel);const bucketNav=document.createElement('nav');bucketNav.className='admin-request-buckets';bucketNav.setAttribute('aria-label','Order request status');bucketNav.innerHTML='<button type="button" data-request-bucket="new">New <strong></strong></button><button type="button" data-request-bucket="in_progress">In Progress <strong></strong></button><button type="button" data-request-bucket="closed">Closed</button>';toolbar.insertAdjacentElement('afterend',bucketNav);const pagination=document.createElement('div');pagination.className='admin-request-pagination';pagination.innerHTML='<button type="button" data-request-page="prev">Previous</button><span data-request-page-status></span><button type="button" data-request-page="next">Next</button>';list.insertAdjacentElement('afterend',pagination);let bucket='new';const pages={new:1,in_progress:1,closed:1};const pageSize=10;const apply=()=>{const articles=[...list.querySelectorAll('.admin-order-support-request')];const statusOf=(article)=>{const status=article.querySelector('.admin-request-status');return status?.className.match(/admin-request-status-([^\s]+)/)?.[1]||'';};const visible=articles.filter((article)=>bucket==='closed'?['resolved','declined'].includes(statusOf(article)):statusOf(article)===bucket);const pageCount=Math.max(1,Math.ceil(visible.length/pageSize));pages[bucket]=Math.min(Math.max(1,pages[bucket]),pageCount);articles.forEach((article)=>{article.hidden=true;});visible.slice((pages[bucket]-1)*pageSize,pages[bucket]*pageSize).forEach((article)=>{article.hidden=false;});bucketNav.querySelectorAll('[data-request-bucket]').forEach((button)=>button.classList.toggle('active',button.dataset.requestBucket===bucket));pagination.querySelector('[data-request-page="prev"]').disabled=pages[bucket]<=1;pagination.querySelector('[data-request-page="next"]').disabled=pages[bucket]>=pageCount;pagination.querySelector('[data-request-page-status]').textContent=`Page ${pages[bucket]} of ${pageCount}`;};const redraw=()=>{const statusSelect=root.querySelector('[data-request-status]');if(statusSelect)statusSelect.value=bucket==='closed'?'all':bucket;root.querySelector('[data-request-type]')?.dispatchEvent(new Event('change'));};bucketNav.querySelectorAll('[data-request-bucket]').forEach((button)=>button.addEventListener('click',()=>{bucket=button.dataset.requestBucket;pages[bucket]=1;redraw();apply();}));pagination.querySelector('[data-request-page="prev"]').addEventListener('click',()=>{pages[bucket]-=1;apply();});pagination.querySelector('[data-request-page="next"]').addEventListener('click',()=>{pages[bucket]+=1;apply();});const countNew=()=>{const counts={new:0,in_progress:0};root.querySelectorAll('.admin-order-support-request').forEach((article)=>{const status=statusOf(article);if(status in counts)counts[status]+=1;});bucketNav.querySelector('[data-request-bucket="new"] strong').textContent=counts.new;bucketNav.querySelector('[data-request-bucket="in_progress"] strong').textContent=counts.in_progress;};const observer=new MutationObserver(()=>{countNew();apply();});observer.observe(list,{childList:true,subtree:true});countNew();apply();};const supportBucketObserver=new MutationObserver(()=>setupSupportBuckets(panel));supportBucketObserver.observe(panel,{childList:true,subtree:true});
const paginateAdminMemberOrders=(dialog)=>{const drilldown=dialog?.querySelector('[data-admin-member-drilldown]');if(!drilldown||drilldown.dataset.paginationReady)return;drilldown.dataset.paginationReady='true';let page=1,signature='';const refresh=()=>{const rows=[...drilldown.querySelectorAll('.admin-member-order-row')],nextSignature=rows.map((row)=>row.getAttribute('href')||'').join('|');if(nextSignature===signature&&!drilldown.querySelector('[data-admin-member-order-pagination]'))return;signature=nextSignature;const pageCount=Math.max(1,Math.ceil(rows.length/5));page=Math.min(page,pageCount);rows.forEach((row,index)=>{row.hidden=index<((page-1)*5)||index>=(page*5);});let pager=drilldown.querySelector('[data-admin-member-order-pagination]');if(!rows.length){pager?.remove();return;}if(!pager){pager=document.createElement('div');pager.dataset.adminMemberOrderPagination='';pager.className='admin-member-pagination';drilldown.append(pager);}pager.innerHTML=`<button type="button" data-member-order-page="prev" ${page<=1?'disabled':''}>Previous</button><span>Page ${page} of ${pageCount}</span><button type="button" data-member-order-page="next" ${page>=pageCount?'disabled':''}>Next</button>`;pager.querySelector('[data-member-order-page="prev"]').onclick=()=>{page=Math.max(1,page-1);signature='';refresh();};pager.querySelector('[data-member-order-page="next"]').onclick=()=>{page=Math.min(pageCount,page+1);signature='';refresh();};};const observer=new MutationObserver(refresh);observer.observe(drilldown,{childList:true,subtree:true});dialog.addEventListener('close',()=>observer.disconnect(),{once:true});refresh();};
document.addEventListener('click',(event)=>{const button=event.target.closest('[data-admin-member-profile]');if(!button)return;event.preventDefault();void openAdminMemberDashboard({id:button.dataset.adminMemberId||'',email:button.dataset.adminMemberEmail||'',name:button.dataset.adminMemberName||'Customer'}).then(()=>{const dialogs=[...document.querySelectorAll('.admin-review-member-dialog')];paginateAdminMemberOrders(dialogs.at(-1));});});
const statusOf=(article)=>article.querySelector('.admin-request-status')?.className.match(/admin-request-status-([^\s]+)/)?.[1]||'';
const supportBucketStatusObserver=new MutationObserver(()=>{const toolbar=panel.querySelector('.admin-request-toolbar');const statusSelect=panel.querySelector('[data-request-status]');const typeSelect=panel.querySelector('[data-request-type]');if(toolbar&&statusSelect&&typeSelect&&!toolbar.dataset.allBucketStatusReady){toolbar.dataset.allBucketStatusReady='true';statusSelect.value='all';typeSelect.dispatchEvent(new Event('change'));}});supportBucketStatusObserver.observe(panel,{childList:true,subtree:true});
panel.addEventListener('click',(event)=>{if(!event.target.closest('[data-request-bucket]'))return;window.setTimeout(()=>{const statusSelect=panel.querySelector('[data-request-status]');const typeSelect=panel.querySelector('[data-request-type]');if(statusSelect&&typeSelect){statusSelect.value='all';typeSelect.dispatchEvent(new Event('change'));}},0);});
const renderOrderSupportRequests=async(type)=>{
  if(activeTab!=='order-requests'&&activeTab!=='order-cancellations'&&activeTab!=='order-issues')return;
  if(!window.beadSupabase){panel.innerHTML='<div class="admin-empty">Order support queues require the connected store database.</div>';return;}
  let requestQuery=cloudAdmin().from('order_support_requests').select('id,order_id,order_number,request_type,name,email,subject,message,priority,status,admin_notes,admin_response,responded_at,created_at,updated_at,orders(id,order_number,status,total,customer_email,shipping_name)',{count:'exact'}).order('created_at',{ascending:false}).range(0,99);
  if(type!=='all')requestQuery=requestQuery.eq('request_type',type);
  const result=await requestQuery;if(result.error)throw result.error;const requests=result.data||[],requestTotal=Number(result.count)||requests.length;
  const eventResult=requests.length?await cloudAdmin().from('order_support_request_events').select('request_id,event_type,body,created_at').in('request_id',requests.map((request)=>request.id)).order('created_at',{ascending:false}).range(0,499):{data:[]};const events=eventResult.data||[];const orderIds=[...new Set(requests.map((request)=>request.order_id).filter(Boolean))];const orderNotesResult=orderIds.length?await cloudAdmin().from('order_notes').select('id,order_id,note,created_at').in('order_id',orderIds).order('created_at',{ascending:false}).range(0,499):{data:[]};const orderNotes=orderNotesResult.data||[];const financialResult=orderIds.length?await cloudAdmin().from('order_financial_events').select('id,order_id,event_type,quantity,amount,reason,created_at').in('order_id',orderIds).order('created_at',{ascending:false}).range(0,499):{data:[]};const financialEvents=financialResult.data||[];const emailLogResult=orderIds.length?await cloudAdmin().from('admin_email_log').select('id,order_id,request_id,recipient,subject,created_at').or(`order_id.in.(${orderIds.join(',')}),request_id.in.(${requests.map((request)=>request.id).join(',')})`).order('created_at',{ascending:false}).range(0,499):{data:[]};const emailLogs=emailLogResult.data||[];
panel.innerHTML=`<div class="admin-heading"><div><p class="kicker">PRIORITY ORDER SUPPORT</p><h2>Order Issues/Cancels</h2><p>Cancellation requests and order issues live here, tied to the customer and the exact order. Use the order modal for returns, refunds, inventory, and the financial audit.</p><p class="admin-field-note">Showing the latest ${requests.length} of ${requestTotal} requests to keep this queue fast.</p></div></div><div class="admin-request-toolbar"><label>Request type<select data-request-type><option value="all">All request types</option><option value="cancellation">Cancellations</option><option value="issue">Reported issues</option></select></label><label>Status<select data-request-status><option value="open">Open only</option><option value="new">New</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option><option value="declined">Declined</option><option value="all">All statuses</option></select></label><label>Search<input type="search" data-request-search placeholder="Order, name, email, message"></label></div><div class="admin-request-columns"><section><div class="admin-section-label">Request queue</div><div data-order-support-list></div></section><aside class="admin-request-side"><div class="admin-section-label">Handling guide</div><p>Keep customer-facing replies in email. Use notes for internal decisions and keep the request status current.</p><ul><li><b>New</b> needs an owner.</li><li><b>In progress</b> means someone is actively handling it.</li><li><b>Resolved</b> or <b>Declined</b> closes the request with an audit trail.</li></ul></aside></div>`;
  panel.querySelector('[data-request-type]').value=type==='all'?'all':type;
  const historyFor=(request)=>[
    ...events.filter((event)=>event.request_id===request.id).map((event)=>({id:`event-${event.created_at}-${event.event_type}`,created_at:event.created_at,event_type:String(event.event_type||'activity'),body:event.body||''})),
    ...orderNotes.filter((note)=>note.order_id===request.order_id).map((note)=>({id:`note-${note.id}`,created_at:note.created_at,event_type:'Order note',body:note.note||''})),
    ...emailLogs.filter((log)=>log.request_id===request.id||log.order_id===request.order_id).map((log)=>({id:`email-${log.id}`,created_at:log.created_at,event_type:`Email sent to ${log.recipient||''}`,body:log.subject||''})),
    ...financialEvents.filter((event)=>event.order_id===request.order_id).map((event)=>({id:`financial-${event.id}`,created_at:event.created_at,event_type:`Order activity: ${String(event.event_type||'adjustment').replaceAll('_',' ')}${event.quantity?` · ${event.quantity} item${event.quantity===1?'':'s'}`:''} · $${Number(event.amount||0).toFixed(2)}`,body:event.reason||''}))
  ].sort((left,right)=>(Date.parse(right.created_at||'')||0)-(Date.parse(left.created_at||'')||0)||String(right.id).localeCompare(String(left.id)));
  const draw=()=>{const kind=panel.querySelector('[data-request-type]').value,filterStatus=panel.querySelector('[data-request-status]').value,query=panel.querySelector('[data-request-search]').value.trim().toLowerCase();const filtered=requests.filter((request)=>{if(kind!=='all'&&request.request_type!==kind)return false;if(filterStatus==='open'&&!['new','in_progress'].includes(request.status))return false;if(!['open','all'].includes(filterStatus)&&request.status!==filterStatus)return false;return !query||[request.order_number,request.name,request.email,request.subject,request.message].join(' ').toLowerCase().includes(query);});panel.querySelector('[data-order-support-list]').innerHTML=filtered.map((request)=>{const linked=request.orders||{};const orderId=linked.id||request.order_id||'';const requestEvents=historyFor(request);return `<article class="admin-card admin-order-support-request"><div class="admin-support-card-top"><div><p class="kicker">${adminSafe(request.priority||'high')} priority · ${adminSafe(request.request_type==='cancellation'?'Cancellation':'Reported issue')}</p><h3>${adminSafe(request.subject)}</h3><p>${adminSafe(request.name)} · <a href="mailto:${adminSafe(request.email)}">${adminSafe(request.email)}</a></p></div><span class="admin-request-status admin-request-status-${adminSafe(request.status)}">${adminSafe(String(request.status).replace('_',' '))}</span></div><div class="admin-order-support-linked-order"><strong>Linked order</strong><span>${adminSafe(request.order_number)} · ${adminSafe(linked.status||'Unknown status')} · ${linked.total==null?'—':`$${Number(linked.total).toFixed(2)}`}</span>${orderId?`<button type="button" data-open-admin-order="${adminSafe(orderId)}">Open order</button>`:''}</div><p class="admin-request-message">${adminSafe(request.message)}</p><div class="admin-request-controls"><label>Status<select data-order-support-status="${adminSafe(request.id)}"><option value="new" ${request.status==='new'?'selected':''}>New</option><option value="in_progress" ${request.status==='in_progress'?'selected':''}>In progress</option><option value="resolved" ${request.status==='resolved'?'selected':''}>Resolved</option><option value="declined" ${request.status==='declined'?'selected':''}>Declined</option></select></label><button type="button" data-admin-email data-email-to="${adminSafe(request.email||'')}" data-email-name="${adminSafe(request.name||'')}" data-email-subject="${adminSafe(`Re: ${request.subject||`Order ${request.order_number}`}`)}">Email customer</button></div><div class="admin-request-note-entry"><textarea data-order-support-note-entry="${adminSafe(request.id)}" rows="2" maxlength="10000" placeholder="Add an internal note…"></textarea><button type="button" class="cta" data-order-support-save="${adminSafe(request.id)}">Save update</button></div><div class="admin-request-history">${requestEvents.length?requestEvents.map((event)=>`<div><time>${adminSafe(new Date(event.created_at).toLocaleString())}</time><span>${adminSafe(event.event_type.replace('_',' '))}: ${adminSafe(event.body)}</span></div>`).join(''): '<span>No internal activity yet.</span>'}</div><p data-order-support-status-message="${adminSafe(request.id)}" class="admin-action-status" role="status"></p></article>`;}).join('')||'<div class="admin-empty">No requests match these filters.</div>';panel.querySelectorAll('[data-open-admin-order]').forEach((button)=>button.addEventListener('click',()=>void openAdminOrderModal(button.dataset.openAdminOrder)));panel.querySelectorAll('[data-order-support-save]').forEach((button)=>button.addEventListener('click',async()=>{const id=button.dataset.orderSupportSave,article=button.closest('article'),nextStatus=article.querySelector('[data-order-support-status]').value,note=article.querySelector('[data-order-support-note-entry]').value.trim(),message=article.querySelector('[data-order-support-status-message]');button.disabled=true;message.textContent='Saving…';const current=requests.find((entry)=>entry.id===id);if(nextStatus!==current.status){const update=await cloudAdmin().from('order_support_requests').update({status:nextStatus,updated_at:new Date().toISOString(),resolved_at:['resolved','declined'].includes(nextStatus)?new Date().toISOString():null}).eq('id',id);if(update.error){message.textContent='Unable to save: '+update.error.message;button.disabled=false;return;}await cloudAdmin().from('order_support_request_events').insert({request_id:id,order_id:current.order_id,event_type:'status_change',body:`Status changed to ${nextStatus.replace('_',' ')}`});current.status=nextStatus;}if(note){const noteResult=await cloudAdmin().rpc('add_order_support_note',{request_id_value:id,body_value:note});if(noteResult.error){message.textContent='Status saved, but note failed: '+noteResult.error.message;button.disabled=false;return;}events.unshift({request_id:id,event_type:'note',body:note,created_at:new Date().toISOString()});}message.textContent='Update saved.';button.disabled=false;draw();}));};
  const decorateOrderNotes=()=>{};
  const decorateEmailLogs=()=>{};
  const decorateFinancialEvents=()=>{};
  const cleanEmptyHistory=()=>{};
  ['data-request-type','data-request-status','data-request-search'].forEach((attribute)=>panel.querySelector(`[${attribute}]`).addEventListener(attribute==='data-request-search'?'input':'change',draw));draw();decorateSupportCustomerLinks(panel,requests);const customerLinkObserver=new MutationObserver(()=>decorateSupportCustomerLinks(panel,requests));customerLinkObserver.observe(panel,{childList:true,subtree:true});decorateOrderNotes();decorateEmailLogs();decorateFinancialEvents();cleanEmptyHistory();
};
async function renderEtsyConnection(){
  const root=document.createElement('section');root.className='admin-card';
  root.innerHTML='<p class="kicker">SHOP CONNECTION & IMPORTS</p><h2>Etsy</h2><p>Connect Etsy once, then use the ongoing order sync and fee resync.</p><p data-etsy-status role="status">Checking connection…</p><p>Register this exact callback URL in your Etsy app settings:</p><p><code data-etsy-callback></code></p><div class="admin-actions"><button type="button" data-etsy-connect disabled>Connect Etsy</button><button type="button" data-etsy-verify hidden>Verify connection</button><button type="button" data-etsy-disconnect hidden>Disconnect</button></div><section class="admin-card etsy-import-tools"><h3>Ongoing Etsy sync</h3><div class="admin-actions"><button type="button" data-etsy-import="orders">Import new sales and inventory</button><button type="button" data-etsy-status-sync>Sync Etsy refunds &amp; cancellations</button><button type="button" data-etsy-financial="sync_financials">Resync last 45 days of fees</button><button type="button" data-etsy-import="listings">Find new Etsy listings</button></div><p>New-order import checks for new receipts. Refund and cancellation sync checks changed receipts already imported and updates their sales records only; it never changes inventory quantities. Fee resync is manual and does not run as part of order import.</p><h3>Recent Etsy actions</h3><p>Actions stay in <strong>Needs review</strong> until you finish them. Mark a row reviewed to move it to the completed archive. Showing 5 actions per page, newest first.</p><p class="admin-field-note">Fee resync counts Etsy orders, while fee lines are the individual items inside those orders. One order can contain multiple lines, so the fee-line number will normally be larger.</p><p data-etsy-import-status role="status"></p><div data-etsy-batches class="admin-table-wrap"></div></section><p class="inventory-help">The term “Etsy” is a trademark of Etsy, Inc. This application uses the Etsy API but is not endorsed or certified by Etsy, Inc.</p>';
  panel.replaceChildren(root);
  const status=root.querySelector('[data-etsy-status]'),connect=root.querySelector('[data-etsy-connect]'),verify=root.querySelector('[data-etsy-verify]'),disconnect=root.querySelector('[data-etsy-disconnect]');
  const importStatusText=root.querySelector('[data-etsy-import-status]');
  if(importStatusText)new MutationObserver(()=>{const text=importStatusText.textContent||'';const cleaned=text.replace(/\s*Processed 1 new Etsy listings this run; run it again to continue\.?/i,'').trim();if(cleaned!==text)importStatusText.textContent=cleaned;}).observe(importStatusText,{childList:true,characterData:true,subtree:true});
  const client=cloudAdmin();
  let batchPage=1;
  const batchPageSize=5;
  let historyView='active';
  // The history table redraws for pagination and review actions. Keep the
  // bounded reference reads in memory for this screen, then invalidate them
  // after a mutation so admins still see fresh state when it matters.
  let etsyBatchRowsPromise=null;
  let etsyUnmatchedReviewsPromise=null;
  const invalidateEtsyHistory=()=>{etsyBatchRowsPromise=null;etsyUnmatchedReviewsPromise=null;};
  const reviewedIds=(metadata)=>new Set(Array.isArray(metadata?.reviewed_listing_ids)?metadata.reviewed_listing_ids.map((id)=>String(id)):[]);
  const pageReviewId=(page)=>String(page?.listing_id||page?.product_id||'');
  const pageIsReviewed=(batch,page)=>reviewedIds(batch.metadata).has(pageReviewId(page));
  const hasNewListingArtifacts=(page)=>{const family=Array.isArray(page?.family_skus)?page.family_skus:[];return family.some((row)=>{const oneExisted=typeof row.one_pk_sku_existed_before_run==='boolean'?row.one_pk_sku_existed_before_run:row.one_pk_sku_existed;const packExisted=typeof row.pack_sku_existed_before_run==='boolean'?row.pack_sku_existed_before_run:row.pack_sku_existed;return row.recipe_created===true||oneExisted===false||packExisted===false;});};
  const listingReviewPages=(batch)=>{const created=Array.isArray(batch.metadata?.created_pages)?batch.metadata.created_pages:[];const existing=(Array.isArray(batch.metadata?.existing_pages)?batch.metadata.existing_pages:[]).filter((page)=>page.webhook_sku_update===true||hasNewListingArtifacts(page));const seen=new Set();return [...created,...existing].filter((page)=>{const id=String(page?.listing_id||page?.product_id||'');if(!id)return true;if(seen.has(id))return false;seen.add(id);return true;});};
  const pendingListingPages=(batch)=>listingReviewPages(batch).filter((page)=>!pageIsReviewed(batch,page));
  let showReviewedListingPages=false;
  root.querySelector('[data-etsy-callback]').textContent='https://zejcuqhihbfpuwsjvmhc.supabase.co/functions/v1/etsy-connect/callback';
  const listingRunIdKey='etsy-listing-run-id-v3';
  let activeListingRunId=sessionStorage.getItem(listingRunIdKey)||'',activeListingRunAt=0;
  const listingCursorKey='etsy-listing-cursor-v2';
  const call=async(action,extra={})=>{
    if(action==='import_listings'){
      const now=Date.now();
      const savedOffset=Number(sessionStorage.getItem(listingCursorKey)||0);
      if(!activeListingRunId){activeListingRunId=crypto.randomUUID?.()||String(now)+'-'+Math.random().toString(36).slice(2);sessionStorage.setItem(listingRunIdKey,activeListingRunId);}
      activeListingRunAt=now;
      extra={...extra,run_id:activeListingRunId};
      if(savedOffset>0&&!Number(extra.offset))extra.offset=savedOffset;
    }
    if(!client)throw new Error('Please sign in to your administrator account.');
    const sessionResult=await client.auth.getSession();
    let accessToken=sessionResult.data?.session?.access_token;
    if(!accessToken)throw new Error('Your admin session is missing. Sign in again on this local admin page.');
    let lastError='Unable to reach the Etsy connection service.';
    // Listing scans are intentionally long-running and bounded server-side.
    // Retrying a resource-limited scan multiplies concurrent Edge Function
    // workers and can turn one click into several overlapping scans.
    const maxAttempts=['import_listings','sync_order_statuses'].includes(action)?1:3;
    for(let attempt=0;attempt<maxAttempts;attempt+=1){
      const {data,error}=await client.functions.invoke('etsy-connect',{body:{action,...extra},headers:{Authorization:`Bearer ${accessToken}`}});
      if(!error){if(data?.error)throw new Error(data.error);if(action==='import_listings'){const nextOffset=Number(data?.next_offset||0);const scanWaiting=data?.scan_waiting===true||/already running|still running/i.test(String(data?.warning||''));if(data?.continue_available&&nextOffset>0)sessionStorage.setItem(listingCursorKey,String(nextOffset));else if(!scanWaiting)sessionStorage.removeItem(listingCursorKey);if(!data?.continue_available&&!scanWaiting){sessionStorage.removeItem(listingRunIdKey);activeListingRunId='';}}return data;}
      const statusCode=Number(error.context?.status||0);
      let detail,raw='';
      try{const context=error.context;const response=context&&typeof context.clone==='function'?context.clone():context;raw=await response?.text()||'';try{detail=JSON.parse(raw);}catch(parseError){}}catch(parseError){}
      lastError=detail?.error||raw||error.message||lastError;
      if((statusCode===401||statusCode===403)&&attempt<2){
        const refreshed=await client.auth.refreshSession();
        const refreshedToken=refreshed.data?.session?.access_token;
        if(refreshedToken){accessToken=refreshedToken;continue;}
      }
      const retryable=!error.context||statusCode>=500||/(?:fetch|network|timeout|5\d\d|non-2xx)/i.test(String(lastError));
      if(!retryable||attempt===maxAttempts-1)throw new Error(lastError);
      await new Promise((resolve)=>setTimeout(resolve,750*(attempt+1)));
    }
    throw new Error(lastError);
  };
  const recordEtsyAction=async(type,status,rowCount,matchedCount,appliedCount,metadata={})=>{
    if(!client)return;
    if(type==='orders'&&status==='applied'&&Number(rowCount)===0)return;
    try{
      const userResult=await client.auth.getUser();
      const userId=userResult.data?.user?.id;
      if(!userId)return;
      const kind=type==='listings'?'listings':type==='reviews'?'reviews':'orders';
      await client.from('etsy_import_batches').insert({created_by:userId,kind,payload:{},expires_at:new Date(Date.now()+30*86400000).toISOString(),import_type:kind,status,source:'etsy_api',row_count:Number(rowCount)||0,matched_count:Number(matchedCount)||0,applied_count:Number(appliedCount)||0,metadata:{action:type==='fees'?'fee_resync':type,...metadata}});
      invalidateEtsyHistory();
      batchPage=1;
    }catch(error){/* History must not prevent a completed Etsy action from being reported. */}
  };
  const drawBatches=async()=>{
    const target=root.querySelector('[data-etsy-batches]');
    if(!target||!client)return;
    if(!etsyBatchRowsPromise)etsyBatchRowsPromise=client.from('etsy_import_batches').select('id,kind,import_type,status,row_count,matched_count,applied_count,metadata,created_at,source').or('source.is.null,source.neq.etsy_webhook').order('created_at',{ascending:false}).limit(100).then((result)=>{if(result.error)etsyBatchRowsPromise=null;return result;}).catch((error)=>{etsyBatchRowsPromise=null;throw error;});
    const result=await etsyBatchRowsPromise;
    if(result.error){target.innerHTML='<p class="admin-empty">Import history is unavailable until the staged-import migration is applied.</p>';return;}
    if(!etsyUnmatchedReviewsPromise)etsyUnmatchedReviewsPromise=client.from('etsy_import_reviews').select('id,etsy_sku,rating,body,reviewer_name').eq('match_status','unmatched').is('applied_review_id',null).order('created_at',{ascending:false}).limit(100).then((result)=>{if(result.error)etsyUnmatchedReviewsPromise=null;return result;}).catch((error)=>{etsyUnmatchedReviewsPromise=null;throw error;});
    const unmatchedResult=await etsyUnmatchedReviewsPromise;
    const [unmatchedSalesResult,hiddenSalesResult]=await Promise.all([
      client.from('etsy_sale_lines').select('id,etsy_sku,external_order_id,external_line_id,sale_date,raw_data,matched_inventory_sku,inventory_allocation_status,inventory_units_applied').or('match_status.eq.unmatched,matched_inventory_sku.is.null').order('sale_date',{ascending:false}).limit(100),
      client.from('etsy_sale_line_exclusions').select('external_order_id,external_line_id')
    ]);
    const hiddenSaleLineKeys=new Set((hiddenSalesResult.data||[]).map((sale)=>JSON.stringify([sale.external_order_id,sale.external_line_id])));
    const canonicalUnmatchedSales=unmatchedSalesResult.error?null:(unmatchedSalesResult.data||[]).filter((sale)=>!hiddenSaleLineKeys.has(JSON.stringify([sale.external_order_id,sale.external_line_id]))&&sale.inventory_allocation_status!=='ignored'&&Number(sale.inventory_units_applied||0)===0);
    const rawRows=result.data||[];
    const groupedRows=[];
    const listingGroups=new Map();
    rawRows.forEach((batch)=>{
      const metadata=batch.metadata||{};
      const isListing=metadata.action==='listings'||batch.import_type==='listings'||batch.kind==='listings';
      const runId=isListing&&metadata.run_id?String(metadata.run_id):'';
      if(!runId){groupedRows.push({...batch,run_started_at:batch.created_at,source_batches:[{id:batch.id,status:batch.status,metadata,created_at:batch.created_at}]});return;}
      let group=listingGroups.get(runId);
      if(!group){group={...batch,run_started_at:batch.created_at,row_count:0,applied_count:0,matched_count:0,source_batches:[],metadata:{...metadata,created_pages:[],failed_pages:[],existing_pages:[],repair_issues:[],reviewed_listing_ids:[]},status:'staged'};listingGroups.set(runId,group);groupedRows.push(group);}
      group.source_batches.push({id:batch.id,status:batch.status,metadata,created_at:batch.created_at});
      group.metadata.created_pages.push(...(Array.isArray(metadata.created_pages)?metadata.created_pages:[]));
      group.metadata.failed_pages.push(...(Array.isArray(metadata.failed_pages)?metadata.failed_pages:[]));
      group.metadata.repair_issues.push(...(Array.isArray(metadata.repair_issues)?metadata.repair_issues:[]));
      group.metadata.existing_pages.push(...(Array.isArray(metadata.existing_pages)?metadata.existing_pages:[]));
      group.metadata.reviewed_listing_ids.push(...(Array.isArray(metadata.reviewed_listing_ids)?metadata.reviewed_listing_ids:[]));
      group.row_count+=Number(batch.row_count||0);
      group.applied_count+=Number(batch.applied_count||0);
      group.matched_count=listingReviewPages(group).length;
      if(batch.status==='failed')group.status='failed';
      group.metadata.warning=metadata.warning||null;
      if(metadata.error)group.metadata.error=metadata.error;
      if(new Date(batch.created_at)>new Date(group.created_at))group.created_at=batch.created_at;
      if(new Date(batch.created_at)<new Date(group.run_started_at))group.run_started_at=batch.created_at;
    });
    listingGroups.forEach((group)=>{
      const uniquePages=(pages)=>[...new Map(pages.map((page)=>[String(page?.listing_id||page?.product_id||JSON.stringify(page)),page])).values()];
      group.metadata.created_pages=uniquePages(group.metadata.created_pages);
      const createdIds=new Set(group.metadata.created_pages.map((page)=>String(page?.listing_id||'')));
      group.metadata.existing_pages=uniquePages(group.metadata.existing_pages).filter((page)=>!createdIds.has(String(page?.listing_id||'')));
      group.metadata.failed_pages=uniquePages(group.metadata.failed_pages);
      group.metadata.repair_issues=uniquePages(group.metadata.repair_issues);
      group.metadata.reviewed_listing_ids=[...new Set(group.metadata.reviewed_listing_ids.map((id)=>String(id)))];
      const reviewPages=listingReviewPages(group);
      group.matched_count=reviewPages.length;
      const allSourcesReviewed=group.source_batches.length>0&&group.source_batches.every((source)=>Boolean(source.metadata?.reviewed)||source.status==='completed');
      const allPagesReviewed=reviewPages.length?reviewPages.every((page)=>pageIsReviewed(group,page)):allSourcesReviewed;
      const needsAttention=group.metadata.failed_pages.length+group.metadata.repair_issues.length;
      group.metadata.reviewed=allPagesReviewed;
      if(group.metadata.reviewed)group.status='completed';
      else if(needsAttention)group.status='failed';
      else if(reviewPages.length)group.status='staged';
    });
    const rows=groupedRows.filter((batch)=>historyView==='completed'?Boolean(batch.metadata?.reviewed||batch.status==='completed')&&!(listingReviewPages(batch).length&&pendingListingPages(batch).length):!Boolean(batch.metadata?.reviewed)&&batch.status!=='completed').sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));
    const pageCount=Math.max(1,Math.ceil(rows.length/batchPageSize));
    batchPage=Math.min(batchPage,pageCount);
    const visible=rows.slice((batchPage-1)*batchPageSize,batchPage*batchPageSize);
    const actionLabel=(batch)=>{const metadata=batch.metadata||{};if(metadata.action==='fee_resync')return 'Fee resync';if(metadata.action==='order_status_sync')return 'Refund & cancellation sync';if(metadata.action==='orders'||batch.import_type==='orders'||batch.kind==='orders')return 'Order import';if(metadata.action==='listings'||batch.import_type==='listings'||batch.kind==='listings')return 'Etsy listings';if(metadata.action==='reviews'||batch.import_type==='reviews'||batch.kind==='reviews')return 'Reviews';if(batch.import_type==='sales_history'||batch.kind==='sales_history')return 'Sales history';return batch.import_type||batch.kind||'Etsy action';};
    const listingSkuCandidates=visible.filter((batch)=>actionLabel(batch)==='Etsy listings').flatMap((batch)=>listingReviewPages(batch).flatMap((page)=>{const family=Array.isArray(page.family_skus)?page.family_skus:[];return [...family.flatMap((row)=>[row.one_pk_sku,row.etsy_sku]),page.one_pk_sku,page.etsy_sku].map((sku)=>String(sku||'').trim()).filter(Boolean);}));
    const inventoryBySku=new Map();
    const inventoryLookupValues=[...new Set(listingSkuCandidates.flatMap((sku)=>[sku,sku.toLowerCase()]))];
    let recipeLookupError=null;
    for(let start=0;start<inventoryLookupValues.length;start+=100){const lookup=await client.from('inventory_skus').select('id,sku').in('sku',inventoryLookupValues.slice(start,start+100));if(lookup.error){recipeLookupError=lookup.error;const status=root.querySelector('[data-etsy-import-status]');if(status)status.textContent='Imported SKU and recipe details could not be loaded. Refresh to retry.';break;}for(const row of lookup.data||[]){const key=String(row.sku||'').trim().toUpperCase();if(!inventoryBySku.has(key))inventoryBySku.set(key,[]);inventoryBySku.get(key).push(row);}}
    const inventoryById=new Map([...inventoryBySku.values()].flat().map((row)=>[row.id,row]));
    const recipeParentSkus=visible.filter((batch)=>actionLabel(batch)==='Etsy listings').flatMap((batch)=>listingReviewPages(batch).flatMap((page)=>Array.isArray(page.family_skus)?page.family_skus.map((row)=>String(row.etsy_sku||'').trim().toUpperCase()):[]));
    const recipeParentIds=[...new Set(recipeParentSkus.flatMap((sku)=>(inventoryBySku.get(sku)||[]).map((row)=>row.id)).filter(Boolean))];
    const recipesByParentId=new Map();
    if(!recipeLookupError&&recipeParentIds.length){
      const lookup=await adminBatchRows(recipeParentIds,(batch)=>client.from('inventory_bundle_components').select('bundle_sku_id,component_sku_id,quantity,sort_order').in('bundle_sku_id',batch).order('sort_order'),100);
      if(lookup.error)recipeLookupError=lookup.error;
      else{
        const missingChildIds=[...new Set((lookup.data||[]).map((row)=>row.component_sku_id).filter((id)=>!inventoryById.has(id)))];
        if(missingChildIds.length){
          const children=await adminBatchRows(missingChildIds,(batch)=>client.from('inventory_skus').select('id,sku').in('id',batch),100);
          if(children.error)recipeLookupError=children.error;
          else (children.data||[]).forEach((row)=>inventoryById.set(row.id,row));
        }
        if(!recipeLookupError)(lookup.data||[]).forEach((row)=>{const components=recipesByParentId.get(row.bundle_sku_id)||[];components.push({sku:inventoryById.get(row.component_sku_id)?.sku||'Unknown child SKU',quantity:Number(row.quantity)||1});recipesByParentId.set(row.bundle_sku_id,components);});
      }
    }
    const listingInventorySkus=(page)=>{const family=Array.isArray(page?.family_skus)?page.family_skus:[];const candidates=[...family.flatMap((row)=>[row.one_pk_sku,row.etsy_sku]),page?.one_pk_sku,page?.etsy_sku].map((sku)=>String(sku||'').trim()).filter(Boolean);const matches=[];const seen=new Set();for(const sku of candidates){for(const row of inventoryBySku.get(sku.toUpperCase())||[]){if(seen.has(row.id))continue;seen.add(row.id);matches.push({id:row.id,sku:String(row.sku||sku).trim()});}}return matches;};
    groupedRows.forEach((batch)=>{if(actionLabel(batch)==='Etsy listings'&&Array.isArray(batch.metadata?.created_pages)){batch.applied_count=batch.metadata.created_pages.length;batch.matched_count=listingReviewPages(batch).length;}});
    const displayCount=(value)=>Number(value||0).toLocaleString();
    const feeSyncSummary=(batch)=>{const metadata=batch.metadata||{};return {receipts:Number(batch.row_count||0),lines:Number(batch.applied_count||metadata.fee_lines||0),window:String(metadata.window||'last 45 days')};};
    const followUp=(batch)=>{
      const metadata=batch.metadata||{};
      if(batch.status==='failed'&&actionLabel(batch)!=='Etsy listings')return '<span class="admin-field-note">Run again</span>';
      if(actionLabel(batch)==='Fee resync'){
        const summary=feeSyncSummary(batch);
        return '<span class="admin-field-note">Checked '+displayCount(summary.receipts)+' Etsy orders and updated fees on '+displayCount(summary.lines)+' order lines ('+adminSafe(summary.window)+'). Compare that order count with Etsy before marking reviewed.</span>';
      }
      if(actionLabel(batch)==='Refund & cancellation sync')return '<span class="admin-field-note">Updated '+displayCount(metadata.updated_lines)+' existing sale lines: '+displayCount(metadata.cancelled_receipts)+' cancelled, '+displayCount(metadata.refunded_receipts)+' fully refunded, '+displayCount(metadata.partial_refund_receipts)+' partially refunded. Inventory quantities were not changed.</span>';
      if(actionLabel(batch)==='Etsy listings'){
        const allPages=listingReviewPages(batch);
        const reviewedPages=allPages.filter((page)=>pageIsReviewed(batch,page));
        const pages=historyView==='completed'||showReviewedListingPages?allPages:allPages.filter((page)=>!pageIsReviewed(batch,page));
        const repairIssues=Array.isArray(metadata.repair_issues)?metadata.repair_issues:[];
        const failed=Array.isArray(metadata.failed_pages)?metadata.failed_pages:[];
        const attentionItems=[...new Map([...failed,...repairIssues].filter(Boolean).map((issue)=>[String(issue.listing_id||''),issue])).values()];
        const nextStepFor=(error)=>{if(/physical inventory child|recipe parent/i.test(error))return 'Use Correct local SKUs & recipes on this imported listing to verify its local inventory SKU and package recipes.';if(/response omits|every expected SKU/i.test(error))return 'Check the variation SKUs in Etsy. The importer will not invent missing Etsy variation data.';if(/incomplete SKU|no explicit SKU/i.test(error))return 'Give every variation a SKU in Etsy before importing this listing.';if(/multiple|different product page|different Etsy listing/i.test(error))return 'Resolve the conflicting product-page or listing link before importing this listing again.';return 'Review the Etsy listing data and correct its local SKUs & recipes if it has already been imported.';};
        const oldWarning=String(metadata.warning||'');
        const scanWarning=oldWarning.replace(/The scan paused at a listing that could not be imported\. Run the import again to retry it and continue\./g,'').replace(/\d+ listings? need a retry\./g,'').trim();
        const warningText=[scanWarning,oldWarning!==scanWarning&&failed.length?failed.length+' listing'+(failed.length===1?'':'s')+' need attention. Review Etsy variation data or correct the local SKUs & recipes for imported listings.':''].filter(Boolean).join(' ');
        const warning=warningText?'<span class="admin-field-note">'+adminSafe(warningText)+'</span>':'';
        const failedMarkup=attentionItems.length?'<div class="admin-etsy-failed-links"><strong>Needs attention ('+attentionItems.length+')</strong><ul>'+attentionItems.map(issue=>{const error=String(issue.error||'Import failed.');return '<li><strong>Etsy listing '+adminSafe(issue.listing_id||'unknown')+'</strong>: '+adminSafe(error)+'<br><small>Next step: '+adminSafe(nextStepFor(error))+'</small></li>';}).join('')+'</ul></div>':'';
        const createdDetails=(page)=>{
          const familyRows=Array.isArray(page.family_skus)?page.family_skus:[];
          const inventorySkus=[];
          listingInventorySkus(page).forEach((sku)=>inventorySkus.push('<li><strong>'+adminSafe(sku.sku)+'</strong> <button type="button" data-edit-created-inventory-sku="'+adminSafe(sku.id)+'">Edit SKU</button></li>'));
          const seenRecipes=new Set();
          const recipes=familyRows.map((row)=>{
            const parent=String(row.etsy_sku||'').trim();
            if(!parent||seenRecipes.has(parent.toUpperCase()))return '';
            seenRecipes.add(parent.toUpperCase());
            const parentId=inventoryBySku.get(parent.toUpperCase())?.[0]?.id;
            const components=recipesByParentId.get(parentId)||[];
            if(Number(row.pack_size||0)<=1&&!components.length)return '';
            const parts=recipeLookupError?'Saved recipe could not be loaded. Refresh to retry.':components.length?components.map((component)=>component.quantity+' × '+adminSafe(component.sku)).join(' · '):'No saved recipe';
            return '<li><strong>'+adminSafe(parent)+'</strong><span>'+parts+'</span></li>';
          }).filter(Boolean).join('');
          const productId=String(page.product_id||'').trim();
          const productHref=productId?'admin.html?edit='+encodeURIComponent(productId):String(page.links?.product||page.url||'');
          const productLink=productHref?'<a href="'+adminSafe(productHref)+'" target="_blank" rel="noopener">Edit product page</a>':'';
          const addPageButton='<button type="button" data-etsy-add-product-page>Add second product page</button>';
          const pageTitle=String(page.product_name||page.etsy_title||page.title||page.listing_id||'Etsy listing').trim();
          const reviewId=pageReviewId(page);
          const isReviewed=pageIsReviewed(batch,page);
          const reviewButton=reviewId?'<div class="admin-etsy-review-action"><button type="button" data-etsy-page-review="'+adminSafe(reviewId)+'" data-reviewed="'+String(isReviewed)+'">'+(isReviewed?'Undo reviewed':'Mark reviewed')+'</button></div>':'';
          const correctButton='<button type="button" data-correct-imported-etsy-family="'+adminSafe(page.listing_id||reviewId)+'">Correct local SKUs &amp; recipes</button>';
          return '<div><strong>'+adminSafe(pageTitle)+'</strong>'+(isReviewed?' <span class="admin-field-note">Reviewed</span>':'')+'</div>'+(inventorySkus.length?'<ul class="admin-etsy-created-skus">'+inventorySkus.join('')+'</ul>':'')+(recipes?'<div class="admin-etsy-recipe-summary"><strong>Saved recipes</strong><ul>'+recipes+'</ul></div>':'')+correctButton+productLink+addPageButton+reviewButton;
        };
        const reviewedToggle=reviewedPages.length&&historyView!=='completed'?'<button type="button" data-etsy-show-reviewed>'+(showReviewedListingPages?'Hide':'Show')+' reviewed pages ('+reviewedPages.length+')</button>':'';
        const createdMarkup=pages.map(createdDetails).filter(Boolean).map((markup)=>'<div class="admin-etsy-created-links">'+markup+'</div>').join('<hr>');
        return reviewedToggle+createdMarkup+failedMarkup+(warning?'<br>'+warning:'');
      }
      if(actionLabel(batch)==='Order import'&&Number(metadata.unmatched||0)>0){const unmatchedSkus=Array.isArray(metadata.unmatched_skus)?metadata.unmatched_skus:[];return '<button type="button" data-etsy-reapply-sales="'+adminSafe(batch.id)+'">Reapply stored Etsy sales</button><br><span class="admin-field-note">Matches newly-created SKUs without contacting Etsy again.</span>'+(unmatchedSkus.length?'<ul>'+unmatchedSkus.map((sku)=>'<li>'+adminSafe(sku)+'</li>').join('')+'</ul>':'');}
      if(actionLabel(batch)==='Reviews')return '<button type="button" data-etsy-rematch-reviews="'+adminSafe(batch.id)+'">Rematch staged reviews</button>'+(batch.status==='staged'&&Number(batch.matched_count||0)?'<button type="button" data-etsy-apply-reviews="'+adminSafe(batch.id)+'">Apply matched reviews</button>':'');
      return '<span class="admin-field-note">No action needed</span>';
    };
    const listingCounts=(batch)=>({created:Array.isArray(batch.metadata?.created_pages)?batch.metadata.created_pages.length:0,repaired:Array.isArray(batch.metadata?.existing_pages)?batch.metadata.existing_pages.length:0,failed:Array.isArray(batch.metadata?.failed_pages)?batch.metadata.failed_pages.length:0,checked:listingReviewPages(batch).length});
    const resultCell=(batch)=>{if(actionLabel(batch)==='Etsy listings'){const counts=listingCounts(batch);const skuUpdates=Number(batch.metadata?.sku_update_count)||0;return displayCount(counts.created)+' new product pages · '+displayCount(counts.repaired)+' existing listing families repaired · '+displayCount(skuUpdates)+' SKU updates synced · '+displayCount(batch.metadata?.unchanged_count)+' already represented; skipped';}if(actionLabel(batch)==='Fee resync'){const summary=feeSyncSummary(batch);return displayCount(summary.receipts)+' Etsy orders checked';}if(actionLabel(batch)==='Order import'){const metadata=batch.metadata||{};return displayCount(metadata.receipts||batch.row_count)+' new Etsy orders · '+displayCount(metadata.sale_lines||batch.applied_count)+' sale lines';}return displayCount(batch.row_count)+' rows';};
    const attentionCell=(batch)=>{if(actionLabel(batch)==='Etsy listings'){const pending=pendingListingPages(batch).length;const issues=[...(Array.isArray(batch.metadata?.failed_pages)?batch.metadata.failed_pages:[]),...(Array.isArray(batch.metadata?.repair_issues)?batch.metadata.repair_issues:[])].filter(Boolean);const failed=new Set(issues.map((issue)=>String(issue.listing_id||''))).size;return (pending?displayCount(pending)+' pages to review':'None')+(failed?' · '+displayCount(failed)+' need attention':'');}if(actionLabel(batch)==='Fee resync'){const summary=feeSyncSummary(batch);return displayCount(summary.lines)+' fee lines updated';}if(actionLabel(batch)==='Order import'){const metadata=batch.metadata||{};return Number(metadata.unmatched||0)?displayCount(metadata.unmatched)+' unmatched sale line'+(Number(metadata.unmatched)===1?'':'s'):Number(metadata.inventory_updated||0)+' inventory updates';}return Number(batch.matched_count||0)?displayCount(batch.matched_count)+' matched':'None';};
    const historyTabs='<div class="admin-etsy-history-tabs"><button type="button" data-etsy-history-view="active" '+(historyView==='active'?'aria-current="page"':'')+'>Needs review</button><button type="button" data-etsy-history-view="completed" '+(historyView==='completed'?'aria-current="page"':'')+'>Completed archive</button></div>';
    if(canonicalUnmatchedSales)visible.forEach((batch)=>{if(actionLabel(batch)!=='Order import')return;const minCreated=Number(batch.metadata?.min_created);if(!(minCreated>0))return;const batchEnd=Date.parse(batch.created_at||'');const batchUnmatched=canonicalUnmatchedSales.filter((sale)=>{const saleTime=Date.parse(sale.sale_date||'');return saleTime>=minCreated*1000&&(!Number.isFinite(batchEnd)||saleTime<=batchEnd);});batch.metadata={...(batch.metadata||{}),unmatched:batchUnmatched.length,unmatched_skus:[...new Set(batchUnmatched.map((sale)=>String(sale.etsy_sku||'').trim()).filter(Boolean))]};});
    target.innerHTML=historyTabs+'<table class="admin-table"><thead><tr><th>Action</th><th>Status</th><th>Result</th><th>Needs attention</th><th>Ran</th><th>Follow-up</th></tr></thead><tbody>'+(visible.map((batch)=>'<tr><td>'+adminSafe(actionLabel(batch))+'</td><td>'+adminSafe(historyView==='completed'?'completed':batch.status)+'</td><td>'+adminSafe(resultCell(batch))+'</td><td>'+adminSafe(attentionCell(batch))+'</td><td>'+adminSafe(batch.created_at?new Date(batch.created_at).toLocaleString():'')+'</td><td>'+followUp(batch)+(historyView==='completed'?'<button type="button" data-etsy-restore-reviewed="'+adminSafe(batch.id)+'">Restore to needs review</button>':'<button type="button" data-etsy-mark-reviewed="'+adminSafe(batch.id)+'">Mark reviewed</button>')+'</td></tr>').join('')||'<tr><td colspan="6">'+(historyView==='completed'?'No completed Etsy actions yet.':'Nothing needs review.')+'</td></tr>')+'</tbody></table><div class="admin-pagination"><button type="button" data-etsy-batch-page="prev" '+(batchPage===1?'disabled':'')+'>Previous</button><span>Page '+batchPage+' of '+pageCount+' · '+rows.length+' actions</span><button type="button" data-etsy-batch-page="next" '+(batchPage===pageCount?'disabled':'')+'>Next</button></div>';
    target.querySelectorAll('[data-etsy-batch-page]').forEach((button)=>button.onclick=()=>{batchPage=Math.max(1,Math.min(pageCount,batchPage+(button.dataset.etsyBatchPage==='next'?1:-1)));drawBatches();});
    target.querySelectorAll('[data-etsy-history-view]').forEach((button)=>button.onclick=()=>{historyView=button.dataset.etsyHistoryView;batchPage=1;void drawBatches();});
    target.querySelectorAll('[data-edit-created-inventory-sku]').forEach((button)=>button.onclick=async()=>{button.disabled=true;try{await openInventorySkuEditor(button.dataset.editCreatedInventorySku,async()=>{invalidateEtsyHistory();await drawBatches();});}finally{button.disabled=false;}});
    target.querySelectorAll('[data-correct-imported-etsy-family]').forEach((button)=>button.onclick=async()=>{const batch=visible.find((row)=>actionLabel(row)==='Etsy listings'&&listingReviewPages(row).some((page)=>pageReviewId(page)===String(button.dataset.correctImportedEtsyFamily)));const page=batch&&listingReviewPages(batch).find((entry)=>pageReviewId(entry)===String(button.dataset.correctImportedEtsyFamily));if(!page)return;button.disabled=true;try{await openImportedEtsySkuCorrection(page,async()=>{invalidateEtsyHistory();await drawBatches();});}finally{button.disabled=false;}});
    target.querySelectorAll('[data-etsy-add-product-page]').forEach((button)=>button.onclick=()=>{const url=new URL('admin.html?new=item',window.location.href);window.open(url.href,'_blank','noopener');});
    target.querySelectorAll('[data-etsy-show-reviewed]').forEach((button)=>button.onclick=()=>{showReviewedListingPages=!showReviewedListingPages;void drawBatches();});
    const updateListingReviewState=async(batch,reviewId,reviewed)=>{if(!batch||!reviewId)throw new Error('That Etsy product page is no longer available. Refresh the page and try again.');const sources=Array.isArray(batch.source_batches)&&batch.source_batches.length?batch.source_batches:[{id:batch.id,metadata:batch.metadata||{}}];for(const source of sources){const metadata={...(source.metadata||{})};const ids=new Set(Array.isArray(metadata.reviewed_listing_ids)?metadata.reviewed_listing_ids.map((id)=>String(id)):[]);if(reviewed)ids.add(String(reviewId));else ids.delete(String(reviewId));metadata.reviewed_listing_ids=[...ids];const update=await client.from('etsy_import_batches').update({metadata}).eq('id',source.id).select('id').maybeSingle();if(update.error)throw update.error;if(!update.data)throw new Error('No Etsy history row was updated. Your admin session may have expired; refresh and sign in again.');}};
    target.querySelectorAll('[data-etsy-page-review]').forEach((button)=>button.onclick=async()=>{button.disabled=true;const batch=visible.find((row)=>actionLabel(row)==='Etsy listings'&&listingReviewPages(row).some((page)=>pageReviewId(page)===button.dataset.etsyPageReview));try{await updateListingReviewState(batch,button.dataset.etsyPageReview,button.dataset.reviewed!=='true');invalidateEtsyHistory();await drawBatches();}catch(error){button.disabled=false;const importStatus=root.querySelector('[data-etsy-import-status]');if(importStatus)importStatus.textContent='Could not update this product page review: '+(error.message||'Unknown error.');}});
    const reviewableSaleLineIds=async(batch)=>{const minCreated=Number(batch?.metadata?.min_created);const batchEnd=Date.parse(batch?.created_at||'');if(!(minCreated>0)||!Number.isFinite(batchEnd))throw new Error('This Etsy import has no reliable sale-date window; nothing was marked reviewed.');const ids=[];const startDate=new Date(minCreated*1000).toISOString();const endDate=new Date(batchEnd).toISOString();for(let offset=0;;offset+=1000){const result=await client.from('etsy_sale_lines').select('id,matched_inventory_sku,inventory_allocation_status,inventory_units_applied,match_status').gte('sale_date',startDate).lte('sale_date',endDate).range(offset,offset+999);if(result.error)throw result.error;for(const line of result.data||[])if((line.match_status==='unmatched'||!line.matched_inventory_sku)&&line.inventory_allocation_status!=='applied'&&line.inventory_allocation_status!=='ignored'&&Number(line.inventory_units_applied||0)===0&&line.id)ids.push(line.id);if((result.data||[]).length<1000)break;}return [...new Set(ids)];};
    const updateReviewState=async(batch,reviewed)=>{if(!batch)throw new Error('That Etsy action is no longer available. Refresh the page and try again.');if(reviewed&&actionLabel(batch)==='Order import'){const lineIds=await reviewableSaleLineIds(batch);if(lineIds.length){const result=await client.rpc('mark_etsy_sale_lines_reviewed',{p_sale_line_ids:lineIds});if(result.error)throw result.error;}}const sources=Array.isArray(batch.source_batches)&&batch.source_batches.length?batch.source_batches:[{id:batch.id,metadata:batch.metadata||{}}];for(const source of sources){const metadata={...(source.metadata||{})};metadata.reviewed=reviewed;metadata.reviewed_at=reviewed?new Date().toISOString():null;metadata.reviewed_listing_ids=reviewed?[...new Set(listingReviewPages({...batch,metadata}).map(pageReviewId).filter(Boolean))]:[];const update=await client.from('etsy_import_batches').update({status:reviewed?'completed':'staged',metadata}).eq('id',source.id).select('id').maybeSingle();if(update.error)throw update.error;if(!update.data)throw new Error('No Etsy history row was updated. Your admin session may have expired; refresh and sign in again.');}};
     target.querySelectorAll('[data-etsy-reapply-sales]').forEach((button)=>button.onclick=async()=>{button.disabled=true;const importStatus=root.querySelector('[data-etsy-import-status]');if(importStatus)importStatus.textContent='Reapplying stored Etsy sales…';try{const result=await client.rpc('reapply_all_etsy_unmatched_sales');if(result.error)throw result.error;const data=result.data||{};if(importStatus)importStatus.textContent='Reapplied '+Number(data.matched_lines||0)+' stored sale lines without contacting Etsy. '+Number(data.remaining_lines||0)+' remain unmatched.';invalidateEtsyHistory();await drawBatches();}catch(error){if(importStatus)importStatus.textContent='Stored Etsy sales were not reapplied: '+(error.message||'Unknown error.');button.disabled=false;}});
    target.querySelectorAll('[data-etsy-mark-reviewed]').forEach((button)=>button.onclick=async()=>{button.disabled=true;try{await updateReviewState(rows.find((batch)=>String(batch.id)===String(button.dataset.etsyMarkReviewed)),true);invalidateEtsyHistory();await drawBatches();}catch(error){button.disabled=false;const importStatus=root.querySelector('[data-etsy-import-status]');if(importStatus)importStatus.textContent='Could not mark this action reviewed: '+(error.message||'Unknown error.');}});
    target.querySelectorAll('[data-etsy-restore-reviewed]').forEach((button)=>button.onclick=async()=>{button.disabled=true;try{await updateReviewState(rows.find((batch)=>String(batch.id)===String(button.dataset.etsyRestoreReviewed)),false);invalidateEtsyHistory();await drawBatches();}catch(error){button.disabled=false;const importStatus=root.querySelector('[data-etsy-import-status]');if(importStatus)importStatus.textContent='Could not restore this action: '+(error.message||'Unknown error.');}});
    if((unmatchedResult.data||[]).length){target.insertAdjacentHTML('beforeend','<h4>Unmatched reviews</h4><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Reviewer</th><th>SKU</th><th>Rating</th><th>Review</th><th></th></tr></thead><tbody>'+(unmatchedResult.data||[]).map((review)=>'<tr><td>'+adminSafe(review.reviewer_name||'Etsy customer')+'</td><td>'+adminSafe(review.etsy_sku||'—')+'</td><td>'+Number(review.rating||0)+'/5</td><td>'+adminSafe(window.decodeReviewText(review.body||''))+'</td><td><button type="button" data-etsy-delete-review="'+adminSafe(review.id)+'">Delete</button></td></tr>').join('')+'</tbody></table></div>');}
    target.querySelectorAll('[data-etsy-apply-reviews]').forEach((button)=>button.onclick=async()=>{const importStatus=root.querySelector('[data-etsy-import-status]');button.disabled=true;importStatus.textContent='Applying matched reviews…';try{const batchId=button.dataset.etsyApplyReviews;const clientResult=await client.functions.invoke('etsy-connect',{body:{action:'apply_matched_reviews',batch_id:batchId}});if(clientResult.error)throw clientResult.error;importStatus.textContent='Applied '+Number(clientResult.data?.applied_count||0)+' matched reviews.';invalidateEtsyHistory();await drawBatches();}catch(error){importStatus.textContent=error.message||'Reviews could not be applied.';button.disabled=false;}});
    target.querySelectorAll('[data-etsy-rematch-reviews]').forEach((button)=>button.onclick=async()=>{const importStatus=root.querySelector('[data-etsy-import-status]');button.disabled=true;importStatus.textContent='Rematching staged reviews…';try{const clientResult=await client.functions.invoke('etsy-connect',{body:{action:'rematch_staged_reviews',batch_id:button.dataset.etsyRematchReviews}});if(clientResult.error)throw clientResult.error;importStatus.textContent='Rematched '+Number(clientResult.data?.rematched_count||0)+' reviews and published '+Number(clientResult.data?.applied_count||0)+' product-page copies.';invalidateEtsyHistory();await drawBatches();}catch(error){importStatus.textContent=error.message||'Reviews could not be rematched.';button.disabled=false;}});
    target.querySelectorAll('[data-etsy-delete-review]').forEach((button)=>button.onclick=async()=>{if(!window.confirm('Delete this imported Etsy review?'))return;button.disabled=true;const importStatus=root.querySelector('[data-etsy-import-status]');try{const deleted=await client.functions.invoke('etsy-connect',{body:{action:'delete_imported_review',review_id:button.dataset.etsyDeleteReview}});if(deleted.error)throw deleted.error;importStatus.textContent='Imported review deleted.';invalidateEtsyHistory();await drawBatches();}catch(error){importStatus.textContent=error.message||'Review could not be deleted.';button.disabled=false;}});
  };
    root.querySelectorAll('[data-etsy-import]').forEach((button)=>button.onclick=async()=>{const importStatus=root.querySelector('[data-etsy-import-status]');const type=button.dataset.etsyImport;button.disabled=true;const requestStartedAt=Date.now();let requestNotice=null;if(type==='listings')requestNotice=window.setInterval(()=>{const seconds=Math.floor((Date.now()-requestStartedAt)/1000);importStatus.textContent='Checking Etsy listings… the server request has been running for '+seconds+' seconds. Progress is checkpointed; keep this page open.';},5000);importStatus.textContent=type==='orders'?'Importing new Etsy sales and updating inventory…':'Fetching and staging '+type.replace('_',' ')+'…';let totalReceipts=0,totalLines=0,applied=0,existingTotal=0,matchedTotal=0,unmatchedTotal=0,historyRecorded=false,listingWarning='',scanWaiting=false,minCreated=null;try{let offset=0;let done=false;do{const response=type==='listings'?{data:await call('import_listings',{offset}),error:null}:await client.functions.invoke('etsy-connect',{body:{action:'import_'+type,offset,...(minCreated?{min_created:minCreated}:{})}});if(response.error){let detail;try{detail=await response.error.context?.json();}catch(parseError){}throw new Error(detail?.error||response.error.message||'Etsy import failed.');}const result=response.data||{};historyRecorded=historyRecorded||Boolean(result.history_recorded);if(result.error)throw new Error(result.error);listingWarning=type==='listings'&&result.warning?String(result.warning):listingWarning;if(type==='listings'&&(result.scan_waiting||/already running|still running/i.test(String(result.warning||'')))){scanWaiting=true;break;}if(type==='orders'){minCreated=minCreated||Number(result.min_created)||null;totalReceipts+=Number(result.receipts||0);totalLines+=Number(result.sales||0);matchedTotal+=Number(result.matched||0);unmatchedTotal+=Number(result.unmatched||0);if(result.batch_id){const appliedResult=await client.rpc('apply_etsy_import_batch',{batch_id:result.batch_id});if(appliedResult.error)throw appliedResult.error;const appliedData=appliedResult.data||{};const finalized=await client.functions.invoke('etsy-connect',{body:{action:'finalize_order_import',batch_id:result.batch_id,receipts:result.receipts,sales:result.sales,matched:result.matched,unmatched:result.unmatched,inventory_updated:appliedData.inventory_updated||0}});if(finalized.error)throw finalized.error;if(finalized.data?.error)throw new Error(finalized.data.error);applied+=Number(appliedData.inserted||0)+Number(appliedData.updated||0);historyRecorded=true;}}else{totalLines+=Number(result.rows||result.reviews||result.receipts||0);if(type==='listings'){applied=Number(result.created_count||0);existingTotal=Number(result.existing_count||0);matchedTotal=Number(result.matched||0);}else{applied+=Number(result.applied_count||0);matchedTotal+=Number(result.matched_count||result.matched||0);}unmatchedTotal+=Number(result.unmatched_count||result.unmatched||0);}offset=Number(result.next_offset||0);done=type==='orders'?result.has_more!==true:result.done!==false&&!(type==='listings'&&result.continue_available);importStatus.textContent=type==='orders'?'Imported '+totalReceipts+' Etsy orders ('+totalLines+' sale lines)…':type==='listings'?'Checked '+totalLines+' Etsy listings: '+applied+' new product pages, '+existingTotal+' existing families handled…':'Staged '+totalLines+' rows so far…';}while((type==='sales_history'||type==='orders'||type==='listings')&&!done);if(!historyRecorded)await recordEtsyAction(type,type==='listings'?'staged':'applied',totalLines,matchedTotal,applied,{unmatched:unmatchedTotal,warning:listingWarning||null});importStatus.textContent=scanWaiting?'The Etsy listing scan is still running in another tab. No duplicate scan was started; your saved import checkpoint is intact. Try “Find new Etsy listings” again after the other scan finishes.':type==='reviews'?'Staged '+totalLines+' reviews; published '+applied+' matched product-page copies.':type==='orders'?'Imported '+totalReceipts+' Etsy orders ('+totalLines+' sale lines). Fee sync is manual.':'Checked '+totalLines+' Etsy listings: '+applied+' new product pages and '+existingTotal+' existing listing families handled; all imported pages remain inactive for review.'+(listingWarning?' '+listingWarning:'');invalidateEtsyHistory();const completionMessage=importStatus.textContent;void drawBatches().catch(()=>{if(importStatus.textContent===completionMessage)importStatus.textContent=completionMessage+' Import history could not refresh; reload the page to view the completed action.';});}catch(error){if(!historyRecorded)await recordEtsyAction(type,'failed',totalLines,matchedTotal,applied,{unmatched:unmatchedTotal,error:String(error.message||'Etsy import failed.')});importStatus.textContent=error.message||'Etsy import failed.';}finally{if(requestNotice)window.clearInterval(requestNotice);button.disabled=false;if(type==='listings'&&button.dataset.listingLockTimestamp&&localStorage.getItem(listingImportLockKey)===button.dataset.listingLockTimestamp)localStorage.removeItem(listingImportLockKey);}});
  root.querySelector('[data-etsy-status-sync]')?.addEventListener('click',async(event)=>{
    const button=event.currentTarget;
    const importStatus=root.querySelector('[data-etsy-import-status]');
    button.disabled=true;
    let offset=0,minLastModified=null,maxLastModified=null,summary={scanned_receipts:0,updated_lines:0,cancelled_receipts:0,refunded_receipts:0,partial_refund_receipts:0};
    importStatus.textContent='Checking Etsy refunds and cancellations…';
    try{
      let done=false;
      do{
        const extra={offset};
        if(minLastModified!==null)extra.min_last_modified=minLastModified;
        if(maxLastModified!==null)extra.max_last_modified=maxLastModified;
        extra.summary=summary;
        const result=await call('sync_order_statuses',extra);
        if(result.error||result.ok===false)throw new Error(result.error||'Etsy status sync failed.');
        minLastModified=Number(result.min_last_modified)||minLastModified;
        maxLastModified=Number(result.max_last_modified)||maxLastModified;
        summary={scanned_receipts:Number(result.scanned_receipts)||0,updated_lines:Number(result.updated_lines)||0,cancelled_receipts:Number(result.cancelled_receipts)||0,refunded_receipts:Number(result.refunded_receipts)||0,partial_refund_receipts:Number(result.partial_refund_receipts)||0,ledger_offset:Number(result.ledger_offset)||0};
        done=result.done===true;
        offset=Number(result.next_offset)||0;
        importStatus.textContent=done?(result.backfill?'Historical Etsy refund/cancellation import complete: ':'Etsy refund/cancellation sync complete: ')+summary.cancelled_receipts+' cancelled, '+summary.refunded_receipts+' fully refunded, '+summary.partial_refund_receipts+' partially refunded orders; '+summary.updated_lines+' sale lines updated. Inventory quantities were not changed.':(result.backfill?'Importing historical Etsy refunds and cancellations… ':'Checking recent Etsy refunds and cancellations… ')+summary.scanned_receipts+' matching receipts checked; inventory quantities are not changed.';
      }while(!done);
      invalidateEtsyHistory();
      await drawBatches();
    }catch(error){
      importStatus.textContent='Etsy refunds and cancellations were not fully synced: '+(error.message||'Unknown error. Retry to continue; inventory quantities were not changed.');
    }finally{button.disabled=false;}
  });
  root.querySelectorAll('[data-etsy-financial]').forEach((button)=>button.onclick=async()=>{
    const importStatus=root.querySelector('[data-etsy-import-status]');
    button.disabled=true;
    const action=button.dataset.etsyFinancial;
    const cursorKey='etsy-financial-cursor:v4:'+action;
    let cursor=sessionStorage.getItem(cursorKey)||'';
    let total=0,feeLines=0,done=false,requestNotice=null,currentWindowStart=0;
    const historical=action==='backfill_historical_fees';
    const coverageDays=historical?3*365:45;
    const totalWindows=Math.ceil(coverageDays/7);
    const initialCursor=Number(cursor);
    const periodStart=Math.floor(Date.now()/1000)-coverageDays*24*60*60;
    currentWindowStart=Number.isFinite(initialCursor)&&initialCursor>=periodStart?initialCursor:periodStart;
    const dateLabel=(timestamp)=>new Date(timestamp*1000).toLocaleDateString();
    const progressLabel=()=>{
      const currentWindow=Math.min(totalWindows,Math.floor(Math.max(0,currentWindowStart-periodStart)/(7*24*60*60))+1);
      return (historical?'Backfilling Etsy fees':'Resyncing recent Etsy fees')+' (window '+currentWindow+' of '+totalWindows+')';
    };
    try{
      do{
        const requestStartedAt=Date.now();
        requestNotice=window.setInterval(()=>{
          const seconds=Math.floor((Date.now()-requestStartedAt)/1000);
          importStatus.textContent=progressLabel()+': checking the Etsy ledger for the window starting '+dateLabel(currentWindowStart)+' ('+seconds+' seconds). Completed windows are saved; keep this page open.';
        },1000);
        importStatus.textContent=progressLabel()+': checking the Etsy ledger for the window starting '+dateLabel(currentWindowStart)+'…';
        const response=await client.functions.invoke('etsy-connect',{body:{action,cursor}});
        window.clearInterval(requestNotice);requestNotice=null;
        if(response.error){
          let detail;
          try{detail=await response.error.context?.json();}catch(parseError){}
          throw new Error(detail?.error||response.error.message||'Etsy fee sync request failed.');
        }
        const result=response.data||{};
        if(result.error||result.ok===false)throw new Error(result.error||'Etsy fee sync failed.');
        if(typeof result.done!=='boolean')throw new Error('Etsy did not confirm whether the fee window completed. Progress is saved through the last confirmed window; retry to continue.');
        const nextCursor=result.next_cursor==null?'':String(result.next_cursor);
        if(!result.done){
          const nextValue=Number(nextCursor),currentValue=Number(cursor);
          if(!Number.isFinite(nextValue)||(Number.isFinite(currentValue)&&nextValue<=currentValue))throw new Error('Etsy fee sync did not advance its saved window. Retry to continue from the last confirmed window.');
        }
        total+=Number(result.synced_receipts||0);
        feeLines+=Number(result.updated_lines||0);
        done=result.done;
        if(result.window_end)currentWindowStart=Math.floor(Date.parse(result.window_end)/1000)-1;
        cursor=nextCursor;
        if(done)sessionStorage.removeItem(cursorKey);
        else{
          sessionStorage.setItem(cursorKey,cursor);
          currentWindowStart=Number(cursor);
        }
        importStatus.textContent=done
          ?'Completed Etsy fee sync: '+total+' receipts and '+feeLines+' sale lines updated.'
          :'Saved fee window through '+dateLabel(currentWindowStart)+'; '+total+' receipts and '+feeLines+' sale lines updated so far. Continuing…';
      }while(!done);
      await recordEtsyAction('fees','applied',total,total,feeLines,{fee_lines:feeLines,window:historical?'last 3 years':'last 45 days'});
      importStatus.textContent='Completed Etsy fee sync: '+total+' receipts and '+feeLines+' sale lines updated.';
      invalidateEtsyHistory();
      void drawBatches().catch(()=>{
        if(importStatus.textContent.startsWith('Completed Etsy fee sync:'))importStatus.textContent+=' Recent-action history could not refresh; reload to view it.';
      });
    }catch(error){
      if(cursor)sessionStorage.setItem(cursorKey,cursor);
      const message=(error.message||'Etsy financial sync failed.')+(cursor?' Completed windows are saved; retry to resume from the last confirmed window.':'');
      importStatus.textContent=message;
      void recordEtsyAction('fees','failed',total,total,feeLines,{fee_lines:feeLines,window:historical?'last 3 years':'last 45 days',error:String(error.message||'Etsy financial sync failed.')})
        .then(()=>drawBatches())
        .catch(()=>{if(importStatus.textContent===message)importStatus.textContent+=' The failure could not be saved to recent actions.';});
    }finally{
      if(requestNotice)window.clearInterval(requestNotice);
      button.disabled=false;
    }
  });
  // Prevent duplicate listing scans from separate local tabs. The listing
  // worker is deliberately long-running; overlapping clicks can exhaust the
  // Edge Function before it can return a result.
  const listingImportLockKey='beadDifferentEtsyListingImportLock';
  root.addEventListener('click',(event)=>{
    const button=event.target.closest?.('[data-etsy-import="listings"]');
    if(!button)return;
    const now=Date.now();
    const existing=Number(localStorage.getItem(listingImportLockKey)||0);
    if(existing&&now-existing<180000){
      event.preventDefault();
      event.stopImmediatePropagation();
      const status=root.querySelector('[data-etsy-import-status]');
      if(status)status.textContent='Another Etsy listing scan is already running. Wait for it to finish before trying again.';
      return;
    }
    localStorage.setItem(listingImportLockKey,String(now));
    button.dataset.listingLockTimestamp=String(now);
    window.setTimeout(()=>{if(Number(localStorage.getItem(listingImportLockKey))===now)localStorage.removeItem(listingImportLockKey);},180000);
  },true);
  const display=(data)=>{
    status.textContent=data.connected?'Connected to '+data.shop_name+' (shop '+data.shop_id+'). Last verified: '+new Date(data.verified_at).toLocaleString()+'.':'No Etsy shop connected.';
    connect.textContent=data.connected?'Reconnect Etsy':'Connect Etsy';connect.disabled=false;
    verify.hidden=disconnect.hidden=!data.connected;
  };
  const busy=(value)=>root.querySelectorAll('button').forEach((button)=>{button.disabled=value;});
  const callbackResult=adminUrlParams.get('etsy');
  const notices={connected:'Etsy authorization completed.',denied:'Etsy access was declined. You can try again.',failed:'Etsy authorization could not be completed. Check your app settings and reconnect.','wrong-shop':'That account owns a different shop. Disconnect the existing shop first if you intend to replace it.'};
  try{display(await call('status'));if(notices[callbackResult])status.textContent=notices[callbackResult]+' '+status.textContent;await drawBatches();}catch(error){status.textContent=error.message;}
  connect.onclick=async()=>{busy(true);status.textContent='Opening Etsy authorization…';try{const result=await call('start');const url=new URL(result.authorize_url);if(url.origin!=='https://www.etsy.com'||url.pathname!=='/oauth/connect')throw new Error('Invalid Etsy authorization address.');window.location.assign(url.href);}catch(error){status.textContent=error.message;busy(false);}};
  verify.onclick=async()=>{busy(true);status.textContent='Verifying access with Etsy…';try{display(await call('verify'));}catch(error){status.textContent=error.message;}finally{busy(false);}};
  disconnect.onclick=async()=>{if(!window.confirm('Disconnect this Etsy shop? Stored connection tokens will be removed; existing imported data stays.'))return;busy(true);try{display(await call('disconnect'));}catch(error){status.textContent=error.message;}finally{busy(false);}};
}
function renderTab(){
  const tab=activeTab;
  const renderGeneration=adminTabRenderGeneration;
  const renderers={
    overview:()=>renderOverview(),
    etsy:()=>renderEtsyConnection(),
    categories:()=>renderCategories(),
    items:()=>withAdminTimeout(renderItems(),'Products request'),
    waitlist:()=>renderWaitlist(),
    stats:()=>renderStats(),
    subscribers:()=>renderSubscribers(),
    promos:()=>renderPromos(),
    reviews:()=>withAdminTimeout(renderReviews(),'Reviews section'),
    members:()=>withAdminTimeout(renderSimple('members','Members','Review customer accounts, notes, and account status.','No members yet.'),'Members section'),
    orders:()=>renderSimple('orders','Orders','Review order history and update shipping details.','No orders yet.'),
 settings:()=>{renderSettings();installCanonicalSettingsSave();restoreAdminThemeDefault();rememberAdminThemeDefault();void initializeAdminThemeSettings().then(()=>{initializeAdminThemeDisclosure();const settingsForm=panel.querySelector('#settings-form');const themes=panel.querySelector('[data-theme-settings]');const settingsActions=settingsForm?.querySelector('.admin-actions');if(settingsForm&&themes){if(settingsActions){settingsActions.remove();settingsForm.insertAdjacentElement('afterend',themes);themes.insertAdjacentElement('afterend',settingsActions);const saveButton=settingsActions.querySelector('button.cta');if(saveButton)saveButton.setAttribute('form',settingsForm.id);}else settingsForm.insertAdjacentElement('afterend',themes);}});},
    campaigns:()=>renderCampaigns(),
    content:()=>renderStoreContent(),
    contacts:()=>renderContactMessages(),
    'order-requests':()=>renderOrderSupportRequests('all'),
    'order-cancellations':()=>renderOrderSupportRequests('all'),
    'order-issues':()=>renderOrderSupportRequests('all'),
    inventory:()=>renderInventoryTools(document.body.dataset.inventoryTab||adminUrlParams.get('inventory')||'adjust').then(()=>{const sku=adminUrlParams.get('sku');const input=sku&&panel.querySelector('[data-sku-search]');if(input){input.value=sku;input.dispatchEvent(new Event('input'));}}),
    expenses:()=>withAdminTimeout(renderExpensesCanonical(),'Expenses request')
  };
  const renderer=renderers[activeTab];
  if(!renderer){panel.innerHTML='<div class="admin-empty">That Store Control section is unavailable.</div>';return;}
  Promise.resolve().then(renderer).catch((error)=>{if(activeTab!==tab||adminTabRenderGeneration!==renderGeneration)return;if(/timed out/i.test(error.message||''))adminTabRenderGeneration++;panel.innerHTML=`<div class="admin-empty">${adminSafe(error.message||'Unable to load this section.')}</div>`;});
}
const renderExpensesCanonical=async()=>{if(activeTab!=='expenses')return;if(!window.beadSupabase){panel.innerHTML='<div class="product-unavailable"><h2>Expenses require the connected store database.</h2><p>Sign in to the admin account connected to Supabase to record business expenses and reconciliations.</p></div>';return;}const [expenseResult,reconciliationResult]=await Promise.all([cloudAdmin().from('business_expenses').select('id,expense_date,vendor,category,amount,notes,receipt_path,receipt_name,created_at',{count:'exact'}).order('expense_date',{ascending:false}).range((expensePage-1)*25,expensePage*25-1),cloudAdmin().from('business_bank_reconciliations').select('id,period_month,starting_balance,ending_balance,notes,reconciled_at,updated_at').order('period_month',{ascending:false}).range(0,11)]);if(activeTab!=='expenses')return;if(expenseResult?.error||reconciliationResult?.error){const failure=expenseResult?.error||reconciliationResult?.error;panel.innerHTML='<div class="admin-empty">Unable to load Expenses: '+adminSafe(failure?.message||'The expense tables could not be read.')+'</div>';return;}const expenses=expenseResult.data||[];const reconciliations=reconciliationResult.data||[];const expensePageCount=Math.max(1,Math.ceil((expenseResult.count||0)/25));expensePage=Math.min(expensePage,expensePageCount);const today=new Date();let selectedMonth=today.toISOString().slice(0,7);let orders=[];let monthlySalesRows=[];let monthlyExpenseRows=[];let signedReceiptUrls=new Map();const monthLabel=(month)=>{const date=new Date(month+'-01T00:00:00');return Number.isNaN(date.getTime())?month:date.toLocaleDateString(undefined,{month:'long',year:'numeric'});};const reconciliationFor=(month)=>reconciliations.find((entry)=>String(entry.period_month||'').slice(0,7)===month);const monthSales=(month)=>Number(monthlySalesRows.find((row)=>String(row.month_start||'').slice(0,7)===month)?.order_total)||0;const monthExpenses=(month)=>Number(monthlyExpenseRows.find((row)=>String(row.month_start||'').slice(0,7)===month)?.expense_total)||0;const recentMonths=()=>[...new Set([selectedMonth,...reconciliations.map((entry)=>String(entry.period_month||'').slice(0,7)).filter(Boolean)])].sort().reverse().slice(0,12);const drawReconciliations=()=>{const body=panel.querySelector('[data-reconciliation-body]');if(!body)return;body.innerHTML=recentMonths().map((month)=>{const entry=reconciliationFor(month);const starting=entry?Number(entry.starting_balance||0):null;const sales=monthSales(month);const spent=monthExpenses(month);const expected=starting===null?null:starting+sales-spent;const ending=entry&&entry.ending_balance!==null&&entry.ending_balance!==undefined?Number(entry.ending_balance):null;const difference=ending===null||expected===null?null:ending-expected;return'<tr><td>'+adminSafe(monthLabel(month))+'</td><td>'+(starting===null?'—':'$'+starting.toFixed(2))+'</td><td>$'+sales.toFixed(2)+'</td><td>$'+spent.toFixed(2)+'</td><td>'+(expected===null?'—':'$'+expected.toFixed(2))+'</td><td>'+(ending===null?'—':'$'+ending.toFixed(2))+'</td><td>'+(difference===null?'Open':'$'+difference.toFixed(2))+'</td><td>'+(entry?.reconciled_at?'Reconciled':'Open')+'</td></tr>';}).join('')||'<tr><td colspan="8">No monthly reconciliations yet.</td></tr>';};const drawLedger=()=>{const body=panel.querySelector('[data-expense-body]');if(!body)return;body.innerHTML=expenses.map((expense)=>{const receipt=signedReceiptUrls.get(expense.id);return'<tr><td>'+adminSafe(expense.expense_date)+'</td><td>'+adminSafe(expense.category||'Other')+'</td><td>'+adminSafe(expense.vendor)+'</td><td>'+adminSafe(expense.notes||'—')+'</td><td>$'+Number(expense.amount||0).toFixed(2)+'</td><td>'+(receipt?'<a href="'+adminSafe(receipt)+'" target="_blank" rel="noreferrer">'+adminSafe(expense.receipt_name||'View receipt')+'</a>':'—')+'</td><td><button type="button" data-delete-expense="'+adminSafe(expense.id)+'">Delete</button></td></tr>';}).join('')||'<tr><td colspan="7">No expenses recorded yet.</td></tr>';};panel.innerHTML='<div class="admin-heading"><div><p class="kicker">BUSINESS OPERATIONS</p><h2>Expenses</h2><p>Record business expenses with vendor notes and private receipt copies. Expense totals flow into Metrics and stay separate from inventory purchases.</p></div></div><section class="admin-card"><h3>Add expense</h3><form class="admin-form" data-expense-form><div class="admin-form-grid"><label>Date<input name="expense_date" type="date" required value="'+adminSafe(today.toISOString().slice(0,10))+'"></label><label>Category<select name="category"><option selected>Other</option><option>Website fees</option><option>Insurance</option><option>Office supplies</option><option>Advertising &amp; marketing</option><option>Software &amp; subscriptions</option><option>Shipping &amp; postage</option><option>Equipment</option><option>Professional services</option><option>Taxes &amp; licenses</option><option>Utilities</option></select></label><label>Vendor<input name="vendor" required placeholder="Vendor name"></label><label>Amount<input name="amount" type="number" min="0" step="0.01" required placeholder="0.00"></label><label>Receipt copy<input name="receipt" type="file" accept="image/*,.pdf,application/pdf"></label></div><label>Notes<textarea name="notes" rows="3" placeholder="What was purchased or why was it paid?"></textarea><small>Receipt files are private and available only to admins. Maximum size: 10 MB.</small><div class="admin-actions"><button type="submit" class="cta">Save expense</button></div><p data-expense-status role="status"></p></form></section><section class="admin-card"><div class="admin-heading"><div><h3>Monthly bank reconciliation</h3><p>Enter the bank starting and ending balances. Expected ending balance equals starting balance plus net recorded orders minus recorded expenses. This estimate excludes processor fees, payout timing, taxes, and other bank activity.</p></div></div><form class="admin-form" data-reconciliation-form><div class="admin-form-grid"><label>Month<input name="period_month" type="month" required value="'+adminSafe(selectedMonth)+'"></label><label>Starting bank balance<input name="starting_balance" type="number" min="0" step="0.01" required value="'+(reconciliationFor(selectedMonth)?Number(reconciliationFor(selectedMonth).starting_balance||0).toFixed(2):'')+'"></label><label>Actual ending bank balance<input name="ending_balance" type="number" min="0" step="0.01" value="'+(reconciliationFor(selectedMonth)?.ending_balance===null||reconciliationFor(selectedMonth)?.ending_balance===undefined?'':Number(reconciliationFor(selectedMonth)?.ending_balance).toFixed(2))+'"></label></div><label>Reconciliation notes<textarea name="notes" rows="3" placeholder="Explain any difference or leave a note for the accountant.">'+adminSafe(reconciliationFor(selectedMonth)?.notes||'')+'</textarea><div class="admin-actions"><button type="submit" class="cta">Save reconciliation</button></div><p data-reconciliation-status role="status"></p></form><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Month</th><th>Starting</th><th>Net orders</th><th>Expenses</th><th>Expected ending</th><th>Actual ending</th><th>Difference</th><th>Status</th></tr></thead><tbody data-reconciliation-body></tbody></table></div></section><section class="admin-card"><div class="admin-heading"><div><h3>Expense ledger</h3><p>Most recent 25 expenses. Export the complete ledger for accounting.</p></div><button type="button" data-download-expenses>Export expenses CSV</button></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Date</th><th>Category</th><th>Vendor</th><th>Notes</th><th>Amount</th><th>Receipt</th><th></th></tr></thead><tbody data-expense-body></tbody></table></div><div class="admin-pagination"><button type="button" data-expense-page="prev" '+(expensePage<=1?'disabled':'')+'>Previous</button><span>Page '+expensePage+' of '+expensePageCount+'</span><button type="button" data-expense-page="next" '+(expensePage>=expensePageCount?'disabled':'')+'>Next</button></div></section>';drawLedger();drawReconciliations();const expenseForm=panel.querySelector('[data-expense-form]');expenseForm.addEventListener('submit',async(event)=>{event.preventDefault();const fields=Object.fromEntries(new FormData(expenseForm));const status=expenseForm.querySelector('[data-expense-status]');const amount=Number(fields.amount);const file=expenseForm.querySelector('[name="receipt"]').files?.[0];if(!String(fields.vendor||'').trim()||!Number.isFinite(amount)||amount<0){status.textContent='Enter a vendor and a non-negative amount.';return;}if(file&&file.size>10*1024*1024){status.textContent='Receipt files must be 10 MB or smaller.';return;}status.textContent='Saving expense…';let receiptPath=null;try{const userResult=await cloudAdmin().auth.getUser();const userId=userResult.data?.user?.id||null;if(file){const safeName=file.name.toLowerCase().replace(/[^a-z0-9._-]+/g,'-')||'receipt';receiptPath=(userId||'admin')+'/'+Date.now()+'-'+safeName;const upload=await cloudAdmin().storage.from('expense-receipts').upload(receiptPath,file,{upsert:false,contentType:file.type||undefined});if(upload.error)throw upload.error;}const result=await cloudAdmin().from('business_expenses').insert({expense_date:fields.expense_date,vendor:String(fields.vendor).trim(),category:String(fields.category||'Other').trim()||'Other',amount,notes:String(fields.notes||'').trim()||null,receipt_path:receiptPath,receipt_name:file?.name||null,created_by:userId}).select('id').single();if(result.error)throw result.error;await invalidateAdminAccountingInventoryCaches();await renderExpensesCanonical();}catch(error){if(receiptPath)await cloudAdmin().storage.from('expense-receipts').remove([receiptPath]);status.textContent='Expense was not saved: '+error.message;}});panel.querySelector('[data-reconciliation-form]').addEventListener('submit',async(event)=>{event.preventDefault();const form=event.currentTarget;const fields=Object.fromEntries(new FormData(form));const status=form.querySelector('[data-reconciliation-status]');const starting=Number(fields.starting_balance);const ending=String(fields.ending_balance||'').trim()===''?null:Number(fields.ending_balance);if(!/^\d{4}-\d{2}$/.test(fields.period_month)||!Number.isFinite(starting)||starting<0||(ending!==null&&(!Number.isFinite(ending)||ending<0))){status.textContent='Enter a valid month and non-negative balances.';return;}status.textContent='Saving reconciliation…';const userResult=await cloudAdmin().auth.getUser();const result=await cloudAdmin().from('business_bank_reconciliations').upsert({period_month:fields.period_month+'-01',starting_balance:starting,ending_balance:ending,notes:String(fields.notes||'').trim()||null,reconciled_at:ending===null?null:new Date().toISOString(),created_by:userResult.data?.user?.id||null,updated_at:new Date().toISOString()},{onConflict:'period_month'});if(result.error){status.textContent='Reconciliation was not saved: '+result.error.message;return;}selectedMonth=fields.period_month;await renderExpensesCanonical();});panel.querySelector('[name="period_month"]').addEventListener('change',(event)=>{selectedMonth=event.target.value;const current=reconciliationFor(selectedMonth);const form=panel.querySelector('[data-reconciliation-form]');if(form){form.elements.starting_balance.value=current?Number(current.starting_balance||0).toFixed(2):'';form.elements.ending_balance.value=current?.ending_balance===null||current?.ending_balance===undefined?'':Number(current.ending_balance).toFixed(2);form.elements.notes.value=current?.notes||'';}drawReconciliations();});panel.querySelector('[data-download-expenses]').onclick=async()=>{const button=panel.querySelector('[data-download-expenses]');button.disabled=true;try{const rows=await fetchAdminRowsAll(()=>cloudAdmin().from('business_expenses').select('expense_date,category,vendor,amount,notes,receipt_name,created_at').order('expense_date',{ascending:false}));expenseCsvDownload([['Date','Category','Vendor','Amount','Notes','Receipt file','Created at'],...rows.map((expense)=>[expense.expense_date,expense.category||'Other',expense.vendor,expense.amount,expense.notes||'',expense.receipt_name||'',expense.created_at||''])],'business-expenses.csv');}finally{button.disabled=false;}};panel.querySelectorAll('[data-delete-expense]').forEach((button)=>button.addEventListener('click',async()=>{if(!window.confirm('Delete this expense and its receipt copy?'))return;button.disabled=true;const expense=expenses.find((entry)=>entry.id===button.dataset.deleteExpense);const result=await cloudAdmin().from('business_expenses').delete().eq('id',button.dataset.deleteExpense);if(result.error){button.disabled=false;panel.querySelector('[data-expense-status]').textContent='Expense was not deleted: '+result.error.message;return;}if(expense?.receipt_path)await cloudAdmin().storage.from('expense-receipts').remove([expense.receipt_path]);await invalidateAdminAccountingInventoryCaches();await renderExpensesCanonical();}));panel.querySelectorAll('[data-expense-page]').forEach((button)=>button.addEventListener('click',()=>{expensePage+=button.dataset.expensePage==='next'?1:-1;void renderExpensesCanonical();}));void cloudAdmin().rpc('get_admin_monthly_order_sales').then((result)=>{if(!result.error&&activeTab==='expenses'){monthlySalesRows=result.data||[];drawReconciliations();}});void cloudAdmin().rpc('get_admin_monthly_expense_totals').then((result)=>{if(!result.error&&activeTab==='expenses'){monthlyExpenseRows=result.data||[];drawReconciliations();}});void Promise.all(expenses.filter((expense)=>expense.receipt_path).map(async(expense)=>{const signed=await cloudAdmin().storage.from('expense-receipts').createSignedUrl(expense.receipt_path,3600);if(!signed.error&&signed.data?.signedUrl)signedReceiptUrls.set(expense.id,signed.data.signedUrl);})).then(()=>{if(activeTab==='expenses'){drawLedger();}});};
let inventoryPurchaseRowsForReconciliation=[];
let businessExpenseRowsForReconciliation=[];
let inventoryPurchaseReceiptLoad=null;
let purchaseReconciliationDataLoaded=false;
const moneyFromCell=(cell)=>{const normalized=String(cell?.textContent||'').replace(/[^0-9.-]/g,'');if(!normalized||normalized==='-'||normalized==='.')return null;const value=Number(normalized);return Number.isFinite(value)?value:null;};
const renderInventoryPurchaseReceipts=async()=>{
  if(activeTab!=='expenses')return;
  const reconciliationBody=panel.querySelector('[data-reconciliation-body]');
  const expenseBody=panel.querySelector('[data-expense-body]');
  if(!reconciliationBody||!expenseBody)return;
  const reconciliationTable=reconciliationBody.closest('table');
  const headerRow=reconciliationTable?.querySelector('thead tr');
  if(headerRow&&headerRow.children.length===8){
    headerRow.children[3].textContent='Business expenses';
    const purchaseHeader=document.createElement('th');
    purchaseHeader.textContent='Inventory purchases';
    headerRow.children[3].after(purchaseHeader);
  }
  const reconciliationDescription=reconciliationTable?.closest('.admin-card')?.querySelector('.admin-heading p');
  if(reconciliationDescription)reconciliationDescription.textContent='Expected ending balance includes net recorded orders minus business expenses and inventory purchases. This estimate excludes processor fees, payout timing, taxes, and other bank activity.';
  const purchaseSection=panel.querySelector('[data-inventory-purchase-history]');
  if(!purchaseSection){
    inventoryPurchaseRowsForReconciliation=[];
    businessExpenseRowsForReconciliation=[];
    purchaseReconciliationDataLoaded=false;
    const section=document.createElement('section');
    section.className='admin-card';
    section.dataset.inventoryPurchaseHistory='';
    section.innerHTML='<div class="admin-heading"><div><h3>Inventory purchase receipts</h3><p>Download the private receipt copies attached to each purchase whenever you need them. Files are available only to admins.</p></div></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Date</th><th>Vendor</th><th>Reference / PO</th><th>Notes</th><th>Total</th><th>Receipt copies</th></tr></thead><tbody data-inventory-purchase-receipt-body><tr><td colspan="6">Loading inventory purchases…</td></tr></tbody></table></div>';
    expenseBody.closest('.admin-card')?.after(section);
    if(!inventoryPurchaseReceiptLoad){
      inventoryPurchaseReceiptLoad=(async()=>{
        const [rows,expenses,receiptFiles]=await Promise.all([
          fetchAdminRowsAll(()=>cloudAdmin().from('inventory_purchases').select('id,purchase_date,vendor,reference_number,notes,total_cost,receipt_path,receipt_name').order('purchase_date',{ascending:false})),
          fetchAdminRowsAll(()=>cloudAdmin().from('business_expenses').select('expense_date,amount').order('expense_date',{ascending:false})),
          fetchAdminRowsAll(()=>cloudAdmin().from('inventory_purchase_receipts').select('purchase_id,receipt_path,receipt_name').order('created_at',{ascending:true}))
        ]);
        const filesByPurchase=new Map();
        receiptFiles.forEach((file)=>{const files=filesByPurchase.get(file.purchase_id)||[];files.push(file);filesByPurchase.set(file.purchase_id,files);});
        const receipts=rows.map((purchase)=>({purchase,files:filesByPurchase.get(purchase.id)||(purchase.receipt_path?[{receipt_path:purchase.receipt_path,receipt_name:purchase.receipt_name}]:[])}));
        return{receipts,expenses};
      })();
    }
    try{
      const loaded=await inventoryPurchaseReceiptLoad;
      const receipts=loaded.receipts;
      inventoryPurchaseRowsForReconciliation=receipts.map(({purchase,files})=>({...purchase,receipt_files:files}));
      businessExpenseRowsForReconciliation=loaded.expenses;
      purchaseReconciliationDataLoaded=true;
      if(activeTab!=='expenses'||!section.isConnected)return;
      const receiptBody=section.querySelector('[data-inventory-purchase-receipt-body]');
      receiptBody.innerHTML=receipts.map(({purchase,files})=>'<tr><td>'+adminSafe(String(purchase.purchase_date||'').slice(0,10))+'</td><td>'+adminSafe(purchase.vendor||'')+'</td><td>'+adminSafe(purchase.reference_number||'—')+'</td><td>'+adminSafe(purchase.notes||'—')+'</td><td>$'+Number(purchase.total_cost||0).toFixed(2)+'</td><td>'+(files.length?files.map((file,index)=>'<button type="button" data-download-inventory-receipt="'+adminSafe(purchase.id)+'" data-receipt-index="'+index+'">Download '+adminSafe(file.receipt_name||'receipt')+'</button>').join(' '):'No receipt uploaded')+'</td></tr>').join('')||'<tr><td colspan="6">No inventory purchases recorded.</td></tr>';
      receiptBody.querySelectorAll('[data-download-inventory-receipt]').forEach((button)=>button.addEventListener('click',async()=>{
        const purchase=inventoryPurchaseRowsForReconciliation.find((row)=>row.id===button.dataset.downloadInventoryReceipt);
        const receipt=purchase?.receipt_files?.[Number(button.dataset.receiptIndex)];
        if(!receipt?.receipt_path)return;
        button.disabled=true;
        try{
          const result=await cloudAdmin().storage.from('expense-receipts').download(receipt.receipt_path);
          if(result.error)throw result.error;
          const url=URL.createObjectURL(result.data);
          const download=document.createElement('a');
          download.href=url;
          download.download=receipt.receipt_name||'inventory-purchase-receipt';
          document.body.append(download);
          download.click();
          download.remove();
          window.setTimeout(()=>URL.revokeObjectURL(url),1000);
        }catch(error){
          button.textContent='Download failed — retry';
          button.title=error.message||'Receipt download failed.';
        }finally{button.disabled=false;}
      }));
    }catch(error){
      if(section.isConnected)section.querySelector('[data-inventory-purchase-receipt-body]').innerHTML='<tr><td colspan="6">Unable to load inventory purchases: '+adminSafe(error.message||'Database request failed.')+'</td></tr>';
    }finally{inventoryPurchaseReceiptLoad=null;}
  }
  if(!purchaseReconciliationDataLoaded)return;
  const purchaseTotalsByMonth=new Map();
  inventoryPurchaseRowsForReconciliation.forEach((purchase)=>{
    const month=String(purchase.purchase_date||'').slice(0,7);
    if(month)purchaseTotalsByMonth.set(month,(purchaseTotalsByMonth.get(month)||0)+Number(purchase.total_cost||0));
  });
  const businessExpenseTotalsByMonth=new Map();
  businessExpenseRowsForReconciliation.forEach((expense)=>{
    const month=String(expense.expense_date||'').slice(0,7);
    if(month)businessExpenseTotalsByMonth.set(month,(businessExpenseTotalsByMonth.get(month)||0)+Number(expense.amount||0));
  });
  const allOutflowMonths=new Set([...purchaseTotalsByMonth.keys(),...businessExpenseTotalsByMonth.keys()]);
  reconciliationBody.querySelectorAll('tr').forEach((row)=>{
    const cells=[...row.children];
    if(cells.length===1){cells[0].colSpan=9;return;}
    if(cells.length<8)return;
    let purchaseCell=row.querySelector('[data-inventory-purchase-total]');
    if(!purchaseCell){
      purchaseCell=document.createElement('td');
      purchaseCell.dataset.inventoryPurchaseTotal='';
      cells[3].after(purchaseCell);
    }
    const label=String(cells[0].textContent||'').trim();
    const monthKey=[...allOutflowMonths].find((month)=>new Date(month+'-01T00:00:00').toLocaleDateString(undefined,{month:'long',year:'numeric'})===label)||'';
    const purchaseTotal=purchaseTotalsByMonth.get(monthKey)||0;
    const businessExpenseTotal=businessExpenseTotalsByMonth.get(monthKey)||0;
    purchaseCell.textContent='$'+purchaseTotal.toFixed(2);
    const currentCells=[...row.children];
    const starting=moneyFromCell(currentCells[1]);
    const sales=moneyFromCell(currentCells[2]);
    currentCells[3].textContent='$'+businessExpenseTotal.toFixed(2);
    const businessExpenses=businessExpenseTotal;
    const expectedCell=currentCells[5];
    const endingCell=currentCells[6];
    const differenceCell=currentCells[7];
    if(starting===null||sales===null||businessExpenses===null){expectedCell.textContent='—';differenceCell.textContent='Open';return;}
    const expected=starting+sales-businessExpenses-purchaseTotal;
    expectedCell.textContent='$'+expected.toFixed(2);
    const ending=moneyFromCell(endingCell);
    differenceCell.textContent=ending===null?'Open':'$'+(ending-expected).toFixed(2);
  });
};
const inventoryPurchasePanelObserver=new MutationObserver(()=>{
  if(activeTab!=='expenses'||panel.querySelector('[data-inventory-purchase-history]'))return;
  if(!panel.querySelector('[data-reconciliation-body]')||!panel.querySelector('[data-expense-body]'))return;
  void renderInventoryPurchaseReceipts();
});
inventoryPurchasePanelObserver.observe(panel,{childList:true,subtree:true});
void requireAdmin();
const restoreAdminRequestedBehavior=()=>{
  document.querySelectorAll('[data-theme-category-clear]').forEach((button)=>{button.type='button';});
  document.querySelectorAll('a[href="admin?new=item"]').forEach((link)=>{link.textContent='Add a product page';});
  const itemHeading=panel?.querySelector('#cloud-item-form')?.closest('.admin-heading')?.querySelector('h2');
  if(itemHeading&&itemHeading.textContent.trim()==='Add item')itemHeading.textContent='Add a product page';
  const inventoryTabs=panel?.querySelector('.inventory-tabs');
  if(inventoryTabs){const adjustment=inventoryTabs.querySelector('[data-inventory-tab="adjust"]');if(adjustment&&inventoryTabs.firstElementChild!==adjustment)inventoryTabs.prepend(adjustment);}
  panel?.querySelectorAll('table').forEach((table)=>{
    if(table.closest('#cloud-items-lists'))return;
    const headers=[...table.querySelectorAll('thead th')];
    const skuIndexes=headers.map((header,index)=>/^(our )?sku(?:\(s\)|s)?$/i.test(header.textContent.trim())?index:-1).filter((index)=>index>=0);
    skuIndexes.forEach((index)=>table.querySelectorAll('tbody tr').forEach((row)=>{
      const cell=row.children[index];
      if(!cell||cell.dataset.adminSkuLinked||cell.querySelector('a'))return;
      const values=cell.textContent.trim().split(/\s*,\s*/).filter((value)=>value&&value!=='—');
      if(!values.length)return;
      cell.replaceChildren(...values.flatMap((value,valueIndex)=>{const link=document.createElement('a');link.className='admin-sku-link';link.href='admin.html?inventory=sku&sku='+encodeURIComponent(value);link.textContent=value;return valueIndex?[' , ',link]:[link];}));
      cell.dataset.adminSkuLinked='true';
    }));
  });
  panel?.querySelectorAll('table').forEach((table)=>{
    const headers=[...table.querySelectorAll('thead th')];
    const storefrontIndex=headers.findIndex((header)=>header.textContent.trim().toLowerCase()==='storefront');
    if(storefrontIndex<0)return;
    if(!headers.some((header)=>header.textContent.trim().toLowerCase()==='feature')){const header=document.createElement('th');header.textContent='Feature';headers[storefrontIndex].insertAdjacentElement('afterend',header);table.querySelectorAll('tbody tr').forEach((row)=>{const storefront=row.children[storefrontIndex];if(!storefront)return;const cell=document.createElement('td');const id=storefront.querySelector('[data-toggle-visible]')?.dataset.toggleVisible;if(!id)return;const button=document.createElement('button');button.type='button';button.dataset.toggleFeatured=id;button.textContent='FEATURE';cell.append(button);storefront.insertAdjacentElement('afterend',cell);});}
    const featureButtons=[...table.querySelectorAll('[data-toggle-featured]')];
    const ids=[...new Set(featureButtons.map((button)=>button.dataset.toggleFeatured).filter(Boolean))].sort();
    const hydrationKey=ids.join('|');
    if(ids.length&&window.beadSupabase&&table.dataset.featureStateHydrationKey!==hydrationKey){
     table.dataset.featureStateHydrationKey=hydrationKey;
     table.dataset.featureStateHydration='loading';
     void cloudAdmin().from('products').select('id,featured').in('id',ids).then((result)=>{
      if(!table.isConnected||table.dataset.featureStateHydrationKey!==hydrationKey)return;
      if(result.error){table.dataset.featureStateHydration='failed';return;}
      const state=new Map((result.data||[]).map((row)=>[row.id,row.featured===true]));
      table.querySelectorAll('[data-toggle-featured]').forEach((button)=>{
       const featured=state.get(button.dataset.toggleFeatured)===true;
       const label=featured?'UNFEATURE':'FEATURE';
       button.dataset.featured=String(featured);
       if(button.textContent!==label)button.textContent=label;
      });
      table.dataset.featureStateHydration='loaded';
     }).catch(()=>{if(table.isConnected)table.dataset.featureStateHydration='failed';});
    }
  });
};
const adminRestorationObserver=new MutationObserver(()=>restoreAdminRequestedBehavior());
adminRestorationObserver.observe(document.body,{childList:true,subtree:true});
restoreAdminRequestedBehavior();
const syncFeatureButton=(button,featured)=>{button.dataset.featured=String(featured);button.textContent=featured?'UNFEATURE':'FEATURE';button.setAttribute('aria-label',featured?'Unfeature product':'Feature product');};
document.addEventListener('click',async(event)=>{
  const featureButton=event.target.closest?.('[data-toggle-featured]');
  if(featureButton){event.preventDefault();event.stopImmediatePropagation();const current=featureButton.dataset.featured==='true';const next=!current;syncFeatureButton(featureButton,next);featureButton.dataset.featuredPending='true';featureButton.disabled=true;featureButton.setAttribute('aria-busy','true');featureButton.textContent='SAVING…';try{const result=await cloudAdmin().from('products').update({featured:next}).eq('id',featureButton.dataset.toggleFeatured);if(result.error){syncFeatureButton(featureButton,current);renderCloudError(result.error);return;}syncFeatureButton(featureButton,next);}catch(error){syncFeatureButton(featureButton,current);renderCloudError(error);}finally{featureButton.disabled=false;featureButton.removeAttribute('aria-busy');delete featureButton.dataset.featuredPending;}return;}
  const clearButton=event.target.closest?.('[data-theme-category-clear]');
  if(clearButton)event.preventDefault();
},true);
const installProductEditorRestorations=async()=>{
  const form=document.querySelector('#cloud-item-form');
  if(!form||form.dataset.editorRestorations)return;
  form.dataset.editorRestorations='loading';
  const primary=form.elements.category_slug?.value||'';
  try{
    const categories=await cloudCategoryRows();
    if(!form.isConnected)return;
    const fieldset=document.createElement('label');
    fieldset.textContent='Additional storefront category';
    const select=document.createElement('select');
    select.size=1;select.dataset.additionalCategory='';select.name='additional_category_slugs';
    select.innerHTML='<option value="" selected>No additional category</option>'+categories.filter((category)=>category.slug&&category.slug!==primary).map((category)=>'<option value="'+adminSafe(category.slug)+'">'+adminSafe(category.name)+'</option>').join('');
    fieldset.append(select);
    form.querySelector('.admin-item-meta-row')?.append(fieldset);
    const productId=form.dataset.productId;
    if(productId){const result=await cloudAdmin().from('product_categories').select('category_slug').eq('product_id',productId);(result.data||[]).forEach((row)=>{if(row.category_slug===primary)return;const option=select.querySelector('option[value="'+CSS.escape(row.category_slug)+'"]');if(option)option.selected=true;});}
    form.dataset.editorRestorations='ready';
    select.dispatchEvent(new Event('change',{bubbles:true}));
  }catch(error){form.dataset.editorRestorations='ready';}
};
const productEditorRestorationObserver=new MutationObserver(()=>{void installProductEditorRestorations();});
productEditorRestorationObserver.observe(document.body,{childList:true,subtree:true});
void installProductEditorRestorations();
document.addEventListener('click',async(event)=>{
  const link=event.target.closest?.('a[href^="admin?inventory=sku"],a[href^="admin.html?inventory=sku"]');
  if(!link)return;
  event.preventDefault();
  const url=new URL(link.href,window.location.href);const sku=url.searchParams.get('sku')||'';const directInventory=url.searchParams.get('direct')==='inventory';
  if(directInventory){history.replaceState({},'',`admin.html?inventory=sku&sku=${encodeURIComponent(sku)}`);activeTab='inventory';document.querySelectorAll('[data-admin-tab]').forEach((button)=>button.classList.toggle('active',button.dataset.adminTab===activeTab));await renderInventoryTools('sku');const input=panel.querySelector('[data-sku-search]');if(input){input.value=sku;input.dispatchEvent(new Event('input'));}return;}
  try{
    const [optionSkuResult,optionInventoryResult,productResult]=await Promise.all([
      cloudAdmin().from('product_option_values').select('product_options(product_id)').eq('sku',sku).maybeSingle(),
      cloudAdmin().from('product_option_values').select('product_options(product_id)').eq('inventory_sku',sku).maybeSingle(),
      cloudAdmin().from('products').select('id').eq('sku',sku).maybeSingle()
    ]);
    const relation=optionSkuResult.data?.product_options||optionInventoryResult.data?.product_options;
    const productId=(Array.isArray(relation)?relation[0]?.product_id:relation?.product_id)||productResult.data?.id;
    if(productId){activeTab='items';document.querySelectorAll('[data-admin-tab]').forEach((button)=>button.classList.toggle('active',button.dataset.adminTab===activeTab));await openCloudItemForm(productId);return;}
    history.replaceState({},'',`admin.html?inventory=sku&sku=${encodeURIComponent(sku)}`);activeTab='inventory';document.querySelectorAll('[data-admin-tab]').forEach((button)=>button.classList.toggle('active',button.dataset.adminTab===activeTab));await renderInventoryTools('sku');const input=panel.querySelector('[data-sku-search]');if(input){input.value=sku;input.dispatchEvent(new Event('input'));}
  }catch(error){
    history.replaceState({},'',`admin.html?inventory=sku&sku=${encodeURIComponent(sku)}`);activeTab='inventory';
    document.querySelectorAll('[data-admin-tab]').forEach((button)=>button.classList.toggle('active',button.dataset.adminTab===activeTab));
    await renderInventoryTools('sku');
    const input=panel.querySelector('[data-sku-search]');
    if(input){input.value=sku;input.dispatchEvent(new Event('input'));}
  }
},true);
const expensePeriodBounds=(period)=>{const end=new Date();const start=period==='month'?new Date(end.getFullYear(),end.getMonth(),1):period==='year'?new Date(end.getFullYear(),0,1):period==='week'?new Date(end.getTime()-7*86400000):null;return{start,end};};
const expenseDateInPeriod=(date,period)=>{const bounds=expensePeriodBounds(period);const value=Date.parse(String(date||'')+'T00:00:00');return Number.isFinite(value)&&(!bounds.start||value>=bounds.start.getTime())&&value<bounds.end.getTime();};
const expenseCsvDownload=(rows,name)=>{const escape=(value)=>'"'+String(value??'').replace(/"/g,'""')+'"';const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([rows.map((row)=>row.map(escape).join(',')).join('\n')],{type:'text/csv;charset=utf-8'}));link.download=name;link.click();URL.revokeObjectURL(link.href);};
const installStateTaxMetrics=async()=>{
  if(activeTab!=='stats'||!panel.querySelector('#metrics-report')||panel.querySelector('[data-state-tax-metrics]'))return;
  const section=document.createElement('section');
  section.className='admin-card';
  section.dataset.stateTaxMetrics='loading';
  section.innerHTML='<div class="admin-heading"><div><h3>State order and tax tracking</h3><p>Order count, order total, and tax collected by shipping state.</p></div><div class="admin-report-launch-actions"><button type="button" data-run-state-tax>Run report</button><button type="button" data-run-state-tax-fresh>Run fresh report</button> <button type="button" data-download-state-tax disabled>Download CSV</button></div></div><p data-state-tax-status>Report not run. Click Run report to load state totals.</p><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>State</th><th>Order qty</th><th>Order total</th><th>Tax collected</th></tr></thead><tbody></tbody></table></div>';
  panel.append(section);
  section.querySelector('[data-run-state-tax]').onclick=()=>{panel.dataset.stateTaxMetricsRun='true';section.remove();void installStateTaxMetrics();};
  section.querySelector('[data-run-state-tax-fresh]').onclick=async()=>{clearAdminRowsCachePrefix('state-order-tax');await clearAdminReportCache('report:state-order-tax');panel.dataset.stateTaxMetricsRun='true';section.remove();void installStateTaxMetrics();};
  if(panel.dataset.stateTaxMetricsRun!=='true')return;
  try{
    const aggregate=await adminCachedReportRows('state-order-tax',()=>cloudAdmin().rpc('get_admin_state_order_tax'));
    if(!aggregate.error){
      const rows=(aggregate.data||[]).map((row)=>({state:String(row.state||'Unknown')==='OHIO'?'OH':String(row.state||'Unknown'),orders:Number(row.order_count)||0,total:Number(row.order_total)||0,tax:Number(row.tax_collected)||0}));
      section.querySelector('tbody').innerHTML=rows.map((row)=>'<tr><td>'+adminSafe(row.state)+'</td><td>'+row.orders+'</td><td>$'+row.total.toFixed(2)+'</td><td>$'+row.tax.toFixed(2)+'</td></tr>').join('')||'<tr><td colspan="4">No orders recorded yet.</td></tr>';
      section.querySelector('[data-state-tax-status]').textContent=rows.length+' state'+(rows.length===1?'':'s')+' tracked.'+(aggregate.__adminCachedAt?' Cached from '+new Date(aggregate.__adminCachedAt).toLocaleString()+'.':'');
      section.querySelector('[data-download-state-tax]').onclick=()=>download([['State','Order qty','Order total','Tax collected'],...rows.map((row)=>[row.state,row.orders,row.total.toFixed(2),row.tax.toFixed(2)])],'state-order-tax-report.csv');
      section.dataset.stateTaxMetrics='ready';
      return;
    }
    section.querySelector('tbody').innerHTML='<tr><td colspan="4">The server aggregate could not be loaded. No raw order download was attempted.</td></tr>';
    section.querySelector('[data-state-tax-status]').textContent='State totals are unavailable until the aggregate function is repaired.';
    section.querySelector('[data-download-state-tax]').disabled=true;
    section.dataset.stateTaxMetrics='error';
  }catch(error){section.querySelector('[data-state-tax-status]').textContent='Unable to load state order and tax totals: '+(error.message||'Unknown error.');section.dataset.stateTaxMetrics='error';}
};
const stateTaxMetricsObserver=new MutationObserver(()=>{void installStateTaxMetrics();});
stateTaxMetricsObserver.observe(panel,{childList:true,subtree:true});
void installStateTaxMetrics();
const installAdminCategoryFilterAssignments=async()=>{const select=document.querySelector('#cloud-item-category');if(!select||select.dataset.assignmentsLoaded)return;select.dataset.assignmentsLoaded='loading';try{const [categoryResult,assignmentResult]=await Promise.all([cloudAdmin().from('categories').select('slug,name').order('name').range(0,99),cloudAdmin().from('product_categories').select('category_slug').range(0,499)]);if(categoryResult.error)throw categoryResult.error;if(assignmentResult.error)throw assignmentResult.error;const slugs=[...new Set([...(categoryResult.data||[]).map((row)=>String(row.slug||'').trim()),...(assignmentResult.data||[]).map((row)=>String(row.category_slug||'').trim())].filter(Boolean))];const existing=new Set([...select.options].map((option)=>option.value));slugs.filter((slug)=>!existing.has(slug)).sort().forEach((slug)=>{const option=document.createElement('option');option.value=slug;option.textContent=(categoryResult.data||[]).find((row)=>row.slug===slug)?.name||slug;select.append(option);});select.dataset.assignmentsLoaded='true';}catch(error){select.dataset.assignmentsLoaded='error';}};const adminCategoryFilterObserver=new MutationObserver(()=>{if(document.querySelector('#cloud-item-category')){void installAdminCategoryFilterAssignments();}});adminCategoryFilterObserver.observe(document.body,{childList:true,subtree:true});
// Product editors own their submit lifecycle: the reliable editor handler
// validates hydration, disables the button, and renders any save error. A
// second document-level listener would disable the button first and make that
// canonical handler exit before it can save.
window.addEventListener('admin-product-saved',()=>{const showNotice=()=>{const heading=panel.querySelector('.admin-heading');if(!heading||panel.querySelector('[data-admin-save-notice]'))return false;const notice=document.createElement('p');notice.className='admin-saved';notice.dataset.adminSaveNotice='';notice.textContent='Product saved successfully.';heading.after(notice);window.setTimeout(()=>notice.remove(),5000);return true;};if(showNotice())return;const observer=new MutationObserver(()=>{if(showNotice())observer.disconnect();});observer.observe(panel,{childList:true,subtree:true});window.setTimeout(()=>observer.disconnect(),10000);});
const adminFilterDefinitionCache=new Map();
const loadAdminFilterDefinitionData=async(categorySlugs)=>{
  const slugs=[...new Set(categorySlugs.filter(Boolean))].sort();
  if(!slugs.length||!window.beadSupabase)return[];
  const cacheKey=slugs.join('|');
  const cached=adminFilterDefinitionCache.get(cacheKey);
  if(cached)return cached;
  const request=(async()=>{
    // Keep these reads explicit instead of depending on a nested PostgREST
    // relationship response. The editor runs with an authenticated admin
    // session, and a relation/embed error must not silently erase the filter UI.
    const [categoryResult,definitionResult,valueResult]=await Promise.all([
      cloudAdmin().from('storefront_filter_categories').select('category_slug,filter_id').in('category_slug',slugs).range(0,499),
      cloudAdmin().from('storefront_filter_definitions').select('id,key,label,scope,sort_order,active').eq('active',true).range(0,99),
      cloudAdmin().from('storefront_filter_values').select('id,filter_id,value_key,label,sort_order,active').eq('active',true).range(0,499)
    ]);
    if(categoryResult.error)throw categoryResult.error;
    if(definitionResult.error)throw definitionResult.error;
    if(valueResult.error)throw valueResult.error;
    const linkedIds=new Set((categoryResult.data||[]).map((row)=>row.filter_id).filter(Boolean));
    const valuesByFilter=new Map();
    (valueResult.data||[]).forEach((value)=>{
      if(!linkedIds.has(value.filter_id))return;
      const values=valuesByFilter.get(value.filter_id)||[];
      values.push(value);
      valuesByFilter.set(value.filter_id,values);
    });
    const categoryByFilter=new Map((categoryResult.data||[]).map((row)=>[row.filter_id,row.category_slug]));
    const definitionsById=new Map();
    (definitionResult.data||[]).forEach((definition)=>{
      if(!definition?.active||!linkedIds.has(definition.id)||definitionsById.has(definition.id))return;
      definitionsById.set(definition.id,{...definition,category_slug:categoryByFilter.get(definition.id)||'',values:(valuesByFilter.get(definition.id)||[]).sort((left,right)=>(Number(left.sort_order)||0)-(Number(right.sort_order)||0)||String(left.label||'').localeCompare(String(right.label||'')))});
    });
    return [...definitionsById.values()].sort((left,right)=>(Number(left.sort_order)||0)-(Number(right.sort_order)||0)||String(left.label||'').localeCompare(String(right.label||'')));
  })();
  adminFilterDefinitionCache.set(cacheKey,request);
  try{return await request;}catch(error){adminFilterDefinitionCache.delete(cacheKey);throw error;}
};
const adminFilterCategorySlugs=(form)=>[form.elements.category_slug?.value||'',form.querySelector('[data-additional-category]')?.value||''].filter(Boolean);
const installAdminSkuFilterEditors=async(form)=>{
  if(!form||['loading','ready'].includes(form.dataset.skuFilterEditorsInstalled))return;
  form.dataset.skuFilterEditorsInstalled='loading';
  let drawToken=0;
  let assignments=[];
  let assignmentLoadError='';
  const loadAssignments=async()=>{
    const productId=form.dataset.productId;
    if(!productId)return;
    const result=await cloudAdmin().from('product_filter_assignments').select('filter_value_id,inventory_sku_id').eq('product_id',productId);
    if(result.error){assignmentLoadError=result.error.message||'Existing filter assignments could not be loaded.';assignments=[];return;}
    assignments=(result.data||[]).map((entry)=>({filter_value_id:entry.filter_value_id,inventory_sku_id:entry.inventory_sku_id||''})).filter((entry)=>entry.filter_value_id);
  };
  const draw=async()=>{
    const token=++drawToken;
    const definitions=await loadAdminFilterDefinitionData(adminFilterCategorySlugs(form));
    if(token!==drawToken||!form.isConnected)return;
    const skuInputs=[...form.querySelectorAll('[data-variant-row] [data-variant-sku]')];
    const skus=[...new Set(skuInputs.map((input)=>String(input.value||'').trim()).filter(Boolean))];
    const inventoryBySku=new Map();
    if(skus.length){const result=await adminBatchRows(skus,(batch)=>cloudAdmin().from('inventory_skus').select('id,sku,source_metadata').in('sku',batch));if(result.error)throw result.error;(result.data||[]).forEach((row)=>inventoryBySku.set(String(row.sku).toLowerCase(),row));}
    const assignmentKeys=new Set(assignments.map((row)=>`${row.filter_value_id}:${row.inventory_sku_id||''}`));
    const canonicalFilterAssignments=new Map();
    const canonicalFilterInventoryIds=new Set();
    inventoryBySku.forEach((inventory)=>{
      const metadata=inventory.source_metadata&&typeof inventory.source_metadata==='object'?inventory.source_metadata:{};
      const answers=Array.isArray(metadata.variant_values)?metadata.variant_values:[];
      if(Object.prototype.hasOwnProperty.call(metadata,'variant_values'))canonicalFilterInventoryIds.add(inventory.id);
      answers.forEach((answer)=>{
        const answerKey=String(answer?.key||answer?.filter_key||'').trim().toLowerCase();
        const definition=definitions.find((entry)=>answerKey&&String(entry.key||'').trim().toLowerCase()===answerKey)||definitions.find((entry)=>String(entry.label||'').trim().toLowerCase()===String(answer?.name||'').trim().toLowerCase());
        const choice=definition?.values.find((value)=>[value.label,value.value_key].filter(Boolean).some((candidate)=>String(candidate).trim().toLowerCase()===String(answer?.value||'').trim().toLowerCase()));
        if(!choice)return;
        const key=`${choice.id}:${inventory.id}`;
        canonicalFilterAssignments.set(inventory.id+':'+definition.id,choice.id);
        if(assignmentKeys.has(key))return;
        assignmentKeys.add(key);assignments.push({filter_value_id:choice.id,inventory_sku_id:inventory.id});
      });
    });
    form.querySelectorAll('[data-variant-row] .admin-sku-filter-editor').forEach((editor)=>editor.remove());
    form.querySelectorAll('[data-variant-row]').forEach((row)=>{
      const sku=String(row.querySelector('[data-variant-sku]')?.value||'').trim();
       const inventoryId=inventoryBySku.get(sku.toLowerCase())?.id||'';
      const editor=document.createElement('section');
      editor.className='admin-sku-filter-editor';
      const heading=document.createElement('h3');heading.textContent='Storefront filters';editor.append(heading);
       if(definitions.length){const grid=document.createElement('div');grid.className='admin-sku-filter-grid';definitions.forEach((definition)=>{const label=document.createElement('label');label.textContent=definition.label;const select=document.createElement('select');select.dataset.skuFilterValue='';select.dataset.filterId=definition.id;select.dataset.filterKey=definition.key||'';select.dataset.filterLabel=definition.label;select.dataset.inventorySkuId=inventoryId;select.dataset.sku=sku;const blank=document.createElement('option');blank.value='';blank.textContent='Not assigned';select.append(blank);const canonicalChoiceId=canonicalFilterAssignments.get(inventoryId+':'+definition.id);const assigned=canonicalFilterInventoryIds.has(inventoryId)?(canonicalChoiceId?{filter_value_id:canonicalChoiceId}:null):assignments.find((assignment)=>assignment.inventory_sku_id===inventoryId&&assignment.filter_value_id&&definition.values.some((value)=>value.id===assignment.filter_value_id))||assignments.find((assignment)=>!assignment.inventory_sku_id&&assignment.filter_value_id&&definition.values.some((value)=>value.id===assignment.filter_value_id));definition.values.forEach((value)=>{const option=document.createElement('option');option.value=value.id;option.textContent=value.label;option.selected=assigned?.filter_value_id===value.id;select.append(option);});label.append(select);grid.append(label);});editor.append(grid);}      row.querySelector('.admin-sku-internal')?.before(editor);
    });
  };
  const showError=(error)=>{
    form.dataset.skuFilterEditorError=error.message||'Unable to load storefront filters.';
    form.querySelectorAll('[data-sku-filter-editor-error]').forEach((notice)=>notice.remove());
    const notice=document.createElement('p');
    notice.dataset.skuFilterEditorError='';
    notice.className='admin-save-error';
    notice.textContent=`Storefront filters could not be loaded: ${form.dataset.skuFilterEditorError}`;
    form.querySelector('[data-variant-list]')?.before(notice);
  };
  const drawWithTransientRetry=async()=>{
    try{return await draw();}
    catch(error){
      if(!(error instanceof TypeError)||!/failed to fetch/i.test(String(error.message||'')))throw error;
      await new Promise((resolve)=>setTimeout(resolve,250));
      return draw();
    }
  };
  const redraw=()=>{
    const refresh=drawWithTransientRetry().then(()=>{
      form.dataset.skuFilterEditorsInstalled='ready';
      form.querySelectorAll('[data-sku-filter-editor-error]').forEach((notice)=>notice.remove());
      return true;
    }).catch((error)=>{
      form.dataset.skuFilterEditorsInstalled='error';
      showError(error);
      throw error;
    });
    form._productFilterEditorsRefreshPromise=refresh;
    return refresh;
  };
  form.addEventListener('sku-list-changed',()=>{void redraw().catch(()=>{});});
  form.addEventListener('change',(event)=>{if(event.target.matches('[name="category_slug"],[data-additional-category]'))void redraw().catch(()=>{});});
  try{
    // Draw the filter choices as soon as definitions and values are available.
    // Existing assignments are secondary hydration and must not make the
    // editor appear incomplete when that read is slow or unavailable.
    const assignmentsPromise=loadAssignments();
    await drawWithTransientRetry();
    await assignmentsPromise;
    if(assignments.length)await drawWithTransientRetry();
    form.dataset.skuFilterEditorsInstalled='ready';
    form.querySelectorAll('[data-sku-filter-editor-error]').forEach((notice)=>notice.remove());
    if(assignmentLoadError){const notice=document.createElement('p');notice.className='inventory-help';notice.textContent=`Existing storefront filter selections could not be loaded: ${assignmentLoadError}`;form.querySelector('[data-variant-list]')?.before(notice);}
  }
  catch(error){form.dataset.skuFilterEditorsInstalled='error';showError(error);}
};
window.saveAdminProductFilterAssignments=async(productId,form)=>{
  if(!productId||!form)return;
  const selects=[...form.querySelectorAll('[data-sku-filter-value]')];
  if(!selects.length)return;
  const skus=[...new Set(selects.map((select)=>String(select.closest('[data-variant-row]')?.querySelector('[data-variant-sku]')?.value||select.dataset.sku||'').trim()).filter(Boolean))];
  const inventoryBySku=new Map();
  if(skus.length){
    const result=await adminBatchRows(skus,(batch)=>cloudAdmin().from('inventory_skus').select('id,sku').in('sku',batch));
    if(result.error)throw result.error;
    (result.data||[]).forEach((row)=>inventoryBySku.set(String(row.sku||'').trim().toLowerCase(),row.id));
  }
  const selected=selects.map((select)=>{
    const sku=String(select.closest('[data-variant-row]')?.querySelector('[data-variant-sku]')?.value||select.dataset.sku||'').trim();
    return {filter_value_id:select.value,inventory_sku_id:select.dataset.inventorySkuId||inventoryBySku.get(sku.toLowerCase())||''};
  }).filter((entry)=>entry.filter_value_id&&entry.inventory_sku_id);
   const unique=[...new Map(selected.map((entry)=>[`${entry.filter_value_id}:${entry.inventory_sku_id}`,entry])).values()];
   const remove=await cloudAdmin().from('product_filter_assignments').delete().eq('product_id',productId);if(remove.error)throw remove.error;
   if(unique.length){const insert=await cloudAdmin().from('product_filter_assignments').insert(unique.map((entry)=>({...entry,product_id:productId})));if(insert.error)throw insert.error;}
   const inventoryAnswers=new Map();
   selects.filter((select)=>select.dataset.inventorySkuId).forEach((select)=>{
     const record=inventoryAnswers.get(select.dataset.inventorySkuId)||{names:new Set(),keys:new Set(),answers:[]};
     const name=String(select.dataset.filterLabel||'').trim();
     const key=String(select.dataset.filterKey||'').trim().toLowerCase();
     if(name)record.names.add(name.toLowerCase());
     if(key)record.keys.add(key);
     if(select.value)record.answers.push({key:key||null,name,value:String(select.selectedOptions[0]?.textContent||'').trim()});
     inventoryAnswers.set(select.dataset.inventorySkuId,record);
   });
   const inventoryIds=[...inventoryAnswers.keys()];
   if(inventoryIds.length){
     const currentResult=await cloudAdmin().from('inventory_skus').select('id,source_metadata').in('id',inventoryIds);
     if(currentResult.error)throw currentResult.error;
     const currentById=new Map((currentResult.data||[]).map((row)=>[row.id,row]));
     const updatedAt=new Date().toISOString();
     const updates=inventoryIds.map((inventoryId)=>{
       const record=inventoryAnswers.get(inventoryId);
       const current=currentById.get(inventoryId);
       const metadata=current?.source_metadata&&typeof current.source_metadata==='object'?current.source_metadata:{};
       const existing=Array.isArray(metadata.variant_values)?metadata.variant_values:[];
       const byName=new Map(existing.map((entry)=>{const name=String(entry?.name||entry?.label||'').trim();const key=String(entry?.key||entry?.filter_key||'').trim().toLowerCase();return[key||name.toLowerCase(),{key:key||null,name,value:String(entry?.value??entry?.answer??'').trim()}];}).filter((entry)=>entry[0]&&entry[1].name&&entry[1].value&&!record.keys.has(entry[0])&&!record.names.has(entry[1].name.toLowerCase())));
       record.answers.forEach((answer)=>{if(answer.name&&answer.value)byName.set(answer.name.toLowerCase(),answer);});
       return cloudAdmin().from('inventory_skus').update({source_metadata:{...metadata,variant_values:[...byName.values()]},updated_at:updatedAt}).eq('id',inventoryId);
     });
     const results=await Promise.all(updates);
     const failed=results.find((result)=>result.error);
     if(failed)throw failed.error;
   }
 };
window.installAdminSkuFilterEditors=installAdminSkuFilterEditors;
const installProductPageOptionHydrationGuard=(form)=>{
  if(!form||form.dataset.productPageOptionHydrationGuard)return;
  form.dataset.productPageOptionHydrationGuard='true';
  const apply=()=>{
    const hydrating=form.dataset.productPageOptionsHydrating==='true';
    const unavailable=form.dataset.productPageOptionsHydrating==='error';
    form.querySelectorAll('[data-product-page-answer]').forEach((field)=>{
      field.disabled=hydrating||unavailable;
      field.placeholder=unavailable?'Saved answer unavailable — refresh editor':hydrating?'Loading saved answer…':'Enter answer';
      field.title=unavailable?'Saved product-page option values could not be loaded safely. Refresh the editor before saving.':hydrating?'Loading saved product-page option values.':'';
    });
  };
  form.addEventListener('product-page-options-recovered',apply);
  form.addEventListener('product-page-options-recovery-failed',apply);
  new MutationObserver(apply).observe(form,{childList:true,subtree:true});
  apply();
};
const adminMediaRows=(form)=>[...form.querySelectorAll('[data-existing-media]')];
const syncAdminMediaPositions=(form)=>adminMediaRows(form).forEach((row,index)=>{const input=row.querySelector('[data-media-position]');if(input)input.value=String(index+1);});
const moveAdminMediaRow=(form,row,delta)=>{
  const container=row?.parentElement;
  const rows=adminMediaRows(form).filter((entry)=>entry.parentElement===container);
  const current=rows.indexOf(row);
  const target=current+delta;
  if(!container||current<0||target<0||target>=rows.length)return;
  if(delta<0)container.insertBefore(row,rows[target]);
  else container.insertBefore(rows[target],row);
  syncAdminMediaPositions(form);
};
const initializeAdminMediaReordering=(form)=>{
  adminMediaRows(form).forEach((row)=>{
    let positionLabel=row.querySelector('.admin-media-position');
    let positionInput=row.querySelector('[data-media-position]');
    if(!positionLabel){
      positionLabel=document.createElement('label');
      positionLabel.className='admin-media-position';
      positionLabel.textContent='Position';
      positionInput=document.createElement('input');
      positionInput.type='number';
      positionInput.min='1';
      positionInput.step='1';
      positionInput.dataset.mediaPosition='';
      positionLabel.append(positionInput);
      row.insertBefore(positionLabel,row.firstElementChild);
    }
    if(positionInput&&!positionInput.dataset.mediaPositionBound){
      positionInput.dataset.mediaPositionBound='true';
      positionInput.addEventListener('change',()=>{
        const rows=adminMediaRows(form).filter((entry)=>entry.parentElement===row.parentElement);
        const current=rows.indexOf(row);
        const target=Math.max(0,Math.min(rows.length-1,Number(positionInput.value||1)-1));
        if(current!==target){
          if(target<current)row.parentElement.insertBefore(row,rows[target]);
          else row.parentElement.insertBefore(rows[target],row);
        }
        syncAdminMediaPositions(form);
      });
    }
    if(!positionLabel.querySelector('[data-media-move-controls]')){
      const controls=document.createElement('span');
      controls.dataset.mediaMoveControls='';
      const up=document.createElement('button');
      up.type='button';
      up.dataset.mediaMove='up';
      up.textContent='↑';
      up.title='Move photo up';
      up.setAttribute('aria-label','Move photo up');
      const down=document.createElement('button');
      down.type='button';
      down.dataset.mediaMove='down';
      down.textContent='↓';
      down.title='Move photo down';
      down.setAttribute('aria-label','Move photo down');
      controls.append(up,down);
      positionLabel.append(controls);
      up.addEventListener('click',()=>moveAdminMediaRow(form,row,-1));
      down.addEventListener('click',()=>moveAdminMediaRow(form,row,1));
    }
  });
  syncAdminMediaPositions(form);
};
const addAdminPhotoOption=(form,media)=>{
  if(!media?.url)return;
  const label=adminMediaName(media.url,media.alt_text||'');
  form.querySelectorAll('[data-variant-photo]').forEach((select)=>{
    if([...select.options].some((option)=>option.value===media.url))return;
    select.append(new Option(label,media.url));
  });
};
const appendAdminUploadedMediaRow=(form,media,pending=false)=>{
  const row=document.createElement('div');
  row.className='admin-media-row';
  if(pending){
    row.dataset.manualMedia='';
    row.innerHTML='<input data-display-name placeholder="Display name (optional)" aria-label="New media display name"><input data-manual-url placeholder="https://..." aria-label="New media URL"><select data-manual-type aria-label="New media type"><option value="image">Image</option><option value="video">Video</option></select><button type="button" data-remove-manual>Remove</button>';
    row.querySelector('[data-manual-url]').value=media.url||'';
    row.querySelector('[data-display-name]').value=media.alt_text||adminMediaName(media.url,'');
    row.querySelector('[data-manual-type]').value=media.media_type||'image';
    row.querySelector('[data-remove-manual]').addEventListener('click',()=>row.remove());
    const list=form.querySelector('[data-manual-url-list]');
    (list||form.querySelector('.admin-media-editor'))?.append(row);
  }else{
    row.dataset.existingMedia='';
    row.dataset.mediaId=media.id||'';
    row.innerHTML='<input data-display-name value="" aria-label="Photo display name" placeholder="Display name"><input data-existing-url value="" aria-label="Media URL"><select data-existing-type aria-label="Media type"><option value="image">Image</option><option value="video">Video</option></select><button type="button" data-remove-media>Remove</button>';
    row.querySelector('[data-existing-url]').value=media.url||'';
    row.querySelector('[data-display-name]').value=media.alt_text||adminMediaName(media.url,'');
    row.querySelector('[data-existing-type]').value=media.media_type||'image';
    const remove=row.querySelector('[data-remove-media]');
    remove.checked=false;
    remove.addEventListener('click',()=>{remove.checked=true;row.hidden=true;});
    const manualList=form.querySelector('[data-manual-url-list]');
    if(manualList)manualList.before(row);else form.querySelector('.admin-media-editor')?.append(row);
  }
  renderAdminMediaPreviews(form);
  initializeAdminMediaReordering(form);
};
const initializeAdminMediaUploadButton=async(form)=>{
  if(!form||form.dataset.mediaUploadReady)return;
  const input=form.querySelector('[name="media"]');
  if(!input)return;
  form.dataset.mediaUploadReady='true';
  const button=document.createElement('button');
  button.type='button';
  button.className='admin-media-upload-action';
  button.textContent='Upload selected photo(s) now';
  const status=document.createElement('span');
  status.className='admin-media-upload-status';
  status.setAttribute('role','status');
  input.insertAdjacentElement('afterend',button);
  button.insertAdjacentElement('afterend',status);
  button.addEventListener('click',async()=>{
    const files=[...(input.files||[])];
    if(!files.length){status.textContent='Choose one or more photos first.';return;}
    if(!window.beadSupabase){status.textContent='Photo uploads require the connected store database.';return;}
    const productId=String(form.dataset.productId||'').trim();
    button.disabled=true;
    status.textContent='Uploading photo(s)…';
    try{
      for(const file of files){
        const mediaType=file.type.startsWith('video/')?'video':'image';
        const url=await uploadAdminMedia(file,productId?'products/'+productId:'products/pending');
        if(!url)continue;
        const media={url,alt_text:file.name,media_type:mediaType};
        if(productId){
          const order=adminMediaRows(form).length;
          const result=await cloudAdmin().from('product_images').insert({product_id:productId,url,alt_text:file.name,media_type:mediaType,sort_order:order}).select('id,url,alt_text,media_type,sort_order').single();
          if(result.error)throw result.error;
          appendAdminUploadedMediaRow(form,result.data||{...media,id:''},false);
          addAdminPhotoOption(form,result.data||media);
        }else{
          appendAdminUploadedMediaRow(form,media,true);
          addAdminPhotoOption(form,media);
        }
      }
      input.value='';
      status.textContent=productId?'Photo(s) uploaded and added to this page.':'Photo(s) staged; save this new page once to attach them.';
    }catch(error){
      status.textContent='Photo upload failed: '+(error.message||'Unknown error.');
    }finally{button.disabled=false;}
  });
  initializeAdminMediaReordering(form);
};
const initializeCanonicalAdminMedia=async(form)=>{if(!form||form.dataset.mediaEditorReady)return;form.dataset.mediaEditorReady='true';renderAdminMediaPreviews(form);const rows=()=>[...form.querySelectorAll('[data-existing-media]')];const list=()=>rows()[0]?.parentElement;const sync=()=>rows().forEach((row,index)=>{const position=row.querySelector('[data-media-position]');if(position)position.value=String(index+1);});rows().forEach((row)=>{const position=document.createElement('label');position.className='admin-media-position';position.textContent='Position';const input=document.createElement('input');input.type='number';input.min='1';input.step='1';input.dataset.mediaPosition='';position.append(input);row.insertBefore(position,row.firstElementChild);input.addEventListener('change',()=>{const mediaRows=rows();const current=mediaRows.indexOf(row);const target=Math.max(1,Math.min(mediaRows.length,Number(input.value)||1))-1;if(current===target)return;const container=list();const reference=mediaRows[target];if(container&&reference)container.insertBefore(row,current<target?reference.nextSibling:reference);sync();});});sync();};
function setAdminEditorRoute(id){
  const url=new URL(window.location.href);
  url.search='';
  if(id)url.searchParams.set('edit',id);
  else url.searchParams.set('new','item');
  history.replaceState({},'',url.href);
}
const recoverAdminProductPageOptions=async(form)=>{
  const input=form?.querySelector('[name="sku_filter_definitions"]');
  const productId=String(form?.dataset.productId||'').trim();
  if(!input||!productId||!window.beadSupabase){form.dataset.productPageOptionsHydrating='false';form.dispatchEvent(new Event('product-page-options-recovered'));return;}
  let existing=[];
  try{existing=JSON.parse(input.value||'[]');}catch(error){existing=[];}
  if(!Array.isArray(existing))existing=[];
  const rows=[...form.querySelectorAll('[data-variant-row]')];
  const skus=[...new Set(rows.map((row)=>String(row.querySelector('[data-variant-sku]')?.value||'').trim()).filter(Boolean))];
  if(!skus.length){form.dataset.productPageOptionsHydrating='false';form.dispatchEvent(new Event('product-page-options-recovered'));return;}
  const result=await withAdminEditorTimeout(adminBatchRows(skus,(batch)=>cloudAdmin().from('inventory_skus').select('sku,source_metadata').in('sku',batch)),'Product page option recovery');
  if(result.error)throw result.error;
  const byLabel=new Map(existing.map((definition)=>{const label=String(definition?.label||'').trim();return[label.toLowerCase(),{label,options:{}}];}).filter(([key,definition])=>key&&definition.label));
  (result.data||[]).forEach((record)=>{
    const sku=String(record.sku||'').trim();
    const metadata=record.source_metadata&&typeof record.source_metadata==='object'?record.source_metadata:{};
    const pages=metadata.product_pages&&typeof metadata.product_pages==='object'?metadata.product_pages:{};
    const page=pages[productId]&&typeof pages[productId]==='object'?pages[productId]:{};
    (Array.isArray(page.options)?page.options:[]).forEach((answer)=>{
      const label=String(answer?.name||'').trim();
      const value=String(answer?.value??'').trim();
      if(!label||!value)return;
      const key=label.toLowerCase();
      if(!byLabel.has(key)&&byLabel.size>=3)return;
      const definition=byLabel.get(key)||{label,options:{}};
      definition.options[sku]=value;
      byLabel.set(key,definition);
    });
  });
  input.value=JSON.stringify([...byLabel.values()].slice(0,3));
  form.dispatchEvent(new Event('product-page-options-recovered'));
};
const installReliableProductEditorSave=(form,id)=>{
  if(!form||form.dataset.reliableSaveInstalled)return;
  form.dataset.reliableSaveInstalled='true';
  // Native constraint validation can suppress submit entirely while an async
  // SKU/filter hydration pass is still filling required fields. The handler
  // below performs the canonical validation and renders a readable error.
  form.noValidate=true;
  form.addEventListener('submit',async(event)=>{
    event.preventDefault();
    event.stopImmediatePropagation();
    const submitButton=form.querySelector('button.cta');
    if(submitButton?.disabled)return;
    if(submitButton){submitButton.disabled=true;submitButton.textContent='Saving…';}
    try{
      if(form._productFilterEditorsReadyPromise)await form._productFilterEditorsReadyPromise;
      if(form._productFilterEditorsRefreshPromise)await form._productFilterEditorsRefreshPromise;
      const missingRequired=[...form.querySelectorAll('[required]')].find((field)=>!field.disabled&&!String(field.value||'').trim());
      if(missingRequired)throw new Error((missingRequired.labels?.[0]?.textContent||missingRequired.name||'Required field').replace(/\s+/g,' ').trim()+' is required.');
      const fields=Object.fromEntries(new FormData(form));
      await saveCloudProductWithMappings(id,fields,form);
      if(fields.finalize_inventory_setup==='on'&&window.beadSupabase){
        const values=JSON.parse(fields.sku_data||'[]').flatMap((option)=>option.values||[]);
        const skus=[...new Set(values.map((value)=>String(value.inventory_sku||value.sku||'').trim()).filter(Boolean))];
        const lookup=await withAdminEditorTimeout(adminBatchRows(skus,(batch)=>cloudAdmin().from('inventory_skus').select('id').in('sku',batch)),'Finalizing inventory setup');
        if(lookup.error)throw lookup.error;
        const result=await withAdminEditorTimeout(cloudAdmin().rpc('finalize_inventory_sku_setup',{inventory_sku_ids:(lookup.data||[]).map((row)=>row.id)}),'Finalizing inventory setup');
        if(result.error)throw result.error;
      }
      renderItems();
    }catch(error){renderCloudError(error);}
  },true);
};
const openCloudItemForm=async(id)=>{
  setAdminEditorRoute(id);
  // Give immediate feedback instead of leaving the previous catalog view on
  // screen while the editor's Supabase requests are in flight.
  if(panel)panel.innerHTML='<div class="admin-empty admin-loading" role="status">Loading product editor…</div>';
  try{
    await cloudItemForm(id);
  }catch(error){
    // A transient browser-level fetch failure is safe to retry once because
    // cloudItemForm only paints after its reads complete.
    if(error instanceof TypeError&&/failed to fetch/i.test(String(error.message||''))){
      await new Promise((resolve)=>setTimeout(resolve,250));
      await cloudItemForm(id);
    }else throw error;
  }
  const form=document.querySelector('#cloud-item-form');
  if(form){
    const requestedSku=adminUrlParams.get('sku');
    if(requestedSku){
      const matchingRow=[...form.querySelectorAll('[data-variant-row]')].find((row)=>String(row.querySelector('[data-variant-sku]')?.value||'').trim().toLowerCase()===String(requestedSku).trim().toLowerCase());
      if(matchingRow){
        matchingRow.classList.add('admin-sku-focus');
        window.setTimeout(()=>matchingRow.scrollIntoView({block:'center',behavior:'smooth'}),0);
      }
    }
    // Paint the editor and the customer-facing filter controls first. Media
    // upload wiring and canonical recovery are independent hydration work and
    // must not delay the first usable editor render.
    installCanonicalProductPageOptions(form);
    installProductPageOptionHydrationGuard(form);
    installReliableProductEditorSave(form,id);
    const filterPromise=window.installAdminSkuFilterEditors?withAdminEditorTimeout(window.installAdminSkuFilterEditors(form),'Storefront filter hydration'):Promise.resolve();
    form._productFilterEditorsReadyPromise=filterPromise.then(()=>{if(form.dataset.skuFilterEditorsInstalled==='error')throw new Error('Storefront filters could not be loaded. Refresh the editor before saving so existing selections stay safe.');return true;});
    const recoveryPromise=recoverAdminProductPageOptions(form).then(()=>true).catch((error)=>{form.dataset.productPageOptionsHydrating='error';form.dataset.productPageOptionsRecoveryFailed='true';form.dataset.productPageOptionsRecoveryError=error.message||'Product page option recovery failed.';form.querySelector('[data-product-page-options-recovery-error]')?.remove();const notice=document.createElement('p');notice.dataset.productPageOptionsRecoveryError='';notice.className='admin-save-error';notice.textContent='Saved product page option values could not be loaded: '+form.dataset.productPageOptionsRecoveryError;form.querySelector('[data-variant-list]')?.before(notice);form.dispatchEvent(new Event('product-page-options-recovery-failed'));return false;});
    form._productPageOptionsReadyPromise=recoveryPromise;
    void Promise.allSettled([
      initializeCanonicalAdminMedia(form),
      initializeAdminMediaUploadButton(form),
      installProductEditorRestorations(),
      recoveryPromise,
      filterPromise
    ]);
    form.addEventListener('input',(event)=>{if(event.target.matches('[data-variant-sku]'))form.dispatchEvent(new Event('sku-list-changed'));});
  }
};
document.addEventListener('click',(event)=>{if(event.target.closest?.('[data-cancel]'))clearAdminRoute();},true);
document.addEventListener('click',(event)=>{
  const link=event.target.closest?.('a[href]');
  if(!link)return;
  const url=new URL(link.href,window.location.href);
  if(!/admin(?:\.html)?$/i.test(url.pathname.split('/').pop()||''))return;
  const editorId=url.searchParams.get('edit');
  const isNew=url.searchParams.get('new')==='item';
  if(!editorId&&!isNew)return;
  if(link.target==='_blank'||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  event.preventDefault();
  event.stopImmediatePropagation();
  activeTab='items';
  document.querySelectorAll('[data-admin-tab]').forEach((button)=>button.classList.toggle('active',button.dataset.adminTab==='items'));
  void openCloudItemForm(editorId||undefined).catch(renderCloudError);
},true);
const renderAdminCategoryFilterManager=async(categorySlug)=>{
  adminFilterDefinitionCache.clear();
  if(!cloudAdmin()){renderCloudError(new Error('Supabase is not connected.'));return;}
  try{
    const categories=await cloudCategoryRows();
    const category=categories.find((entry)=>entry.slug===categorySlug);
    if(!category)throw new Error('Category was not found.');
    const [definitionResult,linkResult,valueResult]=await Promise.all([
      cloudAdmin().from('storefront_filter_definitions').select('id,key,label,scope,active,sort_order').order('sort_order').order('label').range(0,99),
      cloudAdmin().from('storefront_filter_categories').select('filter_id,category_slug').eq('category_slug',categorySlug).range(0,499),
      cloudAdmin().from('storefront_filter_values').select('id,filter_id,value_key,label,active,sort_order').order('sort_order').order('label').range(0,499)
    ]);
    if(definitionResult.error)throw definitionResult.error;
    if(linkResult.error)throw linkResult.error;
    if(valueResult.error)throw valueResult.error;
    const linkedIds=new Set((linkResult.data||[]).map((row)=>row.filter_id));
    const definitions=(definitionResult.data||[]).filter((definition)=>linkedIds.has(definition.id));
    const available=(definitionResult.data||[]).filter((definition)=>!linkedIds.has(definition.id));
    const valuesByFilter=new Map();
    (valueResult.data||[]).forEach((value)=>{const values=valuesByFilter.get(value.filter_id)||[];values.push(value);valuesByFilter.set(value.filter_id,values);});
    const definitionMarkup=definitions.map((definition)=>{
      const values=valuesByFilter.get(definition.id)||[];
      return `<article class="admin-filter-definition" data-filter-definition="${adminSafe(definition.id)}"><form data-filter-definition-save><h3>${adminSafe(definition.label)}</h3><div class="admin-form-grid"><label>Filter name<input name="label" required value="${adminSafe(definition.label)}"></label><label>Key<input name="key" readonly value="${adminSafe(definition.key)}"></label></div><label class="admin-toggle"><input name="active" type="checkbox" ${definition.active?'checked':''}> Active and available for this category</label><div class="admin-actions"><button type="submit" class="cta">Save filter</button><button type="button" data-filter-category-remove>Remove from category</button></div></form><div class="admin-filter-value-editor"><h4>Customer choices</h4>${values.map((value)=>`<form class="admin-filter-value-row" data-filter-value-form="${adminSafe(value.id)}"><input name="label" required value="${adminSafe(value.label)}" aria-label="Filter value label"><input name="value_key" readonly value="${adminSafe(value.value_key)}" aria-label="Filter value key"><label class="admin-toggle"><input name="active" type="checkbox" ${value.active?'checked':''}> Active</label><button type="submit">Save</button><button type="button" data-filter-value-delete>Delete</button></form>`).join('')||'<p>No choices yet.</p>'}<form class="admin-filter-value-add" data-filter-value-add><input name="label" required placeholder="New choice label" aria-label="New choice label"><input name="value_key" placeholder="Generated key" aria-label="New choice key"><button type="submit">Add choice</button></form></div></article>`;
    }).join('');
    panel.innerHTML=`<div class="admin-heading"><div><p class="kicker">CATEGORY FILTERS</p><h2>${adminSafe(category.name)}</h2><p>Choose the filter questions customers can use on this category. Products select their values per SKU in the product editor.</p></div><button type="button" data-filter-back>Back to categories</button></div><section class="admin-card admin-category-filter-manager"><div class="admin-category-filter-add"><form data-filter-create class="admin-category-filter-form"><h3>Create a filter question</h3><div class="admin-category-filter-fields"><label>Filter name<input name="label" required placeholder="Example: Finish"></label><label>Key<input name="key" placeholder="Generated from name"><small class="admin-field-help">A stable internal identifier, such as <code>finish</code>, used to connect this filter to saved SKU values. Keep it unchanged after creation.</small></label></div><button type="submit" class="cta">Create and add filter</button></form><form data-filter-link class="admin-category-filter-form"><h3>Add an existing filter</h3><p class="admin-field-help">Choose a filter that is already configured, then make it available on this category.</p><label class="admin-filter-link-field">Available filter<select name="filter_id"><option value="">Choose a filter</option>${available.map((definition)=>`<option value="${adminSafe(definition.id)}">${adminSafe(definition.label)} · ${adminSafe(definition.key)}</option>`).join('')||'<option value="">All filters are already added</option>'}</select></label><button type="submit">Add filter to category</button></form></div><div class="admin-category-filter-list">${definitionMarkup||'<p>No filters are assigned to this category yet.</p>'}</div></section>`;
    panel.querySelector('[data-filter-back]').addEventListener('click',renderCloudCategories);
    panel.querySelector('[data-filter-create]').addEventListener('submit',async(event)=>{event.preventDefault();const form=event.currentTarget;const label=String(form.elements.label.value||'').trim();const key=adminSlug(form.elements.key.value||label);if(!label||!key){renderCloudError(new Error('A filter name is required.'));return;}try{const result=await cloudAdmin().from('storefront_filter_definitions').insert({key,label,scope:'variant',active:true,sort_order:(definitionResult.data||[]).length*10+10}).select('id').single();if(result.error)throw result.error;const link=await cloudAdmin().from('storefront_filter_categories').insert({filter_id:result.data.id,category_slug:categorySlug});if(link.error)throw link.error;await renderAdminCategoryFilterManager(categorySlug);}catch(error){renderCloudError(error);}});
    panel.querySelector('[data-filter-link]').addEventListener('submit',async(event)=>{event.preventDefault();const filterId=event.currentTarget.elements.filter_id.value;if(!filterId)return;const result=await cloudAdmin().from('storefront_filter_categories').insert({filter_id:filterId,category_slug:categorySlug});if(result.error){renderCloudError(result.error);return;}await renderAdminCategoryFilterManager(categorySlug);});
    panel.querySelectorAll('[data-filter-definition-save]').forEach((form)=>form.addEventListener('submit',async(event)=>{event.preventDefault();const definition=form.closest('[data-filter-definition]');const label=String(form.elements.label.value||'').trim();if(!label){renderCloudError(new Error('A filter name is required.'));return;}const submit=form.querySelector('button[type="submit"]');if(submit){submit.disabled=true;submit.textContent='Saving…';}const result=await cloudAdmin().from('storefront_filter_definitions').update({label,active:form.elements.active.checked}).eq('id',definition.dataset.filterDefinition).select('id').single();if(result.error){renderCloudError(result.error);return;}await renderAdminCategoryFilterManager(categorySlug);}));
    panel.querySelectorAll('[data-filter-category-remove]').forEach((button)=>button.addEventListener('click',async()=>{const definition=button.closest('[data-filter-definition]');if(!window.confirm('Remove this filter from the category?'))return;const result=await cloudAdmin().from('storefront_filter_categories').delete().eq('filter_id',definition.dataset.filterDefinition).eq('category_slug',categorySlug);if(result.error){renderCloudError(result.error);return;}await renderAdminCategoryFilterManager(categorySlug);}));
    panel.querySelectorAll('[data-filter-value-form]').forEach((form)=>form.addEventListener('submit',async(event)=>{event.preventDefault();const label=String(form.elements.label.value||'').trim();if(!label){renderCloudError(new Error('A customer choice label is required.'));return;}const submit=form.querySelector('button[type="submit"]');if(submit){submit.disabled=true;submit.textContent='Saving…';}const result=await cloudAdmin().from('storefront_filter_values').update({label,active:form.elements.active.checked}).eq('id',form.dataset.filterValueForm).select('id').single();if(result.error){renderCloudError(result.error);return;}await renderAdminCategoryFilterManager(categorySlug);}));
    panel.querySelectorAll('[data-filter-value-delete]').forEach((button)=>button.addEventListener('click',async()=>{const form=button.closest('[data-filter-value-form]');if(!window.confirm('Delete this customer choice? Existing SKU assignments using it will be removed.'))return;const result=await cloudAdmin().from('storefront_filter_values').delete().eq('id',form.dataset.filterValueForm);if(result.error){renderCloudError(result.error);return;}await renderAdminCategoryFilterManager(categorySlug);}));
    panel.querySelectorAll('[data-filter-value-add]').forEach((form)=>form.addEventListener('submit',async(event)=>{event.preventDefault();const definition=form.closest('[data-filter-definition]');const label=String(form.elements.label.value||'').trim();const valueKey=adminSlug(form.elements.value_key.value||label);if(!label||!valueKey){renderCloudError(new Error('A filter choice label is required.'));return;}const result=await cloudAdmin().from('storefront_filter_values').insert({filter_id:definition.dataset.filterDefinition,value_key:valueKey,label,active:true,sort_order:(valuesByFilter.get(definition.dataset.filterDefinition)||[]).length*10+10});if(result.error){renderCloudError(result.error);return;}await renderAdminCategoryFilterManager(categorySlug);}));
  }catch(error){renderCloudError(error);}
};
const initializeAdminThemeImageControls=()=>{const form=panel?.querySelector('[data-theme-form]');if(!form||form.dataset.themeImageControls)return;form.dataset.themeImageControls='true';const presetSelect=form.elements.theme_preset;const fields=[{name:'hero',key:'heroUrl',label:'Homepage hero image'},{name:'logo',key:'logoUrl',label:'Main logo'},{name:'story',key:'storyUrl',label:'Our Story image'},{name:'background',key:'pageBackgroundImageUrl',label:'Page background image'},{name:'footerLogo',key:'footerLogoUrl',label:'Footer logo'}];const parsePresets=(value)=>{if(Array.isArray(value))return value;if(typeof value==='string'){try{const parsed=JSON.parse(value);return Array.isArray(parsed)?parsed:[];}catch(error){return[];}}return[];};const getState=async()=>{const local=adminData().settings||{};let value={admin:local,config:window.productStoreConfig||{}};if(window.beadSupabase){try{const result=await cloudAdmin().from('site_settings').select('value').eq('key','store').maybeSingle();if(!result.error&&result.data?.value)value=result.data.value;}catch(error){throw error;}}const admin=value.admin&&typeof value.admin==='object'?value.admin:{};const config=value.config&&typeof value.config==='object'?value.config:{};const presets=parsePresets(admin.themePresets);const selectedValue=String(presetSelect?.value||'');const index=Number(selectedValue);const preset=selectedValue==='__locked_default__'?null:Number.isInteger(index)&&index>=0?presets[index]:null;const defaultSnapshot=admin.themeDefaultSnapshot&&typeof admin.themeDefaultSnapshot==='object'?admin.themeDefaultSnapshot:{};return{value,admin,config,presets,index,preset,defaultSnapshot,selectedValue};};const getUrl=(field,state)=>{if(state.selectedValue==='__locked_default__')return safeAdminThemeImageUrl(state.defaultSnapshot[field.key]);if(state.preset)return safeAdminThemeImageUrl(state.preset[field.key]||state.defaultSnapshot[field.key]);return safeAdminThemeImageUrl(state.admin[field.key]??state.config[field.key]);};const metaByName=new Map();fields.forEach((field)=>{const input=form.elements[field.name];const host=input?.closest('label');if(!input||!host)return;const meta=document.createElement('div');meta.className='admin-theme-image-meta';meta.dataset.themeImageMeta=field.name;host.append(meta);metaByName.set(field.name,meta);input.addEventListener('change',()=>{void renderMeta();});});const renderMeta=async()=>{const state=await getState();fields.forEach((field)=>{const input=form.elements[field.name];const meta=metaByName.get(field.name);if(!input||!meta)return;const file=input.files?.[0];const url=getUrl(field,state);const objectUrl=file?URL.createObjectURL(file):'';if(meta.dataset.objectUrl)URL.revokeObjectURL(meta.dataset.objectUrl);meta.dataset.objectUrl=objectUrl;meta.replaceChildren();const overrideUrl=state.selectedValue==='__locked_default__'?'':state.preset?safeAdminThemeImageUrl(state.preset[field.key]):safeAdminThemeImageUrl(state.admin[field.key]??state.config[field.key]);const status=document.createElement('strong');status.textContent=file?'NEW IMAGE SELECTED':overrideUrl?'CUSTOM IMAGE LOADED':url?'DEFAULT IMAGE LOADED':'NO CUSTOM IMAGE — DEFAULT WILL BE USED';const preview=document.createElement('img');preview.className='admin-theme-image-preview';preview.alt='';preview.hidden=!(file||url);preview.src=objectUrl||url;const remove=document.createElement('button');remove.type='button';remove.className='admin-theme-image-remove';remove.dataset.themeImageRemove=field.name;remove.textContent='Remove image / Use default';remove.disabled=!(file||overrideUrl)||state.selectedValue==='__locked_default__';meta.append(status,preview,remove);});};const removeImage=async(name)=>{const field=fields.find((entry)=>entry.name===name);const input=form.elements[name];const meta=metaByName.get(name);if(!field||!input||!meta)return;const button=meta.querySelector('[data-theme-image-remove]');if(button)button.disabled=true;const state=await getState();if(state.selectedValue==='__locked_default__'){const status=meta.querySelector('strong');if(status)status.textContent='DEFAULT IMAGE CANNOT BE REMOVED';return;}const currentUrl=getUrl(field,state);if(input.files?.length)input.value='';if(!currentUrl){await renderMeta();return;}try{const nextPresets=state.presets.map((preset,index)=>index===state.index?{...preset,[field.key]:''}:preset);const selectedPreset=state.preset;const active=selectedPreset&&JSON.stringify(state.admin.theme||{})===JSON.stringify(selectedPreset.theme||{});const nextAdmin={...state.admin,themePresets:nextPresets};const nextConfig={...state.config};if(!selectedPreset||active){const fallbackUrl=safeAdminThemeImageUrl(state.defaultSnapshot[field.key]);nextAdmin[field.key]=fallbackUrl;nextConfig[field.key]=fallbackUrl;}const nextValue={...state.value,config:nextConfig,admin:nextAdmin};if(!window.beadSupabase)throw new Error('The store database is unavailable.');const result=await patchAdminStoreSettings({admin:nextAdmin});const local=adminData();local.settings={...(local.settings||{}),...nextAdmin};saveAdminData(local);localStorage.setItem('beadDifferentProductConfig',JSON.stringify(nextConfig));await renderMeta();}catch(error){const status=meta.querySelector('strong');if(status)status.textContent='IMAGE WAS NOT REMOVED: '+(error.message||'Unknown error');if(button)button.disabled=false;}};form.addEventListener('click',(event)=>{const button=event.target.closest('[data-theme-image-remove]');if(button){event.preventDefault();void removeImage(button.dataset.themeImageRemove);}});presetSelect?.addEventListener('change',()=>setTimeout(()=>void renderMeta(),0));void renderMeta();};new MutationObserver(()=>initializeAdminThemeImageControls()).observe(panel,{childList:true,subtree:true});initializeAdminThemeImageControls();
const initializeAdminThemeCategoryPhotoPreviews=()=>{const form=panel?.querySelector('[data-theme-form]');const list=form?.querySelector('[data-theme-category-list]');if(!form||!list)return;const getPersisted=(input)=>safeAdminThemeImageUrl(input.dataset.themeCategoryCurrent)||safeAdminThemeImageUrl(input.dataset.themeCategoryDefault);list.querySelectorAll('[data-theme-category]').forEach((input)=>{if(input.dataset.categoryPreviewReady)return;input.dataset.categoryPreviewReady='true';const preview=document.createElement('img');preview.className='admin-theme-category-preview';preview.alt=(input.closest('label')?.querySelector('span')?.textContent||'Category')+' preview';preview.hidden=true;input.insertAdjacentElement('afterend',preview);const render=()=>{if(preview.dataset.objectUrl)URL.revokeObjectURL(preview.dataset.objectUrl);const file=input.files?.[0];const source=file?URL.createObjectURL(file):getPersisted(input);if(file)preview.dataset.objectUrl=source;else delete preview.dataset.objectUrl;preview.hidden=!source;preview.src=source||'';};input.addEventListener('change',render);render();});};new MutationObserver(()=>initializeAdminThemeCategoryPhotoPreviews()).observe(panel,{childList:true,subtree:true});initializeAdminThemeCategoryPhotoPreviews();
const initializeAdminSkuSetupLocks=()=>{const form=panel?.querySelector('.admin-item-form');if(!form)return;if(!form.dataset.skuSetupLockListeners){form.dataset.skuSetupLockListeners='true';form.addEventListener('input',(event)=>{if(event.target.matches('[data-variant-sku],[data-variant-inventory-sku]')){const row=event.target.closest('[data-variant-row]');if(row){delete row.dataset.setupLockSku;void initializeAdminSkuSetupLocks();void renderAdminRecipeSummaries(form);}}});form.addEventListener('change',(event)=>{if(event.target.matches('[data-variant-disposition]')){void renderAdminRecipeSummaries(form);void saveAdminSkuDisposition(event.target.closest('[data-variant-row]'));}});}
const finishRow=(row,sku,record)=>{if(!row.isConnected)return;const metadata=record?.source_metadata&&typeof record.source_metadata==='object'?record.source_metadata:{};const locked=metadata.setup_locked===true;const disposition=canonicalSkuDisposition(record);const internalGrid=row.querySelector('.admin-sku-internal .admin-form-grid');if(internalGrid&&!internalGrid.querySelector('[data-variant-disposition]')){const dispositionLabel=document.createElement('label');dispositionLabel.textContent='SKU type';const dispositionSelect=document.createElement('select');dispositionSelect.dataset.variantDisposition='';dispositionSelect.innerHTML='<option value="inventory">Inventory / child</option><option value="recipe_parent">Parent / non-inventory</option>';dispositionLabel.append(dispositionSelect);internalGrid.prepend(dispositionLabel);}const dispositionInput=row.querySelector('[data-variant-disposition]');if(dispositionInput)dispositionInput.value=disposition;if(disposition==='recipe_parent'){void renderAdminRecipeSummaries(form);}const controlled=['[data-variant-sku]','[data-variant-quantity]','[data-variant-threshold]','[data-variant-inventory-sku]','[data-variant-inventory-units]','[data-variant-item-type]','[data-variant-disposition]','[data-variant-cost]','[data-variant-weight]','[data-variant-weight-unit]','[data-variant-unit-type]','[data-variant-reserve]'];controlled.forEach((selector)=>{const field=row.querySelector(selector);if(!field)return;field.disabled=locked;field.readOnly=locked;field.classList.toggle('admin-sku-locked-field',locked);field.title=locked?'Locked after initial inventory setup. Changes require the Year-end audit CSV.':'';});row.dataset.setupLockSku=sku;row.dataset.setupLocked=locked?'true':'false';row.dataset.setupLockPending='false';};
const pending=[];form.querySelectorAll('[data-variant-row]').forEach((row)=>{const skuInput=row.querySelector('[data-variant-sku]');const sku=String(row.querySelector('[data-variant-inventory-sku]')?.value||skuInput?.value||'').trim();if(!sku||row.dataset.setupLockPending==='true'||row.dataset.setupLockSku===sku)return;row.dataset.setupLockPending='true';pending.push({row,sku});});if(!pending.length)return;if(!window.beadSupabase){pending.forEach(({row,sku})=>finishRow(row,sku,null));return;}const skus=[...new Set(pending.map(({sku})=>sku))];void adminBatchRows(skus,(batch)=>cloudAdmin().from('inventory_skus').select('id,sku,item_type,hierarchy,source_metadata').in('sku',batch)).then(async(result)=>{if(result.error){pending.forEach(({row,sku})=>finishRow(row,sku,null));return;}const bySku=new Map((result.data||[]).map((record)=>[String(record.sku||'').trim().toLowerCase(),record]));const missing=pending.filter(({sku})=>!bySku.has(sku.toLowerCase()));if(missing.length){const fallback=await Promise.all(missing.map(({sku})=>cloudAdmin().from('inventory_skus').select('id,sku,item_type,hierarchy,source_metadata').ilike('sku',sku).maybeSingle()));fallback.forEach((response,index)=>{if(!response.error&&response.data)bySku.set(missing[index].sku.toLowerCase(),response.data);});}pending.forEach(({row,sku})=>finishRow(row,sku,bySku.get(sku.toLowerCase())||null));}).catch(()=>pending.forEach(({row,sku})=>finishRow(row,sku,null)));};
const saveAdminSkuDisposition=async(row)=>{if(!row||row.dataset.setupLocked==='true'||!window.beadSupabase)return;const sku=String(row.querySelector('[data-variant-inventory-sku]')?.value||row.querySelector('[data-variant-sku]')?.value||'').trim();const requestedDisposition=String(row.querySelector('[data-variant-disposition]')?.value||'inventory');const disposition=requestedDisposition==='recipe_parent'?'recipe_parent':'inventory';const typeInput=row.querySelector('[data-variant-item-type]');if(typeInput)typeInput.value=disposition==='recipe_parent'?'Non-inventory':'Inventory';const result=await cloudAdmin().from('inventory_skus').select('id').ilike('sku',sku).maybeSingle();if(result.error||!result.data)return;const applied=await cloudAdmin().rpc('apply_inventory_sku_disposition',{inventory_sku_id_value:result.data.id,disposition_value:disposition});if(applied.error){row.dataset.dispositionError=applied.error.message;return;}row.dataset.dispositionError='';delete row.dataset.setupLockSku;void initializeAdminSkuSetupLocks();};new MutationObserver(()=>initializeAdminSkuSetupLocks()).observe(panel,{childList:true,subtree:true});initializeAdminSkuSetupLocks();
const initializeAdminProductLeadLinks=()=>{panel?.querySelectorAll('.admin-product-lead:not([data-admin-product-link-ready])').forEach((image)=>{const editHref=image.closest('tr')?.querySelector('a[href*="admin.html?edit="]')?.getAttribute('href');if(!editHref)return;const link=document.createElement('a');link.className='admin-product-lead-link';link.href=editHref.replace(/^admin\.html\?edit=/,'product.html?id=');link.target='_blank';link.rel='noreferrer';link.setAttribute('aria-label',`Open ${image.alt||'product'} storefront page`);image.dataset.adminProductLinkReady='true';image.replaceWith(link);link.append(image);});};new MutationObserver(()=>initializeAdminProductLeadLinks()).observe(panel,{childList:true,subtree:true});initializeAdminProductLeadLinks();
const initializeAdminActiveThemeSelection=()=>{const form=panel?.querySelector('[data-theme-form]');const select=form?.elements?.theme_preset;if(!form||!select||select.dataset.activeThemeReady)return;select.dataset.activeThemeReady='true';const normalizePhotos=(value)=>value&&typeof value==='object'?value:{};const selectActive=()=>{const settings=adminData().settings||{};const config=window.productStoreConfig||{};const presets=Array.isArray(settings.themePresets)?settings.themePresets:[];const active=normalizeAdminTheme(settings.theme||config.theme);const snapshot=settings.themeDefaultSnapshot||{};if(JSON.stringify(active)===JSON.stringify(normalizeAdminTheme(snapshot.theme||{}))&&select.querySelector('[value="__locked_default__"]')){select.value='__locked_default__';return;}const index=presets.findIndex((preset)=>JSON.stringify(normalizeAdminTheme(preset?.theme||{}))===JSON.stringify(active));if(index>=0&&select.options[index+2])select.value=String(index);};const loadDefaultCategoryPreviews=async()=>{if(select.value!=='__locked_default__'||!window.beadSupabase)return;const result=await cloudAdmin().from('categories').select('slug,cover_photo').range(0,99);if(result.error)return;const photos=Object.fromEntries((result.data||[]).map((category)=>[category.slug,safeAdminThemeImageUrl(category.cover_photo)]));form.querySelectorAll('[data-theme-category]').forEach((input)=>{const preview=input.nextElementSibling;if(preview?.matches('img.admin-theme-category-preview')&&photos[input.dataset.themeCategory]){preview.hidden=false;preview.src=photos[input.dataset.themeCategory];}});};select.addEventListener('change',()=>{void loadDefaultCategoryPreviews();});selectActive();void loadDefaultCategoryPreviews();};new MutationObserver(()=>initializeAdminActiveThemeSelection()).observe(panel,{childList:true,subtree:true});initializeAdminActiveThemeSelection();
const renderAdminGlobalFilterManager=async()=>{
  if(!cloudAdmin()){renderCloudError(new Error('Supabase is not connected.'));return;}
  try{
    const [definitionResult,valueResult]=await Promise.all([
      cloudAdmin().from('storefront_filter_definitions').select('id,key,label,active,sort_order').order('sort_order').order('label').range(0,99),
      cloudAdmin().from('storefront_filter_values').select('id,filter_id,value_key,label,active,sort_order').order('sort_order').order('label').range(0,499)
    ]);
    if(definitionResult.error)throw definitionResult.error;
    if(valueResult.error)throw valueResult.error;
    const definitions=definitionResult.data||[];
    const valuesByFilter=new Map();
    (valueResult.data||[]).forEach((value)=>{const values=valuesByFilter.get(value.filter_id)||[];values.push(value);valuesByFilter.set(value.filter_id,values);});
    const cards=definitions.map((definition)=>{
      const values=valuesByFilter.get(definition.id)||[];
      const choices=values.map((value)=>`<form class="admin-filter-value-row global-filter-value-row" data-global-filter-value="${adminSafe(value.id)}"><label>Customer choice<input name="label" required value="${adminSafe(value.label)}"></label><label>Key<input name="value_key" readonly value="${adminSafe(value.value_key)}"></label><label class="admin-toggle"><input name="active" type="checkbox" ${value.active?'checked':''}> Active</label><button type="submit">Save choice</button><button type="button" class="admin-filter-delete" data-global-filter-value-delete>Delete choice</button></form>`).join('');
      return `<article class="admin-filter-definition" data-global-filter-definition="${adminSafe(definition.id)}"><form data-global-filter-save><h3>${adminSafe(definition.label)}</h3><label>Filter name<input name="label" required value="${adminSafe(definition.label)}"></label><label>Key<input name="key" readonly value="${adminSafe(definition.key)}"></label><label class="admin-toggle"><input name="active" type="checkbox" ${definition.active?'checked':''}> Active everywhere linked</label><div class="admin-actions"><button type="submit" class="cta">Save filter</button><button type="button" class="admin-filter-delete" data-global-filter-delete>Delete filter everywhere</button></div></form><div class="admin-filter-value-editor"><h4>Customer choices</h4><p>Choice is the wording customers see. Its generated key stays fixed if you change that wording.</p>${choices||'<p>No customer choices yet.</p>'}<form class="admin-filter-value-add global-filter-value-add" data-global-filter-value-add><label>New customer choice<input name="label" data-global-key-source required placeholder="Example: 12MM"></label><label>Generated key<input name="value_key" data-global-generated-key readonly></label><button type="submit">Add choice</button></form></div></article>`;
    }).join('');
    panel.innerHTML=`<div class="admin-heading"><div><p class="kicker">GLOBAL FILTERS</p><h2>Universal filter definitions</h2><p>Edit once; every linked category uses the same definition. Keys are generated when created and cannot be changed afterward.</p></div><button type="button" data-global-filter-back>Back to categories</button></div><section class="admin-card admin-category-filter-manager"><form class="admin-category-filter-form admin-global-filter-create" data-global-filter-create><h3>Add a global filter</h3><label>Filter name<input name="label" data-global-key-source required placeholder="Example: Finish"></label><label>Generated key<input name="key" data-global-generated-key readonly></label><p class="admin-field-help">The key is fixed after creation. Then add this filter to the categories where customers should use it.</p><button type="submit" class="cta">Add filter</button></form><p class="admin-save-error" data-global-filter-notice role="alert" hidden></p><div class="admin-category-filter-list">${cards||'<p>No global filters have been created yet.</p>'}</div></section>`;
    const showNotice=(error)=>{const notice=panel.querySelector('[data-global-filter-notice]');if(notice){notice.hidden=false;notice.textContent='Unable to save: '+(error?.message||'Please try again.');}};
    const mutate=async(button,busyLabel,action)=>{const originalLabel=button.textContent;button.disabled=true;button.textContent=busyLabel;try{await action();await renderAdminGlobalFilterManager();}catch(error){showNotice(error);button.disabled=false;button.textContent=originalLabel;}};
    panel.querySelectorAll('[data-global-key-source]').forEach((labelInput)=>{const keyInput=labelInput.form?.querySelector('[data-global-generated-key]');if(!keyInput)return;const updateKey=()=>{keyInput.value=adminSlug(labelInput.value);};labelInput.addEventListener('input',updateKey);updateKey();});
    panel.querySelector('[data-global-filter-back]').addEventListener('click',renderCloudCategories);
    panel.querySelector('[data-global-filter-create]').addEventListener('submit',async(event)=>{event.preventDefault();const form=event.currentTarget;const label=String(form.elements.label.value||'').trim();const key=String(form.elements.key.value||'').trim();const button=form.querySelector('[type="submit"]');if(!label||!key){showNotice(new Error('Enter a filter name that can generate a key.'));return;}await mutate(button,'Adding…',async()=>{const result=await cloudAdmin().from('storefront_filter_definitions').insert({key,label,scope:'variant',active:true,sort_order:definitions.length*10+10}).select('id').single();if(result.error)throw result.error;});});
    panel.querySelectorAll('[data-global-filter-save]').forEach((form)=>form.addEventListener('submit',async(event)=>{event.preventDefault();const card=form.closest('[data-global-filter-definition]');const label=String(form.elements.label.value||'').trim();const button=form.querySelector('[type="submit"]');if(!label){showNotice(new Error('A filter name is required.'));return;}await mutate(button,'Saving…',async()=>{const result=await cloudAdmin().from('storefront_filter_definitions').update({label,active:form.elements.active.checked}).eq('id',card.dataset.globalFilterDefinition).select('id').single();if(result.error)throw result.error;});}));
    panel.querySelectorAll('[data-global-filter-delete]').forEach((button)=>button.addEventListener('click',async()=>{const card=button.closest('[data-global-filter-definition]');const definition=definitions.find((entry)=>entry.id===card.dataset.globalFilterDefinition);if(!definition||!window.confirm(`Delete filter “${definition.label}” (key: ${definition.key}) everywhere? This permanently deletes its choices and any product/SKU assignments that use them. To hide it without deleting data, turn off “Active everywhere linked.”`))return;await mutate(button,'Deleting…',async()=>{const result=await cloudAdmin().from('storefront_filter_definitions').delete().eq('id',definition.id).select('id');if(result.error)throw result.error;if(!result.data?.length)throw new Error('No filter was deleted. Refresh and try again.');});}));
    panel.querySelectorAll('[data-global-filter-value]').forEach((form)=>form.addEventListener('submit',async(event)=>{event.preventDefault();const label=String(form.elements.label.value||'').trim();const button=form.querySelector('[type="submit"]');if(!label){showNotice(new Error('A customer choice is required.'));return;}await mutate(button,'Saving…',async()=>{const result=await cloudAdmin().from('storefront_filter_values').update({label,active:form.elements.active.checked}).eq('id',form.dataset.globalFilterValue).select('id').single();if(result.error)throw result.error;});}));
    panel.querySelectorAll('[data-global-filter-value-delete]').forEach((button)=>button.addEventListener('click',async()=>{const form=button.closest('[data-global-filter-value]');const value=(valueResult.data||[]).find((entry)=>entry.id===form.dataset.globalFilterValue);if(!value||!window.confirm(`Delete customer choice “${value.label}” (key: ${value.value_key})? Any product/SKU assignments using it will also be deleted.`))return;await mutate(button,'Deleting…',async()=>{const result=await cloudAdmin().from('storefront_filter_values').delete().eq('id',value.id).select('id');if(result.error)throw result.error;if(!result.data?.length)throw new Error('No choice was deleted. Refresh and try again.');});}));
    panel.querySelectorAll('[data-global-filter-value-add]').forEach((form)=>form.addEventListener('submit',async(event)=>{event.preventDefault();const label=String(form.elements.label.value||'').trim();const valueKey=String(form.elements.value_key.value||'').trim();const card=form.closest('[data-global-filter-definition]');const button=form.querySelector('[type="submit"]');if(!label||!valueKey){showNotice(new Error('Enter a choice label that can generate a key.'));return;}await mutate(button,'Adding…',async()=>{const values=valuesByFilter.get(card.dataset.globalFilterDefinition)||[];const result=await cloudAdmin().from('storefront_filter_values').insert({filter_id:card.dataset.globalFilterDefinition,value_key:valueKey,label,active:true,sort_order:values.length*10+10});if(result.error)throw result.error;});}));
  }catch(error){renderCloudError(error);}
};
const globalFilterButtonObserver=new MutationObserver(()=>{const list=panel?.querySelector('.admin-category-list');if(list&&!panel.querySelector('[data-global-filters]')){const b=document.createElement('button');b.type='button';b.dataset.globalFilters='';b.className='cta';b.textContent='Manage global filters';b.addEventListener('click',renderAdminGlobalFilterManager);list.before(b);}});globalFilterButtonObserver.observe(panel,{childList:true,subtree:true});
const installGlobalFilterDropdown=()=>{const list=panel?.querySelector('[data-global-filter-definition]')?.parentElement;if(!list||list.dataset.globalDropdownReady)return;const cards=[...list.querySelectorAll('[data-global-filter-definition]')];if(cards.length<2)return;list.dataset.globalDropdownReady='true';const wrap=document.createElement('label');wrap.className='global-filter-picker';wrap.textContent='Choose a filter to edit';const select=document.createElement('select');select.setAttribute('aria-label','Choose a filter to edit');cards.forEach((card,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=card.querySelector('h3')?.textContent||'Filter';select.append(option);});wrap.append(select);list.prepend(wrap);const show=()=>cards.forEach((card,index)=>{card.hidden=String(index)!==select.value;});select.addEventListener('change',show);show();};const globalFilterDropdownObserver=new MutationObserver(installGlobalFilterDropdown);globalFilterDropdownObserver.observe(panel,{childList:true,subtree:true});
const removeAdminQtySoldByBadges=(form)=>{form?.querySelector('.admin-badge-group-qty-sold-by')?.remove();};
document.addEventListener('click',(event)=>{const tab=event.target.closest?.('[data-admin-tab]');if(tab?.dataset.adminTab)localStorage.setItem('beadAdminActiveTab',tab.dataset.adminTab);},true);
const installAdminSkuMsrp=()=>{const markup=Math.max(0,Number(window.productStoreConfig?.msrpMarkupPercent??100));document.querySelectorAll('#cloud-item-form [data-variant-row]').forEach((row)=>{const cost=row.querySelector('[data-variant-cost]');const pricing=row;if(!cost||!pricing)return;let field=row.querySelector('[data-variant-msrp]');if(!field){field=document.createElement('label');field.className='admin-sku-msrp-field';field.innerHTML='<span>MSRP</span><input data-variant-msrp type="text" readonly aria-label="Suggested MSRP" title="Suggested MSRP based on cost and the standard MSRP markup">';pricing.append(field);}const value=Number(cost.value);const output=field.querySelector('[data-variant-msrp]');if(output)output.value=Number.isFinite(value)&&value>=0&&cost.value.trim()!==''?'$'+(value*(1+markup/100)).toFixed(2):'—';});};
const adminProductEditorObserver=new MutationObserver(()=>{document.querySelectorAll('#cloud-item-form').forEach(removeAdminQtySoldByBadges);installAdminSkuMsrp();});
adminProductEditorObserver.observe(document.body,{childList:true,subtree:true});
document.addEventListener('input',(event)=>{if(event.target.matches('#cloud-item-form [data-variant-cost]'))installAdminSkuMsrp();});

// Promotions are scheduled at hour precision and a SKU-level sale follows that
// canonical SKU to every product page where it is offered.
(()=>{
  let pendingSkuPromo=null;
  const hourValue=(value)=>{
    const raw=String(value||'').trim();
    if(!raw)return '';
    const match=raw.match(/^(\d{4}-\d{2}-\d{2}T\d{2})/);
    return match?`${match[1]}:00`:raw;
  };
  const normalizePromoInputs=(root=document)=>{
    root.querySelectorAll?.('input[type="datetime-local"][name="starts_at"],input[type="datetime-local"][name="ends_at"],input[type="datetime-local"][name="promo_starts_at"],input[type="datetime-local"][name="promo_ends_at"]').forEach((input)=>{
      input.step='3600';
      if(input.value)input.value=hourValue(input.value);
    });
  };
  const skuValuesFromForm=(form)=>{
    try{return JSON.parse(form.elements.sku_data?.value||'[]').flatMap((option)=>Array.isArray(option.values)?option.values:[]).map((value)=>String(value.sku||value.inventory_sku||'').trim()).filter(Boolean);}catch(error){return[];}
  };
  document.addEventListener('submit',(event)=>{
    const form=event.target;
    if(!(form instanceof HTMLFormElement))return;
    ['starts_at','ends_at','promo_starts_at','promo_ends_at'].forEach((name)=>{if(form.elements[name])form.elements[name].value=hourValue(form.elements[name].value);});
    if(form.id!=='cloud-item-form')return;
    const discount=Math.min(100,Math.max(0,Number(form.elements.promo_discount_percent?.value)||0));
    const selected=(()=>{try{const values=JSON.parse(form.elements.promo_skus?.value||'[]');return Array.isArray(values)?values.map((value)=>String(value||'').trim()).filter(Boolean):[];}catch(error){return[];}})();
    const affectedSkus=selected.length?selected:discount>0?[]:skuValuesFromForm(form);
    const starts=hourValue(form.elements.promo_starts_at?.value);
    const ends=hourValue(form.elements.promo_ends_at?.value);
    if(form.elements.promo_starts_at)form.elements.promo_starts_at.value=starts;
    if(form.elements.promo_ends_at)form.elements.promo_ends_at.value=ends;
    pendingSkuPromo={skus:affectedSkus,discount,starts:starts||null,ends:ends||null};
  },true);
  const propagate=async(sourceId,draft)=>{
    if(!window.beadSupabase||!draft?.skus?.length)return;
    const skus=[...new Set(draft.skus.map((sku)=>String(sku).trim()).filter(Boolean))];
    const [bySku,byInventorySku]=await Promise.all([
      adminBatchRows(skus,(batch)=>window.beadSupabase.from('product_option_values').select('sku,product_options!inner(product_id)').in('sku',batch)),
      adminBatchRows(skus,(batch)=>window.beadSupabase.from('product_option_values').select('inventory_sku,product_options!inner(product_id)').in('inventory_sku',batch))
    ]);
    if(bySku.error)throw bySku.error;
    if(byInventorySku.error)throw byInventorySku.error;
    const productIds=[...new Set([...(bySku.data||[]),...(byInventorySku.data||[])].map((row)=>row.product_options?.product_id).filter((id)=>id&&id!==sourceId))];
    if(!productIds.length)return;
    const targets=await window.beadSupabase.from('products').select('id,promo_skus').in('id',productIds);
    if(targets.error)throw targets.error;
    for(const target of targets.data||[]){
      const existing=Array.isArray(target.promo_skus)?target.promo_skus:[];
      const merged=[...existing,...skus].filter((sku,index,array)=>array.findIndex((candidate)=>String(candidate).toLowerCase()===String(sku).toLowerCase())===index);
      const update=await window.beadSupabase.from('products').update({promo_discount_percent:draft.discount,promo_starts_at:draft.starts,promo_ends_at:draft.ends,promo_skus:draft.discount>0?merged:existing.filter((sku)=>!skus.some((affected)=>String(affected).toLowerCase()===String(sku).toLowerCase()))}).eq('id',target.id);
      if(update.error)throw update.error;
    }
  };
  new MutationObserver(()=>normalizePromoInputs(panel||document)).observe(document.body,{childList:true,subtree:true});
  document.addEventListener('admin-product-saved',(event)=>{const draft=pendingSkuPromo;pendingSkuPromo=null;if(!draft)return;void propagate(event.detail?.id,draft).catch((error)=>console.error('SKU promotion propagation failed.',error));});
  normalizePromoInputs();
})();
// Canonical inventory exception reports. These are derived views over the
// existing product, option, inventory, category-filter, and assignment data.
(()=>{
  const escapeReport=(value)=>String(value??'').replace(/[&<>"']/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const reportRowsCache=new Map();
  const loadRows=async(table,select,forceFresh=false)=>{const key=table+'|'+select;const cached=reportRowsCache.get(key);if(!forceFresh&&cached&&Date.now()-cached.at<30000)return cached.data;const result=await window.beadSupabase.from(table).select(select).range(0,499);if(result.error)throw result.error;const rows=result.data||[];reportRowsCache.set(key,{at:Date.now(),data:rows});return rows;};
  const install=()=>{
    const tabs=document.querySelector('.inventory-tabs');
    if(!tabs||tabs.dataset.canonicalExceptionsInstalled==='true'||!window.beadSupabase)return;
    tabs.dataset.canonicalExceptionsInstalled='true';
    const reportLabels={
      'waitlist-exceptions':['Not waitlistable','Product-page SKUs that cannot accept a restock request.'],
      'missing-filter-assignments':['Missing filter assignments','Active category filters with no value assigned to the SKU.'],
    };
    const showLauncher=(key)=>{
      const view=document.querySelector('#inventory-view');
      if(!view)return;
      const detail=reportLabels[key]||['Inventory report','Run the selected inventory report.'];
      view.innerHTML='<div class="admin-heading"><div><h3>Report ready to run</h3><p>Click Run report when you want to load this report. No report data is requested while this screen is open.</p></div></div><div class="admin-report-launch-list"><article class="admin-card admin-report-launch"><div><h4>'+detail[0]+'</h4><p>'+detail[1]+'</p></div><div class="admin-report-launch-actions"><button type="button" data-run-canonical-report>Run report</button><button type="button" data-run-canonical-fresh>Run fresh report</button></div></article></div>';
      view.querySelector('[data-run-canonical-report]').onclick=()=>void render(key);
      view.querySelector('[data-run-canonical-fresh]').onclick=()=>void render(key,true);
    };
    [['waitlist-exceptions','Not waitlistable'],['missing-filter-assignments','Missing filter assignments']].forEach(([key,label])=>{
      const button=document.createElement('button');button.type='button';button.dataset.inventoryTab=key;button.textContent=label;tabs.append(button);
      button.addEventListener('click',()=>showLauncher(key));
    });
  };
  const render=async(kind,forceFresh=false)=>{
    const view=document.querySelector('#inventory-view');if(!view)return;
    view.innerHTML='<div class="admin-empty admin-loading" role="status">Loading canonical report…</div>';
    try{
      const emptyRows=()=>Promise.resolve({data:[],error:null});
      const needsFilterData=kind==='missing-filter-assignments';
      const [products,options,inventory,assignments,filterLinks,definitions]=await Promise.all([
        loadRows('products','id,name,external_id,sku,category_slug,visible,waitlist_enabled,promo_price,promo_starts_at,promo_ends_at',forceFresh),
        loadRows('product_option_values','id,label,sku,inventory_sku,quantity,product_options!inner(product_id)',forceFresh),
        loadRows('inventory_skus','id,sku,name,quantity_on_hand,reorder_point,reserve_quantity,item_type,discontinued,category,price,cost,preferred_vendor',forceFresh),
        needsFilterData?loadRows('product_filter_assignments','product_id,filter_value_id,inventory_sku_id',forceFresh):emptyRows(),
        needsFilterData?loadRows('storefront_filter_categories','category_slug,filter_id',forceFresh):emptyRows(),
        needsFilterData?loadRows('storefront_filter_definitions','id,key,label,active,sort_order,storefront_filter_values(id,filter_id,label,active,sort_order)',forceFresh):emptyRows()
      ]);
      const productById=new Map(products.map((row)=>[row.id,row]));
      const inventoryBySku=new Map(inventory.filter((row)=>row.sku).map((row)=>[String(row.sku).trim().toLowerCase(),row]));
      const optionRows=options.map((row)=>({...row,product_id:row.product_id||row.product_options?.product_id}));
      const placements=optionRows.length?optionRows:products.filter((row)=>row.sku).map((row)=>({product_id:row.id,label:'Standard',sku:row.sku,inventory_sku:row.sku}));
      const pageName=(id)=>productById.get(id)?.name||productById.get(id)?.external_id||'Unknown product';
      const available=adminNetAvailable;
      const table=(title,description,headers,rows,empty)=>'<div class="admin-heading"><div><h3>'+title+'</h3><p>'+description+'</p></div><button type="button" data-report-refresh>Refresh</button></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr>'+headers.map((header)=>'<th>'+header+'</th>').join('')+'</tr></thead><tbody>'+((rows.length?rows.map((row)=>'<tr>'+row.map((cell)=>'<td>'+escapeReport(cell)+'</td>').join('')+'</tr>').join(''):'<tr><td colspan="'+headers.length+'">'+empty+'</td></tr>'))+'</tbody></table></div>';
      if(kind==='waitlist-exceptions'){
        const rows=placements.map((placement)=>{const product=productById.get(placement.product_id);const sku=String(placement.inventory_sku||placement.sku||'').trim();const record=inventoryBySku.get(sku.toLowerCase());const reasons=[];if(!product)reasons.push('Missing product page');else if(product.visible!==true)reasons.push('Product page not listed');if(product?.waitlist_enabled!==true)reasons.push('Waitlist disabled');if(product?.visible===true&&product?.waitlist_enabled===true&&!record)reasons.push('No canonical inventory SKU');if(record?.discontinued===true)reasons.push('SKU discontinued');if(!reasons.length)return null;return[pageName(placement.product_id),record?.name||placement.label||'Unknown product',sku||'—',available(record),reasons.join('; ')]}).filter(Boolean);
        view.innerHTML=table('Not waitlistable','Each row is a product-page SKU placement that cannot accept a restock request. Reasons are calculated from canonical records.',['Product page','Variant','Canonical SKU','Available','Reason'],rows,'No waitlist exceptions found.');
      }else if(kind==='missing-filter-assignments'){
        const linksByCategory=new Map();filterLinks.forEach((link)=>{const list=linksByCategory.get(link.category_slug)||[];if(!list.includes(link.filter_id))list.push(link.filter_id);linksByCategory.set(link.category_slug,list);});
        const defsById=new Map(definitions.filter((definition)=>definition.active!==false).map((definition)=>[definition.id,definition]));
        const assignmentsByKey=new Set(assignments.map((assignment)=>`${assignment.product_id}:${assignment.inventory_sku_id||''}:${assignment.filter_value_id}`));
         const rows=[];placements.forEach((placement)=>{const product=productById.get(placement.product_id);if(!product)return;const filterIds=linksByCategory.get(product.category_slug)||[];const sku=String(placement.inventory_sku||placement.sku||'').trim();filterIds.forEach((filterId)=>{const definition=defsById.get(filterId);if(!definition)return;const values=(definition.storefront_filter_values||[]).filter((value)=>value.active!==false);const assigned=values.some((value)=>assignmentsByKey.has(`${product.id}:${inventoryBySku.get(sku.toLowerCase())?.id||sku}:${value.id}`)||assignmentsByKey.has(`${product.id}::${value.id}`));if(!assigned)rows.push([pageName(product.id),inventoryBySku.get(sku.toLowerCase())?.name||placement.label||'Unknown product',sku||'—',definition.label||definition.key]);});});
         view.innerHTML=table('Missing filter assignments','Active category filters with no value assigned to the SKU. This is derived from canonical category definitions and SKU assignments.',['Product page','Product name','Canonical SKU','Missing filter'],rows,'No missing filter assignments found.');
      }
      view.querySelector('[data-report-refresh]')?.addEventListener('click',()=>void render(kind,true));
    }catch(error){view.innerHTML='<div class="admin-empty">Unable to load report: '+escapeReport(error.message||'Unknown database error.')+'</div>';}
  };
  new MutationObserver(install).observe(document.body,{childList:true,subtree:true});
  install();
})();

document.addEventListener('submit',(event)=>{
  const form=event.target;
  if(!(form instanceof HTMLFormElement)||form.id!=='settings-form')return;
  const editor=form.querySelector('[data-rich-editor]');
  if(!editor)return;
  let html=editor.innerHTML;
  html=html.replace(/<div style="line-height:1\.5"><\/div>/gi,'');
  html=html.replace(/^(<div style="line-height:1\.5">)+/i,'').replace(/(<\/div>)+$/i,'');
  editor.innerHTML=html;
},true);

const synchronizeActiveAdminThemeSelection=async()=>{
  const form=document.querySelector('[data-theme-form]');
  const select=form?.elements?.theme_preset;
  if(!form||!select||select.options.length<2||select.dataset.cloudThemeSynchronized||select.dataset.userSelected)return;
  if(!window.beadSupabase)return;
  const value=await loadAdminStoreSettings().catch(()=>null);
  if(!value||select.dataset.userSelected)return;
  const admin=value.admin&&typeof value.admin==='object'?value.admin:{};
  const config=value.config&&typeof value.config==='object'?value.config:{};
  const active=normalizeAdminTheme(admin.theme||config.theme);
  const snapshot=admin.themeDefaultSnapshot||{};
  if(JSON.stringify(active)===JSON.stringify(normalizeAdminTheme(snapshot.theme||{}))&&select.querySelector('[value="__locked_default__"]'))select.value='__locked_default__';
  else{
    const presets=Array.isArray(admin.themePresets)?admin.themePresets:[];
    const index=presets.findIndex((preset)=>JSON.stringify(normalizeAdminTheme(preset?.theme||{}))===JSON.stringify(active));
    if(index>=0&&select.querySelector('option[value="'+index+'"]'))select.value=String(index);
  }
  form.querySelector('[data-theme-footer-logo-status]')?.replaceChildren();
  select.dataset.cloudThemeSynchronized='true';
  if(select.value)select.dispatchEvent(new Event('change'));
};
new MutationObserver(()=>{void synchronizeActiveAdminThemeSelection();}).observe(document.body,{childList:true,subtree:true});

const routeDefaultStoreMediaEditors=()=>{const settingsForm=panel?.querySelector('#settings-form');const editors=[...panel?.querySelectorAll('[data-default-hero-editor],[data-default-story-editor],[data-default-footer-logo-editor]')||[]];if(!settingsForm){editors.forEach((editor)=>editor.remove());return;}const mediaSection=settingsForm.nextElementSibling?.matches('[data-default-store-media]')?settingsForm.nextElementSibling:null;if(!mediaSection){const section=document.createElement('section');section.className='admin-card admin-default-store-media';section.dataset.defaultStoreMedia='';section.innerHTML='<div class="admin-heading"><div><h3>Default storefront media</h3><p>These images are used by the locked Default theme. Saved themes keep their own images.</p></div></div><div data-default-store-media-list></div>';settingsForm.insertAdjacentElement('afterend',section);}const list=panel.querySelector('[data-default-store-media-list]');if(!list)return;editors.forEach((editor)=>{if(!list.contains(editor))list.append(editor);});if(!list.querySelector('[data-default-footer-logo-editor]')){const footer=document.createElement('section');footer.className='admin-card admin-default-hero';footer.dataset.defaultFooterLogoEditor='';footer.innerHTML='<div class="admin-heading"><div><h3>Default footer logo</h3><p>Set the logo used in the footer when the locked Default theme is active.</p></div></div><form class="admin-default-hero-form"><label>Footer logo<input name="footerLogo" type="file" accept="image/*"></label><img data-default-footerLogo-preview alt="" hidden><div class="admin-actions"><button type="submit" class="cta">Save default footer logo</button></div><p data-default-footerLogo-status role="status"></p></form>';list.append(footer);}initializeAdminDefaultImageEditor('hero','heroUrl','hero image','[data-default-hero-editor]');initializeAdminDefaultImageEditor('story','storyUrl','Our Story image','[data-default-story-editor]');initializeAdminDefaultImageEditor('footerLogo','footerLogoUrl','footer logo','[data-default-footer-logo-editor]');};
const defaultStoreMediaObserver=new MutationObserver(()=>routeDefaultStoreMediaEditors());
defaultStoreMediaObserver.observe(panel,{childList:true,subtree:true});
const clearDefaultMediaFallbackText=()=>{panel?.querySelectorAll('[data-default-hero-status],[data-default-story-status],[data-default-footerLogo-status]').forEach((status)=>{if(status.textContent.startsWith('The built-in default '))status.textContent='';});};
new MutationObserver(()=>clearDefaultMediaFallbackText()).observe(panel,{childList:true,subtree:true});

const repairDefaultStoreMediaLayout=()=>{
  const settingsForm=panel?.querySelector('#settings-form');
  const themeSection=panel?.querySelector('[data-theme-settings]');
  if(!settingsForm)return;
  const sections=[...panel.querySelectorAll('[data-default-store-media]')];
  const mediaSection=sections[0]||document.createElement('section');
  mediaSection.className='admin-card admin-default-store-media';
  mediaSection.dataset.defaultStoreMedia='';
  if(!mediaSection.querySelector('[data-default-store-media-list]'))mediaSection.insertAdjacentHTML('beforeend','<div class="admin-heading"><div><h3>Default storefront media</h3><p>These images are used by the locked Default theme. Saved themes keep their own images.</p></div></div><div data-default-store-media-list></div>');
  const list=mediaSection.querySelector('[data-default-store-media-list]');
  sections.slice(1).forEach((section)=>{[...section.querySelectorAll('[data-default-hero-editor],[data-default-story-editor],[data-default-footer-logo-editor]')].forEach((editor)=>list.append(editor));section.remove();});
  const makeEditor=(field,title,description,button,preview,status)=>{const section=document.createElement('section');section.className='admin-card admin-default-hero';section.dataset[field==='hero'?'defaultHeroEditor':field==='story'?'defaultStoryEditor':'defaultFooterLogoEditor']='';section.innerHTML='<div class="admin-heading"><div><h3>'+title+'</h3><p>'+description+'</p></div></div><form class="admin-default-hero-form"><label>'+title+'<input name="'+field+'" type="file" accept="image/*"></label><img data-default-'+preview+' alt="" hidden><div class="admin-actions"><button type="submit" class="cta">'+button+'</button></div><p data-default-'+status+' role="status"></p></form>';return section;};
  const existing=(selector)=>list.querySelector(selector);
  if(!existing('[data-default-hero-editor]'))list.append(makeEditor('hero','Default homepage hero','Set the hero used by the locked Default theme. Saved themes keep their own hero images.','Save default hero','hero-preview','hero-status'));
  if(!existing('[data-default-story-editor]'))list.append(makeEditor('story','Default Our Story image','Set the default image used by the Our Story section. Saved themes keep their own Story images.','Save default Story image','story-preview','story-status'));
  if(!existing('[data-default-footer-logo-editor]'))list.append(makeEditor('footerLogo','Default footer logo','Set the logo used in the footer when the locked Default theme is active.','Save default footer logo','footerLogo-preview','footerLogo-status'));
  if(themeSection&&themeSection.previousElementSibling!==mediaSection)themeSection.parentElement.insertBefore(mediaSection,themeSection);else if(!themeSection&&mediaSection.parentElement!==settingsForm.parentElement)settingsForm.insertAdjacentElement('afterend',mediaSection);
  initializeAdminDefaultImageEditor('hero','heroUrl','hero image','[data-default-hero-editor]');
  initializeAdminDefaultImageEditor('story','storyUrl','Our Story image','[data-default-story-editor]');
  initializeAdminDefaultImageEditor('footerLogo','footerLogoUrl','footer logo','[data-default-footer-logo-editor]');
};
const defaultStoreMediaLayoutObserver=new MutationObserver(()=>repairDefaultStoreMediaLayout());
defaultStoreMediaLayoutObserver.observe(panel,{childList:true,subtree:true});
repairDefaultStoreMediaLayout();

const canonicalRenderCategories=renderCategories;
renderCategories=async()=>{
  await canonicalRenderCategories();
  panel.querySelectorAll('[data-default-hero-editor],[data-default-story-editor]').forEach((editor)=>editor.closest('.admin-card')?.remove());
};

const initializeAdminReviewResponses=()=>{panel?.querySelectorAll('#review-admin-list article:not([data-review-response-ready])').forEach((article)=>{const id=article.querySelector('[data-review-id]')?.dataset.reviewId;if(!id)return;article.dataset.reviewResponseReady='loading';const actions=article.lastElementChild;const form=document.createElement('form');form.className='admin-review-response';form.innerHTML='<strong class="admin-review-response-saved" data-response-state>No response saved yet.</strong><label>Response<textarea name="response" rows="3" placeholder="Write a public response…"></textarea></label><button type="submit">Save response</button><span role="status"></span>';actions?.before(form);const state=form.querySelector('[data-response-state]'),button=form.querySelector('button'),preview=document.createElement('p');preview.className='admin-review-response-preview';preview.hidden=true;form.querySelector('label')?.after(preview);const setSavedState=(response,responseAt)=>{const hasResponse=Boolean(String(response||'').trim());button.textContent=hasResponse?'Update response':'Save response';state.textContent=hasResponse?`Response saved${responseAt?` · ${new Date(responseAt).toLocaleString()}`:''}`:'No response saved yet.';state.dataset.hasResponse=hasResponse?'true':'false';preview.textContent=String(response||'').trim();preview.hidden=!hasResponse;};const hydrate=(response,responseAt)=>{if(!form.isConnected)return;form.elements.response.value=response||'';setSavedState(response,responseAt);article.dataset.reviewResponseReady='true';};const cachedResponse=article.dataset.reviewResponseLoaded==='true';if(cachedResponse)hydrate(article.dataset.reviewResponse||'',article.dataset.reviewResponseAt||'');else cloudAdmin().from('reviews').select('admin_response,admin_response_at').eq('id',id).maybeSingle().then((result)=>{if(!form.isConnected)return;if(result.error){state.textContent='Response could not be loaded.';return;}hydrate(result.data?.admin_response||'',result.data?.admin_response_at||'');}).catch(()=>{if(form.isConnected)state.textContent='Response could not be loaded.';});form.addEventListener('submit',async(event)=>{event.preventDefault();button.disabled=true;const status=form.querySelector('[role=status]');status.textContent='Saving…';const response=String(form.elements.response.value||'').trim();const responseAt=response?new Date().toISOString():null;const result=await cloudAdmin().from('reviews').update({admin_response:response||null,admin_response_at:responseAt}).eq('id',id);if(result.error){status.textContent=`Response was not saved: ${result.error.message||'unknown error'}`;button.disabled=false;return;}setSavedState(response,responseAt);status.textContent=response?'Response saved.':'Response removed.';button.disabled=false;});});};new MutationObserver(()=>initializeAdminReviewResponses()).observe(panel,{childList:true,subtree:true});initializeAdminReviewResponses();

const normalizeReviewModerationActions=()=>{panel?.querySelectorAll('[data-review-status="deleted"]').forEach((button)=>button.remove());panel?.querySelectorAll('[data-review-status="blocked"]').forEach((button)=>{const article=button.closest('article');const hidden=article?.querySelector('div:first-child span')?.textContent?.includes(' · blocked');const label=hidden?'Restore to website':'Hide from website';const title=hidden?'Restore this review to customer-facing review pages.':'Hide this review from customer-facing review pages without removing it from the customer history.';const reviewDetails=article?.querySelector('div:first-child');if(hidden){button.dataset.reviewStatus='approved';article?.classList.add('review-hidden');if(reviewDetails&&!reviewDetails.querySelector('[data-review-hidden-badge]')){const badge=document.createElement('strong');badge.dataset.reviewHiddenBadge='';badge.className='admin-review-hidden-badge';badge.textContent='Hidden from website';reviewDetails.prepend(badge);}}else{article?.classList.remove('review-hidden');article?.querySelector('[data-review-hidden-badge]')?.remove();}if(button.textContent!==label)button.textContent=label;if(button.title!==title)button.title=title;button.disabled=false;});};new MutationObserver(()=>normalizeReviewModerationActions()).observe(panel,{childList:true,subtree:true});normalizeReviewModerationActions();
const restoreAdminParentQuantity=(root=panel)=>{root?.querySelectorAll('[data-variant-row]').forEach((row)=>{const type=row.querySelector('[data-variant-item-type]');const quantity=row.querySelector('[data-variant-quantity]');if(!type||!quantity||String(type.value||'').toLowerCase()!=='non-inventory')return;const stored=quantity.dataset.inventoryValue;if(quantity.value==='N/A'&&stored!==undefined){quantity.type='number';quantity.value=stored;quantity.disabled=false;quantity.readOnly=true;quantity.required=false;quantity.title='Calculated from child SKU availability';delete quantity.dataset.inventoryValue;}});};
const adminParentQuantityObserver=new MutationObserver(()=>restoreAdminParentQuantity());
adminParentQuantityObserver.observe(panel,{childList:true,subtree:true,attributes:true,attributeFilter:['value','disabled','type']});
restoreAdminParentQuantity();

const initializeAdminProductPageEditorLock=async(form)=>{
  if(!form||form.dataset.productPageEditorLockInitialized)return;
  const control=form.querySelector('[name="finalize_inventory_setup"]');
  if(!control)return;
  form.dataset.productPageEditorLockInitialized='loading';
  control.dataset.productPageEditorLock='';
  control.checked=false;
  const label=control.closest('label');
  if(label){
    label.classList.add('admin-page-editor-lock');
    [...label.childNodes].filter((node)=>node.nodeType===3).forEach((node)=>node.remove());
    const text=document.createElement('span');
    text.dataset.pageEditorLockText='';
    label.append(text);
    label.dataset.pageEditorLockLabel='';
  }
  const helper=form.querySelector('.inventory-help');
  if(helper)helper.textContent='Leave unlocked while auditing. Lock this product-page SKU editor when the audit is complete; uncheck it to unlock the page again.';
  const updateLabel=()=>{
    const text=label?.querySelector('[data-page-editor-lock-text]');
    const next=control.checked?'Unlock product-page SKU editor':'Lock product-page SKU editor';
    if(text&&text.textContent!==next)text.textContent=next;
  };
  const apply=()=>{
    const locked=control.checked;
    form.dataset.productPageEditorLocked=locked?'true':'false';
    form.querySelectorAll('input,select,textarea,button').forEach((field)=>{
      if(field===control||field.type==='hidden'||field.matches('[data-cancel]'))return;
      if(field.matches('[data-history-page]')){
        field.disabled=false;
        field.classList.remove('admin-page-editor-locked-field');
        return;
      }
      if(field.type==='submit'){
        field.disabled=locked&&form.dataset.productPageEditorLockDirty!=='true';
        return;
      }
      if(field.dataset.pageEditorOriginalDisabled===undefined)field.dataset.pageEditorOriginalDisabled=field.disabled?'true':'false';
      if('readOnly' in field&&field.dataset.pageEditorOriginalReadonly===undefined)field.dataset.pageEditorOriginalReadonly=field.readOnly?'true':'false';
      field.disabled=locked||field.dataset.pageEditorOriginalDisabled==='true';
      if('readOnly' in field)field.readOnly=locked||field.dataset.pageEditorOriginalReadonly==='true';
      field.classList.toggle('admin-page-editor-locked-field',locked);
    });
    updateLabel();
  };
  const persistUnlock=async()=>{
    const productId=String(form.dataset.productId||'').trim();
    if(!productId||!window.beadSupabase)return;
    const result=await cloudAdmin().from('products').update({sku_editor_locked:false,updated_at:new Date().toISOString()}).eq('id',productId);
    if(result.error){
      control.checked=true;
      apply();
      form.dataset.productPageEditorLockError=result.error.message||'The page could not be unlocked.';
      return;
    }
    form.dataset.productPageEditorLockError='';
  };
  control.addEventListener('change',()=>{
    form.dataset.productPageEditorLockDirty='true';
    apply();
    if(!control.checked)void persistUnlock();
  });
  const productId=String(form.dataset.productId||'').trim();
  if(productId&&window.beadSupabase){
    const result=await cloudAdmin().from('products').select('sku_editor_locked').eq('id',productId).maybeSingle();
    if(!result.error)control.checked=result.data?.sku_editor_locked===true;
  }
  form.dataset.productPageEditorLockDirty='false';
  form._applyProductPageEditorLock=apply;
  apply();
  form.dataset.productPageEditorLockInitialized='ready';
};

const adminProductPageEditorLockObserver=new MutationObserver(()=>{
  document.querySelectorAll('#cloud-item-form').forEach((form)=>{if(typeof form._applyProductPageEditorLock==='function')form._applyProductPageEditorLock();else void initializeAdminProductPageEditorLock(form);});
});
adminProductPageEditorLockObserver.observe(document.body,{childList:true,subtree:true});
document.querySelectorAll('#cloud-item-form').forEach((form)=>{void initializeAdminProductPageEditorLock(form);});
// Select controls do not consistently emit `input` in every browser.  Mirror
// their change into the existing SKU sync so linked photos, units, and other
// select-backed values are present in the canonical save payload.
document.addEventListener('change',(event)=>{
  if(!event.target.closest?.('#cloud-item-form [data-variant-row]'))return;
  event.target.dispatchEvent(new Event('input',{bubbles:true}));
},true);

// Taxability is an editable canonical field.  Hydrate the checkbox from
// inventory instead of leaving every row visually checked by default.
const hydrateCanonicalTaxableFields=async(form)=>{
  if(!form||!window.beadSupabase||form.dataset.taxableHydration==='ready'||form.dataset.taxableHydration==='loading')return;
  const rows=[...form.querySelectorAll('[data-variant-row]')];
  if(!rows.length)return;
  const skus=rows.map((row)=>String(row.querySelector('[data-variant-sku]')?.value||'').trim()).filter(Boolean);
  if(!skus.length)return;
  form.dataset.taxableHydration='loading';
  const result=await adminBatchRows(skus,(batch)=>cloudAdmin().from('inventory_skus').select('sku,taxable').in('sku',batch));
  if(result.error){delete form.dataset.taxableHydration;return;}
  const bySku=new Map((result.data||[]).map((record)=>[String(record.sku||'').trim().toLowerCase(),record.taxable!==false]));
  rows.forEach((row)=>{
    const sku=String(row.querySelector('[data-variant-sku]')?.value||'').trim().toLowerCase();
    const checkbox=row.querySelector('[data-variant-taxable]');
    if(checkbox&&bySku.has(sku))checkbox.checked=bySku.get(sku);
  });
  form.dataset.taxableHydration='ready';
};
const canonicalTaxableObserver=new MutationObserver(()=>{
  document.querySelectorAll('#cloud-item-form').forEach((form)=>void hydrateCanonicalTaxableFields(form));
});
canonicalTaxableObserver.observe(document.body,{childList:true,subtree:true});
document.querySelectorAll('#cloud-item-form').forEach((form)=>void hydrateCanonicalTaxableFields(form));

// The layout pass historically marked several SKU inputs read-only before
// the canonical setup-lock check ran.  That made ordinary child inventory
// rows look locked forever.  Once the canonical lock state is known, restore
// editability for unlocked inventory children and update the page-lock
// baseline so the product-page lock does not resurrect the stale state.
const releaseUnlockedChildSkuFields=(form)=>{
  if(!form||form.dataset.productPageEditorLocked==='true')return;
  form.querySelectorAll('[data-variant-row]').forEach((row)=>{
    if(row.dataset.setupLocked!=='false')return;
    const itemType=String(row.querySelector('[data-variant-item-type]')?.value||'Inventory').toLowerCase();
    if(itemType==='non-inventory')return;
    ['[data-variant-cost]','[data-variant-weight]','[data-variant-weight-unit]','[data-variant-unit-type]','[data-variant-quantity]','[data-variant-threshold]','[data-variant-reserve]','[data-variant-item-type]'].forEach((selector)=>{
      const field=row.querySelector(selector);
      if(!field)return;
      field.disabled=false;
      if('readOnly' in field)field.readOnly=false;
      field.dataset.pageEditorOriginalDisabled='false';
      if('readOnly' in field)field.dataset.pageEditorOriginalReadonly='false';
      field.classList.remove('admin-sku-locked-field');
      field.title='';
    });
  });
};
const unlockedChildSkuObserver=new MutationObserver(()=>{
  document.querySelectorAll('#cloud-item-form').forEach((form)=>releaseUnlockedChildSkuFields(form));
});
unlockedChildSkuObserver.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['data-setup-locked']});
document.querySelectorAll('#cloud-item-form').forEach((form)=>releaseUnlockedChildSkuFields(form));

// FormData intentionally omits disabled controls. The product-page lock uses
// disabled controls to prevent editing, but saving the page must still carry
// their current values forward. Preserve every disabled named control in the
// canonical product editor so a locked save cannot blank the name, category,
// visibility, or other editable product metadata.
const preserveDisabledAdminProductFields=(form)=>{
  if(!form||form.dataset.disabledFormDataPreserved)return;
  form.dataset.disabledFormDataPreserved='true';
  form.addEventListener('formdata',(event)=>{
    form.querySelectorAll('input[name],select[name],textarea[name]').forEach((field)=>{
      if(!field.disabled||field.type==='file'||field.type==='hidden')return;
      if(field.type==='checkbox'){
        if(field.checked&&!event.formData.has(field.name))event.formData.append(field.name,'on');
        return;
      }
      if(!event.formData.has(field.name))event.formData.append(field.name,field.value);
    });
    form.querySelectorAll('input[type="checkbox"][name="badges"]:checked').forEach((field)=>{
      if(field.disabled)event.formData.append('badges',field.value);
    });
  });
};
const disabledAdminProductDataObserver=new MutationObserver(()=>{
  document.querySelectorAll('#cloud-item-form').forEach((form)=>preserveDisabledAdminProductFields(form));
});
disabledAdminProductDataObserver.observe(document.body,{childList:true,subtree:true});
document.querySelectorAll('#cloud-item-form').forEach((form)=>preserveDisabledAdminProductFields(form));

// Product history can grow quickly during setup. The initial history renderer
// creates the section, then this canonical enhancement reads bounded chunks
// from each history source and merges them into stable pages. This keeps the
// complete history available without downloading it all on the first view.
const enhanceAdminInventoryHistoryPagination=async(section)=>{
  if(!section||section.dataset.historyPagination)return;
  const form=section.closest('#cloud-item-form');
  const productId=form?.dataset.productId;
  if(!productId)return;
  section.dataset.historyPagination='loading';
  try{
    if(!section.isConnected)return;
    const formatEntry=(entry)=>'<li><strong>'+adminSafe(entry.field_name)+'</strong><span>'+adminSafe(entry.inventory_sku||'Product')+' · '+new Date(entry.created_at).toLocaleString()+' · '+adminSafe(entry.change_type)+'</span><p>Previous: '+adminSafe(entry.previous_value??'—')+' → New: '+adminSafe(entry.new_value??'—')+(entry.note?' · '+adminSafe(entry.note):'')+(entry.historyType==='adjustment'?' · Source: '+adminSafe(String(entry.adjustment_type||'manual').replace(/_/g,' '))+(Number(entry.cost_impact)?' · Cost impact: $'+Number(entry.cost_impact).toFixed(2):''):'')+'</p></li>';
    const pageSize=25;
    const chunkSize=50;
    const state={buffers:{changes:[],adjustments:[]},offsets:{changes:0,adjustments:0},exhausted:{changes:false,adjustments:false},pages:[],page:1,loading:false};
    const normalizeChanges=(rows)=>rows.map((entry)=>({...entry,historyType:'change'})).filter((entry)=>adminHistoryValue(entry.previous_value)!==adminHistoryValue(entry.new_value));
    const normalizeAdjustments=(rows)=>rows.map((entry)=>({id:entry.id,inventory_sku:entry.inventory_sku,field_name:'Inventory quantity',previous_value:String(Number(entry.quantity_after)-Number(entry.quantity_delta)),new_value:String(entry.quantity_after),change_type:'updated',note:entry.note,adjustment_type:entry.adjustment_type,cost_impact:entry.cost_impact,created_at:entry.created_at,historyType:'adjustment'})).filter((entry)=>adminHistoryValue(entry.previous_value)!==adminHistoryValue(entry.new_value));
    const fetchChunk=async(kind)=>{
      if(state.exhausted[kind])return;
      const table=kind==='changes'?'product_change_history':'inventory_adjustments';
      const select=kind==='changes'?'id,inventory_sku,field_name,previous_value,new_value,change_type,note,created_at':'id,inventory_sku,quantity_delta,quantity_after,note,adjustment_type,cost_impact,created_at';
      const offset=state.offsets[kind];
      const result=await cloudAdmin().from(table).select(select).eq('product_id',productId).order('created_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+chunkSize-1);
      if(result.error)throw result.error;
      const rows=Array.isArray(result.data)?result.data:[];
      state.offsets[kind]+=rows.length;
      if(rows.length<chunkSize)state.exhausted[kind]=true;
      state.buffers[kind].push(...(kind==='changes'?normalizeChanges(rows):normalizeAdjustments(rows)));
    };
    const ensureBuffers=async()=>{
      const pending=Object.keys(state.buffers).filter((kind)=>!state.exhausted[kind]&&state.buffers[kind].length<pageSize);
      await Promise.all(pending.map((kind)=>fetchChunk(kind)));
    };
    const takeNextPage=async()=>{
      await ensureBuffers();
      const entries=[...state.buffers.changes,...state.buffers.adjustments].sort((first,second)=>{const byDate=Date.parse(second.created_at)-Date.parse(first.created_at);return byDate||String(second.id||'').localeCompare(String(first.id||''));});
      const next=entries.slice(0,pageSize);
      next.forEach((entry)=>{const source=entry.historyType==='change'?state.buffers.changes:state.buffers.adjustments;const index=source.indexOf(entry);if(index>=0)source.splice(index,1);});
      state.pages.push(next);
      return next;
    };
    const list=document.createElement('ul');
    const pager=document.createElement('div');
    pager.className='admin-pagination';
    section.querySelector('ul')?.replaceWith(list);
    section.append(pager);
    const draw=async(targetPage=state.page)=>{
      if(state.loading)return;
      state.loading=true;
      try{
        while(state.pages.length<targetPage){await takeNextPage();if(!state.pages[state.pages.length-1]?.length)break;}
        state.page=Math.min(targetPage,Math.max(1,state.pages.length));
        const visibleEntries=state.pages[state.page-1]||[];
        const hasMore=state.pages.length>state.page||(!state.exhausted.changes||!state.exhausted.adjustments||state.buffers.changes.length||state.buffers.adjustments.length);
        list.innerHTML=visibleEntries.length?visibleEntries.map(formatEntry).join(''):'<li>No product changes recorded.</li>';
        pager.innerHTML='<button type="button" data-history-page="prev" '+(state.page<=1?'disabled':'')+'>Previous</button><span>Page '+state.page+(hasMore?' · More available':' · End of history')+'</span><button type="button" data-history-page="next" '+(hasMore?'':'disabled')+'>Next</button>';
        pager.querySelector('[data-history-page="prev"]').onclick=()=>{if(state.page>1)void draw(state.page-1);};
        pager.querySelector('[data-history-page="next"]').onclick=()=>{if(hasMore)void draw(state.page+1);};
      }finally{state.loading=false;}
    };
    await draw();
    section.dataset.historyPagination='ready';
  }catch(error){
    section.dataset.historyPagination='error';
    console.error('Unable to paginate product history',error);
  }
};
const adminHistoryPaginationObserver=new MutationObserver(()=>{
  document.querySelectorAll('.admin-inventory-history').forEach((section)=>void enhanceAdminInventoryHistoryPagination(section));
});
adminHistoryPaginationObserver.observe(document.body,{childList:true,subtree:true});
document.querySelectorAll('.admin-inventory-history').forEach((section)=>void enhanceAdminInventoryHistoryPagination(section));

// Default storefront media is stored in the canonical cloud settings row.
// Hydrate the standalone hero/story/footer editors from that row as well as
// the local cache so a fresh admin tab can show the saved media immediately.
let adminDefaultStoreMediaHydration=null;
const hydrateAdminDefaultStoreMedia=()=>{
  const editors=[...document.querySelectorAll('[data-default-hero-editor],[data-default-story-editor],[data-default-footer-logo-editor]')];
  if(!editors.length||!window.beadSupabase||adminDefaultStoreMediaHydration||editors.every((editor)=>editor.dataset.cloudMediaHydrated==='true'))return adminDefaultStoreMediaHydration;
  adminDefaultStoreMediaHydration=(async()=>{
    const value=await loadAdminStoreSettings().catch(()=>null);
    if(!value)return;
    const admin=value.admin&&typeof value.admin==='object'?value.admin:{};
    const config=value.config&&typeof value.config==='object'?value.config:{};
    const snapshot=admin.themeDefaultSnapshot&&typeof admin.themeDefaultSnapshot==='object'?admin.themeDefaultSnapshot:{};
    const fields=[['hero','heroUrl','hero image'],['story','storyUrl','Our Story image'],['footerLogo','footerLogoUrl','footer logo']];
    fields.forEach(([field,key,label])=>{
      const editor=document.querySelector('[data-default-'+field+'-editor]');
      const preview=editor?.querySelector('[data-default-'+field+'-preview]');
      if(!preview||preview.dataset.objectUrl)return;
      editor.dataset.cloudMediaHydrated='true';
      const url=safeAdminThemeImageUrl(snapshot[key]??admin[key]??config[key]);
      if(!url)return;
      preview.src=url;
      preview.hidden=false;
      const status=editor.querySelector('[data-default-'+field+'-status]');
      if(status)status.textContent='Saved '+label+' is loaded from the store.';
    });
  })().catch((error)=>{console.warn('Default storefront media hydration unavailable.',error);}).finally(()=>{adminDefaultStoreMediaHydration=null;});
  return adminDefaultStoreMediaHydration;
};
const adminDefaultStoreMediaObserver=new MutationObserver(()=>void hydrateAdminDefaultStoreMedia());
adminDefaultStoreMediaObserver.observe(document.body,{childList:true,subtree:true});
void hydrateAdminDefaultStoreMedia();
let adminCurrentThemeSyncSignature='';
const synchronizeCurrentAdminTheme=async()=>{
  const form=panel?.querySelector('[data-theme-form]');
  const select=form?.elements?.theme_preset;
  if(!form||!select||select.options.length<2||!window.beadSupabase||select.dataset.userSelected)return;
  const value=await loadAdminStoreSettings();
  if(select.dataset.userSelected)return;
  const admin=value.admin&&typeof value.admin==='object'?value.admin:{};
  const config=value.config&&typeof value.config==='object'?value.config:{};
  const active=normalizeAdminTheme(admin.theme||config.theme);
  const snapshot=admin.themeDefaultSnapshot&&typeof admin.themeDefaultSnapshot==='object'?admin.themeDefaultSnapshot:{};
  const defaultActive=JSON.stringify(active)===JSON.stringify(normalizeAdminTheme(snapshot.theme||{}));
  const presets=Array.isArray(admin.themePresets)?admin.themePresets:[];
  const activePresetIndex=defaultActive?-1:presets.findIndex((preset)=>JSON.stringify(normalizeAdminTheme(preset?.theme||{}))===JSON.stringify(active));
  const selectedValue=defaultActive&&select.querySelector('[value="__locked_default__"]')?'__locked_default__':activePresetIndex>=0?String(activePresetIndex):'';
  const signature=JSON.stringify({active,selectedValue,presets:presets.map((preset)=>preset?.name||'')});
  if(signature===adminCurrentThemeSyncSignature&&select.value===selectedValue)return;
  if(selectedValue)select.value=selectedValue;
  if(selectedValue==='__locked_default__'){
    form.elements.theme_preset_name.value='';
  }else if(activePresetIndex>=0){
    form.elements.theme_preset_name.value=String(presets[activePresetIndex].name||'');
  }
  Object.entries(active).forEach(([key,currentValue])=>{if(form.elements[key])form.elements[key].value=currentValue;});
  const local=adminData();
  saveAdminData({...local,settings:{...(local.settings||{}),...admin}});
  window.productStoreConfig={...window.productStoreConfig,...config};
  localStorage.setItem('beadDifferentProductConfig',JSON.stringify(window.productStoreConfig));
  adminCurrentThemeSyncSignature=signature;
};
void synchronizeCurrentAdminTheme().catch(()=>{});
const adminImportedSkuSectionObserver=new MutationObserver(()=>document.querySelectorAll('.admin-item-form .admin-variant-editor').forEach((section)=>{if(section.dataset.importedSkuSectionOpened)return;section.open=true;section.dataset.importedSkuSectionOpened='true';}));
adminImportedSkuSectionObserver.observe(document.body,{childList:true,subtree:true});
document.addEventListener('submit',(event)=>{if(event.target?.id==='settings-form'){clearAdminStoreSettingsCache();window.clearStorefrontSiteSettingsCache?.();}},true);

// Replace the legacy client-side catalog renderer with the server-paginated
// version. This assignment runs after all helpers are declared and before an
// admin tab can invoke the route renderer.
renderItems=async()=>{
  if(!cloudAdmin()){renderCloudError(new Error('Supabase is not connected.'));return;}
  try{
    let activeTab='live';
    let currentPage=1;
    const pageSize=10;
    let requestId=0;
    let products=[];
    const productTitle=(product)=>product.name&&product.name!=='1'?product.name:product.external_id||product.sku||'Untitled product';
    const leadImage=(product)=>window.storefrontCardImageUrl?.(product.lead_image_url)||product.lead_image_url||'product-mix.jpg';
    const row=(product)=>'<tr><td><img class="admin-product-lead" loading="lazy" decoding="async" src="'+adminSafe(leadImage(product))+'" alt="'+adminSafe(productTitle(product))+'"></td><td><strong>'+adminSafe(productTitle(product))+'</strong></td><td>'+adminSafe(product.sku||'—')+'</td><td>$'+Number(product.price||0).toFixed(2)+'</td><td>'+ (Number(product.quantity)||0)+'</td><td><button data-toggle-visible="'+product.id+'">'+(product.visible?'ON':'OFF')+'</button></td><td><a href="admin.html?edit='+encodeURIComponent(product.id)+'">Edit</a></td></tr>';
    const table=(title,items,total)=>'<section class="admin-card"><h3>'+title+' <span>('+total+')</span></h3><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Lead image</th><th>Product title</th><th>SKU</th><th>Price</th><th>Stock</th><th>Storefront</th><th></th></tr></thead><tbody>'+(items.map(row).join('')||'<tr><td colspan="7">No matching products.</td></tr>')+'</tbody></table></div></section>';
    panel.innerHTML='<div class="admin-heading"><div><p class="kicker">PRODUCT CATALOG</p><h2>Products/SKUs</h2><p>Every product is listed here, whether it is live or deactivated.</p></div><a class="cta" href="admin.html?new=item">Add a product page</a></div><div class="admin-form-grid"><label>Search products<input id="cloud-item-search" type="search" placeholder="Name, SKU, category, or description"></label><label>Filter<select id="cloud-item-filter"><option value="all">All products</option><option value="promo">Active promos</option><option value="clearance">Clearance</option><option value="in-stock">In stock</option><option value="low-stock">Low stock</option><option value="out-of-stock">Out of stock</option></select></label><label>Category<select id="cloud-item-category"><option value="all">All categories</option></select></label><label>Sort by<select id="cloud-item-sort"><option value="name">Name</option><option value="category">Category</option><option value="sku">SKU</option><option value="price">Price</option><option value="quantity">Stock</option><option value="updated">Recently added</option></select></label></div><div class="admin-tabs"><button type="button" data-items-tab="live" aria-selected="true">Live products</button><button type="button" data-items-tab="deactivated" aria-selected="false">Deactivated products</button></div><div id="cloud-items-lists"></div><div id="cloud-items-pagination" class="admin-pagination"></div>';
    void cloudCategoryRows().then((categoryRows)=>{
      const categorySelect=panel.querySelector('#cloud-item-category');
      if(!categorySelect)return;
      const selected=categorySelect.value;
      const categories=[...new Set(['uncategorized',...(categoryRows||[]).map((category)=>String(category.slug||'').trim()).filter(Boolean)])].sort();
      categorySelect.innerHTML='<option value="all">All categories</option>'+categories.map((category)=>'<option value="'+adminSafe(category)+'">'+adminSafe(category)+'</option>').join('');
      categorySelect.value=selected;
    }).catch((error)=>console.warn('Unable to load product categories',error));
    const bindRows=()=>{
      panel.querySelectorAll('[data-toggle-visible]').forEach((button)=>button.addEventListener('click',async()=>{
        const product=products.find((entry)=>entry.id===button.dataset.toggleVisible);
        if(!product)return;
        button.disabled=true;
        const result=await cloudAdmin().from('products').update({visible:!product.visible}).eq('id',product.id);
        if(result.error)return renderCloudError(result.error);
        void renderItems();
      }));
    };
    const draw=async()=>{
      const thisRequest=++requestId;
      const search=panel.querySelector('#cloud-item-search').value.trim();
      const filter=panel.querySelector('#cloud-item-filter').value;
      const category=panel.querySelector('#cloud-item-category').value;
      const sort=panel.querySelector('#cloud-item-sort').value;
      panel.querySelector('#cloud-items-lists').innerHTML='<div class="admin-empty admin-loading" role="status">Loading products…</div>';
      const result=await cloudAdmin().rpc('admin_product_catalog_page',{p_search:search||null,p_filter:filter,p_category:category,p_visible:activeTab==='live',p_sort:sort,p_page:currentPage,p_page_size:pageSize});
      if(thisRequest!==requestId)return;
      if(result.error){renderCloudError(result.error);return;}
      products=result.data||[];
      const total=Number(products[0]?.total_count)||0;
      const pageCount=Math.max(1,Math.ceil(total/pageSize));
      if(currentPage>pageCount){currentPage=pageCount;return void draw();}
      panel.querySelector('#cloud-items-lists').innerHTML=table(activeTab==='live'?'Live products':'Deactivated products',products,total);
      panel.querySelector('#cloud-items-pagination').innerHTML='<button type="button" data-items-prev '+(currentPage===1?'disabled':'')+'>Previous</button><span>Page '+currentPage+' of '+pageCount+' · '+total+' products</span><button type="button" data-items-next '+(currentPage===pageCount?'disabled':'')+'>Next</button>';
      panel.querySelectorAll('[data-items-tab]').forEach((button)=>{
        button.setAttribute('aria-selected',button.dataset.itemsTab===activeTab?'true':'false');
        button.onclick=()=>{activeTab=button.dataset.itemsTab;currentPage=1;void draw();};
      });
      panel.querySelector('[data-items-prev]').onclick=()=>{currentPage=Math.max(1,currentPage-1);void draw();};
      panel.querySelector('[data-items-next]').onclick=()=>{currentPage=Math.min(pageCount,currentPage+1);void draw();};
      bindRows();
    };
    let searchTimer=null;
    for(const selector of ['#cloud-item-filter','#cloud-item-category','#cloud-item-sort'])panel.querySelector(selector).addEventListener('change',()=>{currentPage=1;void draw();});
    panel.querySelector('#cloud-item-search').addEventListener('input',()=>{
      currentPage=1;
      clearTimeout(searchTimer);
      searchTimer=setTimeout(()=>void draw(),250);
    });
    await draw();
  }catch(error){renderCloudError(error);}
};
const installFeaturedBackgroundEditor=()=>{const form=document.querySelector('[data-content-form]');const richEditor=form?.querySelector('.featured-rich-editor');if(!form||!richEditor||form.querySelector('[data-featured-background-editor]'))return;const editor=document.createElement('div');editor.className='featured-background-editor';editor.dataset.featuredBackgroundEditor='true';editor.innerHTML='<label>Featured background image<input type="file" accept="image/*" data-featured-background-input><small>Use a 900 × 700 px image. Selecting a new image replaces the current Featured background.</small></label><p data-featured-background-status role="status"></p><img data-featured-background-preview alt="" hidden>';richEditor.after(editor);const input=editor.querySelector('[data-featured-background-input]');const status=editor.querySelector('[data-featured-background-status]');const preview=editor.querySelector('[data-featured-background-preview]');const current=()=>String(window.productStoreConfig?.featuredBackgroundImageUrl||'').trim();const render=(url=current())=>{preview.hidden=!url;preview.src=url||'';};input.addEventListener('change',async()=>{const file=input.files?.[0];if(!file)return;if(!file.type.startsWith('image/')){status.textContent='Choose an image file.';input.value='';return;}input.disabled=true;status.textContent='Uploading Featured background…';try{const url=await uploadAdminMedia(file,'storefront/featured-background',{canonicalKey:'featured-background'});const value=await loadAdminStoreSettings(true);const currentConfig=value.config&&typeof value.config==='object'?value.config:{};const currentAdmin=value.admin&&typeof value.admin==='object'?value.admin:{};const nextValue={...value,config:{...currentConfig,featuredBackgroundImageUrl:url},admin:{...currentAdmin,featuredBackgroundImageUrl:url}};const result=await patchAdminStoreSettings({config:{featuredBackgroundImageUrl:url},admin:{featuredBackgroundImageUrl:url}});clearAdminStoreSettingsCache();window.clearStorefrontSiteSettingsCache?.();window.productStoreConfig={...(window.productStoreConfig||{}),featuredBackgroundImageUrl:url};const local=adminData();saveAdminData({...local,settings:{...(local.settings||{}),featuredBackgroundImageUrl:url}});render(url);status.textContent='Featured background replaced and saved.';}catch(error){status.textContent='Featured background was not saved: '+(error.message||'Unknown error.');}finally{input.disabled=false;}});render();};const featuredBackgroundObserver=new MutationObserver(()=>installFeaturedBackgroundEditor());featuredBackgroundObserver.observe(document.body,{childList:true,subtree:true});installFeaturedBackgroundEditor();
const normalizeAdminRichMarkup=()=>{document.querySelectorAll('[data-rich-editor]').forEach((editor)=>{const input=editor.closest('.admin-rich-editor')?.querySelector('[data-rich-value]');const text=editor.textContent||'';if(!/(<(?:h[1-6]|p|strong|em|u|ul|ol|li|blockquote)\b|<\/(?:h[1-6]|p|strong|em|u|ul|ol|li|blockquote)>)/i.test(text)||/<(?:h[1-6]|p|strong|em|u|ul|ol|li|blockquote)\b/i.test(editor.innerHTML))return;const safe=window.sanitizeRichText?window.sanitizeRichText(text):text;editor.innerHTML=safe;if(input)input.value=safe;});};const richMarkupObserver=new MutationObserver(()=>normalizeAdminRichMarkup());richMarkupObserver.observe(document.body,{childList:true,subtree:true});normalizeAdminRichMarkup();
const featuredBackgroundUploadInProgress=false;
const hydrateFeaturedBackgroundPreview=()=>{const editor=document.querySelector('[data-featured-background-editor]');if(!editor||editor.dataset.featuredBackgroundHydrated)return;editor.dataset.featuredBackgroundHydrated='true';window.setTimeout(async()=>{try{const value=await loadAdminStoreSettings();const config=value?.config&&typeof value.config==='object'?value.config:{};const admin=value?.admin&&typeof value.admin==='object'?value.admin:{};const url=String(config.featuredBackgroundImageUrl||admin.featuredBackgroundImageUrl||'').trim();const preview=editor.querySelector('[data-featured-background-preview]');const status=editor.querySelector('[data-featured-background-status]');if(url){window.productStoreConfig={...(window.productStoreConfig||{}),featuredBackgroundImageUrl:url};if(preview){preview.hidden=false;preview.src=url;}if(status)status.textContent='Current Featured background is loaded.';}}catch(error){console.warn('Featured background preview unavailable.',error);}},0);};const featuredBackgroundPreviewObserver=new MutationObserver(()=>hydrateFeaturedBackgroundPreview());if(document.body){featuredBackgroundPreviewObserver.observe(document.body,{childList:true,subtree:true});hydrateFeaturedBackgroundPreview();}else document.addEventListener('DOMContentLoaded',()=>{featuredBackgroundPreviewObserver.observe(document.body,{childList:true,subtree:true});hydrateFeaturedBackgroundPreview();});
const mergeStorefrontContentCache=(source={})=>{try{const key=window.storefrontSiteSettingsCacheKey;if(!key)return;const record=JSON.parse(sessionStorage.getItem(key)||'null');if(!record?.data||typeof record.data!=='object')return;sessionStorage.setItem(key,JSON.stringify({...record,data:{...record.data,...source}}));}catch(error){}};window.mergeStorefrontContentCache=mergeStorefrontContentCache;window.__storeContentSaveInProgress=false;document.addEventListener('submit',(event)=>{if(event.target?.matches?.('[data-content-form]')){window.__storeContentSaveInProgress=true;window.setTimeout(()=>{window.__storeContentSaveInProgress=false;},15000);}},true);const installStoreContentCacheBridge=()=>{const current=window.applyStoreContent;if(typeof current!=='function'||current.__storeContentCacheBridge)return;const bridged=(source)=>{current(source);mergeStorefrontContentCache(source);};bridged.__storeContentCacheBridge=true;window.applyStoreContent=bridged;};window.setTimeout(installStoreContentCacheBridge,0);const currentStorefrontSettingsCacheClear=window.clearStorefrontSiteSettingsCache;
let storeContentCacheBridgeAttempts=0;const storeContentCacheBridgeTimer=window.setInterval(()=>{installStoreContentCacheBridge();storeContentCacheBridgeAttempts+=1;if(window.applyStoreContent?.__storeContentCacheBridge||storeContentCacheBridgeAttempts>=20)window.clearInterval(storeContentCacheBridgeTimer);},250);
document.addEventListener('click',async(event)=>{const button=event.target.closest('[data-order-refund-full],[data-order-refund-partial]');if(!button||!window.beadSupabase)return;event.preventDefault();event.stopImmediatePropagation();const orderId=button.dataset.orderRefundFull||button.dataset.orderRefundPartial;const full=Boolean(button.dataset.orderRefundFull);const card=button.closest('.admin-order-card');const input=card?.querySelector(`[data-order-refund-amount="${CSS.escape(orderId)}"]`);const amount=full?null:Number(input?.value||0);if(!full&&!(amount>0)){alert('Enter a partial refund amount first.');return;}if(full&&!confirm('Refund the remaining balance for this order?'))return;const reason=prompt('Refund reason:');if(reason===null)return;button.disabled=true;const requestId=button.dataset.refundRequestId||(button.dataset.refundRequestId=crypto.randomUUID());const status=card?.querySelector(`[data-order-action-status="${CSS.escape(orderId)}"]`);if(status)status.textContent='Submitting refund to Stripe…';try{const result=await window.beadSupabase.functions.invoke('stripe-payments',{body:{action:'refund_order',order_id:orderId,amount,full,reason,request_id:requestId}});if(result.error){let detail=null;try{detail=await result.error.context?.json();}catch(error){}throw new Error(detail?.error||result.error.message||'Refund failed.');}delete button.dataset.refundRequestId;if(status)status.textContent=result.data?.status==='pending'?`Refund submitted to Stripe: $${Number(result.data?.refund_amount||amount||0).toFixed(2)}. Inventory remains unchanged until confirmation.`:`Refund recorded: $${Number(result.data?.refund_amount||amount||0).toFixed(2)}.`;window.dispatchEvent(new CustomEvent('admin-order-changed',{detail:{orderId}}));setTimeout(()=>document.querySelector('[data-admin-tab="orders"]')?.click(),500);}catch(error){if(status)status.textContent='Refund failed: '+(error.message||'Unknown error.');button.disabled=false;}},true);
(()=>{
  const fallback='category.html?category=new-arrivals';
  const injectHeroLinkEditor=()=>{
    const form=[...document.querySelectorAll('form')].find((candidate)=>candidate.querySelector('[name="storyTitle"],[name="faqItems"],[name="contactEmail"]')&&!candidate.dataset.heroLinkEditor);
    if(!form)return;
    form.dataset.heroLinkEditor='true';
    const current=String(window.siteContent?.heroLink||window.productStoreConfig?.heroLink||fallback).trim()||fallback;
    const section=document.createElement('section');
    section.className='admin-card admin-content-hero-link';
    section.style.cssText='display:grid;gap:12px;margin-bottom:24px;padding:20px;border:1px solid #e4d8df;border-radius:14px;background:#fff9fb;max-width:720px;';
    section.innerHTML=`<h3>Homepage hero button</h3><p>Keep the current hero image and set the canonical destination for its button.</p><label>Hero button link <input name="heroLink" type="text" inputmode="url" value="${current.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}" placeholder="category.html?category=new-arrivals, sale.html, or https://example.com"></label><small>Saving this replaces the previous hero button link for future clicks.</small><button type="button" class="admin-button" data-save-hero-link>Save hero destination</button><p data-hero-link-status role="status"></p>`;
    form.insertBefore(section,form.firstElementChild);
    section.querySelector('label').style.cssText='display:grid;gap:6px;font-weight:600;';
    section.querySelector('input').style.cssText='width:100%;box-sizing:border-box;padding:12px;border:1px solid #aaa;border-radius:8px;font:inherit;';
    const input=section.querySelector('[name="heroLink"]');
    const button=section.querySelector('[data-save-hero-link]');
    const status=section.querySelector('[data-hero-link-status]');
    button.addEventListener('click',async()=>{
      const value=String(input.value||'').trim()||fallback;
      button.disabled=true;
      status.textContent='Saving…';
      try{
        let result;
        if(typeof window.patchAdminStoreSettings==='function')result=await window.patchAdminStoreSettings({config:{heroLink:value},admin:{heroLink:value}});
        else if(window.beadSupabase)result=await window.beadSupabase.rpc('admin_patch_store_settings',{p_patch:{config:{heroLink:value},admin:{heroLink:value}}});
        if(result?.error)throw result.error;
        window.siteContent={...(window.siteContent||{}),heroLink:value};
        window.productStoreConfig={...(window.productStoreConfig||{}),heroLink:value};
        window.clearStorefrontSiteSettingsCache?.();
        status.textContent='Hero destination saved.';
      }catch(error){status.textContent=error?.message||'Unable to save hero destination.';}
      finally{button.disabled=false;}
    });
  };
  const start=()=>{injectHeroLinkEditor();new MutationObserver(injectHeroLinkEditor).observe(document.body,{childList:true,subtree:true});};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
