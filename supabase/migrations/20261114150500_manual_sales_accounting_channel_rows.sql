-- Keep every saved outside-sales avenue visible in accounting, including zero rows.

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
  ),
  channel_totals as (
    select
      channel_name,
      count(*)::bigint as order_count,
      coalesce(sum(sale_units), 0)::numeric as units_sold,
      coalesce(sum(total_revenue), 0)::numeric as gross_sales,
      coalesce(sum(discount_amount), 0)::numeric as discounts,
      coalesce(sum(shipping_collected), 0)::numeric as shipping_collected,
      coalesce(sum(tax_collected), 0)::numeric as tax_collected,
      coalesce(sum(total_cost), 0)::numeric as cogs
    from per_sale
    group by channel_name
  ),
  all_channels as (
    select channel.name as channel_name
    from public.manual_sales_channels channel
    union
    select channel_name
    from per_sale
  )
  select
    all_channels.channel_name,
    coalesce(channel_totals.order_count, 0)::bigint,
    coalesce(channel_totals.units_sold, 0)::numeric,
    coalesce(channel_totals.gross_sales, 0)::numeric,
    coalesce(channel_totals.discounts, 0)::numeric,
    coalesce(channel_totals.shipping_collected, 0)::numeric,
    coalesce(channel_totals.tax_collected, 0)::numeric,
    coalesce(channel_totals.cogs, 0)::numeric
  from all_channels
  left join channel_totals on channel_totals.channel_name = all_channels.channel_name
  order by all_channels.channel_name;
$$;

revoke all on function public.admin_manual_sales_accounting_totals(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_manual_sales_accounting_totals(timestamptz, timestamptz) to authenticated, service_role;
