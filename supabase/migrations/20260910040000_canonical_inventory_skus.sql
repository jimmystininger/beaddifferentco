create table if not exists public.inventory_skus (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  name text not null,
  variant_name text,
  quantity_on_hand integer not null default 0,
  reorder_point integer not null default 0 check (reorder_point >= 0),
  item_type text,
  hierarchy text,
  category text,
  taxable boolean not null default false,
  price numeric check (price >= 0),
  cost numeric check (cost >= 0),
  income_account text,
  expense_account text,
  inventory_asset_account text,
  sales_description text,
  purchase_description text,
  preferred_vendor text,
  unit_type text not null default 'Each' check (length(trim(unit_type)) > 0),
  source_system text not null default 'quickbooks',
  source_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

insert into public.inventory_skus (sku, name, variant_name, quantity_on_hand, reorder_point, price, cost, source_system, source_metadata)
select distinct on (coalesce(v.inventory_sku, v.sku, 'legacy-' || v.id::text))
  coalesce(v.inventory_sku, v.sku, 'legacy-' || v.id::text),
  coalesce(nullif(trim(v.label), ''), p.name),
  v.label,
  v.quantity,
  v.low_stock_threshold,
  greatest(0, p.price + v.price_delta),
  p.estimated_cost,
  'legacy-catalog',
  jsonb_build_object('source', 'product_option_values', 'product_id', p.id, 'option_value_id', v.id)
from public.product_option_values v
join public.product_options o on o.id = v.option_id
join public.products p on p.id = o.product_id
where coalesce(v.inventory_sku, v.sku, '') <> ''
order by coalesce(v.inventory_sku, v.sku, 'legacy-' || v.id::text), v.id
on conflict (sku) do nothing;

alter table public.product_option_values
  add column if not exists inventory_sku_id uuid references public.inventory_skus(id) on delete restrict;

update public.product_option_values v
set inventory_sku_id = i.id
from public.inventory_skus i
where v.inventory_sku_id is null
  and i.sku = coalesce(v.inventory_sku, v.sku);

alter table public.product_etsy_mappings
  add column if not exists inventory_sku_id uuid references public.inventory_skus(id) on delete restrict;

update public.product_etsy_mappings m
set inventory_sku_id = i.id
from public.inventory_skus i
where m.inventory_sku_id is null
  and i.sku = m.inventory_sku;

create index if not exists inventory_skus_name_idx on public.inventory_skus(name);
create index if not exists inventory_skus_vendor_idx on public.inventory_skus(preferred_vendor);
create index if not exists product_option_values_inventory_sku_idx on public.product_option_values(inventory_sku_id);
create index if not exists product_etsy_mappings_inventory_sku_idx on public.product_etsy_mappings(inventory_sku_id);

alter table public.inventory_skus enable row level security;

drop policy if exists inventory_skus_admin_all on public.inventory_skus;
create policy inventory_skus_admin_all on public.inventory_skus
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create or replace view public.storefront_inventory_skus as
select id, sku, name, variant_name, quantity_on_hand, reorder_point, price, unit_type
from public.inventory_skus;

grant select on public.storefront_inventory_skus to anon, authenticated;
