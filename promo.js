const promoStoreKey='beadDifferentPromos';
let promoRecords=[];
const readPromos=()=>promoRecords.length?promoRecords:(()=>{try{return JSON.parse(localStorage.getItem(promoStoreKey)||'[]');}catch(error){return [];}})();
const savePromos=(promos)=>{promoRecords=promos;localStorage.setItem(promoStoreKey,JSON.stringify(promos));};
const promoIsActive=(promo)=>promo?.active!==false&&(!promo.starts_at||Date.parse(promo.starts_at)<=Date.now())&&(!promo.ends_at||Date.parse(promo.ends_at)>=Date.now());
function promoDiscount(promo,subtotal){if(!promo||!promoIsActive(promo))return 0;const amount=Math.max(0,Number(subtotal)||0);const value=Math.max(0,Number(promo.value)||0);return Math.min(amount,promo.discount_type==='percent'||promo.type==='percent'?amount*(value/100):value);}
function findPromo(code){return readPromos().find((promo)=>promoIsActive(promo)&&(promo.code||'').toUpperCase()===String(code||'').trim().toUpperCase());}
async function findPromoAsync(code){const local=findPromo(code);if(local)return local;if(!window.beadSupabase)return null;const result=await window.beadSupabase.rpc('lookup_test_promo',{promo_code:String(code||'').trim()});if(result.error)throw result.error;return result.data||null;}
function autoPromo(subtotal=0){return readPromos().filter((promo)=>promo.mode==='auto'&&promoIsActive(promo)).sort((a,b)=>promoDiscount(b,subtotal)-promoDiscount(a,subtotal))[0]||null;}
window.storePromos={read:readPromos,save:savePromos,find:findPromo,findAsync:findPromoAsync,auto:autoPromo,discount:promoDiscount};
window.storePromosReady=window.beadSupabase?window.beadSupabase.from('promo_codes').select('id,code,discount_type,value,mode,active,starts_at,ends_at').eq('mode','auto').then(({data,error})=>{if(!error&&data)promoRecords=data;return promoRecords;}):Promise.resolve(readPromos());
