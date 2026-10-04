create or replace function public.admin_product_catalog_page(
  p_search text default null,
  p_filter text default 'all',
  p_category text default 'all',
  p_visible boolean default true,
  p_sort text default 'name',
  p_page integer default 1,
  p_page_size integer default 25
)
returns table (
  id uuid,
  external_id text,
  sku text,
  category_slug text,
  name text,
  search_text text,
  description text,
  item_details text,
  shipping_details text,
  price numeric,
  promo_price numeric,
  promo_starts_at timestamptz,
  promo_ends_at timestamptz,
  promo_discount_percent numeric,
  promo_skus jsonb,
  quantity numeric,
  visible boolean,
  waitlist_enabled boolean,
  estimated_cost numeric,
  low_stock_threshold numeric,
  badges jsonb,
  added_at timestamptz,
  total_count bigint
)
language plpgsql
stable security definer
set search_path to 'public', 'private'
as $$
declare
  v_page integer := greatest(1, coalesce(p_page, 1));
  v_page_size integer := least(100, greatest(1, coalesce(p_page_size, 25)));
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_filter text := lower(coalesce(p_filter, 'all'));
  v_category text := nullif(lower(btrim(coalesce(p_category, 'all'))), 'all');
  v_sort text := lower(coalesce(p_sort, 'name'));
begin
  if not private.is_admin() then
    return;
  end if;

  return query
  with filtered as (
    select
      p.id, p.external_id,
      coalesce(nullif(btrim(p.sku), ''), option_skus.skus) as sku,
      p.category_slug, p.name, p.search_text,
      p.description, p.item_details, p.shipping_details, p.price,
      p.promo_price, p.promo_starts_at, p.promo_ends_at,
      p.promo_discount_percent, p.promo_skus, p.quantity::numeric as quantity,
      p.visible, p.waitlist_enabled, p.estimated_cost,
      p.low_stock_threshold::numeric as low_stock_threshold, p.badges,
      p.added_at, count(*) over () as total_count
    from public.products p
    left join lateral (
      select string_agg(option_sku, ', ' order by option_sku) as skus
      from (
        select distinct coalesce(
          nullif(btrim(value_record.sku), ''),
          nullif(btrim(value_record.inventory_sku), ''),
          nullif(btrim(inventory_record.sku), '')
        ) as option_sku
        from public.product_options option_record
        join public.product_option_values value_record
          on value_record.option_id = option_record.id
        left join public.inventory_skus inventory_record
          on inventory_record.id = value_record.inventory_sku_id
        where option_record.product_id = p.id
      ) option_values
      where option_sku is not null
    ) option_skus on true
    where p.visible = coalesce(p_visible, true)
      and (v_category is null or lower(coalesce(p.category_slug, 'uncategorized')) = v_category)
      and (
        v_search is null
        or concat_ws(' ', p.name, p.external_id, p.sku, option_skus.skus,
          p.category_slug, p.search_text, p.description, p.item_details,
          p.shipping_details) ilike '%' || v_search || '%'
        or exists (
          select 1
          from public.product_options option_record
          join public.product_option_values value_record
            on value_record.option_id = option_record.id
          left join public.inventory_skus inventory_record
            on inventory_record.id = value_record.inventory_sku_id
          where option_record.product_id = p.id
            and concat_ws(' ', value_record.label, value_record.sku,
              value_record.inventory_sku, inventory_record.sku,
              inventory_record.name) ilike '%' || v_search || '%'
        )
      )
      and (
        v_filter = 'all'
        or (v_filter = 'promo'
          and p.promo_price is not null
          and (p.promo_starts_at is null or p.promo_starts_at <= now())
          and (p.promo_ends_at is null or p.promo_ends_at >= now()))
        or (v_filter = 'clearance'
          and (lower(coalesce(p.category_slug, '')) like '%clearance%'
            or coalesce(p.badges, '[]'::jsonb) @> '["Clearance"]'::jsonb))
        or (v_filter = 'out-of-stock' and coalesce(p.quantity, 0) <= 0)
        or (v_filter = 'low-stock'
          and coalesce(p.quantity, 0) > 0
          and coalesce(p.low_stock_threshold, 0) > 0
          and p.quantity <= p.low_stock_threshold)
        or (v_filter = 'in-stock'
          and coalesce(p.quantity, 0) > 0
          and (coalesce(p.low_stock_threshold, 0) = 0 or p.quantity > p.low_stock_threshold))
      )
  )
  select f.id, f.external_id, f.sku, f.category_slug, f.name, f.search_text,
    f.description, f.item_details, f.shipping_details, f.price, f.promo_price,
    f.promo_starts_at, f.promo_ends_at, f.promo_discount_percent, f.promo_skus,
    f.quantity, f.visible, f.waitlist_enabled, f.estimated_cost,
    f.low_stock_threshold, f.badges, f.added_at, f.total_count
  from filtered f
  order by
    case when v_sort = 'category' then lower(coalesce(f.category_slug, 'uncategorized')) end asc nulls last,
    case when v_sort = 'sku' then lower(coalesce(f.sku, '')) end asc nulls last,
    case when v_sort = 'price' then f.price end asc nulls last,
    case when v_sort = 'quantity' then f.quantity end asc nulls last,
    case when v_sort = 'updated' then f.added_at end desc nulls last,
    case when v_sort not in ('category', 'sku', 'price', 'quantity', 'updated')
      then lower(coalesce(f.name, f.external_id, f.sku, '')) end asc nulls last,
    f.id
  limit v_page_size offset (v_page - 1) * v_page_size;
end;
$$;

