create or replace function public.admin_analytics_event_metrics(
  p_start timestamptz default null,
  p_end timestamptz default null
)
returns table(
  event_type text,
  product_id uuid,
  inventory_sku_id uuid,
  search_term text,
  event_count bigint,
  latest_created_at timestamptz
)
language sql
security definer
set search_path = public, private
as $$
  select
    e.event_type,
    e.product_id,
    e.inventory_sku_id,
    e.search_term,
    count(*)::bigint as event_count,
    max(e.created_at) as latest_created_at
  from public.analytics_events e
  where private.is_admin()
    and (p_start is null or e.created_at >= p_start)
    and (p_end is null or e.created_at < p_end)
  group by e.event_type, e.product_id, e.inventory_sku_id, e.search_term;
$$;

revoke all on function public.admin_analytics_event_metrics(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_analytics_event_metrics(timestamptz, timestamptz) to authenticated, service_role;

create or replace function public.admin_etsy_inventory_sales_metrics()
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
  line_count bigint
)
language sql
security definer
set search_path = public, private
as $$
  with canonical as (
    select
      l.external_order_id,
      l.external_line_id,
      l.etsy_sku,
      l.sale_date,
      l.status,
      l.quantity,
      l.refunded_quantity,
      l.gross_revenue,
      l.matched_inventory_sku,
      l.match_status,
      l.inventory_units_applied
    from public.etsy_sale_lines l
  ),
  legacy as (
    select
      l.external_order_id,
      l.external_line_id,
      l.etsy_sku,
      l.sale_date,
      'paid'::text as status,
      l.quantity,
      0::numeric as refunded_quantity,
      l.gross_revenue,
      l.matched_inventory_sku,
      l.match_status,
      0::numeric as inventory_units_applied
    from public.etsy_import_sales l
    where not exists (
      select 1
      from public.etsy_sale_lines c
      where c.external_order_id = l.external_order_id
        and c.external_line_id = l.external_line_id
    )
  ),
  source_rows as (
    select * from canonical
    union all
    select * from legacy
  )
  select
    s.etsy_sku,
    date_trunc('day', s.sale_date)::date as sale_date,
    s.status,
    coalesce(sum(s.quantity), 0) as quantity,
    coalesce(sum(s.refunded_quantity), 0) as refunded_quantity,
    coalesce(sum(s.gross_revenue), 0) as gross_revenue,
    s.matched_inventory_sku,
    s.match_status,
    coalesce(sum(s.inventory_units_applied), 0) as inventory_units_applied,
    count(*)::bigint as line_count
  from source_rows s
  where private.is_admin()
    and s.sale_date is not null
  group by s.etsy_sku, date_trunc('day', s.sale_date)::date, s.status, s.matched_inventory_sku, s.match_status;
$$;

revoke all on function public.admin_etsy_inventory_sales_metrics() from public, anon;
grant execute on function public.admin_etsy_inventory_sales_metrics() to authenticated, service_role;

create or replace function public.admin_website_accounting_totals(
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
  tax_collected numeric,
  cogs numeric,
  promo_units numeric
)
language sql
security definer
set search_path = public, private
as $$
  with eligible_orders as (
    select o.id, o.status, o.discount, o.shipping_amount, o.tax_amount
    from public.orders o
    where private.is_admin()
      and (p_start is null or o.created_at >= p_start)
      and (p_end is null or o.created_at < p_end)
      and lower(coalesce(o.status, '')) in ('paid', 'processing', 'shipped', 'completed', 'cancelled', 'refunded')
  ),
  item_totals as (
    select
      o.id,
      o.status,
      o.discount,
      o.shipping_amount,
      o.tax_amount,
      coalesce(sum(coalesce(i.quantity, 0)), 0) as units,
      coalesce(sum(coalesce(i.unit_price, 0) * coalesce(i.quantity, 0)), 0) as line_gross,
      coalesce(sum(case when i.promo_applied then coalesce(i.quantity, 0) else 0 end), 0) as promo_units,
      coalesce(sum(
        case when i.cost_at_purchase is null then coalesce(s.cost, 0) else i.cost_at_purchase end
        * coalesce(i.quantity, 0)
      ), 0) as line_cogs
    from eligible_orders o
    left join public.order_items i on i.order_id = o.id
    left join public.inventory_skus s on lower(trim(s.sku)) = lower(trim(i.sku))
    group by o.id, o.status, o.discount, o.shipping_amount, o.tax_amount
  )
  select
    count(*) filter (where lower(status) in ('paid', 'processing', 'shipped', 'completed'))::bigint,
    coalesce(sum(case when lower(status) in ('paid', 'processing', 'shipped', 'completed') then units else 0 end), 0),
    coalesce(sum(case when lower(status) in ('cancelled', 'refunded') then units else 0 end), 0),
    coalesce(sum(case when lower(status) in ('paid', 'processing', 'shipped', 'completed') then line_gross else 0 end), 0),
    coalesce(sum(case when lower(status) in ('paid', 'processing', 'shipped', 'completed') then discount else 0 end), 0),
    coalesce(sum(case when lower(status) in ('cancelled', 'refunded') then line_gross else 0 end), 0),
    coalesce(sum(case when lower(status) in ('paid', 'processing', 'shipped', 'completed') then shipping_amount else 0 end), 0),
    coalesce(sum(tax_amount), 0),
    coalesce(sum(case when lower(status) in ('paid', 'processing', 'shipped', 'completed') then line_cogs else -line_cogs end), 0),
    coalesce(sum(case when lower(status) in ('paid', 'processing', 'shipped', 'completed') then promo_units else 0 end), 0)
  from item_totals;
$$;

revoke all on function public.admin_website_accounting_totals(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_website_accounting_totals(timestamptz, timestamptz) to authenticated, service_role;

create or replace function public.admin_website_inventory_sales_metrics()
returns table(
  sale_date date,
  product_id uuid,
  product_name text,
  sku text,
  quantity numeric,
  gross_revenue numeric
)
language sql
security definer
set search_path = public, private
as $$
  select
    date_trunc('day', o.created_at)::date as sale_date,
    i.product_id,
    i.product_name,
    coalesce(
      nullif(trim(i.sku), ''),
      nullif(trim(i.selected_options->>'sku'), ''),
      nullif(trim(i.selected_options->>'inventorySku'), ''),
      nullif(trim(i.selected_options->>'variantSku'), ''),
      'Unassigned SKU'
    ) as sku,
    coalesce(sum(i.quantity), 0) as quantity,
    coalesce(sum(i.unit_price * i.quantity), 0) as gross_revenue
  from public.orders o
  join public.order_items i on i.order_id = o.id
  where private.is_admin()
  group by date_trunc('day', o.created_at)::date, i.product_id, i.product_name,
    coalesce(
      nullif(trim(i.sku), ''),
      nullif(trim(i.selected_options->>'sku'), ''),
      nullif(trim(i.selected_options->>'inventorySku'), ''),
      nullif(trim(i.selected_options->>'variantSku'), ''),
      'Unassigned SKU'
    );
$$;

revoke all on function public.admin_website_inventory_sales_metrics() from public, anon;
grant execute on function public.admin_website_inventory_sales_metrics() to authenticated, service_role;
