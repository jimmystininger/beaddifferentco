alter table public.etsy_sale_lines
  add column if not exists inventory_allocation_status text not null default 'not_required';

create table if not exists public.inventory_manual_pack_allocations (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('etsy', 'website')),
  etsy_sale_line_id uuid unique references public.etsy_sale_lines(id) on delete cascade,
  order_item_id uuid unique references public.order_items(id) on delete cascade,
  parent_sku text not null,
  units numeric not null check (units > 0),
  status text not null default 'pending' check (status in ('pending', 'applied', 'cancelled')),
  allocations jsonb not null default '[]'::jsonb,
  note text,
  created_at timestamptz not null default timezone('utc', now()),
  applied_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  check ((source_type = 'etsy' and etsy_sale_line_id is not null and order_item_id is null)
      or (source_type = 'website' and order_item_id is not null and etsy_sale_line_id is null))
);

create index if not exists inventory_manual_pack_allocations_status_idx
  on public.inventory_manual_pack_allocations(status, created_at);

alter table public.inventory_manual_pack_allocations enable row level security;
drop policy if exists inventory_manual_pack_allocations_admin_all on public.inventory_manual_pack_allocations;
create policy inventory_manual_pack_allocations_admin_all on public.inventory_manual_pack_allocations
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

revoke all on public.inventory_manual_pack_allocations from public, anon, authenticated;
grant select, insert, update on public.inventory_manual_pack_allocations to authenticated;

create or replace function public.queue_manual_etsy_pack_allocation()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.matched_inventory_sku is null
     and greatest(0, coalesce(new.quantity, 0) - least(coalesce(new.quantity, 0), coalesce(new.refunded_quantity, 0))) > 0
     and coalesce(new.inventory_allocation_status, 'not_required') <> 'applied' then
    insert into public.inventory_manual_pack_allocations (
      source_type, etsy_sale_line_id, parent_sku, units, created_by
    ) values (
      'etsy', new.id, new.etsy_sku,
      greatest(0, coalesce(new.quantity, 0) - least(coalesce(new.quantity, 0), coalesce(new.refunded_quantity, 0))),
      auth.uid()
    ) on conflict (etsy_sale_line_id) do update
      set parent_sku = excluded.parent_sku,
          units = excluded.units,
          status = case when inventory_manual_pack_allocations.status = 'applied' then 'applied' else 'pending' end;
    if new.inventory_allocation_status <> 'applied' then
      update public.etsy_sale_lines
      set inventory_allocation_status = 'pending', match_status = 'unmatched', updated_at = timezone('utc', now())
      where id = new.id and inventory_allocation_status <> 'pending';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.queue_manual_etsy_pack_allocation() from public, anon, authenticated;
drop trigger if exists queue_manual_etsy_pack_allocation_after_write on public.etsy_sale_lines;
create trigger queue_manual_etsy_pack_allocation_after_write
after insert or update of etsy_sku, quantity, refunded_quantity
on public.etsy_sale_lines
for each row execute function public.queue_manual_etsy_pack_allocation();

create or replace function public.queue_manual_website_pack_allocation()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  item_type_value text;
  allocation_mode text;
begin
  select lower(coalesce(inventory.item_type, 'inventory')),
         inventory.source_metadata->>'allocation_mode'
    into item_type_value, allocation_mode
  from public.inventory_skus inventory
  where lower(trim(inventory.sku)) = lower(trim(coalesce(new.sku, '')))
  limit 1;
  if item_type_value = 'non-inventory' and allocation_mode = 'manual' then
    insert into public.inventory_manual_pack_allocations (
      source_type, order_item_id, parent_sku, units, created_by
    ) values (
      'website', new.id, new.sku, new.quantity, auth.uid()
    ) on conflict (order_item_id) do update
      set parent_sku = excluded.parent_sku,
          units = excluded.units,
          status = case when inventory_manual_pack_allocations.status = 'applied' then 'applied' else 'pending' end;
  end if;
  return new;
end;
$$;

revoke all on function public.queue_manual_website_pack_allocation() from public, anon, authenticated;
drop trigger if exists queue_manual_website_pack_allocation_after_write on public.order_items;
create trigger queue_manual_website_pack_allocation_after_write
after insert on public.order_items
for each row execute function public.queue_manual_website_pack_allocation();

create or replace function public.apply_inventory_manual_pack_allocation(
  allocation_id uuid,
  child_allocations jsonb,
  allocation_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  allocation record;
  child record;
  child_row jsonb;
  child_sku_value text;
  child_quantity integer;
  product_id_value uuid;
  applied_count integer := 0;
  note_value text := coalesce(nullif(trim(allocation_note), ''), 'Manual mixed-pack allocation');
begin
  if not private.is_admin() then raise exception 'Admin access required.'; end if;
  if jsonb_typeof(child_allocations) <> 'array' or jsonb_array_length(child_allocations) = 0 then
    raise exception 'Choose at least one child SKU and quantity.';
  end if;
  select pending.* into allocation
  from public.inventory_manual_pack_allocations pending
  where pending.id = allocation_id
  for update;
  if allocation.id is null then raise exception 'Manual allocation not found.'; end if;
  if allocation.status <> 'pending' then raise exception 'This allocation is already closed.'; end if;
  if allocation.source_type = 'etsy' then
    select line.product_id into product_id_value from public.etsy_sale_lines line where line.id = allocation.etsy_sale_line_id;
  else
    select item.product_id into product_id_value from public.order_items item where item.id = allocation.order_item_id;
  end if;

  for child_row in select value from jsonb_array_elements(child_allocations) as entries(value)
  loop
    child_sku_value := nullif(trim(child_row->>'sku'), '');
    child_quantity := greatest(0, coalesce(nullif(child_row->>'quantity', '')::integer, 0));
    if child_sku_value is null or child_quantity < 1 then raise exception 'Every child allocation needs a positive quantity.'; end if;
    select inventory.id, inventory.quantity_on_hand, inventory.reserve_quantity,
           lower(coalesce(inventory.item_type, 'inventory')) as item_type
      into child
    from public.inventory_skus inventory
    where lower(trim(inventory.sku)) = lower(child_sku_value)
    for update;
    if child.id is null then raise exception 'Child SKU % is not in canonical inventory.', child_sku_value; end if;
    if child.item_type = 'non-inventory' then raise exception 'Child SKU % is not physical inventory.', child_sku_value; end if;
    if child.quantity_on_hand - coalesce(child.reserve_quantity, 0) < child_quantity then raise exception 'Not enough available inventory for child SKU %.', child_sku_value; end if;
    update public.inventory_skus
    set quantity_on_hand = quantity_on_hand - child_quantity, updated_at = timezone('utc', now())
    where id = child.id;
    insert into public.inventory_adjustments (
      product_id, inventory_sku_id, inventory_sku, quantity_delta, quantity_after,
      note, created_by, adjustment_type, cost_impact
    ) values (
      product_id_value, child.id, child_sku_value, -child_quantity,
      child.quantity_on_hand - child_quantity, note_value, auth.uid(), 'manual',
      coalesce(child_quantity * child.cost, 0)
    );
    applied_count := applied_count + 1;
  end loop;

  update public.inventory_manual_pack_allocations
  set status = 'applied', allocations = child_allocations, note = note_value,
      applied_at = timezone('utc', now())
  where id = allocation.id;
  if allocation.source_type = 'etsy' then
    update public.etsy_sale_lines
    set inventory_allocation_status = 'applied', matched_inventory_sku = allocation.parent_sku,
        match_status = 'matched', inventory_units_applied = allocation.units,
        updated_at = timezone('utc', now())
    where id = allocation.etsy_sale_line_id;
  end if;
  return jsonb_build_object('allocation_id', allocation.id, 'children_applied', applied_count);
end;
$$;

revoke all on function public.apply_inventory_manual_pack_allocation(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.apply_inventory_manual_pack_allocation(uuid, jsonb, text) to authenticated;

create or replace function public.import_etsy_sales(
  sales_rows jsonb,
  apply_inventory boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  sale_row jsonb;
  sale_id uuid;
  was_inserted boolean;
  external_order_id_value text;
  external_line_id_value text;
  etsy_sku_value text;
  status_value text;
  sale_date_value timestamptz;
  quantity_value numeric;
  refunded_quantity_value numeric;
  desired_units numeric;
  previous_units numeric;
  delta_units numeric;
  inserted_count integer := 0;
  updated_count integer := 0;
  skipped_count integer := 0;
  unmatched_count integer := 0;
  inventory_updated_count integer := 0;
  mapping_id uuid;
  mapping_inventory_sku text;
  mapping_inventory_units integer;
  requirement record;
  component record;
  component_delta integer;
begin
  if not private.is_admin() then
    raise exception 'Admin access required.';
  end if;
  if public.etsy_imports_frozen() then
    raise exception 'Etsy imports are paused while an inventory audit is in progress.';
  end if;
  if jsonb_typeof(sales_rows) <> 'array' then
    raise exception 'Etsy sales must be a JSON array.';
  end if;

  for sale_row in select value from jsonb_array_elements(sales_rows) as entries(value)
  loop
    external_order_id_value := nullif(trim(coalesce(sale_row->>'external_order_id', sale_row->>'order_id', sale_row->>'receipt_id')), '');
    external_line_id_value := nullif(trim(coalesce(sale_row->>'external_line_id', sale_row->>'line_id', sale_row->>'transaction_id')), '');
    etsy_sku_value := nullif(trim(coalesce(sale_row->>'etsy_sku', sale_row->>'sku')), '');
    if external_order_id_value is null or external_line_id_value is null or etsy_sku_value is null then
      raise exception 'Every Etsy sale needs an order ID, line ID, and Etsy SKU.';
    end if;

    sale_date_value := coalesce(nullif(trim(sale_row->>'sale_date'), '')::timestamptz, timezone('utc', now()));
    status_value := lower(coalesce(nullif(trim(sale_row->>'status'), ''), 'paid'));
    if status_value not in ('paid', 'completed', 'refunded', 'returned', 'cancelled', 'unknown') then
      status_value := 'unknown';
    end if;
    quantity_value := greatest(0, coalesce(nullif(sale_row->>'quantity', '')::numeric, 0));
    refunded_quantity_value := greatest(0, coalesce(nullif(sale_row->>'refunded_quantity', '')::numeric, 0));
    if status_value in ('refunded', 'returned', 'cancelled') and refunded_quantity_value = 0 then
      refunded_quantity_value := quantity_value;
    end if;
    refunded_quantity_value := least(quantity_value, refunded_quantity_value);
    desired_units := greatest(0, quantity_value - refunded_quantity_value);

    select m.id, m.inventory_sku, m.inventory_units
      into mapping_id, mapping_inventory_sku, mapping_inventory_units
    from public.product_etsy_mappings m
    where lower(trim(m.etsy_sku)) = lower(etsy_sku_value)
      and m.active is true
    order by m.sort_order, m.created_at
    limit 1;

    if mapping_inventory_sku is null then
      select i.sku
        into mapping_inventory_sku
      from public.inventory_skus i
      where lower(trim(i.sku)) = lower(etsy_sku_value)
      limit 1;
      if mapping_inventory_sku is not null then
        mapping_inventory_units := 1;
      end if;
    end if;

    if lower(etsy_sku_value) ~ '(mix|random|assort)' then
      mapping_inventory_sku := null;
      mapping_id := null;
      mapping_inventory_units := 1;
    end if;

    insert into public.etsy_sale_lines (
      external_order_id, external_line_id, etsy_sku, sale_date, status,
      quantity, refunded_quantity, gross_revenue, discount_amount, refund_amount,
      shipping_revenue, sales_tax, marketplace_fees, currency,
      matched_inventory_sku, match_status, raw_data, updated_at
    ) values (
      external_order_id_value, external_line_id_value, etsy_sku_value, sale_date_value, status_value,
      quantity_value, refunded_quantity_value,
      coalesce(nullif(sale_row->>'gross_revenue', '')::numeric, 0),
      coalesce(nullif(sale_row->>'discount_amount', '')::numeric, 0),
      coalesce(nullif(sale_row->>'refund_amount', '')::numeric, 0),
      coalesce(nullif(sale_row->>'shipping_revenue', '')::numeric, 0),
      coalesce(nullif(sale_row->>'sales_tax', '')::numeric, 0),
      coalesce(nullif(sale_row->>'marketplace_fees', '')::numeric, 0),
      coalesce(nullif(trim(sale_row->>'currency'), ''), 'USD'),
      mapping_inventory_sku,
      case when mapping_inventory_sku is null then 'unmatched' else 'matched' end,
      coalesce(sale_row, '{}'::jsonb),
      timezone('utc', now())
    )
    on conflict (external_order_id, external_line_id) do update set
      etsy_sku = excluded.etsy_sku,
      sale_date = excluded.sale_date,
      status = excluded.status,
      quantity = excluded.quantity,
      refunded_quantity = excluded.refunded_quantity,
      gross_revenue = excluded.gross_revenue,
      discount_amount = excluded.discount_amount,
      refund_amount = excluded.refund_amount,
      shipping_revenue = excluded.shipping_revenue,
      sales_tax = excluded.sales_tax,
      marketplace_fees = excluded.marketplace_fees,
      currency = excluded.currency,
      matched_inventory_sku = coalesce(excluded.matched_inventory_sku, public.etsy_sale_lines.matched_inventory_sku),
      match_status = case when excluded.matched_inventory_sku is null and public.etsy_sale_lines.matched_inventory_sku is null then 'unmatched' else 'matched' end,
      raw_data = excluded.raw_data,
      updated_at = timezone('utc', now())
    returning id, inventory_units_applied, (xmax = 0) into sale_id, previous_units, was_inserted;

    if was_inserted then
      inserted_count := inserted_count + 1;
    else
      updated_count := updated_count + 1;
    end if;

    if mapping_inventory_sku is null then
      update public.etsy_sale_lines
      set match_status = case when matched_inventory_sku is null then 'unmatched' else 'matched' end
      where id = sale_id;
      unmatched_count := unmatched_count + 1;
      continue;
    end if;

    if not apply_inventory then
      continue;
    end if;

    delta_units := desired_units - coalesce(previous_units, 0);
    if delta_units = 0 then
      continue;
    end if;

    if exists (
      select 1 from public.product_etsy_mapping_components c where c.mapping_id = mapping_id
    ) then
      for requirement in
        select expanded.component_sku,
               sum(expanded.quantity * c.inventory_units * abs(delta_units))::integer as quantity
        from public.product_etsy_mapping_components c
        cross join lateral public.expand_inventory_sku(c.inventory_sku, 1) expanded
        where c.mapping_id = mapping_id
        group by expanded.component_sku
      loop
        component_delta := requirement.quantity * case when delta_units > 0 then -1 else 1 end;
        update public.inventory_skus
        set quantity_on_hand = quantity_on_hand + component_delta,
            updated_at = timezone('utc', now())
        where sku = requirement.component_sku
          and lower(coalesce(item_type, 'inventory')) <> 'non-inventory';
        if not found then
          select i.id into component from public.inventory_skus i where i.sku = requirement.component_sku;
          if component.id is null then
            raise exception 'Etsy mapping component SKU % is not linked to canonical inventory.', requirement.component_sku;
          end if;
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
        component_delta := requirement.quantity * case when delta_units > 0 then -1 else 1 end;
        update public.inventory_skus
        set quantity_on_hand = quantity_on_hand + component_delta,
            updated_at = timezone('utc', now())
        where sku = requirement.component_sku
          and lower(coalesce(item_type, 'inventory')) <> 'non-inventory';
        if not found then
          select i.id into component from public.inventory_skus i where i.sku = requirement.component_sku;
          if component.id is null then
            raise exception 'Etsy mapping component SKU % is not linked to canonical inventory.', requirement.component_sku;
          end if;
        end if;
        inventory_updated_count := inventory_updated_count + 1;
      end loop;
    end if;

    update public.etsy_sale_lines
    set inventory_units_applied = desired_units,
        matched_inventory_sku = mapping_inventory_sku,
        match_status = 'matched',
        updated_at = timezone('utc', now())
    where id = sale_id;
  end loop;

  return jsonb_build_object(
    'inserted', inserted_count,
    'updated', updated_count,
    'skipped', skipped_count,
    'unmatched', unmatched_count,
    'inventory_updated', inventory_updated_count
  );
end;
$$;

revoke all on function public.import_etsy_sales(jsonb, boolean) from public, anon, authenticated;
grant execute on function public.import_etsy_sales(jsonb, boolean) to authenticated;
