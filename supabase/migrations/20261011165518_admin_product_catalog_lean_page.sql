drop function if exists public.admin_product_catalog_page(text, text, text, boolean, text, integer, integer);

create function public.admin_product_catalog_page(
  p_search text default null,
  p_filter text default 'all',
  p_category text default 'all',
  p_visible boolean default true,
  p_sort text default 'name',
  p_page integer default 1,
  p_page_size integer default 10
)
returns table (
  id uuid,
  external_id text,
  sku text,
  name text,
  price numeric,
  quantity numeric,
  visible boolean,
  lead_image_url text,
  total_count bigint
)
language plpgsql
stable security definer
set search_path to 'public', 'private'
as $$
declare
  v_page integer := greatest(1, coalesce(p_page, 1));
  v_page_size integer := least(10, greatest(1, coalesce(p_page_size, 10)));
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_filter text := lower(coalesce(p_filter, 'all'));
  v_category text := nullif(lower(btrim(coalesce(p_category, 'all'))), 'all');
  v_sort text := lower(coalesce(p_sort, 'name'));
begin
  if not private.is_admin() then
    return;
  end if;

  return query
  with filtered as materialized (
    select
      p.id,
      p.external_id,
      p.sku as product_sku,
      p.name,
      p.category_slug,
      p.price as product_price,
      p.quantity::numeric as quantity,
      p.visible,
      p.added_at,
      p.promo_price,
      p.promo_starts_at,
      p.promo_ends_at,
      p.low_stock_threshold,
      p.badges,
      count(*) over () as total_count
    from public.products p
    where p.visible = coalesce(p_visible, true)
      and (v_category is null or lower(coalesce(p.category_slug, 'uncategorized')) = v_category)
      and (
        v_search is null
        or concat_ws(' ', p.name, p.external_id, p.sku, p.category_slug,
          p.search_text, p.description, p.item_details, p.shipping_details)
          ilike '%' || v_search || '%'
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
          and (coalesce(p.low_stock_threshold, 0) = 0
            or p.quantity > p.low_stock_threshold))
      )
  ),
  sorted_rows as materialized (
    select
      f.*,
      case when v_sort = 'sku' then coalesce((
        select string_agg(option_sku, ', ' order by option_sku)
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
          where option_record.product_id = f.id
        ) option_values
        where option_sku is not null
      ), nullif(btrim(f.product_sku), '')) end as sort_sku
    from filtered f
  ),
  page_rows as materialized (
    select f.*
    from sorted_rows f
    order by
      case when v_sort = 'category' then lower(coalesce(f.category_slug, 'uncategorized')) end asc nulls last,
      case when v_sort = 'sku' then lower(coalesce(f.sort_sku, '')) end asc nulls last,
      case when v_sort = 'price' then f.product_price end asc nulls last,
      case when v_sort = 'quantity' then f.quantity end asc nulls last,
      case when v_sort = 'updated' then f.added_at end desc nulls last,
      case when v_sort not in ('category', 'sku', 'price', 'quantity', 'updated')
        then lower(coalesce(f.name, f.external_id, f.product_sku, '')) end asc nulls last,
      f.id
    limit v_page_size offset (v_page - 1) * v_page_size
  )
  select
    f.id,
    f.external_id,
    coalesce(page_options.skus, nullif(btrim(f.product_sku), '')) as sku,
    f.name,
    coalesce(page_options.inventory_price, f.product_price) as price,
    f.quantity,
    f.visible,
    lead_image.url as lead_image_url,
    f.total_count
  from page_rows f
  left join lateral (
    select
      string_agg(
        distinct coalesce(
          nullif(btrim(value_record.sku), ''),
          nullif(btrim(value_record.inventory_sku), '')
        ),
        ', '
        order by coalesce(
          nullif(btrim(value_record.sku), ''),
          nullif(btrim(value_record.inventory_sku), '')
        )
      ) as skus,
      min(inventory_record.price) as inventory_price
    from public.product_options option_record
    join public.product_option_values value_record
      on value_record.option_id = option_record.id
    left join lateral (
      select distinct nullif(btrim(candidate.sku), '') as sku
      from unnest(array[value_record.sku, value_record.inventory_sku]) as candidate(sku)
      where nullif(btrim(candidate.sku), '') is not null
    ) price_skus on true
    left join public.inventory_skus inventory_record
      on inventory_record.sku = price_skus.sku
    where option_record.product_id = f.id
  ) page_options on true
  left join lateral (
    select image_record.url
    from public.product_images image_record
    where image_record.product_id = f.id
      and image_record.media_type is distinct from 'video'
    order by image_record.sort_order, image_record.id
    limit 1
  ) lead_image on true
  order by
    case when v_sort = 'category' then lower(coalesce(f.category_slug, 'uncategorized')) end asc nulls last,
    case when v_sort = 'sku' then lower(coalesce(f.sort_sku, '')) end asc nulls last,
    case when v_sort = 'price' then f.product_price end asc nulls last,
    case when v_sort = 'quantity' then f.quantity end asc nulls last,
    case when v_sort = 'updated' then f.added_at end desc nulls last,
    case when v_sort not in ('category', 'sku', 'price', 'quantity', 'updated')
      then lower(coalesce(f.name, f.external_id, f.product_sku, '')) end asc nulls last,
    f.id;
end;
$$;

revoke all on function public.admin_product_catalog_page(text, text, text, boolean, text, integer, integer) from public, anon;
grant execute on function public.admin_product_catalog_page(text, text, text, boolean, text, integer, integer) to authenticated, service_role;
