create or replace function public.refresh_inventory_sellable_pack_parents()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_id uuid;
begin
  if current_setting('bead.inventory_audit_mode', true) = 'true' then
    return new;
  end if;

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

create or replace function public.apply_inventory_audit_complete(audit_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public, private
as $$
declare
  audit_row jsonb;
  inventory public.inventory_skus%rowtype;
  audit_sku text;
  normalized_sku text;
  seen_skus text[] := array[]::text[];
  expected_count integer;
  updated_count integer := 0;
  quantity_value integer;
  reserve_value integer;
  reorder_value integer;
  price_value numeric;
  weight_value_input numeric;
  product_name_value text;
  product_id_value uuid;
  quantity_delta integer;
  parent_pass boolean;
  row_is_parent boolean;
begin
  if not private.is_admin() then
    raise exception 'Admin access required.';
  end if;
  if audit_rows is null or jsonb_typeof(audit_rows) <> 'array' then
    raise exception 'The year-end audit must be a JSON array of canonical SKU rows.';
  end if;

  select count(*) into expected_count from public.inventory_skus;
  if jsonb_array_length(audit_rows) <> expected_count then
    raise exception 'The audit must contain every canonical SKU exactly once. Expected %, received %.', expected_count, jsonb_array_length(audit_rows);
  end if;

  perform set_config('bead.inventory_audit_mode', 'true', true);

  for parent_pass in select value from (values (false), (true)) as passes(value)
  loop
    for audit_row in select value from jsonb_array_elements(audit_rows) as entries(value)
    loop
      if jsonb_typeof(audit_row) <> 'object' then
        raise exception 'Every year-end audit row must be an object.';
      end if;

      audit_sku := nullif(trim(audit_row->>'sku'), '');
      if audit_sku is null then
        raise exception 'Every audit row needs an immutable SKU match key.';
      end if;
      normalized_sku := lower(audit_sku);
      if not parent_pass then
        if normalized_sku = any(seen_skus) then
          raise exception 'The audit contains duplicate SKU %.', audit_sku;
        end if;
        seen_skus := array_append(seen_skus, normalized_sku);
      end if;

      select * into inventory
        from public.inventory_skus
       where lower(trim(sku)) = normalized_sku
       for update;
      if not found then
        raise exception 'SKU % is not in canonical inventory. SKU values are immutable.', audit_sku;
      end if;

      row_is_parent := lower(coalesce(inventory.item_type, 'inventory')) = 'non-inventory';
      if row_is_parent is distinct from parent_pass then
        continue;
      end if;

      if not (audit_row ? 'product_name') or not (audit_row ? 'price')
        or not (audit_row ? 'weight_value') or not (audit_row ? 'quantity')
        or not (audit_row ? 'reserve_quantity') or not (audit_row ? 'reorder_point') then
        raise exception 'SKU % must include Name, Price, Weight, Qty, Reserve buffer, and Low stock.', audit_sku;
      end if;

      product_name_value := nullif(trim(audit_row->>'product_name'), '');
      if product_name_value is null then
        raise exception 'SKU % requires a product name.', audit_sku;
      end if;
      price_value := nullif(trim(audit_row->>'price'), '')::numeric;
      weight_value_input := nullif(trim(audit_row->>'weight_value'), '')::numeric;
      quantity_value := nullif(trim(audit_row->>'quantity'), '')::integer;
      reserve_value := nullif(trim(audit_row->>'reserve_quantity'), '')::integer;
      reorder_value := nullif(trim(audit_row->>'reorder_point'), '')::integer;
      if price_value is null or quantity_value is null or reserve_value is null or reorder_value is null then
        raise exception 'SKU % requires Price, Qty, Reserve buffer, and Low stock values.', audit_sku;
      end if;
      if price_value < 0 or coalesce(weight_value_input, 0) < 0
        or quantity_value < 0 or reserve_value < 0 or reorder_value < 0 then
        raise exception 'SKU % contains a negative value; audit values must be zero or greater.', audit_sku;
      end if;

      quantity_delta := quantity_value - coalesce(inventory.quantity_on_hand, 0);
      update public.inventory_skus
         set name = product_name_value,
             price = price_value,
             weight_value = weight_value_input,
             weight_unit = 'oz',
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
             low_stock_threshold = reorder_value
       where inventory_sku_id = inventory.id;

      if quantity_delta <> 0 then
        select option_record.product_id
          into product_id_value
          from public.product_option_values value_record
          join public.product_options option_record on option_record.id = value_record.option_id
         where value_record.inventory_sku_id = inventory.id
         limit 1;
        if product_id_value is null then
          select product.id into product_id_value
            from public.products product
           where product.sku = inventory.sku
           limit 1;
        end if;
        insert into public.inventory_adjustments (
          product_id, inventory_sku_id, inventory_sku, quantity_delta, quantity_after,
          note, created_by, adjustment_type, cost_impact
        ) values (
          product_id_value, inventory.id, inventory.sku, quantity_delta, quantity_value,
          'Year-end audit overwrite', auth.uid(),
          case when quantity_delta < 0 then 'audit_shrink' else 'audit_gain' end,
          case when quantity_delta < 0 then abs(quantity_delta) * coalesce(inventory.cost, 0) else 0 end
        );
      end if;

      updated_count := updated_count + 1;
    end loop;
  end loop;

  if cardinality(seen_skus) <> expected_count then
    raise exception 'The audit must contain every canonical SKU exactly once.';
  end if;

  return updated_count;
end;
$$;

revoke all on function public.refresh_inventory_sellable_pack_parents() from public, anon, authenticated;
revoke all on function public.apply_inventory_audit_complete(jsonb) from public, anon;
grant execute on function public.apply_inventory_audit_complete(jsonb) to authenticated;
