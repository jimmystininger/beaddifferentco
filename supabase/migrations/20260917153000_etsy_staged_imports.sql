create table if not exists public.etsy_import_batches (
  id uuid primary key default gen_random_uuid(),
  import_type text not null check (import_type in ('reviews', 'sales_history', 'orders', 'listings')),
  status text not null default 'staged' check (status in ('staged', 'applied', 'failed')),
  source text not null default 'etsy_api',
  row_count integer not null default 0,
  matched_count integer not null default 0,
  applied_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.etsy_import_batches add column if not exists import_type text;
alter table public.etsy_import_batches add column if not exists status text default 'staged';
alter table public.etsy_import_batches add column if not exists source text default 'etsy_api';
alter table public.etsy_import_batches add column if not exists row_count integer default 0;
alter table public.etsy_import_batches add column if not exists matched_count integer default 0;
alter table public.etsy_import_batches add column if not exists applied_count integer default 0;
alter table public.etsy_import_batches add column if not exists metadata jsonb default '{}'::jsonb;
alter table public.etsy_import_batches add column if not exists updated_at timestamptz default timezone('utc', now());
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'etsy_import_batches_kind_check') then
    alter table public.etsy_import_batches drop constraint etsy_import_batches_kind_check;
  end if;
  alter table public.etsy_import_batches add constraint etsy_import_batches_kind_check check (kind in ('orders', 'reviews', 'sales_history', 'listings'));
end $$;

create table if not exists public.etsy_import_reviews (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.etsy_import_batches(id) on delete cascade,
  external_review_id text not null unique,
  etsy_listing_id text,
  etsy_sku text,
  rating integer not null check (rating between 1 and 5),
  body text not null,
  reviewer_name text,
  reviewed_at timestamptz,
  matched_inventory_sku text,
  matched_product_id uuid references public.products(id) on delete set null,
  match_status text not null default 'unmatched' check (match_status in ('matched', 'unmatched', 'ambiguous')),
  applied_review_id uuid references public.reviews(id) on delete set null,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.etsy_import_sales (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.etsy_import_batches(id) on delete cascade,
  external_order_id text not null,
  external_line_id text not null,
  etsy_sku text,
  sale_date timestamptz,
  quantity numeric not null default 0,
  gross_revenue numeric not null default 0,
  shipping_revenue numeric not null default 0,
  discount_amount numeric not null default 0,
  refund_amount numeric not null default 0,
  marketplace_fees numeric not null default 0,
  sales_tax numeric not null default 0,
  unit_cost numeric,
  matched_inventory_sku text,
  match_status text not null default 'unmatched' check (match_status in ('matched', 'unmatched', 'ambiguous')),
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  unique (external_order_id, external_line_id)
);

create table if not exists public.etsy_import_orders (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.etsy_import_batches(id) on delete cascade,
  external_order_id text not null unique,
  order_status text,
  ordered_at timestamptz,
  total_price numeric not null default 0,
  shipping_cost numeric not null default 0,
  total_cost numeric not null default 0,
  applied_order_id uuid references public.orders(id) on delete set null,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.etsy_import_listings (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.etsy_import_batches(id) on delete cascade,
  external_listing_id text not null unique,
  title text not null,
  proposed_product_name text,
  proposed_product_sku text,
  proposed_single_sku text,
  proposed_color text,
  proposed_product_id uuid references public.products(id) on delete set null,
  review_status text not null default 'pending' check (review_status in ('pending', 'approved', 'rejected')),
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists etsy_import_batches_type_idx on public.etsy_import_batches(import_type, created_at desc);
create index if not exists etsy_import_reviews_match_idx on public.etsy_import_reviews(match_status, etsy_sku);
create index if not exists etsy_import_sales_date_idx on public.etsy_import_sales(sale_date desc);
create index if not exists etsy_import_listings_status_idx on public.etsy_import_listings(review_status, created_at desc);

do $$ declare table_name text; begin
  foreach table_name in array array['etsy_import_batches','etsy_import_reviews','etsy_import_sales','etsy_import_orders','etsy_import_listings'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_admin_all', table_name);
    execute format('create policy %I on public.%I for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()))', table_name || '_admin_all', table_name);
    execute format('revoke all on public.%I from anon, authenticated', table_name);
    execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
  end loop;
end $$;

alter table public.reviews add column if not exists inventory_sku text;
alter table public.reviews add column if not exists source_system text;
alter table public.reviews add column if not exists external_review_id text;
alter table public.reviews add column if not exists author_name text;
alter table public.reviews alter column user_id drop not null;
create unique index if not exists reviews_external_review_id_idx on public.reviews(external_review_id) where external_review_id is not null;
