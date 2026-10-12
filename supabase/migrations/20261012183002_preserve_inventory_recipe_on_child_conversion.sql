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
drop function if exists public.convert_inventory_sku_to_child(uuid);

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
    if coalesce(bundle.source_metadata->>'disposition', '') <> 'inventory' then
      update public.inventory_skus
      set item_type = 'Non-inventory',
          hierarchy = 'Parent',
          source_metadata = coalesce(source_metadata, '{}'::jsonb)
            || jsonb_build_object('disposition', 'recipe_parent', 'disposition_updated_at', timezone('utc', now())),
          updated_at = timezone('utc', now())
      where id = bundle_id;
    end if;
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

create or replace function public.expand_inventory_sku(requested_sku text, requested_units integer default 1)
returns table(component_sku text, quantity integer)
language sql
stable
set search_path = public
as $$
  with recursive roots as (
    select trim(inventory.sku) as sku,
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
      and lower(coalesce(bundle.item_type, 'inventory')) = 'non-inventory'
  ), leaves as (
    select expansion.sku, expansion.required_quantity
    from expansion
    where not exists (
      select 1
      from public.inventory_skus bundle
      join public.inventory_bundle_components recipe on recipe.bundle_sku_id = bundle.id
      where lower(trim(bundle.sku)) = lower(trim(expansion.sku))
        and lower(coalesce(bundle.item_type, 'inventory')) = 'non-inventory'
    )
  )
  select leaves.sku, sum(leaves.required_quantity)::integer
  from leaves
  group by leaves.sku
  order by leaves.sku;
$$;

grant execute on function public.expand_inventory_sku(text, integer) to anon, authenticated;

create or replace function public.convert_inventory_bundle(
  bundle_sku_value text,
  bundle_quantity integer,
  conversion_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  bundle_id uuid;
  bundle_previous_quantity integer;
  bundle_previous_cost numeric;
  bundle_next_quantity integer;
  bundle_unit_cost numeric := 0;
  requirement record;
  component record;
  component_product_id uuid;
  bundle_product_id uuid;
  recipe_exists boolean;
begin
  if not private.is_admin() then
    raise exception 'Admin access required.';
  end if;
  if nullif(trim(bundle_sku_value), '') is null or bundle_quantity is null or bundle_quantity <= 0 then
    raise exception 'Enter a bundle SKU and positive quantity.';
  end if;
  if nullif(trim(conversion_note), '') is null then
    raise exception 'Enter a note describing this bundle conversion.';
  end if;

  select i.id, i.quantity_on_hand, i.cost
    into bundle_id, bundle_previous_quantity, bundle_previous_cost
    from public.inventory_skus i
   where lower(trim(i.sku)) = lower(trim(bundle_sku_value))
   for update;
  if not found then
    raise exception 'Bundle SKU not found in canonical inventory: %', bundle_sku_value;
  end if;
  if lower(coalesce((select item_type from public.inventory_skus where id = bundle_id), 'inventory')) = 'non-inventory' then
    raise exception 'Auto-calculated sellable packs do not need to be built. Their availability follows child inventory automatically.';
  end if;
  select exists (
    select 1 from public.inventory_bundle_components recipe where recipe.bundle_sku_id = bundle_id
  ) into recipe_exists;
  if not recipe_exists then
    raise exception 'Bundle SKU % has no saved bundle recipe.', bundle_sku_value;
  end if;

  for requirement in
    select expanded.component_sku, sum(expanded.quantity * bundle_quantity)::integer as quantity
    from public.inventory_bundle_components recipe
    join public.inventory_skus recipe_component on recipe_component.id = recipe.component_sku_id
    cross join lateral public.expand_inventory_sku(recipe_component.sku, recipe.quantity) expanded
    where recipe.bundle_sku_id = bundle_id
    group by expanded.component_sku
  loop
    select i.id, i.quantity_on_hand, i.reserve_quantity, i.cost,
           lower(coalesce(i.item_type, 'inventory')) <> 'non-inventory' as is_inventory
      into component
      from public.inventory_skus i
     where lower(trim(i.sku)) = lower(trim(requirement.component_sku))
     for update;
    if component.id is null then
      raise exception 'Bundle component SKU % is not linked to canonical inventory.', requirement.component_sku;
    end if;
    if component.is_inventory and component.quantity_on_hand - coalesce(component.reserve_quantity, 0) < requirement.quantity then
      raise exception 'Not enough available inventory for bundle component %.', requirement.component_sku;
    end if;
    if component.is_inventory then
      update public.inventory_skus
      set quantity_on_hand = quantity_on_hand - requirement.quantity,
          updated_at = timezone('utc', now())
      where id = component.id;
      select option_record.product_id into component_product_id
      from public.product_option_values value_record
      join public.product_options option_record on option_record.id = value_record.option_id
      where value_record.inventory_sku_id = component.id limit 1;
      insert into public.inventory_adjustments (
        product_id, inventory_sku_id, inventory_sku, quantity_delta, quantity_after,
        note, created_by, adjustment_type, cost_impact
      ) values (
        component_product_id, component.id, requirement.component_sku, -requirement.quantity,
        component.quantity_on_hand - requirement.quantity, conversion_note, auth.uid(), 'bundle_conversion', 0
      );
      bundle_unit_cost := bundle_unit_cost + coalesce(component.cost, 0) * (requirement.quantity / bundle_quantity);
    end if;
  end loop;

  bundle_next_quantity := bundle_previous_quantity + bundle_quantity;
  update public.inventory_skus
  set quantity_on_hand = bundle_next_quantity,
      cost = case when bundle_next_quantity > 0 then ((greatest(bundle_previous_quantity, 0) * coalesce(bundle_previous_cost, 0)) + (bundle_unit_cost * bundle_quantity)) / bundle_next_quantity else bundle_unit_cost end,
      updated_at = timezone('utc', now())
  where id = bundle_id;
  select option_record.product_id into bundle_product_id
  from public.product_option_values value_record
  join public.product_options option_record on option_record.id = value_record.option_id
  where value_record.inventory_sku_id = bundle_id limit 1;
  insert into public.inventory_adjustments (
    product_id, inventory_sku_id, inventory_sku, quantity_delta, quantity_after,
    note, created_by, adjustment_type, cost_impact
  ) values (
    bundle_product_id, bundle_id, trim(bundle_sku_value), bundle_quantity, bundle_next_quantity,
    conversion_note, auth.uid(), 'bundle_conversion', 0
  );

  return jsonb_build_object('bundle_sku', trim(bundle_sku_value), 'quantity', bundle_quantity, 'quantity_after', bundle_next_quantity);
end;
$$;

revoke all on function public.convert_inventory_bundle(text, integer, text) from public, anon, authenticated;
grant execute on function public.convert_inventory_bundle(text, integer, text) to authenticated;
