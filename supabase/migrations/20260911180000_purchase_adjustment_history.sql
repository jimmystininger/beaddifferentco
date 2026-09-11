create or replace function public.import_inventory_purchase(purchase_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  purchase_id uuid;
  purchase_date_value timestamptz;
  vendor_value text;
  reference_value text;
  notes_value text;
  purchase_line jsonb;
  sku_value text;
  inventory_id uuid;
  product_id_value uuid;
  quantity_value integer;
  total_cost_value numeric;
  unit_cost_value numeric;
  previous_quantity integer;
  previous_cost numeric;
  next_quantity integer;
  weighted_cost numeric;
  line_count integer := 0;
  inventory_updated_count integer := 0;
  purchase_total numeric := 0;
  is_inventory boolean;
begin
  if not private.is_admin() then
    raise exception 'Admin access required.';
  end if;
  if jsonb_typeof(purchase_payload->'lines') <> 'array' or jsonb_array_length(purchase_payload->'lines') = 0 then
    raise exception 'A purchase needs at least one line.';
  end if;

  purchase_date_value := coalesce(nullif(trim(purchase_payload->>'purchase_date'), '')::timestamptz, timezone('utc', now()));
  vendor_value := nullif(trim(purchase_payload->>'vendor'), '');
  if vendor_value is null then
    raise exception 'A vendor is required for every purchase.';
  end if;
  reference_value := nullif(trim(purchase_payload->>'reference_number'), '');
  notes_value := nullif(trim(purchase_payload->>'notes'), '');

  insert into public.inventory_purchases (purchase_date, vendor, reference_number, notes, total_cost, created_by)
  values (purchase_date_value, vendor_value, reference_value, notes_value, 0, auth.uid())
  returning id into purchase_id;

  for purchase_line in select value from jsonb_array_elements(purchase_payload->'lines') as entries(value)
  loop
    sku_value := nullif(trim(purchase_line->>'sku'), '');
    quantity_value := nullif(trim(purchase_line->>'quantity'), '')::integer;
    total_cost_value := nullif(trim(purchase_line->>'total_cost'), '')::numeric;
    if sku_value is null or quantity_value is null or quantity_value <= 0 or total_cost_value is null or total_cost_value < 0 then
      raise exception 'Every purchase line needs a SKU, positive quantity, and non-negative total cost.';
    end if;

    select i.id, i.quantity_on_hand, i.cost, lower(coalesce(i.item_type, 'inventory')) <> 'non-inventory'
      into inventory_id, previous_quantity, previous_cost, is_inventory
    from public.inventory_skus i
    where lower(trim(i.sku)) = lower(sku_value)
    for update;
    if inventory_id is null then
      raise exception 'Purchase SKU not found in canonical inventory: %', sku_value;
    end if;

    unit_cost_value := case when quantity_value = 0 then 0 else total_cost_value / quantity_value end;
    purchase_total := purchase_total + total_cost_value;
    if is_inventory then
      next_quantity := previous_quantity + quantity_value;
      weighted_cost := case
        when next_quantity <= 0 then coalesce(unit_cost_value, 0)
        else ((greatest(previous_quantity, 0) * coalesce(previous_cost, 0)) + total_cost_value) / next_quantity
      end;
      update public.inventory_skus
      set quantity_on_hand = next_quantity,
          cost = weighted_cost,
          updated_at = timezone('utc', now())
      where id = inventory_id;
      inventory_updated_count := inventory_updated_count + 1;
    end if;

    insert into public.inventory_purchase_lines (
      purchase_id, inventory_sku_id, sku, quantity, total_cost, unit_cost, inventory_updated
    ) values (
      purchase_id, inventory_id, sku_value, quantity_value, total_cost_value, unit_cost_value, is_inventory
    );

    select option_record.product_id
      into product_id_value
    from public.product_option_values value_record
    join public.product_options option_record on option_record.id = value_record.option_id
    where value_record.inventory_sku_id = inventory_id
    limit 1;
    if product_id_value is null then
      select p.id into product_id_value from public.products p where p.sku = sku_value limit 1;
    end if;
    if product_id_value is not null and is_inventory then
      insert into public.inventory_adjustments (
        product_id, inventory_sku_id, inventory_sku, quantity_delta, quantity_after,
        note, created_by, adjustment_type, cost_impact
      ) values (
        product_id_value, inventory_id, sku_value, quantity_value, next_quantity,
        'Purchase received: ' || vendor_value || coalesce(' · ' || reference_value, ''), auth.uid(),
        'purchase', total_cost_value
      );
    end if;
    line_count := line_count + 1;
  end loop;

  update public.inventory_purchases set total_cost = purchase_total where id = purchase_id;
  return jsonb_build_object(
    'id', purchase_id,
    'lines', line_count,
    'inventory_updated', inventory_updated_count,
    'total_cost', purchase_total
  );
end;
$$;

revoke all on function public.import_inventory_purchase(jsonb) from public, anon, authenticated;
grant execute on function public.import_inventory_purchase(jsonb) to authenticated;
