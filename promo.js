const promoStoreKey='beadDifferentPromos';
let promoRecords=[];
const readPromos=()=>promoRecords.length?promoRecords:(()=>{try{return JSON.parse(localStorage.getItem(promoStoreKey)||'[]');}catch(error){return [];}})();
const savePromos=(promos)=>{promoRecords=promos;localStorage.setItem(promoStoreKey,JSON.stringify(promos));};
function promoDiscount(promo,subtotal){if(!promo||promo.active===false)return 0;const value=Number(promo.value)||0;return Math.min(subtotal,promo.discount_type==='percent'||promo.type==='percent'?subtotal*(value/100):value);}
function findPromo(code){return readPromos().find((promo)=>promo.active!==false&&(promo.code||'').toUpperCase()===String(code||'').trim().toUpperCase());}
function autoPromo(){return readPromos().filter((promo)=>promo.active!==false&&promo.mode==='auto').sort((a,b)=>promoDiscount(b,Infinity)-promoDiscount(a,Infinity))[0]||null;}
window.storePromos={read:readPromos,save:savePromos,find:findPromo,auto:autoPromo,discount:promoDiscount};
window.storePromosReady=window.beadSupabase?window.beadSupabase.from('promo_codes').select('id,code,discount_type,value,mode,active').then(({data,error})=>{if(!error&&data)promoRecords=data;return promoRecords;}):Promise.resolve(readPromos());
