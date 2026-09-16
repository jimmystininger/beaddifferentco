create index if not exists products_visible_category_added_idx
  on public.products(visible, category_slug, added_at desc, id desc);

create index if not exists products_visible_subcategory_added_idx
  on public.products(visible, subcategory_slug, added_at desc, id desc);

create or replace function public.get_storefront_category_products(
  category_slugs text[] default '{}',
  page_size integer default 24,
  page_offset integer default 0,
  recent_since timestamptz default null
)
returns table (
  id uuid,
  external_id text,
  sku text,
  category_slug text,
  subcategory_slug text,
  name text,
  seo_title text,
  search_text text,
  short_description text,
  description text,
  item_details text,
  shipping_details text,
  etsy_units_per_sale numeric,
  price numeric,
  promo_price numeric,
  promo_starts_at timestamptz,
  promo_ends_at timestamptz,
  promo_discount_percent numeric,
  promo_skus jsonb,
  quantity integer,
  visible boolean,
  waitlist_enabled boolean,
  added_at timestamptz,
  low_stock_threshold integer,
  badges jsonb,
  featured boolean,
  lead_image_url text,
  lead_image_alt text,
  total_count bigint
)
language sql
stable
set search_path = public
as $$
  with filtered as (
    select p.*
    from public.products p
    where p.visible
      and (recent_since is null or p.added_at >= recent_since)
      and (
        coalesce(array_length(category_slugs, 1), 0) = 0
        or p.category_slug = any(category_slugs)
        or p.subcategory_slug = any(category_slugs)
        or exists (
          select 1
          from public.product_categories pc
          where pc.product_id = p.id
            and pc.category_slug = any(category_slugs)
        )
      )
  ),
  paged as (
    select f.*, count(*) over () as total_count
    from filtered f
    order by f.added_at desc, f.id desc
    limit greatest(1, least(coalesce(page_size, 24), 48))
    offset greatest(0, coalesce(page_offset, 0))
  )
  select
    paged.id,
    paged.external_id,
    paged.sku,
    paged.category_slug,
    paged.subcategory_slug,
    paged.name,
    paged.seo_title,
    paged.search_text,
    paged.short_description,
    paged.description,
    paged.item_details,
    paged.shipping_details,
    paged.etsy_units_per_sale,
    paged.price,
    paged.promo_price,
    paged.promo_starts_at,
    paged.promo_ends_at,
    paged.promo_discount_percent,
    paged.promo_skus,
    paged.quantity,
    paged.visible,
    paged.waitlist_enabled,
    paged.added_at,
    paged.low_stock_threshold,
    paged.badges,
    paged.featured,
    lead.url,
    lead.alt_text,
    paged.total_count
  from paged
  left join lateral (
    select pi.url, pi.alt_text
    from public.product_images pi
    where pi.product_id = paged.id
      and pi.media_type = 'image'
    order by pi.sort_order asc, pi.id asc
    limit 1
  ) lead on true
  order by paged.added_at desc, paged.id desc;
$$;

revoke all on function public.get_storefront_category_products(text[], integer, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.get_storefront_category_products(text[], integer, integer, timestamptz)
  to anon, authenticated;
