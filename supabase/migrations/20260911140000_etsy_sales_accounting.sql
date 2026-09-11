create table if not exists public.etsy_sale_lines (
  id uuid primary key default gen_random_uuid(),
  external_order_id text not null,
  external_line_id text not null,
  etsy_sku text not null,
  sale_date timestamptz not null,
  status text not null default 'paid' check (status in ('paid', 'completed', 'refunded', 'returned', 'cancelled', 'unknown')),
  quantity numeric not null default 0 check (quantity >= 0),
  refunded_quantity numeric not null default 0 check (refunded_quantity >= 0),
  gross_revenue numeric not null default 0,
  discount_amount numeric not null default 0,
  refund_amount numeric not null default 0,
  shipping_revenue numeric not null default 0,
  sales_tax numeric not null default 0,
  marketplace_fees numeric not null default 0,
  currency text not null default 'USD',
  matched_inventory_sku text,
  match_status text not null default 'unmatched' check (match_status in ('matched', 'unmatched')),
  inventory_units_applied numeric not null default 0,
  raw_data jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (external_order_id, external_line_id)
);

create index if not exists etsy_sale_lines_sale_date_idx
  on public.etsy_sale_lines(sale_date desc);

create index if not exists etsy_sale_lines_sku_idx
  on public.etsy_sale_lines(etsy_sku);

create index if not exists etsy_sale_lines_matched_sku_idx
  on public.etsy_sale_lines(matched_inventory_sku);

alter table public.etsy_sale_lines enable row level security;

drop policy if exists etsy_sale_lines_admin_all on public.etsy_sale_lines;
create policy etsy_sale_lines_admin_all on public.etsy_sale_lines
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

revoke all on public.etsy_sale_lines from public, anon, authenticated;
grant select on public.etsy_sale_lines to authenticated;

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
