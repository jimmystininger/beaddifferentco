const reviewStoreKey='beadDifferentReviews';
const readReviews=()=>{try{return JSON.parse(localStorage.getItem(reviewStoreKey)||'[]');}catch(error){return [];}};
const saveReviews=(reviews)=>localStorage.setItem(reviewStoreKey,JSON.stringify(reviews));
const reviewEscape=(value)=>String(value??'').replace(/[&<>"']/g,(character)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
function purchasedItemIds(){try{return new Set(JSON.parse(localStorage.getItem('beadDifferentPurchasedItems')||'[]'));}catch(error){return new Set();}}
function submitReview(review){const account=window.restockWaitlist?.currentAccount();if(!account)throw new Error('Please log in before leaving a review.');const reviews=readReviews();reviews.push({...review,id:`review-${Date.now()}`,email:account.email,status:'pending',createdAt:new Date().toISOString()});saveReviews(reviews);return true;}
window.reviewTools={read:readReviews,save:saveReviews,purchasedItemIds,submit:submitReview,escape:reviewEscape};
