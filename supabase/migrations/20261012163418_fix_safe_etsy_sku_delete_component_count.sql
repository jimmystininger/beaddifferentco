create or replace function public.delete_unused_inventory_sku(
  inventory_sku_id_value uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  inventory record;
  repair_mapping record;
  repair_candidate record;
  removed_option_values integer := 0;
  removed_mapping_components integer := 0;
  removed_mappings integer := 0;
  repaired_mappings integer := 0;
  deleted_component_count integer := 0;
  is_etsy_imported boolean;
  mapping_component_count integer;
  current_component_count integer;
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

  is_etsy_imported := (
    lower(coalesce(inventory.source_system, '')) = 'etsy-import'
    or inventory.source_metadata->>'source' = 'etsy_listing'
  ) and coalesce(inventory.source_metadata->>'disposition', '') <> 'inventory';

  if exists (
    select 1
    from public.inventory_bundle_components component
    where component.component_sku_id = inventory.id
  ) then
    raise exception 'Cannot delete % because it is used as a child in a saved recipe.', inventory.sku;
  end if;

  if exists (
    select 1
    from public.inventory_adjustments adjustment
    where adjustment.inventory_sku_id = inventory.id
  ) then
    raise exception 'Cannot delete % because it has inventory adjustment history.', inventory.sku;
  end if;

  if exists (
    select 1
    from public.inventory_purchase_lines purchase_line
    where purchase_line.inventory_sku_id = inventory.id
  ) then
    raise exception 'Cannot delete % because it has purchase history.', inventory.sku;
  end if;

  if exists (
    select 1
    from public.product_etsy_mapping_components component
    join public.product_etsy_mappings mapping on mapping.id = component.mapping_id
    where component.inventory_sku_id = inventory.id
      and mapping.inventory_sku_id is distinct from inventory.id
  ) then
    raise exception 'Cannot delete % because it is part of an Etsy link that points to another canonical SKU.', inventory.sku;
  end if;

  if is_etsy_imported then
    for repair_mapping in
      select mapping.id, mapping.product_id, mapping.etsy_sku
      from public.product_etsy_mappings mapping
      where mapping.inventory_sku_id = inventory.id
        and (
          select count(*)
          from public.product_etsy_mapping_components component
          where component.mapping_id = mapping.id
        ) > 1
      for update
    loop
      select count(*)
      into mapping_component_count
      from public.product_etsy_mapping_components component
      where component.mapping_id = repair_mapping.id;

      select count(*)
      into current_component_count
      from public.product_etsy_mapping_components component
      where component.mapping_id = repair_mapping.id
        and component.inventory_sku_id = inventory.id;

      if mapping_component_count <> 2 or current_component_count <> 1 then
        raise exception 'Cannot safely remove %: its Etsy sale link has more than one extra inventory component.', inventory.sku;
      end if;

      select component.id,
             component.inventory_units,
             candidate.id as candidate_id,
             candidate.sku as candidate_sku,
             candidate.source_metadata as candidate_metadata,
             candidate.item_type as candidate_item_type
      into repair_candidate
      from public.product_etsy_mapping_components component
      join public.inventory_skus candidate
        on candidate.id = component.inventory_sku_id
      where component.mapping_id = repair_mapping.id
        and component.inventory_sku_id <> inventory.id;

      if repair_candidate.candidate_id is null
         or repair_candidate.candidate_metadata->>'disposition' <> 'inventory'
         or repair_candidate.candidate_metadata->>'etsy_listing_id' is distinct from inventory.source_metadata->>'etsy_listing_id'
         or lower(coalesce(repair_candidate.candidate_item_type, 'inventory')) = 'non-inventory'
         or not exists (
           select 1
           from public.products product
           where product.id = repair_mapping.product_id
             and product.etsy_listing_id::text = inventory.source_metadata->>'etsy_listing_id'
         )
         or not exists (
           select 1
           from public.inventory_skus bundle
           join public.inventory_bundle_components recipe
             on recipe.bundle_sku_id = bundle.id
           where upper(trim(bundle.sku)) = upper(trim(repair_mapping.etsy_sku))
             and recipe.component_sku_id = repair_candidate.candidate_id
             and recipe.quantity = repair_candidate.inventory_units
         ) then
        raise exception 'Cannot safely remove %: its Etsy sale link does not match the saved product recipe.', inventory.sku;
      end if;

      update public.product_etsy_mappings
      set inventory_sku = repair_candidate.candidate_sku,
          inventory_sku_id = repair_candidate.candidate_id,
          inventory_units = repair_candidate.inventory_units
      where id = repair_mapping.id;

      delete from public.product_etsy_mapping_components
      where mapping_id = repair_mapping.id
        and inventory_sku_id = inventory.id;

      get diagnostics deleted_component_count = row_count;
      if deleted_component_count <> 1 then
        raise exception 'Cannot safely remove %: the incorrect Etsy sale-link component changed.', inventory.sku;
      end if;

      repaired_mappings := repaired_mappings + 1;
      removed_mapping_components := removed_mapping_components + deleted_component_count;
    end loop;
  end if;

  if exists (
    select 1
    from public.product_etsy_mappings mapping
    where mapping.inventory_sku_id = inventory.id
      and (
        select count(*)
        from public.product_etsy_mapping_components component
        where component.mapping_id = mapping.id
      ) > 1
  ) then
    raise exception 'Cannot delete % because its Etsy link has multiple inventory components that do not match a saved product recipe.', inventory.sku;
  end if;

  if not is_etsy_imported
     and (
       exists (select 1 from public.product_option_values option_value where option_value.inventory_sku_id = inventory.id)
       or exists (select 1 from public.product_etsy_mappings mapping where mapping.inventory_sku_id = inventory.id)
       or exists (select 1 from public.product_etsy_mapping_components component where component.inventory_sku_id = inventory.id)
     ) then
    raise exception 'Cannot delete % because it is attached to a product page or Etsy link. Remove those links first.', inventory.sku;
  end if;

  if is_etsy_imported then
    delete from public.product_etsy_mapping_components component
    using public.product_etsy_mappings mapping
    where component.mapping_id = mapping.id
      and component.inventory_sku_id = inventory.id
      and mapping.inventory_sku_id = inventory.id;
    get diagnostics deleted_component_count = row_count;
    removed_mapping_components := removed_mapping_components + deleted_component_count;

    delete from public.product_etsy_mappings mapping
    where mapping.inventory_sku_id = inventory.id;
    get diagnostics removed_mappings = row_count;

    delete from public.product_option_values option_value
    where option_value.inventory_sku_id = inventory.id;
    get diagnostics removed_option_values = row_count;
  end if;

  delete from public.inventory_skus
  where id = inventory.id;

  return jsonb_build_object(
    'deleted', true,
    'sku', inventory.sku,
    'removed_product_options', removed_option_values,
    'removed_etsy_mapping_components', removed_mapping_components,
    'removed_etsy_mappings', removed_mappings,
    'repaired_etsy_links', repaired_mappings
  );
end;
$$;

revoke all on function public.delete_unused_inventory_sku(uuid) from public, anon, authenticated;
grant execute on function public.delete_unused_inventory_sku(uuid) to authenticated;
