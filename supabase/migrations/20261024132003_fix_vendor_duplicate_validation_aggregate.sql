create or replace function public.admin_replace_inventory_sku_vendor_options(
  p_inventory_sku_id uuid,
  p_vendors jsonb,
  p_vendor_product_image_path text
)
returns setof public.inventory_sku_vendors
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  preferred_count integer;
  preferred_option jsonb;
begin
  if not private.is_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_vendors, '[]'::jsonb)) <> 'array' then
    raise exception 'Vendor options must be provided as a list.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.inventory_skus where id = p_inventory_sku_id) then
    raise exception 'Canonical inventory SKU was not found.' using errcode = 'P0002';
  end if;

  select count(*) into preferred_count
  from jsonb_array_elements(coalesce(p_vendors, '[]'::jsonb)) as vendor_item(value)
  where coalesce((vendor_item.value->>'is_preferred')::boolean, false);
  if preferred_count > 1 or (jsonb_array_length(coalesce(p_vendors, '[]'::jsonb)) > 0 and preferred_count <> 1) then
    raise exception 'Choose exactly one preferred vendor when vendor options exist.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_vendors, '[]'::jsonb)) as vendor_item(value)
    group by lower(trim(coalesce(vendor_item.value->>'vendor_name', '')))
    having count(*) > 1 or bool_or(length(trim(coalesce(vendor_item.value->>'vendor_name', ''))) = 0)
  ) then
    raise exception 'Vendor names must be non-empty and unique for this SKU.' using errcode = '22023';
  end if;

  delete from public.inventory_sku_vendors where inventory_sku_id = p_inventory_sku_id;
  insert into public.inventory_sku_vendors (
    id, inventory_sku_id, vendor_name, vendor_reorder_number, is_preferred
  )
  select
    coalesce(nullif(vendor_item.value->>'id', '')::uuid, gen_random_uuid()),
    p_inventory_sku_id,
    trim(vendor_item.value->>'vendor_name'),
    nullif(trim(vendor_item.value->>'vendor_reorder_number'), ''),
    coalesce((vendor_item.value->>'is_preferred')::boolean, false)
  from jsonb_array_elements(coalesce(p_vendors, '[]'::jsonb)) as vendor_item(value);

  select vendor_item.value into preferred_option
  from jsonb_array_elements(coalesce(p_vendors, '[]'::jsonb)) as vendor_item(value)
  where coalesce((vendor_item.value->>'is_preferred')::boolean, false)
  limit 1;

  update public.inventory_skus
  set preferred_vendor = nullif(trim(preferred_option->>'vendor_name'), ''),
      vendor_reorder_number = nullif(trim(preferred_option->>'vendor_reorder_number'), ''),
      vendor_product_image_path = nullif(trim(p_vendor_product_image_path), ''),
      updated_at = timezone('utc', now())
  where id = p_inventory_sku_id;

  return query
  select v.* from public.inventory_sku_vendors v
  where v.inventory_sku_id = p_inventory_sku_id
  order by v.is_preferred desc, lower(v.vendor_name), v.id;
end;
$function$;