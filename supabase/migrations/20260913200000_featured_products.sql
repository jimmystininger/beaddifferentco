alter table public.products
  add column if not exists featured boolean not null default false;

create index if not exists products_featured_visible_idx
  on public.products(featured, visible, added_at desc);
