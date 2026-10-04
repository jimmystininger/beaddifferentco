create or replace function public.convert_inventory_sku_to_child(
  inventory_sku_id_value uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  inventory record;
  related_component_ids uuid[] := '{}'::uuid[];
  related_component_skus text[] := '{}'::text[];
  affected_mapping_ids uuid[] := '{}'::uuid[];
  affected_product_ids uuid[] := '{}'::uuid[];
  removed_recipe_count integer := 0;
  mapping_count integer := 0;
  option_count integer := 0;
  rebuilt_component_count integer := 0;
  next_metadata jsonb;
begin
  if not private.is_admin() then
    raise exception 'Admin access required.';
  end if;

  select * into inventory
  from public.inventory_skus
  where id = inventory_sku_id_value
  for update;

  if inventory.id is null then
    raise exception 'Inventory SKU not found.';
  end if;

  select
    coalesce(array_agg(recipe.component_sku_id), '{}'::uuid[]),
    coalesce(array_agg(component.sku), '{}'::text[])
  into related_component_ids, related_component_skus
  from public.inventory_bundle_components recipe
  join public.inventory_skus component on component.id = recipe.component_sku_id
  where recipe.bundle_sku_id = inventory.id;

  select
    related_component_ids || coalesce(array_agg(candidate.id), '{}'::uuid[]),
    related_component_skus || coalesce(array_agg(candidate.sku), '{}'::text[])
  into related_component_ids, related_component_skus
  from public.inventory_skus candidate
  where candidate.id <> inventory.id
    and lower(trim(coalesce(candidate.item_type, 'inventory'))) <> 'non-inventory'
    and lower(trim(coalesce(candidate.source_metadata->>'etsy_sku', ''))) = lower(trim(coalesce(inventory.source_metadata->>'etsy_sku', inventory.sku)))
    and (
      nullif(trim(inventory.source_metadata->>'etsy_listing_id'), '') is null
      or candidate.source_metadata->>'etsy_listing_id' = inventory.source_metadata->>'etsy_listing_id'
    );

  select
    coalesce(array_agg(mapping.id), '{}'::uuid[]),
    coalesce(array_agg(distinct mapping.product_id), '{}'::uuid[])
  into affected_mapping_ids, affected_product_ids
  from public.product_etsy_mappings mapping
  where lower(trim(mapping.etsy_sku)) = lower(trim(inventory.sku))
     or mapping.inventory_sku_id = any(related_component_ids)
     or lower(trim(mapping.inventory_sku)) = any(related_component_skus);

  if nullif(trim(inventory.source_metadata->>'etsy_listing_id'), '') is not null then
    affected_product_ids := affected_product_ids || coalesce(
      array(
        select product.id
        from public.products product
        where product.etsy_listing_id::text = inventory.source_metadata->>'etsy_listing_id'
      ),
      '{}'::uuid[]
    );
  end if;

  delete from public.inventory_bundle_components
  where bundle_sku_id = inventory.id;
  get diagnostics removed_recipe_count = row_count;

  update public.product_option_values option_value
  set inventory_sku_id = inventory.id,
      inventory_sku = inventory.sku,
      inventory_units = 1
  where option_value.option_id in (
    select option_row.id
    from public.product_options option_row
    where option_row.product_id = any(affected_product_ids)
  )
    and (
      option_value.inventory_sku_id = any(related_component_ids)
      or lower(trim(option_value.inventory_sku)) = any(related_component_skus)
    );
  get diagnostics option_count = row_count;

  update public.product_etsy_mappings
  set inventory_sku_id = inventory.id,
      inventory_sku = inventory.sku,
      inventory_units = 1
  where id = any(affected_mapping_ids);
  get diagnostics mapping_count = row_count;

  delete from public.product_etsy_mapping_components
  where mapping_id = any(affected_mapping_ids);

  insert into public.product_etsy_mapping_components (
    mapping_id,
    inventory_sku_id,
    inventory_sku,
    inventory_units,
    sort_order
  )
  select mapping_id, inventory.id, inventory.sku, 1, 0
  from unnest(affected_mapping_ids) as mapping_id;
  get diagnostics rebuilt_component_count = row_count;

  next_metadata := coalesce(inventory.source_metadata, '{}'::jsonb)
    || jsonb_build_object(
      'disposition', 'inventory',
      'disposition_updated_at', timezone('utc', now()),
      'converted_from_recipe_parent_at', timezone('utc', now())
    );
  next_metadata := next_metadata - 'predetermined_inventory_sku';

  update public.inventory_skus
  set source_metadata = next_metadata,
      item_type = 'Inventory',
      hierarchy = null,
      updated_at = timezone('utc', now())
  where id = inventory.id;

  return jsonb_build_object(
    'sku', inventory.sku,
    'disposition', 'inventory',
    'removed_recipe_components', removed_recipe_count,
    'product_options_updated', option_count,
    'etsy_mappings_updated', mapping_count,
    'etsy_mapping_components_rebuilt', rebuilt_component_count
  );
end;
$$;

revoke all on function public.convert_inventory_sku_to_child(uuid) from public, anon, authenticated;
grant execute on function public.convert_inventory_sku_to_child(uuid) to authenticated;
