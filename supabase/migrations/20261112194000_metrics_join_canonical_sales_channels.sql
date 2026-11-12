-- Metrics should resolve the current avenue name from the canonical relationship.

create or replace function public.admin_manual_sales_metrics()
returns table(
  sale_date timestamptz,
  product_name text,
  sku text,
  quantity numeric,
  gross_revenue numeric,
  discount_amount numeric,
  cost_total numeric,
  cost_breakdown jsonb,
  sales_channel text
)
language sql
stable
security definer
set search_path = public, private
as $$
  select sale.sold_at,
    line.product_name,
    line.sku,
    line.quantity::numeric,
    line.revenue_amount,
    case when sale.total_revenue > 0 then sale.discount_amount * line.revenue_amount / sale.total_revenue else 0 end,
    line.cost_total,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'sku', component.sku,
        'quantity', component.quantity,
        'unit_cost', component.unit_cost_at_sale
      ) order by component.sku)
      from public.manual_sale_line_components component
      where component.sale_line_id = line.id
    ), '[]'::jsonb),
    coalesce(channel.name, sale.sales_channel)
  from public.manual_sales sale
  join public.manual_sale_lines line on line.sale_id = sale.id
  left join public.manual_sales_channels channel on channel.id = sale.sales_channel_id
  where private.is_admin() and sale.voided_at is null
  order by sale.sold_at desc, line.line_number;
$$;

revoke all on function public.admin_manual_sales_metrics() from public, anon;
grant execute on function public.admin_manual_sales_metrics() to authenticated, service_role;

create or replace function public.admin_manual_sales_history()
returns table(
  sale_id uuid, sold_at timestamptz, sales_channel text, customer_reference text,
  notes text, total_revenue numeric, discount_amount numeric,
  shipping_collected numeric, tax_collected numeric, other_fees numeric,
  total_charged numeric, total_cost numeric, voided_at timestamptz,
  line_summary text, customer_name text, customer_phone text, customer_address text
)
language sql
stable
security definer
set search_path = public, private
as $$
  select sale.id, sale.sold_at, coalesce(channel.name, sale.sales_channel), sale.customer_reference,
    sale.notes, sale.total_revenue, sale.discount_amount, sale.shipping_collected,
    sale.tax_collected, sale.other_fees, sale.total_charged, sale.total_cost,
    sale.voided_at,
    string_agg(line.quantity::text || ' × ' || line.sku, ', ' order by line.line_number),
    sale.customer_name, sale.customer_phone, sale.customer_address
  from public.manual_sales sale
  join public.manual_sale_lines line on line.sale_id = sale.id
  left join public.manual_sales_channels channel on channel.id = sale.sales_channel_id
  where private.is_admin()
  group by sale.id, channel.name
  order by sale.sold_at desc
  limit 50;
$$;

revoke all on function public.admin_manual_sales_history() from public, anon;
grant execute on function public.admin_manual_sales_history() to authenticated, service_role;
