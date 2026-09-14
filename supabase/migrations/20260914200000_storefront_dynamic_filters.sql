create table if not exists public.storefront_filter_definitions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  scope text not null default 'variant' check (scope in ('product', 'variant')),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.storefront_filter_categories (
  filter_id uuid not null references public.storefront_filter_definitions(id) on delete cascade,
  category_slug text not null references public.categories(slug) on delete cascade,
  primary key (filter_id, category_slug)
);

create table if not exists public.storefront_filter_values (
  id uuid primary key default gen_random_uuid(),
  filter_id uuid not null references public.storefront_filter_definitions(id) on delete cascade,
  value_key text not null,
  label text not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (filter_id, value_key)
);

create table if not exists public.product_filter_assignments (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  filter_value_id uuid not null references public.storefront_filter_values(id) on delete cascade,
  inventory_sku_id uuid references public.inventory_skus(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists product_filter_assignments_unique_idx
  on public.product_filter_assignments (
    product_id,
    filter_value_id,
    coalesce(inventory_sku_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create index if not exists storefront_filter_categories_category_idx
  on public.storefront_filter_categories(category_slug, filter_id);

create index if not exists storefront_filter_values_filter_idx
  on public.storefront_filter_values(filter_id, active, sort_order);

create index if not exists product_filter_assignments_value_product_idx
  on public.product_filter_assignments(filter_value_id, product_id);

create index if not exists product_filter_assignments_product_sku_idx
  on public.product_filter_assignments(product_id, inventory_sku_id);

alter table public.storefront_filter_definitions enable row level security;
alter table public.storefront_filter_categories enable row level security;
alter table public.storefront_filter_values enable row level security;
alter table public.product_filter_assignments enable row level security;

drop policy if exists storefront_filter_definitions_public_read on public.storefront_filter_definitions;
create policy storefront_filter_definitions_public_read
  on public.storefront_filter_definitions for select to anon, authenticated
  using (active or (select private.is_admin()));

drop policy if exists storefront_filter_definitions_admin_all on public.storefront_filter_definitions;
create policy storefront_filter_definitions_admin_all
  on public.storefront_filter_definitions for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

drop policy if exists storefront_filter_categories_public_read on public.storefront_filter_categories;
create policy storefront_filter_categories_public_read
  on public.storefront_filter_categories for select to anon, authenticated
  using (exists (
    select 1 from public.storefront_filter_definitions d
    join public.categories c on c.slug = category_slug
    where d.id = filter_id and d.active and c.active
  ));

drop policy if exists storefront_filter_categories_admin_all on public.storefront_filter_categories;
create policy storefront_filter_categories_admin_all
  on public.storefront_filter_categories for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

drop policy if exists storefront_filter_values_public_read on public.storefront_filter_values;
create policy storefront_filter_values_public_read
  on public.storefront_filter_values for select to anon, authenticated
  using (active and exists (
    select 1 from public.storefront_filter_definitions d
    where d.id = filter_id and d.active
  ));

drop policy if exists storefront_filter_values_admin_all on public.storefront_filter_values;
create policy storefront_filter_values_admin_all
  on public.storefront_filter_values for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

drop policy if exists product_filter_assignments_public_read on public.product_filter_assignments;
create policy product_filter_assignments_public_read
  on public.product_filter_assignments for select to anon, authenticated
  using (exists (
    select 1
    from public.products p
    join public.storefront_filter_values v on v.id = filter_value_id and v.active
    join public.storefront_filter_definitions d on d.id = v.filter_id and d.active
    where p.id = product_id and p.visible
  ));

drop policy if exists product_filter_assignments_admin_all on public.product_filter_assignments;
create policy product_filter_assignments_admin_all
  on public.product_filter_assignments for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

insert into public.storefront_filter_definitions (key, label, scope, sort_order)
values
  ('size', 'Size', 'variant', 10),
  ('style', 'Style', 'variant', 20),
  ('holiday', 'Holiday', 'variant', 30)
on conflict (key) do update
set label = excluded.label,
    scope = excluded.scope,
    sort_order = excluded.sort_order,
    updated_at = timezone('utc', now());

insert into public.storefront_filter_categories (filter_id, category_slug)
select d.id, links.category_slug
from public.storefront_filter_definitions d
join (values ('size', 'acrylic'), ('style', 'silicone'), ('holiday', 'seasonal')) links(filter_key, category_slug)
  on links.filter_key = d.key
on conflict do nothing;

insert into public.storefront_filter_values (filter_id, value_key, label, sort_order)
select d.id, values_data.value_key, values_data.label, values_data.sort_order
from public.storefront_filter_definitions d
join (values
  ('size', '10-12mm', '10/12mm', 10),
  ('size', '16mm', '16mm', 20),
  ('size', '20mm', '20mm', 30),
  ('style', 'solid', 'Solid Color', 10),
  ('style', 'printed', 'Printed Style', 20),
  ('holiday', 'christmas', 'Christmas', 10),
  ('holiday', 'halloween', 'Halloween', 20)
) values_data(filter_key, value_key, label, sort_order)
  on values_data.filter_key = d.key
on conflict (filter_id, value_key) do update
set label = excluded.label,
    sort_order = excluded.sort_order,
    updated_at = timezone('utc', now());

insert into public.product_filter_assignments (product_id, filter_value_id, inventory_sku_id)
select p.id, v.id, pov.inventory_sku_id
from public.products p
join public.product_options po on po.product_id = p.id
join public.product_option_values pov on pov.option_id = po.id
join public.storefront_filter_definitions d on d.key = 'size'
join public.storefront_filter_values v on v.filter_id = d.id
  and v.value_key = case
    when p.subcategory_slug = '10-12mm-acrylic-beads' then '10-12mm'
    when p.subcategory_slug = '16mm-acrylic-beads' then '16mm'
    when p.subcategory_slug = '20mm-acrylic-beads' then '20mm'
  end
where p.category_slug = 'acrylic'
  and p.subcategory_slug in ('10-12mm-acrylic-beads', '16mm-acrylic-beads', '20mm-acrylic-beads')
  and pov.inventory_sku_id is not null
on conflict do nothing;

insert into public.product_filter_assignments (product_id, filter_value_id, inventory_sku_id)
select p.id, v.id, pov.inventory_sku_id
from public.products p
join public.product_options po on po.product_id = p.id
join public.product_option_values pov on pov.option_id = po.id
join public.storefront_filter_definitions d on d.key = 'style'
join public.storefront_filter_values v on v.filter_id = d.id
  and v.value_key = case
    when p.subcategory_slug = 'silicone-solid-color' then 'solid'
    when p.subcategory_slug = 'silicone-printed-style' then 'printed'
  end
where p.category_slug = 'silicone'
  and p.subcategory_slug in ('silicone-solid-color', 'silicone-printed-style')
  and pov.inventory_sku_id is not null
on conflict do nothing;

insert into public.product_filter_assignments (product_id, filter_value_id)
select p.id, v.id
from public.products p
join public.storefront_filter_definitions d on d.key = 'holiday'
join public.storefront_filter_values v on v.filter_id = d.id
where p.category_slug = 'seasonal'
  and ((v.value_key = 'christmas' and lower(coalesce(p.name, '') || ' ' || coalesce(p.search_text, '')) like '%christmas%')
    or (v.value_key = 'halloween' and lower(coalesce(p.name, '') || ' ' || coalesce(p.search_text, '')) like '%halloween%'))
on conflict do nothing;

drop function if exists public.get_storefront_category_products(text[], integer, integer, timestamptz);

create or replace function public.get_storefront_category_products(
  category_slugs text[] default '{}',
  page_size integer default 24,
  page_offset integer default 0,
  recent_since timestamptz default null,
  filter_key text default null,
  filter_values text[] default '{}'
)
returns table (
  id uuid, external_id text, sku text, category_slug text, subcategory_slug text,
  name text, seo_title text, search_text text, short_description text,
  description text, item_details text, shipping_details text, etsy_units_per_sale numeric,
  price numeric, promo_price numeric, promo_starts_at timestamptz, promo_ends_at timestamptz,
  promo_discount_percent numeric, promo_skus jsonb, quantity integer, visible boolean,
  waitlist_enabled boolean, added_at timestamptz, low_stock_threshold integer,
  badges jsonb, featured boolean, lead_image_url text, lead_image_alt text, total_count bigint
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
    paged.name, paged.seo_title, paged.search_text, paged.short_description,
    paged.description, paged.item_details, paged.shipping_details, paged.etsy_units_per_sale,
    paged.price, paged.promo_price, paged.promo_starts_at, paged.promo_ends_at,
    paged.promo_discount_percent, paged.promo_skus, paged.quantity, paged.visible,
    paged.waitlist_enabled, paged.added_at, paged.low_stock_threshold, paged.badges,
    paged.featured, lead.url, lead.alt_text, paged.total_count
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

create or replace function public.get_storefront_category_filters(p_category_slug text)
returns jsonb
language sql stable set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'key', d.key,
    'label', d.label,
    'scope', d.scope,
    'sortOrder', d.sort_order,
    'values', (
      select coalesce(jsonb_agg(jsonb_build_object('key', v.value_key, 'label', v.label, 'sortOrder', v.sort_order) order by v.sort_order, v.label), '[]'::jsonb)
      from public.storefront_filter_values v
      where v.filter_id = d.id and v.active
    )
  ) order by d.sort_order, d.label), '[]'::jsonb)
  from public.storefront_filter_definitions d
  join public.storefront_filter_categories fc on fc.filter_id = d.id
  join public.categories c on c.slug = fc.category_slug and c.active
  where d.active and fc.category_slug = p_category_slug;
$$;

revoke all on function public.get_storefront_category_filters(text) from public, anon, authenticated;
grant execute on function public.get_storefront_category_filters(text) to anon, authenticated;
