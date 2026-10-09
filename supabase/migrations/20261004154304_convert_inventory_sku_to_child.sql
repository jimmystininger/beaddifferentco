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
  removed_recipe_count integer := 0;
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

  delete from public.inventory_bundle_components
  where bundle_sku_id = inventory.id;
  get diagnostics removed_recipe_count = row_count;

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
    'removed_recipe_components', removed_recipe_count
  );
end;
$$;

revoke all on function public.convert_inventory_sku_to_child(uuid) from public, anon, authenticated;
grant execute on function public.convert_inventory_sku_to_child(uuid) to authenticated;
