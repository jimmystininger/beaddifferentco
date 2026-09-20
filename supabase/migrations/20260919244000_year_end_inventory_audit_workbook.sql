create or replace function public.apply_inventory_audit_complete(audit_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public, private
as $$
declare
  audit_row jsonb;
  inventory public.inventory_skus%rowtype;
  expected_count integer;
  actual_count integer;
  updated_count integer := 0;
  sku_value text;
  normalized_sku text;
  seen_skus text[] := array[]::text[];
  product_name_value text;
  sku_type_value text;
  expected_sku_type text;
  price_value numeric;
  unit_value text;
  cost_value numeric;
  weight_value_value numeric;
  weight_unit_value text;
  quantity_value integer;
  reserve_value integer;
  reorder_value integer;
begin
  if not private.is_admin() then
    raise exception 'Admin access required.';
  end if;
  if audit_rows is null or jsonb_typeof(audit_rows) <> 'array' then
    raise exception 'The year-end audit must be a JSON array of canonical SKU rows.';
  end if;

  select count(*) into expected_count from public.inventory_skus;
  actual_count := jsonb_array_length(audit_rows);
  if actual_count <> expected_count then
    raise exception 'The audit must contain every canonical SKU exactly once. Expected %, received %.', expected_count, actual_count;
  end if;

  for audit_row in select value from jsonb_array_elements(audit_rows) as entries(value)
  loop
    if jsonb_typeof(audit_row) <> 'object' then
      raise exception 'Every year-end audit row must be an object.';
    end if;

    sku_value := nullif(trim(audit_row->>'sku'), '');
    if sku_value is null then
      raise exception 'Every year-end audit row needs an immutable SKU.';
    end if;
    normalized_sku := lower(sku_value);
    if normalized_sku = any(seen_skus) then
      raise exception 'The audit contains duplicate SKU %.', sku_value;
    end if;
    seen_skus := array_append(seen_skus, normalized_sku);

    select * into inventory
      from public.inventory_skus
     where lower(trim(sku)) = normalized_sku
     for update;
    if not found then
      raise exception 'SKU % is not in canonical inventory. SKU values are immutable.', sku_value;
    end if;

    expected_sku_type := case
      when lower(coalesce(inventory.item_type, 'inventory')) = 'non-inventory'
        or exists (select 1 from public.inventory_bundle_components recipe where recipe.bundle_sku_id = inventory.id)
        then 'parent'
      else 'child'
    end;
    sku_type_value := lower(nullif(trim(audit_row->>'sku_type'), ''));
    if sku_type_value is not null and sku_type_value <> expected_sku_type then
      raise exception 'SKU % is on the wrong audit tab.', sku_value;
    end if;

    product_name_value := nullif(trim(audit_row->>'product_name'), '');
    if product_name_value is null then
      raise exception 'SKU % requires a product name.', sku_value;
    end if;
    if nullif(trim(audit_row->>'price'), '') is null then
      raise exception 'SKU % requires a price.', sku_value;
    end if;
    price_value := (audit_row->>'price')::numeric;
    if price_value < 0 then
      raise exception 'SKU % price cannot be negative.', sku_value;
    end if;

    if expected_sku_type = 'parent' then
      update public.inventory_skus
         set name = product_name_value,
             price = price_value,
             updated_at = timezone('utc', now())
       where id = inventory.id;
      update public.product_option_values
         set label = product_name_value,
             sku = inventory.sku,
             inventory_sku = inventory.sku
       where inventory_sku_id = inventory.id;
      updated_count := updated_count + 1;
      continue;
    end if;

    unit_value := nullif(trim(audit_row->>'unit'), '');
    if unit_value is null then
      raise exception 'Child SKU % requires a unit.', sku_value;
    end if;
    if nullif(trim(audit_row->>'qty'), '') is null
      or nullif(trim(audit_row->>'reserve_quantity'), '') is null
      or nullif(trim(audit_row->>'reorder_point'), '') is null then
      raise exception 'Child SKU % requires Qty, Reserve buffer, and Low stock.', sku_value;
    end if;
    quantity_value := (audit_row->>'quantity')::integer;
    reserve_value := (audit_row->>'reserve_quantity')::integer;
    reorder_value := (audit_row->>'reorder_point')::integer;
    if quantity_value < 0 or reserve_value < 0 or reorder_value < 0 then
      raise exception 'Child SKU % quantities and thresholds cannot be negative.', sku_value;
    end if;
    cost_value := nullif(trim(audit_row->>'cost'), '')::numeric;
    weight_value_value := nullif(trim(audit_row->>'weight'), '')::numeric;
    weight_unit_value := lower(coalesce(nullif(trim(audit_row->>'weight_unit'), ''), 'oz'));
    if weight_unit_value not in ('oz', 'lb', 'g', 'kg') then
      raise exception 'Child SKU % has an invalid weight unit.', sku_value;
    end if;
    if cost_value < 0 or weight_value_value < 0 then
      raise exception 'Child SKU % cost and weight cannot be negative.', sku_value;
    end if;

    update public.inventory_skus
       set name = product_name_value,
           price = price_value,
           unit_type = unit_value,
           cost = cost_value,
           weight_value = weight_value_value,
           weight_unit = weight_unit_value,
           quantity_on_hand = quantity_value,
           reserve_quantity = reserve_value,
           reorder_point = reorder_value,
           updated_at = timezone('utc', now())
     where id = inventory.id;
    update public.product_option_values
       set label = product_name_value,
           sku = inventory.sku,
           inventory_sku = inventory.sku,
           quantity = quantity_value,
           low_stock_threshold = reorder_value,
           unit_type = unit_value
     where inventory_sku_id = inventory.id;
    updated_count := updated_count + 1;
  end loop;

  return updated_count;
end;
$$;

revoke all on function public.apply_inventory_audit(jsonb) from public, anon, authenticated;
revoke all on function public.apply_inventory_audit_complete(jsonb) from public, anon;
grant execute on function public.apply_inventory_audit_complete(jsonb) to authenticated;
