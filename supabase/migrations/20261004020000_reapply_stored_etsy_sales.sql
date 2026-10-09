create or replace function public.reapply_etsy_unmatched_sales(etsy_sku_value text)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  requested_sku text := nullif(trim(etsy_sku_value), '');
  mapping_id_value uuid;
  mapping_inventory_sku text;
  mapping_inventory_units integer := 1;
  sale_row public.etsy_sale_lines%rowtype;
  requirement record;
  desired_units numeric;
  previous_units numeric;
  delta_units numeric;
  matched_count integer := 0;
  inventory_updated_count integer := 0;
begin
  if not private.is_admin() then
    raise exception 'Admin access required.';
  end if;
  if requested_sku is null then
    raise exception 'An Etsy SKU is required.';
  end if;

  select m.id, m.inventory_sku, m.inventory_units
    into mapping_id_value, mapping_inventory_sku, mapping_inventory_units
  from public.product_etsy_mappings m
  where lower(trim(m.etsy_sku)) = lower(requested_sku)
    and m.active is true
  order by m.sort_order, m.created_at
  limit 1;

  if mapping_inventory_sku is null then
    select i.sku
      into mapping_inventory_sku
    from public.inventory_skus i
    where lower(trim(i.sku)) = lower(requested_sku)
    limit 1;
    if mapping_inventory_sku is not null then
      mapping_inventory_units := 1;
    end if;
  end if;

  if mapping_inventory_sku is null then
    raise exception 'No active Etsy mapping or canonical inventory SKU exists for %.', requested_sku;
  end if;

  if mapping_id_value is not null
     and exists (select 1 from public.product_etsy_mapping_components c where c.mapping_id = mapping_id_value)
     and not exists (
       select 1
       from public.product_etsy_mapping_components c
       cross join lateral public.expand_inventory_sku(c.inventory_sku, 1) expanded
       where c.mapping_id = mapping_id_value
     ) then
    raise exception 'The mapping for % still needs physical child SKUs.', requested_sku;
  end if;

  if mapping_id_value is null
     and not exists (select 1 from public.expand_inventory_sku(mapping_inventory_sku, 1)) then
    raise exception 'The canonical SKU % still needs physical child SKUs.', mapping_inventory_sku;
  end if;

  for sale_row in
    select *
    from public.etsy_sale_lines line
    where lower(trim(line.etsy_sku)) = lower(requested_sku)
      and (line.match_status = 'unmatched' or line.matched_inventory_sku is null)
    order by line.sale_date, line.id
    for update
  loop
    desired_units := greatest(0, coalesce(sale_row.quantity, 0) - least(coalesce(sale_row.quantity, 0), coalesce(sale_row.refunded_quantity, 0)));
    previous_units := coalesce(sale_row.inventory_units_applied, 0);
    delta_units := desired_units - previous_units;

    if delta_units <> 0 then
      if mapping_id_value is not null
         and exists (select 1 from public.product_etsy_mapping_components c where c.mapping_id = mapping_id_value) then
        for requirement in
          select expanded.component_sku,
                 sum(expanded.quantity * c.inventory_units * abs(delta_units))::integer as quantity
          from public.product_etsy_mapping_components c
          cross join lateral public.expand_inventory_sku(c.inventory_sku, 1) expanded
          where c.mapping_id = mapping_id_value
          group by expanded.component_sku
        loop
          update public.inventory_skus
          set quantity_on_hand = quantity_on_hand + requirement.quantity * case when delta_units > 0 then -1 else 1 end,
              updated_at = timezone('utc', now())
          where lower(trim(sku)) = lower(trim(requirement.component_sku))
            and lower(coalesce(item_type, 'inventory')) <> 'non-inventory';
          if not found then
            raise exception 'Etsy mapping component SKU % is not linked to physical inventory.', requirement.component_sku;
          end if;
          inventory_updated_count := inventory_updated_count + 1;
        end loop;
      else
        for requirement in
          select expanded.component_sku,
                 sum(expanded.quantity * greatest(1, mapping_inventory_units) * abs(delta_units))::integer as quantity
          from public.expand_inventory_sku(mapping_inventory_sku, 1) expanded
          group by expanded.component_sku
        loop
          update public.inventory_skus
          set quantity_on_hand = quantity_on_hand + requirement.quantity * case when delta_units > 0 then -1 else 1 end,
              updated_at = timezone('utc', now())
          where lower(trim(sku)) = lower(trim(requirement.component_sku))
            and lower(coalesce(item_type, 'inventory')) <> 'non-inventory';
          if not found then
            raise exception 'Canonical component SKU % is not linked to physical inventory.', requirement.component_sku;
          end if;
          inventory_updated_count := inventory_updated_count + 1;
        end loop;
      end if;
    end if;

    update public.etsy_sale_lines
    set matched_inventory_sku = mapping_inventory_sku,
        match_status = 'matched',
        inventory_units_applied = desired_units,
        inventory_allocation_status = 'applied',
        updated_at = timezone('utc', now())
    where id = sale_row.id;

    update public.inventory_manual_pack_allocations
    set status = 'cancelled',
        note = 'Automatically matched after the canonical SKU or Etsy mapping was created.'
    where etsy_sale_line_id = sale_row.id
      and status = 'pending';

    matched_count := matched_count + 1;
  end loop;

  return jsonb_build_object(
    'etsy_sku', requested_sku,
    'matched_lines', matched_count,
    'inventory_updated', inventory_updated_count
  );
end;
$$;

revoke all on function public.reapply_etsy_unmatched_sales(text) from public, anon, authenticated;
grant execute on function public.reapply_etsy_unmatched_sales(text) to authenticated;

create or replace function public.reapply_all_etsy_unmatched_sales()
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  sku_value text;
  result jsonb;
  matched_lines integer := 0;
  inventory_updated integer := 0;
  remaining_lines integer := 0;
begin
  if not private.is_admin() then
    raise exception 'Administrator access is required.';
  end if;

  for sku_value in
    select distinct trim(s.etsy_sku)
    from public.etsy_sale_lines s
    where nullif(trim(s.etsy_sku), '') is not null
      and (s.match_status = 'unmatched' or s.matched_inventory_sku is null)
      and (
        exists (
          select 1
          from public.product_etsy_mappings m
          where m.active = true
            and lower(trim(m.etsy_sku)) = lower(trim(s.etsy_sku))
        )
        or exists (
          select 1
          from public.inventory_skus i
          where lower(trim(i.sku)) = lower(trim(s.etsy_sku))
        )
      )
  loop
    result := public.reapply_etsy_unmatched_sales(sku_value);
    matched_lines := matched_lines + coalesce((result ->> 'matched_lines')::integer, 0);
    inventory_updated := inventory_updated + coalesce((result ->> 'inventory_updated')::integer, 0);
  end loop;

  select count(*)
  into remaining_lines
  from public.etsy_sale_lines s
  where s.match_status = 'unmatched' or s.matched_inventory_sku is null;

  return jsonb_build_object(
    'matched_lines', matched_lines,
    'inventory_updated', inventory_updated,
    'remaining_lines', remaining_lines
  );
end;
$$;

revoke all on function public.reapply_all_etsy_unmatched_sales() from public, anon, authenticated;
grant execute on function public.reapply_all_etsy_unmatched_sales() to authenticated;
