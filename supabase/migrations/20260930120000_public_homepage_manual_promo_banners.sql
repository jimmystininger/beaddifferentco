create or replace function public.get_public_homepage_manual_promo_banners()
returns table (
  id uuid,
  title text,
  mode text,
  discount_type text,
  value numeric,
  active boolean,
  starts_at timestamptz,
  ends_at timestamptz,
  show_homepage_banner boolean,
  banner_text text,
  details text,
  banner_link text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    promo.id,
    promo.title,
    promo.mode,
    promo.discount_type,
    promo.value,
    promo.active,
    promo.starts_at,
    promo.ends_at,
    promo.show_homepage_banner,
    promo.banner_text,
    promo.details,
    promo.banner_link
  from public.promo_codes promo
  where promo.mode = 'manual'
    and promo.active
    and promo.show_homepage_banner
    and (promo.starts_at is null or promo.starts_at <= timezone('utc', now()))
    and (promo.ends_at is null or promo.ends_at >= timezone('utc', now()));
$$;

revoke all on function public.get_public_homepage_manual_promo_banners() from public, anon, authenticated;
grant execute on function public.get_public_homepage_manual_promo_banners() to anon, authenticated;
