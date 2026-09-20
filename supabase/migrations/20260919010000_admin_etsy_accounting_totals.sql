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
  select
    count(distinct s.external_order_id) filter (where s.quantity > 0 or s.gross_revenue <> 0),
    coalesce(sum(s.quantity), 0),
    0::numeric,
    coalesce(sum(s.gross_revenue), 0),
    coalesce(sum(s.discount_amount), 0),
    coalesce(sum(s.refund_amount), 0),
    coalesce(sum(s.shipping_revenue), 0),
    coalesce(sum(s.marketplace_fees), 0),
    coalesce(sum(s.sales_tax), 0),
    coalesce(sum(s.quantity * coalesce(s.unit_cost, 0)), 0)
  from public.etsy_import_sales s
  where private.is_admin()
    and (p_start is null or s.sale_date >= p_start)
    and (p_end is null or s.sale_date < p_end);
$$;

revoke all on function public.admin_etsy_accounting_totals(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_etsy_accounting_totals(timestamptz, timestamptz) to authenticated, service_role;
