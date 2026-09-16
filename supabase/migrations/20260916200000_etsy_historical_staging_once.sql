alter table public.etsy_import_batches add column if not exists staged_at timestamptz;

create or replace function public.apply_etsy_import_batch(batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private'
as $function$
declare
  current_user_id uuid := (select auth.uid());
  batch public.etsy_import_batches%rowtype;
  review_row jsonb;
  was_inserted boolean;
  result_value jsonb;
  inserted_count integer := 0;
  updated_count integer := 0;
  historical boolean := false;
begin
  if current_user_id is null or not private.is_admin() then raise exception 'Only an administrator can apply an Etsy import.'; end if;
  select * into batch from public.etsy_import_batches where id = batch_id and created_by = current_user_id for update;
  if batch.id is null then raise exception 'This import preview is unavailable. Create a new preview.'; end if;
  if batch.applied_at is not null then return coalesce(batch.result, jsonb_build_object('status','already_applied')); end if;
  if batch.expires_at <= timezone('utc', now()) then raise exception 'This import preview expired. Create a new preview.'; end if;
  historical := coalesce((batch.payload->>'historical')::boolean,false) or coalesce(batch.payload->>'import_mode','')='historical_sales_only';
  if batch.kind='orders' and historical then
    update public.etsy_import_batches set staged_at=coalesce(staged_at,timezone('utc',now())), result=jsonb_build_object('status','staged','sales',coalesce(jsonb_array_length(batch.payload->'sales'),0)) where id=batch.id;
    return jsonb_build_object('status','staged','sales',coalesce(jsonb_array_length(batch.payload->'sales'),0));
  end if;
  if batch.kind='orders' then
    result_value:=public.import_etsy_sales(batch.payload->'sales',true);
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

create or replace function public.apply_staged_historical_etsy_sales()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private'
as $function$
declare
  current_user_id uuid := (select auth.uid());
  inserted_count integer := 0;
  updated_count integer := 0;
  batch_count integer := 0;
  line_count integer := 0;
begin
  if current_user_id is null or not private.is_admin() then raise exception 'Only an administrator can apply staged historical Etsy sales.'; end if;
  perform set_config('app.etsy_import_inventory_mode','historical',true);
  with staged as (
    select b.id as batch_id, value as sale from public.etsy_import_batches b cross join lateral jsonb_array_elements(coalesce(b.payload->'sales','[]'::jsonb)) value
    where b.kind='orders' and b.staged_at is not null and coalesce((b.payload->>'historical')::boolean,false)
  ), upserted as (
    insert into public.etsy_sale_lines (external_order_id,external_line_id,etsy_sku,sale_date,status,quantity,refunded_quantity,gross_revenue,discount_amount,refund_amount,shipping_revenue,sales_tax,marketplace_fees,currency,matched_inventory_sku,match_status,inventory_units_applied,raw_data,updated_at)
    select nullif(trim(coalesce(sale->>'external_order_id',sale->>'order_id',sale->>'receipt_id')),''),nullif(trim(coalesce(sale->>'external_line_id',sale->>'line_id',sale->>'transaction_id')),''),nullif(trim(coalesce(sale->>'etsy_sku',sale->>'sku')),''),coalesce(nullif(trim(sale->>'sale_date'),'')::timestamptz,timezone('utc',now())),lower(coalesce(nullif(trim(sale->>'status'),''),'paid')),greatest(0,coalesce(nullif(sale->>'quantity','')::numeric,0)),greatest(0,coalesce(nullif(sale->>'refunded_quantity','')::numeric,0)),coalesce(nullif(sale->>'gross_revenue','')::numeric,0),coalesce(nullif(sale->>'discount_amount','')::numeric,0),coalesce(nullif(sale->>'refund_amount','')::numeric,0),coalesce(nullif(sale->>'shipping_revenue','')::numeric,0),coalesce(nullif(sale->>'sales_tax','')::numeric,0),coalesce(nullif(sale->>'marketplace_fees','')::numeric,0),coalesce(nullif(trim(sale->>'currency'),''),'USD'),nullif(trim(sale->>'matched_inventory_sku'),''),case when nullif(trim(sale->>'matched_inventory_sku'),'') is null then 'unmatched' else 'matched' end,0,coalesce(sale,'{}'::jsonb),timezone('utc',now())
    from staged
    where nullif(trim(coalesce(sale->>'external_order_id',sale->>'order_id',sale->>'receipt_id')),'') is not null and nullif(trim(coalesce(sale->>'external_line_id',sale->>'line_id',sale->>'transaction_id')),'') is not null and nullif(trim(coalesce(sale->>'etsy_sku',sale->>'sku')),'') is not null
    on conflict (external_order_id,external_line_id) do update set etsy_sku=excluded.etsy_sku,sale_date=excluded.sale_date,status=excluded.status,quantity=excluded.quantity,refunded_quantity=excluded.refunded_quantity,gross_revenue=excluded.gross_revenue,discount_amount=excluded.discount_amount,refund_amount=excluded.refund_amount,shipping_revenue=excluded.shipping_revenue,sales_tax=excluded.sales_tax,marketplace_fees=excluded.marketplace_fees,currency=excluded.currency,matched_inventory_sku=coalesce(excluded.matched_inventory_sku,public.etsy_sale_lines.matched_inventory_sku),match_status=case when coalesce(excluded.matched_inventory_sku,public.etsy_sale_lines.matched_inventory_sku) is null then 'unmatched' else 'matched' end,raw_data=excluded.raw_data,updated_at=timezone('utc',now())
    returning (xmax=0) as was_inserted
  ) select count(*) filter(where was_inserted),count(*) filter(where not was_inserted) into inserted_count,updated_count from upserted;
  select count(*),coalesce(sum(jsonb_array_length(coalesce(payload->'sales','[]'::jsonb))),0) into batch_count,line_count from public.etsy_import_batches where kind='orders' and staged_at is not null and coalesce((payload->>'historical')::boolean,false);
  return jsonb_build_object('status','applied','batches',batch_count,'staged_sales',line_count,'inserted',inserted_count,'updated',updated_count,'inventory_applied',0);
end;
$function$;
