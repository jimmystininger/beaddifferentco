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
      null::numeric as unit_cost
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
      s.sales_tax, s.matched_inventory_sku, null::numeric as unit_cost
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
