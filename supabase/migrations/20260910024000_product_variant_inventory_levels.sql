alter table public.product_option_values
  add column if not exists quantity integer not null default 0,
  add column if not exists low_stock_threshold integer not null default 0;

alter table public.product_option_values
  drop constraint if exists product_option_values_quantity_check;

alter table public.product_option_values
  add constraint product_option_values_quantity_check check (quantity >= 0);

alter table public.product_option_values
  drop constraint if exists product_option_values_low_stock_threshold_check;

alter table public.product_option_values
  add constraint product_option_values_low_stock_threshold_check check (low_stock_threshold >= 0);
