create or replace function public.delete_unused_inventory_sku(
  inventory_sku_id_value uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  inventory public.inventory_skus%rowtype;
  removed_option_values integer := 0;
  removed_mapping_components integer := 0;
  removed_mappings integer := 0;
  removed_recipe_components integer := 0;
  affected_mapping_ids uuid[];
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

  if exists (
    select 1
    from public.inventory_purchase_lines purchase_line
    where purchase_line.inventory_sku_id = inventory.id
  ) then
    raise exception 'Cannot delete % because it has purchase history.', inventory.sku;
  end if;

  if exists (
    select 1
    from public.etsy_sale_lines sale_line
    where upper(trim(sale_line.etsy_sku)) = upper(trim(inventory.sku))
       or upper(trim(coalesce(sale_line.matched_inventory_sku, ''))) = upper(trim(inventory.sku))
  ) or exists (
    select 1
    from public.etsy_import_sales sale_line
    where upper(trim(coalesce(sale_line.etsy_sku, ''))) = upper(trim(inventory.sku))
       or upper(trim(coalesce(sale_line.matched_inventory_sku, ''))) = upper(trim(inventory.sku))
  ) or exists (
    select 1
    from public.order_items order_item
    where upper(trim(coalesce(order_item.sku, ''))) = upper(trim(inventory.sku))
       or upper(trim(coalesce(order_item.inventory_sku, ''))) = upper(trim(inventory.sku))
  ) then
    raise exception 'Cannot delete % because it has sales history.', inventory.sku;
  end if;

  update public.inventory_adjustments
  set inventory_sku_id = null,
      inventory_sku = coalesce(inventory_sku, inventory.sku)
  where inventory_sku_id = inventory.id;

  delete from public.inventory_bundle_components
  where bundle_sku_id = inventory.id
     or component_sku_id = inventory.id;
  get diagnostics removed_recipe_components = row_count;

  delete from public.product_option_values
  where inventory_sku_id = inventory.id;
  get diagnostics removed_option_values = row_count;

  select coalesce(array_agg(mapping.id), '{}'::uuid[])
  into affected_mapping_ids
  from public.product_etsy_mappings mapping
  where mapping.inventory_sku_id = inventory.id
     or exists (
       select 1
       from public.product_etsy_mapping_components component
       where component.mapping_id = mapping.id
         and component.inventory_sku_id = inventory.id
     );

  delete from public.product_etsy_mapping_components
  where mapping_id = any(affected_mapping_ids);
  get diagnostics removed_mapping_components = row_count;

  delete from public.product_etsy_mappings mapping
  where mapping.id = any(affected_mapping_ids);
  get diagnostics removed_mappings = row_count;

  delete from public.inventory_skus
  where id = inventory.id;

  return jsonb_build_object(
    'deleted', true,
    'sku', inventory.sku,
    'removed_product_options', removed_option_values,
    'removed_etsy_mapping_components', removed_mapping_components,
    'removed_etsy_mappings', removed_mappings,
    'removed_recipe_components', removed_recipe_components
  );
end;
$$;

revoke all on function public.delete_unused_inventory_sku(uuid) from public, anon, authenticated;
grant execute on function public.delete_unused_inventory_sku(uuid) to authenticated;
