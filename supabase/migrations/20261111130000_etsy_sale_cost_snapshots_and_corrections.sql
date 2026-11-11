alter table public.etsy_sale_lines
  add column if not exists unit_cost_at_sale numeric check (unit_cost_at_sale is null or unit_cost_at_sale >= 0),
  add column if not exists unit_cost_source text not null default 'missing' check (unit_cost_source in ('snapshot', 'backfill', 'missing', 'manual')),
  add column if not exists unit_cost_corrected_at timestamptz,
  add column if not exists unit_cost_corrected_by uuid references auth.users(id);

-- Freeze the existing report's best available cost estimate for historical lines.
-- Lines with no cost remain explicitly missing instead of inheriting future purchase costs.
update public.etsy_sale_lines line
set unit_cost_at_sale = inventory.cost,
    unit_cost_source = 'backfill'
from public.inventory_skus inventory
where line.unit_cost_at_sale is null
  and lower(trim(coalesce(nullif(line.matched_inventory_sku, ''), nullif(line.etsy_sku, ''), ''))) = lower(trim(inventory.sku))
  and inventory.cost is not null;

create or replace function public.capture_etsy_sale_unit_cost()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.unit_cost_at_sale is null then
    select inventory.cost
      into new.unit_cost_at_sale
    from public.inventory_skus inventory
    where lower(trim(inventory.sku)) = lower(trim(coalesce(nullif(new.matched_inventory_sku, ''), nullif(new.etsy_sku, ''), '')))
    limit 1;
    new.unit_cost_source := case when new.unit_cost_at_sale is null then 'missing' else 'snapshot' end;
  end if;
  return new;
end;
$$;

drop trigger if exists etsy_sale_lines_capture_unit_cost on public.etsy_sale_lines;
create trigger etsy_sale_lines_capture_unit_cost
before insert on public.etsy_sale_lines
for each row execute function public.capture_etsy_sale_unit_cost();

create index if not exists etsy_sale_lines_missing_cost_lookup_idx
  on public.etsy_sale_lines (matched_inventory_sku, sale_date desc)
  where unit_cost_source in ('missing', 'backfill');

create or replace function public.admin_set_etsy_sale_unit_cost(
  p_sale_line_id uuid,
  p_unit_cost numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  updated_line public.etsy_sale_lines%rowtype;
begin
  if not private.is_admin() then
    raise exception 'Admin access required.';
  end if;
  if p_unit_cost is null or p_unit_cost < 0 then
    raise exception 'Enter a per-unit cost of zero or greater.';
  end if;

  update public.etsy_sale_lines line
  set unit_cost_at_sale = p_unit_cost,
      unit_cost_source = 'manual',
      unit_cost_corrected_at = timezone('utc', now()),
      unit_cost_corrected_by = auth.uid()
  where line.id = p_sale_line_id
    and line.unit_cost_source in ('missing', 'backfill')
  returning line.* into updated_line;

  if not found then
    raise exception 'This sale line is unavailable or its cost was already saved.';
  end if;

  return jsonb_build_object(
    'id', updated_line.id,
    'unit_cost_at_sale', updated_line.unit_cost_at_sale,
    'unit_cost_source', updated_line.unit_cost_source
  );
end;
$$;

revoke all on function public.admin_set_etsy_sale_unit_cost(uuid, numeric) from public, anon;
grant execute on function public.admin_set_etsy_sale_unit_cost(uuid, numeric) to authenticated;
-- Keep Metrics server-aggregated without dropping the canonical Etsy ledger.
-- Current imports live in etsy_sale_lines; older staged imports remain in
-- etsy_import_sales. Prefer the canonical row when the same order/line exists.
create or replace function public.admin_etsy_sku_metrics(
  p_start timestamptz default null,
  p_end timestamptz default null
)
returns table(
  sku text,
  units_sold numeric,
  gross_revenue numeric,
  discounts numeric,
  refunds numeric,
  etsy_fees numeric,
  total_cost numeric,
  net_revenue numeric,
  net_profit numeric
)
language sql
stable
security definer
set search_path = public, private
as $$
  with source_rows as (
    select
      s.external_order_id, s.external_line_id, s.etsy_sku, s.sale_date,
      s.quantity, s.refunded_quantity, s.gross_revenue, s.discount_amount,
      s.refund_amount, s.marketplace_fees, s.matched_inventory_sku,
      coalesce(s.unit_cost_at_sale, 0)::numeric as unit_cost
    from public.etsy_sale_lines s
    where (p_start is null or s.sale_date >= p_start)
      and (p_end is null or s.sale_date < p_end)
    union all
    select
      s.external_order_id, s.external_line_id, s.etsy_sku, s.sale_date,
      s.quantity, 0::numeric, s.gross_revenue, s.discount_amount,
      s.refund_amount, s.marketplace_fees, s.matched_inventory_sku,
      s.unit_cost
    from public.etsy_import_sales s
    where (p_start is null or s.sale_date >= p_start)
      and (p_end is null or s.sale_date < p_end)
      and not exists (
        select 1
        from public.etsy_sale_lines current_row
        where current_row.external_order_id = s.external_order_id
          and current_row.external_line_id = s.external_line_id
      )
  ), resolved as (
    select source_rows.*,
      coalesce(nullif(trim(source_rows.matched_inventory_sku), ''), nullif(trim(source_rows.etsy_sku), ''), 'Unassigned SKU') as resolved_sku,
      coalesce(source_rows.unit_cost, inventory.cost, 0) as resolved_unit_cost
    from source_rows
    left join public.inventory_skus inventory
      on lower(inventory.sku) = lower(coalesce(nullif(trim(source_rows.matched_inventory_sku), ''), nullif(trim(source_rows.etsy_sku), '')))
  )
  select
    resolved_sku,
    coalesce(sum(quantity), 0),
    coalesce(sum(gross_revenue), 0),
    coalesce(sum(discount_amount), 0),
    coalesce(sum(refund_amount), 0),
    coalesce(sum(marketplace_fees), 0),
    coalesce(sum(quantity * resolved_unit_cost), 0),
    coalesce(sum(gross_revenue - discount_amount - refund_amount), 0),
    coalesce(sum(gross_revenue - discount_amount - refund_amount - marketplace_fees - (quantity * resolved_unit_cost)), 0)
  from resolved
  where private.is_admin()
  group by resolved_sku
  order by resolved_sku;
$$;

create or replace function public.admin_etsy_accounting_totals(
  p_start timestamptz default null,
  p_end timestamptz default null
)
returns table(
  order_count bigint,
  units_sold numeric,
  returned_units numeric,
  gross_sales numeric,
  discounts numeric,
  refunds numeric,
  shipping_collected numeric,
  marketplace_fees numeric,
  tax_collected numeric,
  cogs numeric
)
language sql
stable
security definer
set search_path = public, private
as $$
  with source_rows as (
    select
      s.external_order_id, s.external_line_id, s.sale_date, s.quantity,
      s.refunded_quantity, s.gross_revenue, s.discount_amount,
      s.refund_amount, s.shipping_revenue, s.marketplace_fees,
      s.sales_tax, s.matched_inventory_sku, coalesce(s.unit_cost_at_sale, 0)::numeric as unit_cost
    from public.etsy_sale_lines s
    where (p_start is null or s.sale_date >= p_start)
      and (p_end is null or s.sale_date < p_end)
    union all
    select
      s.external_order_id, s.external_line_id, s.sale_date, s.quantity,
      0::numeric, s.gross_revenue, s.discount_amount, s.refund_amount,
      s.shipping_revenue, s.marketplace_fees, s.sales_tax,
      s.matched_inventory_sku, s.unit_cost
    from public.etsy_import_sales s
    where (p_start is null or s.sale_date >= p_start)
      and (p_end is null or s.sale_date < p_end)
      and not exists (
        select 1
        from public.etsy_sale_lines current_row
        where current_row.external_order_id = s.external_order_id
          and current_row.external_line_id = s.external_line_id
      )
  ), resolved as (
    select source_rows.*,
      coalesce(source_rows.unit_cost, inventory.cost, 0) as resolved_unit_cost
    from source_rows
    left join public.inventory_skus inventory
      on lower(inventory.sku) = lower(coalesce(nullif(trim(source_rows.matched_inventory_sku), ''), null))
  )
  select
    count(distinct external_order_id) filter (where quantity > 0 or gross_revenue <> 0),
    coalesce(sum(quantity), 0),
    coalesce(sum(least(quantity, greatest(refunded_quantity, 0))), 0),
    coalesce(sum(gross_revenue), 0),
    coalesce(sum(discount_amount), 0),
    coalesce(sum(refund_amount), 0),
    coalesce(sum(shipping_revenue), 0),
    coalesce(sum(marketplace_fees), 0),
    coalesce(sum(sales_tax), 0),
    coalesce(sum(quantity * resolved_unit_cost), 0)
  from resolved
  where private.is_admin();
$$;

revoke all on function public.admin_etsy_sku_metrics(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_etsy_sku_metrics(timestamptz, timestamptz) to authenticated, service_role;
revoke all on function public.admin_etsy_accounting_totals(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_etsy_accounting_totals(timestamptz, timestamptz) to authenticated, service_role;

-- Keep the child-SKU sales report on each sale's captured cost instead of current inventory cost.
drop function if exists public.admin_etsy_inventory_sales_metrics();
create function public.admin_etsy_inventory_sales_metrics()
returns table(
  etsy_sku text,
  sale_date date,
  status text,
  quantity numeric,
  refunded_quantity numeric,
  gross_revenue numeric,
  matched_inventory_sku text,
  match_status text,
  inventory_units_applied numeric,
  total_cost numeric,
  line_count bigint
)
language sql
security definer
set search_path = public, private
as $$
  with canonical as (
    select
      line.external_order_id,
      line.external_line_id,
      line.etsy_sku,
      line.sale_date,
      line.status,
      line.quantity,
      line.refunded_quantity,
      line.gross_revenue,
      line.matched_inventory_sku,
      line.match_status,
      line.inventory_units_applied,
      line.quantity * coalesce(line.unit_cost_at_sale, 0) as total_cost
    from public.etsy_sale_lines line
  ),
  legacy as (
    select
      line.external_order_id,
      line.external_line_id,
      line.etsy_sku,
      line.sale_date,
      'paid'::text as status,
      line.quantity,
      0::numeric as refunded_quantity,
      line.gross_revenue,
      line.matched_inventory_sku,
      line.match_status,
      0::numeric as inventory_units_applied,
      line.quantity * coalesce(line.unit_cost, 0) as total_cost
    from public.etsy_import_sales line
    where not exists (
      select 1 from public.etsy_sale_lines current_line
      where current_line.external_order_id = line.external_order_id
        and current_line.external_line_id = line.external_line_id
    )
  ),
  source_rows as (
    select * from canonical
    union all
    select * from legacy
  )
  select
    row.etsy_sku,
    date_trunc('day', row.sale_date)::date,
    row.status,
    coalesce(sum(row.quantity), 0),
    coalesce(sum(row.refunded_quantity), 0),
    coalesce(sum(row.gross_revenue), 0),
    row.matched_inventory_sku,
    row.match_status,
    coalesce(sum(row.inventory_units_applied), 0),
    coalesce(sum(row.total_cost), 0),
    count(*)::bigint
  from source_rows row
  where private.is_admin()
    and row.sale_date is not null
  group by row.etsy_sku, date_trunc('day', row.sale_date)::date, row.status,
    row.matched_inventory_sku, row.match_status;
$$;

revoke all on function public.admin_etsy_inventory_sales_metrics() from public, anon;
grant execute on function public.admin_etsy_inventory_sales_metrics() to authenticated, service_role;
