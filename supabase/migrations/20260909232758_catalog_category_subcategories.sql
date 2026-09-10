alter table public.products add column if not exists subcategory_slug text;
create index if not exists products_subcategory_slug_idx on public.products(subcategory_slug);
