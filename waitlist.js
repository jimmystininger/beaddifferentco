const waitlistAccountKey='beadDifferentAccount';
const waitlistEntriesKey='beadDifferentRestockWaitlist';

function currentWaitlistAccount(){
  if(window.customerAccounts?.current())return window.customerAccounts.current();
  try{return JSON.parse(localStorage.getItem(waitlistAccountKey)||'null');}catch(error){return null;}
}

function waitlistEntries(){
  try{return JSON.parse(localStorage.getItem(waitlistEntriesKey)||'[]');}catch(error){return [];} 
}

function saveWaitlistEntries(entries){localStorage.setItem(waitlistEntriesKey,JSON.stringify(entries));}

function chooseWaitlistMode(requested,available){
  const requestedQuantity=Math.max(1,Number(requested)||1);
  const availableQuantity=Math.max(0,Number(available)||0);
  const partialQuantity=Math.max(0,requestedQuantity-availableQuantity);
  return new Promise((resolve)=>{
    const dialog=document.createElement('dialog');
    dialog.className='account-gate waitlist-choice';
    dialog.innerHTML='<button class="modal-close" type="button" data-waitlist-cancel aria-label="Close">×</button><h2>Choose how to handle the unavailable quantity</h2><p>Only '+availableQuantity+' of the '+requestedQuantity+' requested items are available.</p><div class="waitlist-choice-actions">'+(availableQuantity?'<button type="button" data-waitlist-choice="partial">Buy '+availableQuantity+' now and waitlist '+partialQuantity+'</button>':'')+'<button type="button" data-waitlist-choice="full">Waitlist all '+requestedQuantity+'</button></div>';
    let settled=false;
    const finish=(value)=>{if(settled)return;settled=true;resolve(value);dialog.close();};
    dialog.querySelector('[data-waitlist-cancel]').addEventListener('click',()=>finish(null));
    dialog.querySelectorAll('[data-waitlist-choice]').forEach((button)=>button.addEventListener('click',()=>finish(button.dataset.waitlistChoice)));
    dialog.addEventListener('close',()=>{if(!settled)resolve(null);dialog.remove();},{once:true});
    document.body.append(dialog);
    dialog.showModal();
  });
}

async function requestWaitlistAccount(){
  if(window.beadSupabase){
    const {data:{user}}=await window.beadSupabase.auth.getUser();
    if(user)return{id:user.id,email:user.email};
    window.location.href=`account.html?returnTo=${encodeURIComponent(location.href)}`;
    return null;
  }
  return new Promise((resolve)=>{
    const existing=currentWaitlistAccount();
    if(existing){resolve(existing);return;}
    const dialog=document.createElement('dialog');
    dialog.className='account-gate';
    dialog.innerHTML='<form method="dialog"><button class="modal-close" value="cancel" aria-label="Close">×</button><h2>Log in to join the waitlist</h2><p>Use your email so we can connect this restock request to your account.</p><label>Email address<input name="email" type="email" required autocomplete="email" placeholder="you@example.com"></label><div class="account-gate-actions"><button value="cancel">Cancel</button><button class="cta" value="login">Continue</button></div></form>';
    document.body.append(dialog);
    dialog.addEventListener('close',()=>{const form=dialog.querySelector('form');if(dialog.returnValue==='login'){const email=form.email.value.trim().toLowerCase();const account={email};localStorage.setItem(waitlistAccountKey,JSON.stringify(account));resolve(account);}else resolve(null);dialog.remove();},{once:true});
    dialog.showModal();
  });
}

async function joinRestockWaitlist(entry){
  if(window.beadSupabase){
    const {data:{user}}=await window.beadSupabase.auth.getUser();
    if(!user)throw new Error('Please log in before joining the waitlist.');
    const {data:product,error:productError}=await window.beadSupabase.from('products').select('id').eq('external_id',entry.productId).maybeSingle();
    if(productError||!product)throw productError||new Error('Product is unavailable.');
    const inventorySku=String(entry.inventorySku||entry.selectedOptions?.find((option)=>option.inventorySku)?.inventorySku||'').trim();
    let inventorySkuId=null;
    if(inventorySku){const inventoryResult=await window.beadSupabase.from('inventory_skus').select('id').eq('sku',inventorySku).maybeSingle();if(inventoryResult.error||!inventoryResult.data)throw inventoryResult.error||new Error('The selected SKU is unavailable.');inventorySkuId=inventoryResult.data.id;}
    let existingQuery=window.beadSupabase.from('waitlist_entries').select('id').eq('user_id',user.id).eq('product_id',product.id).eq('status','waiting');
    existingQuery=inventorySkuId?existingQuery.eq('inventory_sku_id',inventorySkuId):existingQuery.is('inventory_sku_id',null);
    const {data:existing}=await existingQuery.maybeSingle();
    if(existing)return false;
    const requestedQuantity=Math.max(1,Number(entry.requestedQuantity)||1);
    const {error}=await window.beadSupabase.from('waitlist_entries').insert({user_id:user.id,product_id:product.id,inventory_sku_id:inventorySkuId,selected_options:Array.isArray(entry.selectedOptions)?entry.selectedOptions:[],requested_quantity:requestedQuantity,requested_total_quantity:Math.max(requestedQuantity,Number(entry.requestedTotalQuantity)||0),available_quantity_at_request:Math.max(0,Number(entry.availableQuantityAtRequest)||0),request_mode:entry.requestMode==='full'?'full':'partial'});
    if(error)throw error;
    return true;
  }
  const entries=waitlistEntries();
  const duplicate=entries.some((saved)=>saved.productId===entry.productId&&saved.accountEmail===entry.accountEmail&&saved.inventorySku===entry.inventorySku&&saved.status==='waiting');
  if(!duplicate){entries.push({...entry,createdAt:new Date().toISOString(),status:'waiting'});saveWaitlistEntries(entries);}
  return !duplicate;
}

window.restockWaitlist={currentAccount:currentWaitlistAccount,requestAccount:requestWaitlistAccount,chooseMode:chooseWaitlistMode,entries:waitlistEntries,join:joinRestockWaitlist};
