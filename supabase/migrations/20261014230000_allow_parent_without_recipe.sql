create or replace function public.apply_inventory_sku_disposition(
  inventory_sku_id_value uuid,
  disposition_value text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  inventory record;
  normalized_disposition text := lower(trim(coalesce(disposition_value, '')));
  updated_at_value timestamptz;
begin
  if not private.is_admin() then
    raise exception 'Admin access required.';
  end if;
  if normalized_disposition is null or normalized_disposition not in ('inventory', 'recipe_parent') then
    raise exception 'SKU type must be Inventory / child or Parent / non-inventory.';
  end if;

  select * into inventory
  from public.inventory_skus
  where id = inventory_sku_id_value
  for update;
  if inventory.id is null then
    raise exception 'Inventory SKU not found.';
  end if;

  if normalized_disposition = 'inventory' and exists (
    select 1
    from public.inventory_bundle_components recipe
    where recipe.bundle_sku_id = inventory.id
  ) then
    raise exception 'This SKU has a saved recipe. Keep it Parent / non-inventory or remove the recipe first.';
  end if;

  update public.inventory_skus
  set source_metadata = (coalesce(inventory.source_metadata, '{}'::jsonb) - 'predetermined_inventory_sku')
      || jsonb_build_object(
        'disposition', normalized_disposition,
        'disposition_updated_at', timezone('utc', now())
      ),
    item_type = case
      when normalized_disposition = 'recipe_parent' then 'Non-inventory'
      else 'Inventory'
    end,
    hierarchy = case
      when normalized_disposition = 'recipe_parent' then 'Parent'
      else null
    end,
    updated_at = timezone('utc', now())
  where id = inventory.id
  returning updated_at into updated_at_value;

  return jsonb_build_object(
    'sku', inventory.sku,
    'disposition', normalized_disposition,
    'updated_at', updated_at_value
  );
end;
$$;

revoke all on function public.apply_inventory_sku_disposition(uuid, text) from public, anon, authenticated;
grant execute on function public.apply_inventory_sku_disposition(uuid, text) to authenticated;
