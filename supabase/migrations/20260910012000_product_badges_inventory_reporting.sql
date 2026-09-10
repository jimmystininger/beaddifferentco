alter table public.products add column if not exists estimated_cost numeric not null default 0 check (estimated_cost >= 0);
alter table public.products add column if not exists low_stock_threshold integer not null default 5 check (low_stock_threshold >= 0);
alter table public.products add column if not exists badges jsonb not null default '[]'::jsonb;
create index products_low_stock_idx on public.products(quantity, low_stock_threshold) where visible = true;
