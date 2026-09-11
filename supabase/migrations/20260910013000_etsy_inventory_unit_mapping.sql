alter table public.products
  add column if not exists etsy_units_per_sale numeric not null default 1
  check (etsy_units_per_sale > 0);
