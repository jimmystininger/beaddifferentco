const adminEscape=(value)=>String(value??'').replace(/[&<>"']/g,(character)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const waitlistTarget=document.querySelector('#restock-waitlist-list');
function renderRestockWaitlist(){
  const entries=window.restockWaitlist.entries();
  if(!entries.length){waitlistTarget.innerHTML='<div class="admin-empty">No customers are waiting on a restock yet.</div>';return;}
  waitlistTarget.innerHTML=`<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Product</th><th>Options</th><th>Account</th><th>Joined</th><th>Status</th><th></th></tr></thead><tbody>${entries.map((entry,index)=>`<tr><td>${adminEscape(entry.productName)}</td><td>${adminEscape((entry.options||[]).join(' · '))}</td><td>${adminEscape(entry.accountEmail)}</td><td>${new Date(entry.createdAt).toLocaleDateString()}</td><td>${adminEscape(entry.status||'waiting')}</td><td><button type="button" data-remove-waitlist="${index}">Remove</button></td></tr>`).join('')}</tbody></table></div>`;
  waitlistTarget.querySelectorAll('[data-remove-waitlist]').forEach((button)=>button.addEventListener('click',()=>{const next=window.restockWaitlist.entries();next.splice(Number(button.dataset.removeWaitlist),1);localStorage.setItem('beadDifferentRestockWaitlist',JSON.stringify(next));renderRestockWaitlist();}));
}
renderRestockWaitlist();
