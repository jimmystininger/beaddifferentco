-- Include every saved outside-sales avenue in the canonical accounting report.
-- Aggregate one row per sale first so multi-line sales are not counted more than once.

create or replace function public.admin_manual_sales_accounting_totals(
  p_start timestamptz,
  p_end timestamptz
)
returns table(
  sales_channel text,
  order_count bigint,
  units_sold numeric,
  gross_sales numeric,
  discounts numeric,
  shipping_collected numeric,
  tax_collected numeric,
  cogs numeric
)
language sql
stable
security definer
set search_path = public, private
as $$
  with per_sale as (
    select
      sale.id,
      coalesce(channel.name, sale.sales_channel)::text as channel_name,
      sum(line.quantity)::numeric as sale_units,
      sale.total_revenue,
      sale.discount_amount,
      sale.shipping_collected,
      sale.tax_collected,
      sale.total_cost
    from public.manual_sales sale
    join public.manual_sale_lines line on line.sale_id = sale.id
    left join public.manual_sales_channels channel on channel.id = sale.sales_channel_id
    where private.is_admin()
      and sale.voided_at is null
      and (p_start is null or sale.sold_at >= p_start)
      and (p_end is null or sale.sold_at < p_end)
    group by
      sale.id,
      channel.name,
      sale.sales_channel,
      sale.total_revenue,
      sale.discount_amount,
      sale.shipping_collected,
      sale.tax_collected,
      sale.total_cost
  )
  select
    channel_name,
    count(*)::bigint,
    coalesce(sum(sale_units), 0)::numeric,
    coalesce(sum(total_revenue), 0)::numeric,
    coalesce(sum(discount_amount), 0)::numeric,
    coalesce(sum(shipping_collected), 0)::numeric,
    coalesce(sum(tax_collected), 0)::numeric,
    coalesce(sum(total_cost), 0)::numeric
  from per_sale
  group by channel_name
  order by channel_name;
$$;

revoke all on function public.admin_manual_sales_accounting_totals(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_manual_sales_accounting_totals(timestamptz, timestamptz) to authenticated, service_role;
