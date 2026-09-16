alter table public.promo_codes
  add column if not exists banner_link text not null default '';
