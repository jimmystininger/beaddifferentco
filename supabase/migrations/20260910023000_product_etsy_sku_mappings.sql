create table if not exists public.product_etsy_mappings (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  etsy_sku text not null,
  inventory_sku text not null,
  inventory_units integer not null default 1 check (inventory_units > 0),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique(product_id, etsy_sku)
);

create index if not exists product_etsy_mappings_sku_idx
  on public.product_etsy_mappings(etsy_sku);

alter table public.product_etsy_mappings enable row level security;

drop policy if exists product_etsy_mappings_admin_all on public.product_etsy_mappings;
create policy product_etsy_mappings_admin_all on public.product_etsy_mappings
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));
