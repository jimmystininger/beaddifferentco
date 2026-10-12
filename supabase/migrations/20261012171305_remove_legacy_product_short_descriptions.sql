begin;

drop function public.get_storefront_category_products(text[], integer, integer, timestamptz, text, text[]);
drop function public.get_storefront_category_products_v2(text[], integer, integer, timestamptz, jsonb);

drop trigger if exists products_refresh_search_text on public.products;

create or replace function public.refresh_product_search_text()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  new.search_text := concat_ws(' ', new.name, new.seo_title, new.description, new.item_details, new.shipping_details);
  return new;
end;
$$;

create trigger products_refresh_search_text
before insert or update of name, seo_title, description, item_details, shipping_details
on public.products
for each row execute function public.refresh_product_search_text();

revoke all on function public.refresh_product_search_text() from public, anon, authenticated;

drop trigger if exists prevent_locked_product_page_edits on public.products;

update public.products
set search_text = concat_ws(' ', name, seo_title, description, item_details, shipping_details);

alter table public.products drop column short_description;

create trigger prevent_locked_product_page_edits
before update on public.products
for each row execute function public.prevent_locked_product_page_edits();

create function public.get_storefront_category_products(
  category_slugs text[] default '{}',
  page_size integer default 24,
  page_offset integer default 0,
  recent_since timestamptz default null,
  filter_key text default null,
  filter_values text[] default '{}'
)
returns table (
  id uuid, external_id text, sku text, category_slug text, subcategory_slug text,
  name text, seo_title text, search_text text, description text, item_details text,
  shipping_details text, etsy_units_per_sale numeric, price numeric, promo_price numeric,
  promo_starts_at timestamptz, promo_ends_at timestamptz, promo_discount_percent numeric,
  promo_skus jsonb, quantity integer, visible boolean, waitlist_enabled boolean,
  added_at timestamptz, low_stock_threshold integer, badges jsonb, featured boolean,
  lead_image_url text, lead_image_alt text, total_count bigint
)
language sql stable security definer set search_path = public
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
        or exists (select 1 from public.product_categories pc where pc.product_id = p.id and pc.category_slug = any(category_slugs))
      )
      and (
        filter_key is null
        or coalesce(array_length(filter_values, 1), 0) = 0
        or exists (
          select 1
          from public.product_filter_assignments a
          join public.storefront_filter_values v on v.id = a.filter_value_id and v.active
          join public.storefront_filter_definitions d on d.id = v.filter_id and d.active and d.key = filter_key
          where a.product_id = p.id and v.value_key = any(filter_values)
        )
      )
  ), paged as (
    select f.*, count(*) over () as total_count
    from filtered f
    order by f.added_at desc, f.id desc
    limit greatest(1, least(coalesce(page_size, 24), 48))
    offset greatest(0, coalesce(page_offset, 0))
  )
  select paged.id, paged.external_id, paged.sku, paged.category_slug, paged.subcategory_slug,
    paged.name, paged.seo_title, paged.search_text, paged.description, paged.item_details,
    paged.shipping_details, paged.etsy_units_per_sale, paged.price, paged.promo_price,
    paged.promo_starts_at, paged.promo_ends_at, paged.promo_discount_percent,
    paged.promo_skus, paged.quantity, paged.visible, paged.waitlist_enabled, paged.added_at,
    paged.low_stock_threshold, paged.badges, paged.featured, lead.url, lead.alt_text,
    paged.total_count
  from paged
  left join lateral (
    select pi.url, pi.alt_text from public.product_images pi
    where pi.product_id = paged.id and pi.media_type = 'image'
    order by pi.sort_order asc, pi.id asc limit 1
  ) lead on true
  order by paged.added_at desc, paged.id desc;
$$;

revoke all on function public.get_storefront_category_products(text[], integer, integer, timestamptz, text, text[]) from public, anon, authenticated;
grant execute on function public.get_storefront_category_products(text[], integer, integer, timestamptz, text, text[]) to anon, authenticated;

create function public.get_storefront_category_products_v2(
  category_slugs text[] default '{}',
  page_size integer default 24,
  page_offset integer default 0,
  recent_since timestamptz default null,
  filter_selections jsonb default '{}'::jsonb
)
returns table (
  id uuid, external_id text, sku text, category_slug text, subcategory_slug text,
  name text, seo_title text, search_text text, description text, item_details text,
  shipping_details text, etsy_units_per_sale numeric, price numeric, promo_price numeric,
  promo_starts_at timestamptz, promo_ends_at timestamptz, promo_discount_percent numeric,
  promo_skus jsonb, quantity integer, visible boolean, waitlist_enabled boolean,
  added_at timestamptz, low_stock_threshold integer, badges jsonb, featured boolean,
  lead_image_url text, lead_image_alt text, total_count bigint
)
language sql stable set search_path = public
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
        or exists (select 1 from public.product_categories pc where pc.product_id = p.id and pc.category_slug = any(category_slugs))
      )
      and not exists (
        select 1
        from jsonb_each(case when jsonb_typeof(coalesce(filter_selections, '{}'::jsonb)) = 'object' then filter_selections else '{}'::jsonb end) selection
        where jsonb_typeof(selection.value) <> 'array'
          or jsonb_array_length(case when jsonb_typeof(selection.value) = 'array' then selection.value else '[]'::jsonb end) = 0
          or not exists (
            select 1
            from public.product_filter_assignments a
            join public.storefront_filter_values v on v.id = a.filter_value_id and v.active
            join public.storefront_filter_definitions d on d.id = v.filter_id and d.active and d.key = selection.key
            where a.product_id = p.id
              and v.value_key = any(array(select jsonb_array_elements_text(case when jsonb_typeof(selection.value) = 'array' then selection.value else '[]'::jsonb end)))
          )
      )
  ), paged as (
    select f.*, count(*) over () as total_count
    from filtered f
    order by f.added_at desc, f.id desc
    limit greatest(1, least(coalesce(page_size, 24), 48))
    offset greatest(0, coalesce(page_offset, 0))
  )
  select paged.id, paged.external_id, paged.sku, paged.category_slug, paged.subcategory_slug,
    paged.name, paged.seo_title, paged.search_text, paged.description, paged.item_details,
    paged.shipping_details, paged.etsy_units_per_sale, paged.price, paged.promo_price,
    paged.promo_starts_at, paged.promo_ends_at, paged.promo_discount_percent,
    paged.promo_skus, paged.quantity, paged.visible, paged.waitlist_enabled, paged.added_at,
    paged.low_stock_threshold, paged.badges, paged.featured, lead.url, lead.alt_text,
    paged.total_count
  from paged
  left join lateral (
    select pi.url, pi.alt_text from public.product_images pi
    where pi.product_id = paged.id and pi.media_type = 'image'
    order by pi.sort_order asc, pi.id asc limit 1
  ) lead on true
  order by paged.added_at desc, paged.id desc;
$$;

revoke all on function public.get_storefront_category_products_v2(text[], integer, integer, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.get_storefront_category_products_v2(text[], integer, integer, timestamptz, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
