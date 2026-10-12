create or replace function public.is_manual_inventory_allocation_sku(requested_sku text)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.inventory_skus inventory
    where lower(trim(inventory.sku)) = lower(trim(coalesce(requested_sku, '')))
      and inventory.source_metadata->>'allocation_mode' = 'manual'
  );
$$;

revoke all on function public.is_manual_inventory_allocation_sku(text) from public, anon, authenticated;

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

  if normalized_disposition = 'recipe_parent' and not exists (
    select 1
    from public.inventory_bundle_components recipe
    where recipe.bundle_sku_id = inventory.id
  ) then
    raise exception 'Parent / non-inventory requires a saved recipe first.';
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

create or replace function public.sync_recipe_parent_disposition()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  bundle_id uuid := coalesce(new.bundle_sku_id, old.bundle_sku_id);
  bundle record;
begin
  select * into bundle from public.inventory_skus where id = bundle_id for update;
  if bundle.id is null then
    return coalesce(new, old);
  end if;
  if coalesce(bundle.source_metadata->>'setup_locked', 'false') = 'true'
    and coalesce(current_setting('bead.inventory_audit_mode', true), 'false') <> 'true' then
    raise exception 'Inventory setup is locked. Use the Year-end audit CSV to change this SKU.';
  end if;
  if exists (select 1 from public.inventory_bundle_components where bundle_sku_id = bundle_id) then
    update public.inventory_skus
    set item_type = 'Non-inventory',
        hierarchy = 'Parent',
        source_metadata = coalesce(source_metadata, '{}'::jsonb)
          || jsonb_build_object('disposition', 'recipe_parent', 'disposition_updated_at', timezone('utc', now())),
        updated_at = timezone('utc', now())
    where id = bundle_id;
  elsif tg_op = 'DELETE' then
    update public.inventory_skus
    set item_type = 'Inventory',
        hierarchy = null,
        source_metadata = coalesce(source_metadata, '{}'::jsonb)
          || jsonb_build_object('disposition', 'inventory', 'disposition_updated_at', timezone('utc', now())),
        updated_at = timezone('utc', now())
    where id = bundle_id;
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function public.sync_recipe_parent_disposition() from public, anon, authenticated;
