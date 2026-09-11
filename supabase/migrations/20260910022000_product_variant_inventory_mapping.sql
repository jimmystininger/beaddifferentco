alter table public.product_option_values
  add column if not exists sku text,
  add column if not exists inventory_sku text,
  add column if not exists inventory_units integer not null default 1;

alter table public.product_option_values
  drop constraint if exists product_option_values_inventory_units_check;

alter table public.product_option_values
  add constraint product_option_values_inventory_units_check check (inventory_units > 0);
