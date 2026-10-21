alter table public.inventory_skus
  add column if not exists product_page_not_required boolean not null default false;
