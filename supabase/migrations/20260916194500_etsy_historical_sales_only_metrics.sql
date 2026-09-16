create or replace function public.queue_manual_etsy_pack_allocation()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'private'
as $function$
begin
  if current_setting('app.etsy_import_inventory_mode', true) = 'historical' then
    return new;
  end if;
  if new.matched_inventory_sku is null
     and greatest(0, coalesce(new.quantity, 0) - least(coalesce(new.quantity, 0), coalesce(new.refunded_quantity, 0))) > 0
     and coalesce(new.inventory_allocation_status, 'not_required') <> 'applied' then
    insert into public.inventory_manual_pack_allocations (source_type, etsy_sale_line_id, parent_sku, units, created_by)
    values ('etsy', new.id, new.etsy_sku, greatest(0, coalesce(new.quantity, 0) - least(coalesce(new.quantity, 0), coalesce(new.refunded_quantity, 0))), auth.uid())
    on conflict (etsy_sale_line_id) do update
      set parent_sku = excluded.parent_sku, units = excluded.units,
          status = case when inventory_manual_pack_allocations.status = 'applied' then 'applied' else 'pending' end;
    if new.inventory_allocation_status <> 'applied' then
      update public.etsy_sale_lines set inventory_allocation_status = 'pending', match_status = 'unmatched', updated_at = timezone('utc', now())
      where id = new.id and inventory_allocation_status <> 'pending';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.apply_etsy_import_batch(batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private'
as $function$
declare
  current_user_id uuid := (select auth.uid()); batch public.etsy_import_batches%rowtype; review_row jsonb; was_inserted boolean; result_value jsonb; inserted_count integer := 0; updated_count integer := 0;
begin
  if current_user_id is null or not private.is_admin() then raise exception 'Only an administrator can apply an Etsy import.'; end if;
  select * into batch from public.etsy_import_batches where id = batch_id and created_by = current_user_id for update;
  if batch.id is null then raise exception 'This import preview is unavailable. Create a new preview.'; end if;
  if batch.applied_at is not null then return coalesce(batch.result, jsonb_build_object('status','already_applied')); end if;
  if batch.expires_at <= timezone('utc', now()) then raise exception 'This import preview expired. Create a new preview.'; end if;
  if batch.kind = 'orders' then
    perform set_config('app.etsy_import_inventory_mode',case when coalesce((batch.payload->>'historical')::boolean,false) then 'historical' else 'inventory' end,true);
    result_value := public.import_etsy_sales(batch.payload->'sales',not coalesce((batch.payload->>'historical')::boolean,false));
  else
    for review_row in select value from jsonb_array_elements(batch.payload->'reviews') as entries(value) loop
      insert into public.reviews (user_id,product_id,review_type,rating,body,photos,status,verified_purchase,reviewer_name,external_source,external_review_id,created_at,updated_at)
      values (null,nullif(review_row->>'product_id','')::uuid,'item',greatest(1,least(5,coalesce(nullif(review_row->>'rating','')::integer,5))),coalesce(review_row->>'body',''),coalesce(array(select jsonb_array_elements_text(coalesce(review_row->'photos','[]'::jsonb))),'{}'::text[]),'approved',true,nullif(left(trim(coalesce(review_row->>'reviewer_name','')),120),''),'etsy',review_row->>'external_review_id',coalesce(nullif(review_row->>'created_at','')::timestamptz,timezone('utc',now())),timezone('utc',now()))
      on conflict (external_source,external_review_id) where external_source is not null and external_review_id is not null do update set product_id=excluded.product_id,rating=excluded.rating,body=excluded.body,photos=excluded.photos,reviewer_name=excluded.reviewer_name,updated_at=timezone('utc',now())
      returning (xmax=0) into was_inserted;
      if was_inserted then inserted_count:=inserted_count+1; else updated_count:=updated_count+1; end if;
    end loop;
    result_value:=jsonb_build_object('inserted',inserted_count,'updated',updated_count);
  end if;
  update public.etsy_import_batches set applied_at=timezone('utc',now()),result=result_value where id=batch.id;
  return result_value;
end;
$function$;
