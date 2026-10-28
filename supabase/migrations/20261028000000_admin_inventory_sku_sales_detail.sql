create or replace function public.admin_inventory_sku_sales_detail(p_sku text)
returns table(
  source text,
  source_order_id text,
  reference text,
  sold_at timestamptz,
  status text,
  product_name text,
  sku text,
  quantity numeric,
  revenue numeric
)
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  requested_sku text := lower(trim(coalesce(p_sku, '')));
begin
  if not private.is_admin() then
    raise exception 'Admin access required.';
  end if;
  if requested_sku = '' then
    raise exception 'Enter a canonical SKU.';
  end if;

  return query
  with website_rows as (
    select
      'Website'::text as source,
      order_row.id::text as source_order_id,
      case when order_row.order_number is not null
        then 'BD-' || lpad(order_row.order_number::text, 6, '0')
        else left(order_row.id::text, 8)
      end as reference,
      order_row.created_at as sold_at,
      order_row.status::text as status,
      item.product_name::text as product_name,
      coalesce(nullif(trim(item.inventory_sku), ''), nullif(trim(item.sku), ''),
        nullif(trim(item.selected_options->>'sku'), ''),
        nullif(trim(item.selected_options->>'inventorySku'), ''),
        nullif(trim(item.selected_options->>'variantSku'), '')) as sku,
      greatest(0, coalesce(item.quantity, 0) - coalesce(item.refunded_quantity, 0))::numeric as quantity,
      greatest(0, coalesce(item.unit_price, 0) * greatest(0, coalesce(item.quantity, 0) - coalesce(item.refunded_quantity, 0)))::numeric as revenue
    from public.orders order_row
    join public.order_items item on item.order_id = order_row.id
    where lower(coalesce(order_row.status, '')) not in ('cancelled', 'returned', 'refunded', 'voided', 'failed', 'pending', 'draft')
      and lower(trim(coalesce(nullif(item.inventory_sku, ''), nullif(item.sku, ''),
        nullif(item.selected_options->>'sku', ''),
        nullif(item.selected_options->>'inventorySku', ''),
        nullif(item.selected_options->>'variantSku', ''), ''))) = requested_sku
  ),
  etsy_source_rows as (
    select
      line.external_order_id,
      line.sale_date,
      line.status,
      line.etsy_sku,
      line.matched_inventory_sku,
      line.quantity,
      line.refunded_quantity,
      line.gross_revenue
    from public.etsy_sale_lines line
    where lower(coalesce(line.status, '')) not in ('cancelled', 'refunded', 'returned')
      and lower(trim(coalesce(nullif(line.matched_inventory_sku, ''), nullif(line.etsy_sku, ''), ''))) = requested_sku
    union all
    select
      legacy.external_order_id,
      legacy.sale_date,
      'paid'::text,
      legacy.etsy_sku,
      legacy.matched_inventory_sku,
      legacy.quantity,
      0::numeric,
      legacy.gross_revenue
    from public.etsy_import_sales legacy
    where lower(trim(coalesce(nullif(legacy.matched_inventory_sku, ''), nullif(legacy.etsy_sku, ''), ''))) = requested_sku
      and not exists (
        select 1 from public.etsy_sale_lines current_line
        where current_line.external_order_id = legacy.external_order_id
          and current_line.external_line_id = legacy.external_line_id
      )
  ),
  etsy_rows as (
    select
      'Etsy'::text as source,
      external_order_id as source_order_id,
      external_order_id as reference,
      sale_date as sold_at,
      status::text as status,
      max(coalesce(nullif(matched_inventory_sku, ''), etsy_sku))::text as product_name,
      coalesce(nullif(max(matched_inventory_sku), ''), max(etsy_sku))::text as sku,
      sum(greatest(0, coalesce(quantity, 0) - coalesce(refunded_quantity, 0)))::numeric as quantity,
      sum(case when coalesce(quantity, 0) > 0 then greatest(0, coalesce(gross_revenue, 0)) * greatest(0, coalesce(quantity, 0) - coalesce(refunded_quantity, 0)) / quantity else 0 end)::numeric as revenue
    from etsy_source_rows
    group by external_order_id, sale_date, status
  ),
  outside_rows as (
    select
      'Outside sale'::text as source,
      sale.id::text as source_order_id,
      coalesce(nullif(trim(sale.customer_reference), ''), initcap(sale.sales_channel))::text as reference,
      sale.sold_at,
      'Recorded'::text as status,
      max(line.product_name)::text as product_name,
      max(line.sku)::text as sku,
      sum(line.quantity)::numeric as quantity,
      sum(line.revenue_amount)::numeric as revenue
    from public.manual_sales sale
    join public.manual_sale_lines line on line.sale_id = sale.id
    where sale.voided_at is null
      and lower(trim(line.sku)) = requested_sku
    group by sale.id, sale.customer_reference, sale.sales_channel, sale.sold_at
  ),
  all_rows as (
    select * from website_rows
    union all
    select * from etsy_rows
    union all
    select * from outside_rows
  )
  select all_rows.source, all_rows.source_order_id, all_rows.reference,
    all_rows.sold_at, all_rows.status, all_rows.product_name,
    all_rows.sku, all_rows.quantity, all_rows.revenue
  from all_rows
  order by all_rows.sold_at desc nulls last, all_rows.source, all_rows.reference;
end;
$$;

revoke all on function public.admin_inventory_sku_sales_detail(text) from public, anon;
grant execute on function public.admin_inventory_sku_sales_detail(text) to authenticated, service_role;
