alter table public.product_option_values
  add column if not exists image_url text;

alter table public.products
  add column if not exists promo_discount_percent numeric not null default 0,
  add column if not exists promo_skus jsonb not null default '[]'::jsonb;

alter table public.products
  drop constraint if exists products_promo_discount_percent_check;

alter table public.products
  add constraint products_promo_discount_percent_check
  check (promo_discount_percent >= 0 and promo_discount_percent <= 100);
