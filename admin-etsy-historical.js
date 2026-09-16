(function(){
  const original=window.renderEtsyImports;
  if(typeof original!=='function')return;
  window.renderEtsyImports=async function(){
    await original();
    const button=document.querySelector('[data-import-three-years]');
    const status=document.querySelector('[data-import-status]');
    const client=cloudAdmin();
    if(!button||!client)return;
    const historical=async(body)=>{const r=await client.functions.invoke('etsy-historical',{body:{action:'preview_orders',...body}});if(r.error){let detail;try{detail=await r.error.context?.json();}catch(_){}throw new Error(detail?.error||r.error.message||'Unable to reach the historical Etsy importer.');}if(r.data?.error)throw new Error(r.data.error);return r.data;};
    const applyStage=async(batchId)=>{const r=await client.rpc('apply_etsy_import_batch',{batch_id:batchId});if(r.error)throw r.error;return r.data||{};};
    const loadStagedWindows=async()=>{
      const {data,error}=await client.from('etsy_import_batches').select('payload').eq('kind','orders').not('staged_at','is',null);
      if(error)throw error;
      const windows=new Set();
      (data||[]).forEach(row=>{
        const p=row?.payload;
        if(p?.historical!==true)return;
        const w=p?.historical_window;
        if(!w)return;
        const min=Number(w.min_created),max=Number(w.max_created);
        if(Number.isFinite(min)&&Number.isFinite(max)&&max>min)windows.add(min+':'+max);
      });
      return windows;
    };
    button.onclick=async()=>{
      if(!window.confirm('Import every Etsy order from the last three years? Already staged historical date windows will be skipped. Inventory, recipes, and Etsy Flags will NOT be changed by this historical import.'))return;
      const buttons=[...document.querySelectorAll('[data-import-new-orders],[data-import-three-years],[data-import-all-reviews]')];buttons.forEach(b=>b.disabled=true);
      let stagedLines=0,stagedBatches=0,skippedWindows=0;
      const day=86400,end=Math.floor(Date.now()/1000),start=Math.floor(new Date(new Date().setFullYear(new Date().getFullYear()-3)).getTime()/1000);
      try{
        const stagedWindows=await loadStagedWindows();
        const processWindow=async(min,max)=>{
          const key=min+':'+max;
          if(stagedWindows.has(key)){skippedWindows++;return;}
          const probe=await historical({min_created:min,max_created:max,offset:0,probe:true});
          const count=Number(probe.total_receipts)||0;
          if(!count)return;
          if(count>11975){const mid=Math.floor((min+max)/2);await processWindow(min,mid);await processWindow(mid,max);return;}
          let offset=0;
          while(true){
            status.textContent='Staging Etsy history: '+new Date(min*1000).toLocaleDateString()+'–'+new Date(max*1000).toLocaleDateString()+' · '+(offset+1)+'+';
            const p=await historical({min_created:min,max_created:max,offset});
            if(!p.receipts)break;
            await applyStage(p.batch_id);
            stagedBatches++;stagedLines+=Number(p.sales)||0;
            if(!p.has_more)break;
            offset=p.next_offset;
          }
          stagedWindows.add(key);
        };
        let cursor=start;const windowSize=30*day;
        while(cursor<end){const max=Math.min(end,cursor+windowSize);await processWindow(cursor,max);cursor=max;}
        status.textContent='Historical Etsy staging finished: '+stagedLines+' new sale lines in '+stagedBatches+' staged batches. Skipped '+skippedWindows+' already-staged windows. Nothing has been applied to inventory.';
      }catch(e){status.textContent=(e.message||'Historical import stopped.')+' Staged so far: '+stagedLines+' sale lines in '+stagedBatches+' batches. Skipped '+skippedWindows+' already-staged windows.';}
      finally{buttons.forEach(b=>b.disabled=false);}
    };
  };
})();
