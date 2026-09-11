window.productStoreConfig={
  shippingFrom:'Ohio',
  shippingOriginPostalCode:'',
  shippingOriginCity:'',
  shippingOriginState:'',
  processingDays:3,
  shippingDays:5,
  freeShippingThreshold:35,
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

window.productStoreConfig.estimateArrival=function(zip){
  const start=new Date();
  let days=Number(this.processingDays)+Number(this.shippingDays);
  if(!/^\d{5}(-\d{4})?$/.test(String(zip||'')))return '';
  while(days>0){
    start.setDate(start.getDate()+1);
    if(![0,6].includes(start.getDay()))days-=1;
  }
  return start.toLocaleDateString(undefined,{month:'short',day:'numeric'});
};
