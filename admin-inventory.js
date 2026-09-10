const inventoryTarget=document.querySelector('#inventory-controls');
const inventoryEscape=(value)=>String(value??'').replace(/[&<>"']/g,(character)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));

async function loadInventory(){
  if(window.beadSupabase){
    const {data:{user}}=await window.beadSupabase.auth.getUser();
    if(!user){inventoryTarget.innerHTML='<div class="admin-empty">Admin sign-in required.</div>';return;}
    const {data:profile}=await window.beadSupabase.from('profiles').select('role,status').eq('id',user.id).maybeSingle();
    if(profile?.role!=='admin'||profile?.status!=='active'){inventoryTarget.innerHTML='<div class="admin-empty">Admin access required.</div>';return;}
  }
  await loadCatalog();
  renderInventory();
}

function renderInventory(){
  const config=window.productStoreConfig||{};
  inventoryTarget.innerHTML=`<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Product</th><th>Stock</th><th>Visible on site</th><th>Waitlist</th></tr></thead><tbody>${catalog.map((item)=>`<tr><td>${inventoryEscape(item.name)}</td><td>${item.quantity||0}</td><td><label class="admin-toggle"><input type="checkbox" data-visibility-id="${inventoryEscape(item.id)}" ${item.externalId?item.visible===true:isProductVisible(item)?'checked':''}><span>Show item</span></label></td><td><label class="admin-toggle"><input type="checkbox" data-product-id="${inventoryEscape(item.id)}" ${item.externalId?item.waitlist!==false:!config.waitlistDisabled?.[item.id]?'checked':''}><span>Waitlist available</span></label></td></tr>`).join('')}</tbody></table></div>`;
  inventoryTarget.querySelectorAll('[data-visibility-id]').forEach((checkbox)=>checkbox.addEventListener('change',()=>updateInventory(catalog.find((item)=>item.id===checkbox.dataset.visibilityId),{visible:checkbox.checked},checkbox)));
  inventoryTarget.querySelectorAll('[data-product-id]').forEach((checkbox)=>checkbox.addEventListener('change',()=>updateWaitlist(catalog.find((item)=>item.id===checkbox.dataset.productId),checkbox.checked,checkbox)));
}

async function updateInventory(item,changes,checkbox){
  if(!item)return;
  if(item.externalId&&window.beadSupabase){const {error}=await window.beadSupabase.from('products').update(changes).eq('external_id',item.externalId);if(error){checkbox.checked=!changes.visible;return;}item.visible=changes.visible;return;}
  const hidden=hiddenProductIds();
  if(changes.visible)hidden.delete(item.id);else hidden.add(item.id);
  localStorage.setItem('beadDifferentHiddenProducts',JSON.stringify([...hidden]));
}

async function updateWaitlist(item,enabled,checkbox){
  if(!item)return;
  if(item.externalId&&window.beadSupabase){const {error}=await window.beadSupabase.from('products').update({waitlist_enabled:enabled}).eq('external_id',item.externalId);if(error){checkbox.checked=!enabled;return;}item.waitlist=enabled;return;}
  const disabled={...(window.productStoreConfig?.waitlistDisabled||{})};
  if(enabled)delete disabled[item.id];else disabled[item.id]=true;
  window.productStoreConfig.waitlistDisabled=disabled;
  localStorage.setItem('beadDifferentWaitlistDisabled',JSON.stringify(disabled));
}

loadInventory().catch(()=>{inventoryTarget.innerHTML='<div class="admin-empty">Unable to load inventory. Please try again.</div>';});
