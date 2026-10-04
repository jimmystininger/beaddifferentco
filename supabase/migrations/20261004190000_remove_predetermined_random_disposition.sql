begin;

select set_config('bead.inventory_audit_mode', 'true', true);

update public.inventory_skus inventory
set source_metadata = (coalesce(inventory.source_metadata, '{}'::jsonb) - 'predetermined_inventory_sku')
  || jsonb_build_object(
    'disposition', case
      when exists (
        select 1
        from public.inventory_bundle_components recipe
        where recipe.bundle_sku_id = inventory.id
      ) then 'recipe_parent'
      else 'unresolved'
    end,
    'disposition_updated_at', timezone('utc', now())
  ),
  item_type = case
    when exists (
      select 1
      from public.inventory_bundle_components recipe
      where recipe.bundle_sku_id = inventory.id
    ) then 'Non-inventory'
    else 'Inventory'
  end,
  hierarchy = case
    when exists (
      select 1
      from public.inventory_bundle_components recipe
      where recipe.bundle_sku_id = inventory.id
    ) then 'Parent'
    else null
  end,
  updated_at = timezone('utc', now())
where inventory.source_metadata->>'disposition' = 'predetermined_random';

update public.inventory_skus
set source_metadata = source_metadata - 'predetermined_inventory_sku',
    updated_at = timezone('utc', now())
where source_metadata ? 'predetermined_inventory_sku';

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
begin
  if not private.is_admin() then
    raise exception 'Admin access required.';
  end if;
  if normalized_disposition not in ('inventory', 'recipe_parent', 'unresolved') then
    raise exception 'Disposition must be Inventory, Recipe parent, or Unresolved.';
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
    raise exception 'Recipe parent disposition requires a saved recipe first.';
  end if;
  if normalized_disposition = 'inventory' and exists (
    select 1
    from public.inventory_bundle_components recipe
    where recipe.bundle_sku_id = inventory.id
  ) then
    raise exception 'This SKU has a recipe. Choose Recipe parent or delete the recipe first.';
  end if;

  update public.inventory_skus
  set source_metadata = (coalesce(inventory.source_metadata, '{}'::jsonb) - 'predetermined_inventory_sku')
    || jsonb_build_object(
      'disposition', normalized_disposition,
      'disposition_updated_at', timezone('utc', now())
    ),
    item_type = case
      when normalized_disposition = 'recipe_parent' then 'Non-inventory'
      when normalized_disposition = 'inventory' then 'Inventory'
      else inventory.item_type
    end,
    hierarchy = case
      when normalized_disposition = 'recipe_parent' then 'Parent'
      when normalized_disposition = 'inventory' then null
      else inventory.hierarchy
    end,
    updated_at = timezone('utc', now())
  where id = inventory.id;

  return jsonb_build_object(
    'sku', inventory.sku,
    'disposition', normalized_disposition
  );
end;
$$;

revoke all on function public.apply_inventory_sku_disposition(uuid, text) from public, anon, authenticated;
grant execute on function public.apply_inventory_sku_disposition(uuid, text) to authenticated;

create or replace function public.apply_inventory_audit_complete(audit_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public, private
as $$
declare
  audit_row jsonb;
  updated_count integer;
  inventory_id uuid;
  disposition_value text;
begin
  if not private.is_admin() then
    raise exception 'Admin access required.';
  end if;
  perform set_config('bead.inventory_audit_mode', 'true', true);
  updated_count := public.apply_inventory_audit(audit_rows);
  for audit_row in select value from jsonb_array_elements(audit_rows) as entries(value)
  loop
    select id into inventory_id
    from public.inventory_skus
    where lower(trim(sku)) = lower(trim(audit_row->>'sku'))
    limit 1;
    disposition_value := nullif(trim(audit_row->>'disposition'), '');
    if inventory_id is null or disposition_value is null then
      raise exception 'Every audit row needs a valid disposition.';
    end if;
    perform public.apply_inventory_sku_disposition(inventory_id, disposition_value);
  end loop;
  return updated_count;
end;
$$;

revoke all on function public.apply_inventory_audit_complete(jsonb) from public, anon;
grant execute on function public.apply_inventory_audit_complete(jsonb) to authenticated;
drop function if exists public.apply_inventory_sku_disposition(uuid, text, text);

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
          || jsonb_build_object('disposition', 'unresolved', 'disposition_updated_at', timezone('utc', now())),
        updated_at = timezone('utc', now())
    where id = bundle_id;
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function public.sync_recipe_parent_disposition() from public, anon, authenticated;

create or replace function public.expand_inventory_sku(requested_sku text, requested_units integer default 1)
returns table(component_sku text, quantity integer)
language sql
stable
set search_path = public
as $$
  with recursive roots as (
    select trim(requested_sku) as sku,
           greatest(1, requested_units) as required_quantity
    from public.inventory_skus inventory
    where lower(trim(inventory.sku)) = lower(trim(coalesce(requested_sku, '')))
      and not public.is_manual_inventory_allocation_sku(requested_sku)
    union all
    select trim(requested_sku), greatest(1, requested_units)
    where not exists (
      select 1 from public.inventory_skus inventory
      where lower(trim(inventory.sku)) = lower(trim(coalesce(requested_sku, '')))
    )
      and not public.is_manual_inventory_allocation_sku(requested_sku)
  ), expansion(sku, required_quantity, path) as (
    select roots.sku, roots.required_quantity, array[roots.sku]::text[] from roots
    union all
    select component.sku,
           expansion.required_quantity * recipe.quantity,
           expansion.path || component.sku
    from expansion
    join public.inventory_skus bundle on lower(trim(bundle.sku)) = lower(trim(expansion.sku))
    join public.inventory_bundle_components recipe on recipe.bundle_sku_id = bundle.id
    join public.inventory_skus component on component.id = recipe.component_sku_id
    where not component.sku = any(expansion.path)
  ), leaves as (
    select expansion.sku, expansion.required_quantity
    from expansion
    where not exists (
      select 1
      from public.inventory_skus bundle
      join public.inventory_bundle_components recipe on recipe.bundle_sku_id = bundle.id
      where lower(trim(bundle.sku)) = lower(trim(expansion.sku))
    )
  )
  select leaves.sku, sum(leaves.required_quantity)::integer
  from leaves
  group by leaves.sku
  order by leaves.sku;
$$;

grant execute on function public.expand_inventory_sku(text, integer) to anon, authenticated;

drop view if exists public.storefront_inventory_skus;
create view public.storefront_inventory_skus as
select
  inventory.id,
  inventory.sku,
  inventory.name,
  inventory.variant_name,
  case
    when lower(coalesce(inventory.item_type, 'inventory')) = 'non-inventory'
      and exists (select 1 from public.inventory_bundle_components recipe where recipe.bundle_sku_id = inventory.id)
      then coalesce((select metrics.quantity_available from public.inventory_sku_bundle_metrics(inventory.sku) metrics), 0)
    else greatest(0, coalesce(inventory.quantity_on_hand, 0) - coalesce(inventory.reserve_quantity, 0))
  end as quantity_available,
  inventory.price,
  inventory.unit_type,
  inventory.weight_value,
  inventory.weight_unit
from public.inventory_skus inventory;

revoke all on public.storefront_inventory_skus from anon, authenticated;
grant select on public.storefront_inventory_skus to anon, authenticated;

commit;
