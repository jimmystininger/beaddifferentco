create or replace function public.inventory_sku_bundle_metrics(requested_sku text)
returns table(
  quantity_available integer,
  unit_cost numeric,
  unit_weight numeric,
  unit_weight_unit text
)
language sql
stable
security definer
set search_path = public
as $$
  with requested as (
    select sku
    from public.inventory_skus
    where lower(trim(sku)) = lower(trim(requested_sku))
    limit 1
  ),
  expanded as (
    select expansion.component_sku, expansion.quantity
    from requested
    cross join lateral public.expand_inventory_sku(requested.sku, 1) expansion
  ),
  components as (
    select expanded.quantity, inventory.quantity_on_hand, inventory.reserve_quantity,
           inventory.cost, inventory.weight_value, inventory.weight_unit
    from expanded
    join public.inventory_skus inventory
      on lower(trim(inventory.sku)) = lower(trim(expanded.component_sku))
  )
  select
    case when count(*) = 0 then 0
      else min(floor(greatest(0, components.quantity_on_hand - coalesce(components.reserve_quantity, 0))::numeric / nullif(components.quantity, 0)))::integer
    end,
    case when count(*) = count(components.cost) then sum(components.cost * components.quantity) end,
    case when count(*) = count(components.weight_value) then sum(
      case lower(coalesce(components.weight_unit, 'oz'))
        when 'lb' then components.weight_value * 16
        when 'g' then components.weight_value / 28.349523125
        when 'kg' then components.weight_value * 35.27396195
        else components.weight_value
      end * components.quantity
    ) end,
    'oz'
  from components;
$$;

revoke all on function public.inventory_sku_bundle_metrics(text) from public, anon, authenticated;
grant execute on function public.inventory_sku_bundle_metrics(text) to anon, authenticated;

create or replace function public.refresh_inventory_sellable_pack(bundle_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  bundle_sku_value text;
  bundle_item_type text;
  metrics record;
begin
  select sku, lower(coalesce(item_type, 'inventory'))
    into bundle_sku_value, bundle_item_type
  from public.inventory_skus
  where id = bundle_id;
  if bundle_sku_value is null or bundle_item_type <> 'non-inventory' then
    return;
  end if;
  if not exists (
    select 1 from public.inventory_bundle_components
    where bundle_sku_id = bundle_id
  ) then
    return;
  end if;

  select * into metrics
  from public.inventory_sku_bundle_metrics(bundle_sku_value);

  update public.inventory_skus
  set quantity_on_hand = coalesce(metrics.quantity_available, 0),
      cost = metrics.unit_cost,
      weight_value = metrics.unit_weight,
      weight_unit = metrics.unit_weight_unit,
      updated_at = timezone('utc', now())
  where id = bundle_id
    and (
      quantity_on_hand is distinct from coalesce(metrics.quantity_available, 0)
      or cost is distinct from metrics.unit_cost
      or weight_value is distinct from metrics.unit_weight
      or weight_unit is distinct from metrics.unit_weight_unit
    );
end;
$$;

revoke all on function public.refresh_inventory_sellable_pack(uuid) from public, anon, authenticated;

create or replace function public.refresh_inventory_sellable_pack_parents()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_id uuid;
begin
  for parent_id in
    select distinct bundle_sku_id
    from public.inventory_bundle_components
    where component_sku_id = new.id
  loop
    perform public.refresh_inventory_sellable_pack(parent_id);
  end loop;
  return new;
end;
$$;

revoke all on function public.refresh_inventory_sellable_pack_parents() from public, anon, authenticated;

drop trigger if exists refresh_inventory_sellable_pack_parents_after_inventory_update on public.inventory_skus;
create trigger refresh_inventory_sellable_pack_parents_after_inventory_update
after update of sku, item_type, quantity_on_hand, reserve_quantity, cost, weight_value, weight_unit
on public.inventory_skus
for each row
execute function public.refresh_inventory_sellable_pack_parents();

create or replace function public.refresh_inventory_sellable_pack_after_recipe_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or tg_op = 'UPDATE' then
    perform public.refresh_inventory_sellable_pack(new.bundle_sku_id);
  end if;
  if tg_op = 'DELETE' then
    perform public.refresh_inventory_sellable_pack(old.bundle_sku_id);
  elsif tg_op = 'UPDATE' and old.bundle_sku_id is distinct from new.bundle_sku_id then
    perform public.refresh_inventory_sellable_pack(old.bundle_sku_id);
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function public.refresh_inventory_sellable_pack_after_recipe_change() from public, anon, authenticated;

drop trigger if exists refresh_inventory_sellable_pack_after_recipe_change on public.inventory_bundle_components;
create trigger refresh_inventory_sellable_pack_after_recipe_change
after insert or update or delete
on public.inventory_bundle_components
for each row
execute function public.refresh_inventory_sellable_pack_after_recipe_change();

do $$
declare
  bundle record;
begin
  for bundle in
    select distinct inventory.id
    from public.inventory_skus inventory
    join public.inventory_bundle_components recipe on recipe.bundle_sku_id = inventory.id
    where lower(coalesce(inventory.item_type, 'inventory')) = 'non-inventory'
  loop
    perform public.refresh_inventory_sellable_pack(bundle.id);
  end loop;
end;
$$;

create or replace function public.enforce_inventory_bundle_component_types()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  bundle_item_type text;
  component_item_type text;
begin
  select lower(coalesce(item_type, 'inventory'))
    into bundle_item_type
    from public.inventory_skus
   where id = new.bundle_sku_id;
  if bundle_item_type not in ('inventory', 'non-inventory') then
    raise exception 'Bundle recipe rejected: parent SKU must be an inventory or auto-calculated pack SKU.';
  end if;

  select lower(coalesce(item_type, 'inventory'))
    into component_item_type
    from public.inventory_skus
   where id = new.component_sku_id;
  if component_item_type = 'non-inventory' then
    raise exception 'Bundle recipe rejected: child SKU must be a physical inventory SKU.';
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_bundle_components_inventory_only on public.inventory_bundle_components;
create trigger inventory_bundle_components_inventory_only
before insert or update of bundle_sku_id, component_sku_id
on public.inventory_bundle_components
for each row
execute function public.enforce_inventory_bundle_component_types();

drop view if exists public.storefront_inventory_skus;
create view public.storefront_inventory_skus
as
select
  inventory.id,
  inventory.sku,
  inventory.name,
  inventory.variant_name,
  case
    when lower(coalesce(inventory.item_type, 'inventory')) = 'non-inventory'
      and exists (select 1 from public.inventory_bundle_components recipe where recipe.bundle_sku_id = inventory.id)
      then greatest(0, coalesce(inventory.quantity_on_hand, 0) - coalesce(inventory.reserve_quantity, 0))
    else greatest(0, coalesce(inventory.quantity_on_hand, 0) - coalesce(inventory.reserve_quantity, 0))
  end as quantity_available,
  inventory.price,
  inventory.unit_type,
  inventory.weight_value,
  inventory.weight_unit
from public.inventory_skus inventory;

revoke all on public.storefront_inventory_skus from public, anon, authenticated;
grant select on public.storefront_inventory_skus to anon, authenticated;

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
    from public.expand_inventory_sku(trim(bundle_sku_value), 1) expanded
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
