async function invokeStoreEmail(payload){
  if(!window.beadSupabase?.functions?.invoke)throw new Error('Email delivery requires the connected store database.');
  const result=await window.beadSupabase.functions.invoke('send-store-email',{body:payload});
  if(result.error){
    let message=result.error.message||'Email delivery failed.';
    const response=result.error.context;
    if(response?.clone){try{const detail=await response.clone().json();if(detail?.error)message=detail.error;}catch(error){}}
    throw new Error(message);
  }
  if(result.data?.error)throw new Error(result.data.error);
  const data=result.data||{};
  if(data.failures?.length&&!data.sent)throw new Error(data.failures[0]);
  return data;
}

window.sendAdminStoreEmail=invokeStoreEmail;

const emailEscape=(value)=>String(value??'').replace(/[&<>"']/g,(character)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]||character));

const closeEmailComposer=(dialog)=>{if(dialog?.open)dialog.close();dialog?.remove();};

const emailComposer=async(button)=>{
  const to=String(button.dataset.emailTo||'').trim();
  if(!to)return;
  const recipient=String(button.dataset.emailName||to).replace(/<[^>]*>/g,'').trim()||to;
  const subject=String(button.dataset.emailSubject||'Message from Bead Different Co.').trim();
  const itemLink=String(button.dataset.emailLink||'').trim();
  const greeting=`Hello${recipient&&recipient!==to?` ${recipient}`:''},`;
  const linkLine=itemLink?`\n\nItem link: ${itemLink}`:'';
  const dialog=document.createElement('dialog');
  dialog.className='admin-email-dialog';
  dialog.innerHTML=`<form method="dialog" class="admin-email-composer"><button type="button" class="admin-dialog-close" data-close-email aria-label="Close">×</button><div class="admin-email-composer-heading"><p class="kicker">CUSTOMER COMMUNICATION</p><h2>Email customer</h2><p>Write a personal message. The subject and product link are pre-filled for you.</p></div><label>To<input type="email" value="${emailEscape(to)}" readonly></label><label>Subject<input name="subject" value="${emailEscape(subject)}" maxlength="200" required></label>${itemLink?`<label>Item link<input value="${emailEscape(itemLink)}" readonly></label>`:''}<label>Message<textarea name="body" rows="12" maxlength="10000" required>${emailEscape(`${greeting}\n\n${linkLine}`)}</textarea></label><p class="admin-email-reply-note">Replies currently go to the store’s configured sending address.</p><div class="admin-actions"><button type="button" data-close-email>Cancel</button><button class="cta" data-send-email>Send with Resend</button></div><p class="admin-email-status" role="status"></p></form>`;
  document.body.append(dialog);
  const form=dialog.querySelector('form');
  const status=dialog.querySelector('.admin-email-status');
  const sendButton=dialog.querySelector('[data-send-email]');
  dialog.querySelectorAll('[data-close-email]').forEach((control)=>control.addEventListener('click',()=>closeEmailComposer(dialog)));
  dialog.addEventListener('cancel',(event)=>{event.preventDefault();closeEmailComposer(dialog);});
  form.addEventListener('submit',async(event)=>{
    event.preventDefault();
    sendButton.disabled=true;
    status.textContent='Sending…';
    try{
      await invokeStoreEmail({action:'direct',to,subject:form.elements.subject.value.trim(),body:form.elements.body.value});
      status.textContent='Sent with Resend.';
      button.textContent='Sent';
      setTimeout(()=>closeEmailComposer(dialog),700);
    }catch(error){
      status.textContent=`Email was not sent: ${error.message||'Unknown error.'}`;
      sendButton.disabled=false;
    }
  });
  dialog.showModal();
  form.elements.body.focus();
  form.elements.body.setSelectionRange(greeting.length+2,greeting.length+2);
};

document.addEventListener('click',async(event)=>{
  const emailButton=event.target.closest('[data-admin-email]');
  if(emailButton){event.preventDefault();await emailComposer(emailButton);return;}
  const campaignButton=event.target.closest('[data-send-campaign]');
  if(!campaignButton)return;
  campaignButton.disabled=true;
  try{
    const result=await invokeStoreEmail({action:'campaign',campaignId:campaignButton.dataset.sendCampaign});
    campaignButton.textContent=result.alreadySent?'Already sent':`Sent ${result.sent||0}${result.failures?.length?` · ${result.failures.length} failed`:''}`;
  }catch(error){
    window.alert(`Campaign was not sent: ${error.message||'Unknown error.'}`);
    campaignButton.disabled=false;
  }
});
