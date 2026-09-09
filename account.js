const profileStoreKey='beadDifferentProfiles';
const sessionStoreKey='beadDifferentAccount';
const profileEscape=(value)=>String(value??'').replace(/[&<>"']/g,(character)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const readProfiles=()=>{try{return JSON.parse(localStorage.getItem(profileStoreKey)||'[]');}catch(error){return [];}};
const saveProfiles=(profiles)=>localStorage.setItem(profileStoreKey,JSON.stringify(profiles));
async function profileCredential(value){const bytes=new TextEncoder().encode(value);const digest=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(digest)].map((byte)=>byte.toString(16).padStart(2,'0')).join('');}
async function createCustomerProfile({name,email,password}){const normalized=email.trim().toLowerCase();const profiles=readProfiles();if(profiles.some((profile)=>profile.email===normalized))throw new Error('An account with that email already exists.');const profile={id:`member-${Date.now()}`,name:name.trim(),email:normalized,passwordHash:await profileCredential(password),createdAt:new Date().toISOString(),status:'active'};profiles.push(profile);saveProfiles(profiles);localStorage.setItem(sessionStoreKey,JSON.stringify({id:profile.id,name:profile.name,email:profile.email}));return profile;}
async function signInCustomer(email,password){const normalized=email.trim().toLowerCase();const profile=readProfiles().find((entry)=>entry.email===normalized);if(!profile||profile.passwordHash!==await profileCredential(password))throw new Error('Email or password is incorrect.');if(profile.status==='blocked')throw new Error('This account is blocked.');localStorage.setItem(sessionStoreKey,JSON.stringify({id:profile.id,name:profile.name,email:profile.email}));return profile;}
function signOutCustomer(){localStorage.removeItem(sessionStoreKey);}
function currentCustomer(){try{return JSON.parse(localStorage.getItem(sessionStoreKey)||'null');}catch(error){return null;}}
window.customerAccounts={profiles:readProfiles,create:createCustomerProfile,signIn:signInCustomer,signOut:signOutCustomer,current:currentCustomer};
