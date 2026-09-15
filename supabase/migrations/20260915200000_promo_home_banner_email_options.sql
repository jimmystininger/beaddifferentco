alter table public.promo_codes
  add column if not exists title text not null default 'Promotion',
  add column if not exists show_homepage_banner boolean not null default false;

update public.promo_codes
set title = coalesce(nullif(trim(title), ''), nullif(trim(code), ''), 'Promotion')
where title is null or trim(title) = '';
