create or replace function public.apply_inventory_sku_disposition(
  inventory_sku_id_value uuid,
  disposition_value text,
  predetermined_sku_value text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  inventory record;
  target record;
  normalized_disposition text := lower(trim(coalesce(disposition_value, '')));
  target_sku text := nullif(trim(coalesce(predetermined_sku_value, '')), '');
  next_metadata jsonb;
  option_count integer := 0;
  mapping_count integer := 0;
begin
  if not private.is_admin() then
    raise exception 'Admin access required.';
  end if;
  if normalized_disposition not in ('inventory', 'recipe_parent', 'predetermined_random', 'unresolved') then
    raise exception 'Disposition must be Inventory, Recipe parent, Predetermined random, or Unresolved.';
  end if;

  select * into inventory
  from public.inventory_skus
  where id = inventory_sku_id_value
  for update;
  if inventory.id is null then
    raise exception 'Inventory SKU not found.';
  end if;

  if normalized_disposition = 'recipe_parent' and not exists (
    select 1 from public.inventory_bundle_components recipe where recipe.bundle_sku_id = inventory.id
  ) then
    raise exception 'Recipe parent disposition requires a saved recipe first.';
  end if;
  if normalized_disposition = 'inventory' and exists (
    select 1 from public.inventory_bundle_components recipe where recipe.bundle_sku_id = inventory.id
  ) then
    raise exception 'This SKU has a recipe. Choose Recipe parent or delete the recipe first.';
  end if;
  if normalized_disposition = 'predetermined_random' then
    if target_sku is null then
      raise exception 'Predetermined random disposition requires a canonical target SKU.';
    end if;
    select id, sku, item_type into target
    from public.inventory_skus
    where lower(trim(sku)) = lower(target_sku)
    limit 1;
    if target.id is null then
      raise exception 'The predetermined target SKU is not in canonical inventory.';
    end if;
    if lower(coalesce(target.item_type, 'inventory')) = 'non-inventory' then
      raise exception 'A predetermined target must be physical inventory.';
    end if;
    if target.id = inventory.id then
      raise exception 'A SKU cannot be predetermined to itself.';
    end if;
  end if;

  next_metadata := coalesce(inventory.source_metadata, '{}'::jsonb)
    || jsonb_build_object('disposition', normalized_disposition, 'disposition_updated_at', timezone('utc', now()));
  if normalized_disposition = 'predetermined_random' then
    next_metadata := next_metadata || jsonb_build_object('predetermined_inventory_sku', target.sku);
  else
    next_metadata := next_metadata - 'predetermined_inventory_sku';
  end if;

  update public.inventory_skus
  set source_metadata = next_metadata,
      item_type = case
        when normalized_disposition = 'recipe_parent' then 'Non-inventory'
        when normalized_disposition = 'predetermined_random' then 'Non-inventory'
        when normalized_disposition = 'inventory' then 'Inventory'
        else item_type
      end,
      hierarchy = case
        when normalized_disposition in ('recipe_parent', 'predetermined_random') then 'Parent'
        when normalized_disposition = 'inventory' then null
        else hierarchy
      end,
      updated_at = timezone('utc', now())
  where id = inventory.id;

  if normalized_disposition = 'predetermined_random' then
    update public.product_option_values
    set inventory_sku_id = target.id,
        inventory_sku = target.sku
    where inventory_sku_id = inventory.id;
    get diagnostics option_count = row_count;

    update public.product_etsy_mappings
    set inventory_sku_id = target.id,
        inventory_sku = target.sku,
        inventory_units = 1,
        updated_at = timezone('utc', now())
    where inventory_sku_id = inventory.id;
    get diagnostics mapping_count = row_count;

    update public.product_etsy_mapping_components
    set inventory_sku_id = target.id,
        inventory_sku = target.sku,
        updated_at = timezone('utc', now())
    where inventory_sku_id = inventory.id;
  end if;

  return jsonb_build_object(
    'sku', inventory.sku,
    'disposition', normalized_disposition,
    'predetermined_inventory_sku', case when normalized_disposition = 'predetermined_random' then target.sku else null end,
    'product_options_updated', option_count,
    'etsy_mappings_updated', mapping_count
  );
end;
$$;

revoke all on function public.apply_inventory_sku_disposition(uuid, text, text) from public, anon, authenticated;

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
  predetermined_sku text;
begin
  if not private.is_admin() then
    raise exception 'Admin access required.';
  end if;
  updated_count := public.apply_inventory_audit(audit_rows);
  for audit_row in select value from jsonb_array_elements(audit_rows) as entries(value)
  loop
    select id into inventory_id
    from public.inventory_skus
    where lower(trim(sku)) = lower(trim(audit_row->>'sku'))
    limit 1;
    disposition_value := nullif(trim(audit_row->>'disposition'), '');
    predetermined_sku := nullif(trim(audit_row->>'predetermined_inventory_sku'), '');
    if inventory_id is null or disposition_value is null then
      raise exception 'Every audit row needs a valid disposition.';
    end if;
    perform public.apply_inventory_sku_disposition(inventory_id, disposition_value, predetermined_sku);
  end loop;
  return updated_count;
end;
$$;

revoke all on function public.apply_inventory_audit_complete(jsonb) from public, anon;
grant execute on function public.apply_inventory_audit_complete(jsonb) to authenticated;

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
      and (
        coalesce(inventory.source_metadata->>'disposition', 'unresolved') = 'unresolved'
        or inventory.source_metadata->>'allocation_mode' = 'manual'
        or (
          coalesce(inventory.source_metadata->>'disposition', '') = ''
          and (
            lower(coalesce(inventory.sku, '')) ~ '(mix|random|assort)'
            or lower(coalesce(inventory.name, '')) ~ '(mix|random|assort)'
          )
        )
      )
  );
$$;

revoke all on function public.is_manual_inventory_allocation_sku(text) from public, anon, authenticated;

create or replace function public.expand_inventory_sku(requested_sku text, requested_units integer default 1)
returns table(component_sku text, quantity integer)
language sql
stable
set search_path = public
as $$
  with recursive roots as (
    select coalesce(
      nullif(inventory.source_metadata->>'predetermined_inventory_sku', ''),
      trim(requested_sku)
    ) as sku,
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
      and nullif(inventory.source_metadata->>'predetermined_inventory_sku', '') is not null
      then coalesce((
        select greatest(0, target.quantity_on_hand - coalesce(target.reserve_quantity, 0))
        from public.inventory_skus target
        where lower(trim(target.sku)) = lower(trim(inventory.source_metadata->>'predetermined_inventory_sku'))
      ), 0)
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

delete from public.product_etsy_mappings;
