create table public.inventory_sales_reassignment_audit (
  id uuid primary key default gen_random_uuid(),
  source_sku text not null,
  target_sku text not null,
  restored_components jsonb not null default '[]'::jsonb,
  deducted_components jsonb not null default '[]'::jsonb,
  reference_counts jsonb not null default '{}'::jsonb,
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.inventory_sales_reassignment_audit enable row level security;
create policy inventory_sales_reassignment_audit_admin_select
  on public.inventory_sales_reassignment_audit for select to authenticated
  using ((select private.is_admin()));
revoke all on public.inventory_sales_reassignment_audit from public, anon, authenticated;
grant select on public.inventory_sales_reassignment_audit to authenticated;

create or replace function public.admin_preview_inventory_sku_reassignment(p_source_sku text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  source_value text := nullif(trim(coalesce(p_source_sku, '')), '');
  source_record public.inventory_skus%rowtype;
  etsy_line_count bigint;
  etsy_units numeric;
  staged_count bigint;
  website_count bigint;
  website_units numeric;
  manual_count bigint;
  manual_units numeric;
  sale_details jsonb;
begin
  if not private.is_admin() then raise exception 'Admin access required.'; end if;
  if source_value is null then raise exception 'Choose the incorrect SKU first.'; end if;
  select inventory.* into source_record
  from public.inventory_skus inventory
  where lower(trim(inventory.sku)) = lower(source_value);
  if source_record.sku is null then raise exception 'The source SKU is not in canonical inventory.'; end if;

  select count(*), coalesce(sum(greatest(0, coalesce(line.inventory_units_applied, 0))), 0)
  into etsy_line_count, etsy_units
  from public.etsy_sale_lines line
  where lower(trim(coalesce(nullif(line.matched_inventory_sku, ''), nullif(line.etsy_sku, ''), ''))) = lower(source_record.sku);

  select count(*) into staged_count
  from public.etsy_import_sales line
  where lower(trim(coalesce(nullif(line.matched_inventory_sku, ''), nullif(line.etsy_sku, ''), ''))) = lower(source_record.sku)
    and not exists (
      select 1 from public.etsy_sale_lines current_line
      where current_line.external_order_id = line.external_order_id
        and current_line.external_line_id = line.external_line_id
    );

  select count(*), coalesce(sum(
    case when order_row.inventory_restored_at is null
      and lower(coalesce(order_row.status, '')) in ('paid', 'processing', 'shipped', 'completed')
      and lower(trim(coalesce(item.inventory_sku, ''))) = lower(source_record.sku)
      then greatest(0, item.quantity - coalesce(item.refunded_quantity, 0)) * greatest(1, coalesce(item.inventory_units, 1))
      else 0 end
  ), 0)
  into website_count, website_units
  from public.order_items item
  join public.orders order_row on order_row.id = item.order_id
  where lower(trim(coalesce(item.inventory_sku, ''))) = lower(source_record.sku)
     or lower(trim(coalesce(item.sku, ''))) = lower(source_record.sku);

  select count(*), coalesce(sum(line.quantity), 0)
  into manual_count, manual_units
  from public.manual_sale_lines line
  join public.manual_sales sale on sale.id = line.sale_id
  where sale.voided_at is null and lower(trim(line.sku)) = lower(source_record.sku);

  select coalesce(jsonb_agg(jsonb_build_object(
    'source', detail.source,
    'source_id', detail.source_id,
    'date', detail.sold_at,
    'reference', detail.reference,
    'sku', detail.sku,
    'quantity', detail.quantity,
    'inventory_units_applied', detail.inventory_units_applied
  ) order by detail.sold_at desc nulls last), '[]'::jsonb)
  into sale_details
  from (
    select 'Etsy'::text as source, line.id::text as source_id, line.sale_date as sold_at,
      line.external_order_id as reference, coalesce(nullif(line.matched_inventory_sku, ''), line.etsy_sku) as sku,
      line.quantity, greatest(0, coalesce(line.inventory_units_applied, 0)) as inventory_units_applied
    from public.etsy_sale_lines line
    where lower(trim(coalesce(nullif(line.matched_inventory_sku, ''), nullif(line.etsy_sku, ''), ''))) = lower(source_record.sku)
    union all
    select 'Etsy staged'::text, line.id::text, line.sale_date, line.external_order_id,
      coalesce(nullif(line.matched_inventory_sku, ''), line.etsy_sku), line.quantity, 0::numeric
    from public.etsy_import_sales line
    where lower(trim(coalesce(nullif(line.matched_inventory_sku, ''), nullif(line.etsy_sku, ''), ''))) = lower(source_record.sku)
      and not exists (select 1 from public.etsy_sale_lines current_line
        where current_line.external_order_id = line.external_order_id
          and current_line.external_line_id = line.external_line_id)
    union all
    select 'Website'::text, item.id::text, order_row.created_at,
      coalesce(order_row.order_number::text, order_row.id::text),
      coalesce(nullif(item.inventory_sku, ''), item.sku), item.quantity::numeric,
      case when order_row.inventory_restored_at is null
        and lower(coalesce(order_row.status, '')) in ('paid', 'processing', 'shipped', 'completed')
        and lower(trim(coalesce(item.inventory_sku, ''))) = lower(source_record.sku)
        then greatest(0, item.quantity - coalesce(item.refunded_quantity, 0)) * greatest(1, coalesce(item.inventory_units, 1))
        else 0 end::numeric
    from public.order_items item join public.orders order_row on order_row.id = item.order_id
    where lower(trim(coalesce(item.inventory_sku, ''))) = lower(source_record.sku)
       or lower(trim(coalesce(item.sku, ''))) = lower(source_record.sku)
    union all
    select 'Outside sale'::text, line.id::text, sale.sold_at,
      coalesce(sale.customer_reference, sale.sales_channel), line.sku,
      line.quantity::numeric, case when sale.voided_at is null then line.quantity else 0 end::numeric
    from public.manual_sale_lines line join public.manual_sales sale on sale.id = line.sale_id
    where lower(trim(line.sku)) = lower(source_record.sku)
  ) detail;

  return jsonb_build_object(
    'source_sku', source_record.sku,
    'source_name', source_record.name,
    'etsy_sale_lines', etsy_line_count,
    'etsy_units_applied', etsy_units,
    'staged_etsy_lines', staged_count,
    'website_order_lines', website_count,
    'website_units_applied', website_units,
    'manual_sale_lines', manual_count,
    'manual_units_applied', manual_units,
    'total_units_applied', etsy_units + website_units + manual_units,
    'sale_lines', sale_details
  );
end;
$$;

create or replace function public.reassign_inventory_sku_sales(
  p_source_sku text,
  p_target_sku text,
  p_restore_components jsonb default '[]'::jsonb,
  p_deduct_components jsonb default '[]'::jsonb,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  source_record public.inventory_skus%rowtype;
  target_record public.inventory_skus%rowtype;
  component_row jsonb;
  movement record;
  component_sku text;
  component_quantity integer;
  inventory_record public.inventory_skus%rowtype;
  quantity_after integer;
  restored jsonb := '[]'::jsonb;
  deducted jsonb := '[]'::jsonb;
  etsy_updated integer := 0;
  staged_updated integer := 0;
  website_updated integer := 0;
  manual_updated integer := 0;
  allocation_updated integer := 0;
  reference_counts jsonb;
  audit_id uuid;
  total_applied_units numeric := 0;
begin
  if not private.is_admin() then raise exception 'Admin access required.'; end if;
  if nullif(trim(coalesce(p_source_sku, '')), '') is null
     or nullif(trim(coalesce(p_target_sku, '')), '') is null then
    raise exception 'Choose both the incorrect SKU and its replacement.';
  end if;
  select * into source_record from public.inventory_skus
  where lower(trim(sku)) = lower(trim(p_source_sku)) for update;
  select * into target_record from public.inventory_skus
  where lower(trim(sku)) = lower(trim(p_target_sku)) for update;
  if source_record.id is null then raise exception 'The incorrect SKU is no longer in canonical inventory.'; end if;
  if target_record.id is null then raise exception 'The replacement SKU must already exist in canonical inventory.'; end if;
  if source_record.id = target_record.id then raise exception 'Choose a different replacement SKU.'; end if;
  if jsonb_typeof(coalesce(p_restore_components, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_deduct_components, '[]'::jsonb)) <> 'array' then
    raise exception 'Inventory corrections must be lists of SKU and quantity rows.';
  end if;
  if not exists (select 1 from public.etsy_sale_lines line
      where lower(trim(coalesce(nullif(line.matched_inventory_sku, ''), nullif(line.etsy_sku, ''), ''))) = lower(source_record.sku))
     and not exists (select 1 from public.etsy_import_sales line
      where lower(trim(coalesce(nullif(line.matched_inventory_sku, ''), nullif(line.etsy_sku, ''), ''))) = lower(source_record.sku))
     and not exists (select 1 from public.order_items item
      where lower(trim(coalesce(item.inventory_sku, ''))) = lower(source_record.sku)
         or lower(trim(coalesce(item.sku, ''))) = lower(source_record.sku)
         or lower(trim(coalesce(item.selected_options->>'sku', ''))) = lower(source_record.sku)
         or lower(trim(coalesce(item.selected_options->>'inventorySku', ''))) = lower(source_record.sku)
         or lower(trim(coalesce(item.selected_options->>'variantSku', ''))) = lower(source_record.sku))
     and not exists (select 1 from public.manual_sale_lines line
      where lower(trim(line.sku)) = lower(source_record.sku) or line.inventory_sku_id = source_record.id) then
    raise exception 'No sales history still points to this SKU. Refresh the preview and check the source SKU.';
  end if;

  select coalesce(sum(greatest(0, coalesce(line.inventory_units_applied, 0))), 0)
    into total_applied_units
  from public.etsy_sale_lines line
  where lower(trim(coalesce(nullif(line.matched_inventory_sku, ''), nullif(line.etsy_sku, ''), ''))) = lower(source_record.sku);
  total_applied_units := total_applied_units + coalesce((
    select sum(greatest(0, item.quantity - coalesce(item.refunded_quantity, 0)) * greatest(1, coalesce(item.inventory_units, 1)))
    from public.order_items item
    join public.orders order_row on order_row.id = item.order_id
    where lower(trim(coalesce(item.inventory_sku, ''))) = lower(source_record.sku)
      and order_row.inventory_restored_at is null
      and lower(coalesce(order_row.status, '')) in ('paid', 'processing', 'shipped', 'completed')
  ), 0);
  total_applied_units := total_applied_units + coalesce((
    select sum(line.quantity)
    from public.manual_sale_lines line
    join public.manual_sales sale on sale.id = line.sale_id
    where sale.voided_at is null and lower(trim(line.sku)) = lower(source_record.sku)
  ), 0);
  if total_applied_units > 0 and (jsonb_array_length(coalesce(p_restore_components, '[]'::jsonb)) = 0
      or jsonb_array_length(coalesce(p_deduct_components, '[]'::jsonb)) = 0) then
    raise exception 'Add-back and new deduction quantities are required because this SKU has sales that changed inventory.';
  end if;

  for component_row in select value from jsonb_array_elements(coalesce(p_restore_components, '[]'::jsonb)) as rows(value)
  loop
    component_sku := nullif(trim(component_row->>'sku'), '');
    if component_sku is null or coalesce(component_row->>'quantity', '') !~ '^[0-9]+$'
       or (component_row->>'quantity')::integer <= 0 then
      raise exception 'Each add-back row needs an existing SKU and a positive whole quantity.';
    end if;
    component_quantity := (component_row->>'quantity')::integer;
    select * into inventory_record from public.inventory_skus
    where lower(trim(sku)) = lower(component_sku) for update;
    if inventory_record.id is null then raise exception 'Add-back SKU % is not in canonical inventory.', component_sku; end if;
    if lower(coalesce(inventory_record.item_type, 'inventory')) = 'non-inventory' then
      raise exception 'Add-back SKU % is a parent, not physical inventory. Add its physical child SKUs instead.', inventory_record.sku;
    end if;
    update public.inventory_skus
    set quantity_on_hand = quantity_on_hand + component_quantity, updated_at = timezone('utc', now())
    where id = inventory_record.id returning quantity_on_hand into quantity_after;
    insert into public.inventory_adjustments(product_id, inventory_sku_id, inventory_sku, quantity_delta, quantity_after, note, created_by, adjustment_type, cost_impact)
    values (null, inventory_record.id, inventory_record.sku, component_quantity, quantity_after,
      'Sales SKU reassignment: restore stock from ' || source_record.sku || '. ' || coalesce(nullif(trim(p_note), ''), 'Admin correction.'),
      auth.uid(), 'manual', component_quantity * coalesce(inventory_record.cost, 0));
    restored := restored || jsonb_build_array(jsonb_build_object('sku', inventory_record.sku, 'quantity', component_quantity));
  end loop;

  for component_row in select value from jsonb_array_elements(coalesce(p_deduct_components, '[]'::jsonb)) as rows(value)
  loop
    component_sku := nullif(trim(component_row->>'sku'), '');
    if component_sku is null or coalesce(component_row->>'quantity', '') !~ '^[0-9]+$'
       or (component_row->>'quantity')::integer <= 0 then
      raise exception 'Each deduction row needs an existing SKU and a positive whole quantity.';
    end if;
    component_quantity := (component_row->>'quantity')::integer;
    select * into inventory_record from public.inventory_skus
    where lower(trim(sku)) = lower(component_sku) for update;
    if inventory_record.id is null then raise exception 'Deduction SKU % is not in canonical inventory.', component_sku; end if;
    if lower(coalesce(inventory_record.item_type, 'inventory')) = 'non-inventory' then
      raise exception 'Deduction SKU % is a parent, not physical inventory. Add its physical child SKUs instead.', inventory_record.sku;
    end if;
    if inventory_record.quantity_on_hand - coalesce(inventory_record.reserve_quantity, 0) < component_quantity then
      raise exception 'Not enough available stock to deduct % from %; account for the reserve buffer or correct the quantities.', component_quantity, inventory_record.sku;
    end if;
    update public.inventory_skus
    set quantity_on_hand = quantity_on_hand - component_quantity, updated_at = timezone('utc', now())
    where id = inventory_record.id returning quantity_on_hand into quantity_after;
    insert into public.inventory_adjustments(product_id, inventory_sku_id, inventory_sku, quantity_delta, quantity_after, note, created_by, adjustment_type, cost_impact)
    values (null, inventory_record.id, inventory_record.sku, -component_quantity, quantity_after,
      'Sales SKU reassignment: deduct stock for ' || target_record.sku || '. ' || coalesce(nullif(trim(p_note), ''), 'Admin correction.'),
      auth.uid(), 'manual', -component_quantity * coalesce(inventory_record.cost, 0));
    deducted := deducted || jsonb_build_array(jsonb_build_object('sku', inventory_record.sku, 'quantity', component_quantity));
  end loop;

  update public.etsy_sale_lines
  set etsy_sku = target_record.sku,
      matched_inventory_sku = target_record.sku,
      updated_at = timezone('utc', now())
  where lower(trim(coalesce(nullif(matched_inventory_sku, ''), nullif(etsy_sku, ''), ''))) = lower(source_record.sku);
  get diagnostics etsy_updated = row_count;

  update public.etsy_import_sales
  set etsy_sku = target_record.sku,
      matched_inventory_sku = target_record.sku
  where lower(trim(coalesce(nullif(matched_inventory_sku, ''), nullif(etsy_sku, ''), ''))) = lower(source_record.sku);
  get diagnostics staged_updated = row_count;

  update public.order_items item
  set sku = case when lower(trim(coalesce(item.sku, ''))) = lower(source_record.sku) then target_record.sku else item.sku end,
      inventory_sku = case when lower(trim(coalesce(item.inventory_sku, ''))) = lower(source_record.sku) then target_record.sku else item.inventory_sku end,
      selected_options = case
        when jsonb_typeof(item.selected_options) = 'object' then
          (case when lower(trim(coalesce(item.selected_options->>'sku', ''))) = lower(source_record.sku) then jsonb_set(item.selected_options, '{sku}', to_jsonb(target_record.sku), true) else item.selected_options end)
          || (case when lower(trim(coalesce(item.selected_options->>'inventorySku', ''))) = lower(source_record.sku) then jsonb_build_object('inventorySku', target_record.sku) else '{}'::jsonb end)
          || (case when lower(trim(coalesce(item.selected_options->>'variantSku', ''))) = lower(source_record.sku) then jsonb_build_object('variantSku', target_record.sku) else '{}'::jsonb end)
        else item.selected_options end
  where lower(trim(coalesce(item.sku, ''))) = lower(source_record.sku)
     or lower(trim(coalesce(item.inventory_sku, ''))) = lower(source_record.sku)
     or lower(trim(coalesce(item.selected_options->>'sku', ''))) = lower(source_record.sku)
     or lower(trim(coalesce(item.selected_options->>'inventorySku', ''))) = lower(source_record.sku)
     or lower(trim(coalesce(item.selected_options->>'variantSku', ''))) = lower(source_record.sku);
  get diagnostics website_updated = row_count;

  update public.manual_sale_lines line
  set sku = target_record.sku, inventory_sku_id = target_record.id
  where lower(trim(line.sku)) = lower(source_record.sku) or line.inventory_sku_id = source_record.id;
  get diagnostics manual_updated = row_count;

  update public.inventory_manual_pack_allocations
  set parent_sku = target_record.sku
  where lower(trim(parent_sku)) = lower(source_record.sku);
  get diagnostics allocation_updated = row_count;

  reference_counts := jsonb_build_object('etsy', etsy_updated, 'staged_etsy', staged_updated, 'website', website_updated, 'manual', manual_updated, 'manual_allocations', allocation_updated);
  insert into public.inventory_sales_reassignment_audit(source_sku, target_sku, restored_components, deducted_components, reference_counts, note, created_by)
  values (source_record.sku, target_record.sku, restored, deducted, reference_counts, nullif(trim(coalesce(p_note, '')), ''), auth.uid())
  returning id into audit_id;

  return jsonb_build_object('audit_id', audit_id, 'source_sku', source_record.sku, 'target_sku', target_record.sku,
    'reference_counts', reference_counts, 'restored_components', restored, 'deducted_components', deducted);
end;
$$;

revoke all on function public.admin_preview_inventory_sku_reassignment(text) from public, anon;
grant execute on function public.admin_preview_inventory_sku_reassignment(text) to authenticated, service_role;
revoke all on function public.reassign_inventory_sku_sales(text, text, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.reassign_inventory_sku_sales(text, text, jsonb, jsonb, text) to authenticated;
