window.productStoreConfig={
  shippingFrom:'Ohio',
  shippingOriginPostalCode:'',
  shippingOriginCity:'',
  shippingOriginState:'',
  processingDays:3,
  freeShippingThreshold:35,
  msrpMarkupPercent:100,
  rewardThreshold:35,
  rewardDiscountPercent:5,
  shippingCarrier:'manual',
  shippingBoxes:[],
  waitlistDisabled:JSON.parse(localStorage.getItem('beadDifferentWaitlistDisabled')||'{}'),
  options:{}
};

try{
  const savedConfig=JSON.parse(localStorage.getItem('beadDifferentProductConfig')||'{}');
  Object.assign(window.productStoreConfig,savedConfig);
}catch(error){
  localStorage.removeItem('beadDifferentProductConfig');
}

const loadStorefrontShippingSettings=async()=>{
  if(window.siteSettingsReady){
    const value=await window.siteSettingsReady;
    if(value)Object.assign(window.productStoreConfig,{...value,processingDays:Math.max(0,Number(value.processingDays)||0)});
    return window.productStoreConfig;
  }
  const client=window.beadSupabase;
  if(!client?.rpc)return window.productStoreConfig;
  try{
    const result=await client.rpc('get_storefront_shipping_settings');
    if(!result.error&&result.data)Object.assign(window.productStoreConfig,{...result.data,processingDays:Math.max(0,Number(result.data.processingDays)||0)});
  }catch(error){}
  return window.productStoreConfig;
};

window.shippingSettingsReady=loadStorefrontShippingSettings();
