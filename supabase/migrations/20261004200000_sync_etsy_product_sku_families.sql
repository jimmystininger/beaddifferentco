create or replace function public.sync_etsy_product_sku_family(target_product_id uuid, variant_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private'
as $function$
declare
  sku_option_id uuid;
  product_price numeric := 0;
  effective_variants jsonb := coalesce(variant_rows, '[]'::jsonb);
  desired_count integer := 0;
  inserted_count integer := 0;
  desired record;
begin
  if target_product_id is null then
    return jsonb_build_object('status', 'skipped', 'reason', 'missing_product');
  end if;

  select coalesce(price, 0)
    into product_price
  from public.products
  where id = target_product_id;

  if not found then
    return jsonb_build_object('status', 'skipped', 'reason', 'missing_product');
  end if;

  select id
    into sku_option_id
  from public.product_options
  where product_id = target_product_id
    and lower(trim(name)) = 'sku'
  order by sort_order, id
  limit 1;

  if sku_option_id is null then
    insert into public.product_options (product_id, name, required, sort_order)
    values (target_product_id, 'SKU', true, 0)
    returning id into sku_option_id;
  end if;

  for desired in
  with input_rows as (
    select
      upper(trim(coalesce(value->>'one_pk_sku', ''))) as child_sku,
      upper(trim(coalesce(value->>'etsy_sku', ''))) as parent_sku,
      case
        when coalesce(value->>'pack_size', '') ~ '^\d+$' then greatest(1, (value->>'pack_size')::integer)
        when upper(trim(coalesce(value->>'etsy_sku', ''))) ~ '-\d{1,3}PK$'
          then greatest(1, (regexp_match(upper(trim(value->>'etsy_sku')), '-(\d{1,3})PK$'))[1]::integer)
        else 1
      end as pack_size,
      ordinality
    from jsonb_array_elements(effective_variants) with ordinality
  ), normalized_rows as (
    select
      regexp_replace(regexp_replace(nullif(child_sku, ''), '[^A-Z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g') as child_sku,
      regexp_replace(regexp_replace(nullif(parent_sku, ''), '[^A-Z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g') as parent_sku,
      pack_size,
      ordinality
    from input_rows
  ), family_rows as (
    select
      child_sku as sku,
      '1PK' as label,
      1 as pack_size,
      ordinality as family_order,
      0 as row_kind
    from normalized_rows
    where child_sku is not null
    union all
    select
      parent_sku as sku,
      coalesce(nullif(parent_sku, ''), pack_size::text || 'PK') as label,
      pack_size,
      ordinality as family_order,
      1 as row_kind
    from normalized_rows
    where parent_sku is not null
      and parent_sku <> child_sku
  ), deduplicated as (
    select distinct on (sku)
      sku,
      label,
      pack_size,
      family_order,
      row_kind
    from family_rows
    where sku is not null and sku <> ''
    order by sku, family_order, row_kind, pack_size
  )
  select sku, label, pack_size,
         row_number() over (order by family_order, row_kind, pack_size, sku)::integer - 1 as sort_order
  from deduplicated
  order by sort_order
  loop
    desired_count := desired_count + 1;
    declare
      inventory_row public.inventory_skus%rowtype;
      existing_id uuid;
      source_image text;
    begin
      select * into inventory_row
      from public.inventory_skus
      where lower(trim(sku)) = lower(desired.sku)
      limit 1;

      if inventory_row.id is null then
        continue;
      end if;

      select image_url
        into source_image
      from public.product_option_values
      where option_id = sku_option_id
        and image_url is not null
      order by sort_order, id
      limit 1;

      select id
        into existing_id
      from public.product_option_values
      where option_id = sku_option_id
        and lower(trim(coalesce(inventory_sku, sku, ''))) = lower(desired.sku)
      order by sort_order, id
      limit 1;

      if existing_id is null then
        insert into public.product_option_values (
          option_id, label, price_delta, sort_order, sku, inventory_sku,
          inventory_units, quantity, low_stock_threshold, image_url, unit_type,
          inventory_sku_id, sku_filter_options
        ) values (
          sku_option_id,
          desired.label,
          greatest(0, coalesce(inventory_row.price, 0) - product_price),
          desired.sort_order,
          inventory_row.sku,
          inventory_row.sku,
          1,
          greatest(0, coalesce(inventory_row.quantity_on_hand, 0)),
          greatest(0, coalesce(inventory_row.reorder_point, 0)),
          source_image,
          coalesce(nullif(trim(inventory_row.unit_type), ''), 'Each'),
          inventory_row.id,
          '[]'::jsonb
        );
        inserted_count := inserted_count + 1;
      else
        update public.product_option_values
        set sort_order = desired.sort_order,
            sku = inventory_row.sku,
            inventory_sku = inventory_row.sku,
            inventory_sku_id = inventory_row.id,
            inventory_units = greatest(1, coalesce(inventory_units, 1)),
            quantity = greatest(0, coalesce(inventory_row.quantity_on_hand, 0)),
            low_stock_threshold = greatest(0, coalesce(inventory_row.reorder_point, 0)),
            unit_type = coalesce(nullif(trim(unit_type), ''), nullif(trim(inventory_row.unit_type), ''), 'Each'),
            image_url = coalesce(image_url, source_image)
        where id = existing_id;
      end if;
    end;
  end loop;

  return jsonb_build_object('status', 'synced', 'desired', desired_count, 'inserted', inserted_count);
end;
$function$;

revoke all on function public.sync_etsy_product_sku_family(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.sync_etsy_product_sku_family(uuid, jsonb) to service_role;

do $backfill$
declare
  page record;
begin
  for page in
    select p.id as product_id,
           coalesce(listing.raw_payload->'variants', '[]'::jsonb) as variants
    from public.products p
    left join lateral (
      select raw_payload
      from public.etsy_import_listings listing_row
      where listing_row.proposed_product_id = p.id
      order by listing_row.updated_at desc nulls last, listing_row.id
      limit 1
    ) listing on true
    where p.etsy_listing_id is not null
       or listing.raw_payload is not null
  loop
    perform public.sync_etsy_product_sku_family(page.product_id, page.variants);
  end loop;
end;
$backfill$;
