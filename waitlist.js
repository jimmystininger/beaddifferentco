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
    const {data:existing}=await window.beadSupabase.from('waitlist_entries').select('id').eq('user_id',user.id).eq('product_id',product.id).eq('status','waiting').maybeSingle();
    if(existing)return false;
    const {error}=await window.beadSupabase.from('waitlist_entries').insert({user_id:user.id,product_id:product.id,requested_quantity:Number(entry.requestedQuantity)||1});
    if(error)throw error;
    return true;
  }
  const entries=waitlistEntries();
  const duplicate=entries.some((saved)=>saved.productId===entry.productId&&saved.accountEmail===entry.accountEmail&&JSON.stringify(saved.options)===JSON.stringify(entry.options));
  if(!duplicate){entries.push({...entry,createdAt:new Date().toISOString(),status:'waiting'});saveWaitlistEntries(entries);}
  return !duplicate;
}

window.restockWaitlist={currentAccount:currentWaitlistAccount,requestAccount:requestWaitlistAccount,entries:waitlistEntries,join:joinRestockWaitlist};
