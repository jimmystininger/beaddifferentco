create or replace function public.adjust_inventory_skus(adjustment_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  adjustment_row jsonb;
  sku_value text;
  delta_value integer;
  note_value text;
  inventory_id uuid;
  product_id_value uuid;
  previous_quantity integer;
  next_quantity integer;
  previous_cost numeric;
  adjustment_count integer := 0;
begin
  if not private.is_admin() then
    raise exception 'Admin access required.';
  end if;
  if jsonb_typeof(adjustment_rows) <> 'array' or jsonb_array_length(adjustment_rows) = 0 then
    raise exception 'Add at least one inventory adjustment.';
  end if;

  for adjustment_row in select value from jsonb_array_elements(adjustment_rows) as entries(value)
  loop
    sku_value := nullif(trim(adjustment_row->>'sku'), '');
    delta_value := nullif(trim(adjustment_row->>'quantity_delta'), '')::integer;
    note_value := nullif(trim(adjustment_row->>'note'), '');
    if sku_value is null or delta_value is null or delta_value = 0 or note_value is null then
      raise exception 'Every adjustment needs a SKU, non-zero quantity change, and note.';
    end if;

    select i.id, i.quantity_on_hand, i.cost
      into inventory_id, previous_quantity, previous_cost
      from public.inventory_skus i
     where lower(trim(i.sku)) = lower(sku_value)
     for update;
    if not found then
      raise exception 'Adjustment SKU not found in canonical inventory: %', sku_value;
    end if;
    next_quantity := previous_quantity + delta_value;
    if next_quantity < 0 then
      raise exception 'Adjustment cannot reduce % below zero.', sku_value;
    end if;

    update public.inventory_skus
    set quantity_on_hand = next_quantity,
        updated_at = timezone('utc', now())
    where id = inventory_id;

    select option_record.product_id
      into product_id_value
    from public.product_option_values value_record
    join public.product_options option_record on option_record.id = value_record.option_id
    where value_record.inventory_sku_id = inventory_id
    limit 1;
    if product_id_value is null then
      select p.id into product_id_value from public.products p where p.sku = sku_value limit 1;
    end if;
    insert into public.inventory_adjustments (
      product_id, inventory_sku_id, inventory_sku, quantity_delta, quantity_after,
      note, created_by, adjustment_type, cost_impact
    ) values (
      product_id_value, inventory_id, sku_value, delta_value, next_quantity,
      note_value, auth.uid(), 'manual',
      case when delta_value < 0 then abs(delta_value) * coalesce(previous_cost, 0) else 0 end
    );
    adjustment_count := adjustment_count + 1;
  end loop;
  return jsonb_build_object('adjustments', adjustment_count);
end;
$$;

revoke all on function public.adjust_inventory_skus(jsonb) from public, anon, authenticated;
grant execute on function public.adjust_inventory_skus(jsonb) to authenticated;

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
    select i.id, i.quantity_on_hand, i.reserve_quantity, i.cost, lower(coalesce(i.item_type, 'inventory')) <> 'non-inventory' as is_inventory
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
