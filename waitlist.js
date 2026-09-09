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

function requestWaitlistAccount(){
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

function joinRestockWaitlist(entry){
  const entries=waitlistEntries();
  const duplicate=entries.some((saved)=>saved.productId===entry.productId&&saved.accountEmail===entry.accountEmail&&JSON.stringify(saved.options)===JSON.stringify(entry.options));
  if(!duplicate){entries.push({...entry,createdAt:new Date().toISOString(),status:'waiting'});saveWaitlistEntries(entries);}
  return !duplicate;
}

window.restockWaitlist={currentAccount:currentWaitlistAccount,requestAccount:requestWaitlistAccount,entries:waitlistEntries,join:joinRestockWaitlist};
