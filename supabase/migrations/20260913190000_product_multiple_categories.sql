create table if not exists public.product_categories (
  product_id uuid not null references public.products(id) on delete cascade,
  category_slug text not null references public.categories(slug) on update cascade on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (product_id, category_slug)
);

create index if not exists product_categories_category_idx
  on public.product_categories(category_slug, product_id);

alter table public.product_categories enable row level security;

drop policy if exists product_categories_public_read on public.product_categories;
create policy product_categories_public_read on public.product_categories
  for select to anon, authenticated
  using (
    exists (
      select 1
      from public.products p
      where p.id = product_id
        and p.visible
    )
    and exists (
      select 1
      from public.categories c
      where c.slug = category_slug
        and c.active
    )
  );

drop policy if exists product_categories_admin_read on public.product_categories;
create policy product_categories_admin_read on public.product_categories
  for select to authenticated
  using ((select private.is_admin()));

drop policy if exists product_categories_admin_insert on public.product_categories;
create policy product_categories_admin_insert on public.product_categories
  for insert to authenticated
  with check ((select private.is_admin()));

drop policy if exists product_categories_admin_update on public.product_categories;
create policy product_categories_admin_update on public.product_categories
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

drop policy if exists product_categories_admin_delete on public.product_categories;
create policy product_categories_admin_delete on public.product_categories
  for delete to authenticated
  using ((select private.is_admin()));

insert into public.product_categories (product_id, category_slug, sort_order)
select p.id, p.category_slug, 0
from public.products p
join public.categories c on c.slug = p.category_slug
where nullif(trim(p.category_slug), '') is not null
on conflict (product_id, category_slug) do nothing;
