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
  removed_option_values integer := 0;
  removed_mapping_components integer := 0;
  removed_mappings integer := 0;
  is_etsy_imported boolean;
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
    raise exception 'Cannot delete % because it is part of an Etsy mapping that points to another canonical SKU.', inventory.sku;
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
    raise exception 'Cannot delete % because its Etsy mapping contains multiple inventory components.', inventory.sku;
  end if;

  if not is_etsy_imported
     and (
       exists (select 1 from public.product_option_values option_value where option_value.inventory_sku_id = inventory.id)
       or exists (select 1 from public.product_etsy_mappings mapping where mapping.inventory_sku_id = inventory.id)
       or exists (select 1 from public.product_etsy_mapping_components component where component.inventory_sku_id = inventory.id)
     ) then
    raise exception 'Cannot delete % because it is attached to a product page or Etsy mapping. Remove those links first.', inventory.sku;
  end if;

  if is_etsy_imported then
    delete from public.product_etsy_mapping_components component
    using public.product_etsy_mappings mapping
    where component.mapping_id = mapping.id
      and component.inventory_sku_id = inventory.id
      and mapping.inventory_sku_id = inventory.id;
    get diagnostics removed_mapping_components = row_count;

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
    'removed_etsy_mappings', removed_mappings
  );
end;
$$;

revoke all on function public.delete_unused_inventory_sku(uuid) from public, anon, authenticated;
grant execute on function public.delete_unused_inventory_sku(uuid) to authenticated;
