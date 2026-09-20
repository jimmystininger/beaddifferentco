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
  match_status text not null default 'unmatched' check (match_status in ('matched','unmatched','ambiguous')),
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  unique (external_order_id, external_line_id)
);

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
  match_status text not null default 'unmatched' check (match_status in ('matched','unmatched','ambiguous')),
  applied_review_id uuid references public.reviews(id) on delete set null,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.etsy_import_review_targets (
  id uuid primary key default gen_random_uuid(),
  source_review_id uuid not null references public.etsy_import_reviews(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  applied_review_id uuid references public.reviews(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (source_review_id, product_id)
);

create index if not exists etsy_import_sales_date_idx on public.etsy_import_sales (sale_date desc);
create index if not exists etsy_import_sales_order_id_idx on public.etsy_import_sales (external_order_id);
create index if not exists etsy_import_sales_line_sku_idx on public.etsy_import_sales (external_line_id) where etsy_sku is not null;
create index if not exists etsy_import_sales_date_order_idx on public.etsy_import_sales (sale_date, external_order_id);
create index if not exists etsy_import_reviews_match_idx on public.etsy_import_reviews (match_status, etsy_sku);
create index if not exists etsy_import_review_targets_product_idx on public.etsy_import_review_targets (product_id);

alter table public.etsy_import_sales enable row level security;
alter table public.etsy_import_reviews enable row level security;
alter table public.etsy_import_review_targets enable row level security;
revoke all on public.etsy_import_sales, public.etsy_import_reviews, public.etsy_import_review_targets from public, anon, authenticated;
grant select, insert, update, delete on public.etsy_import_sales, public.etsy_import_reviews, public.etsy_import_review_targets to service_role;

create or replace function public.admin_etsy_sku_metrics(
  p_start timestamptz default null,
  p_end timestamptz default null
)
returns table(
  sku text,
  units_sold numeric,
  gross_revenue numeric,
  discounts numeric,
  refunds numeric,
  etsy_fees numeric,
  total_cost numeric,
  net_revenue numeric,
  net_profit numeric
)
language sql
stable
security definer
set search_path = public, private
as $$
  select
    coalesce(nullif(trim(s.matched_inventory_sku), ''), nullif(trim(s.etsy_sku), ''), 'Unassigned SKU'),
    coalesce(sum(s.quantity), 0),
    coalesce(sum(s.gross_revenue), 0),
    coalesce(sum(s.discount_amount), 0),
    coalesce(sum(s.refund_amount), 0),
    coalesce(sum(s.marketplace_fees), 0),
    coalesce(sum(s.quantity * coalesce(s.unit_cost, 0)), 0),
    coalesce(sum(s.gross_revenue - s.discount_amount - s.refund_amount), 0),
    coalesce(sum(s.gross_revenue - s.discount_amount - s.refund_amount - s.marketplace_fees - (s.quantity * coalesce(s.unit_cost, 0))), 0)
  from public.etsy_import_sales s
  where private.is_admin()
    and (p_start is null or s.sale_date >= p_start)
    and (p_end is null or s.sale_date < p_end)
  group by 1
  order by 1;
$$;

revoke all on function public.admin_etsy_sku_metrics(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_etsy_sku_metrics(timestamptz, timestamptz) to authenticated, service_role;
