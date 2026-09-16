alter table public.promo_codes
  add column if not exists details text not null default '',
  add column if not exists banner_text text not null default '';

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.promo_codes'::regclass
      and conname = 'promo_codes_mode_check'
  ) then
    alter table public.promo_codes drop constraint promo_codes_mode_check;
  end if;
end $$;

alter table public.promo_codes
  add constraint promo_codes_mode_check check (mode in ('auto', 'manual', 'banner'));

drop policy if exists promo_public_read on public.promo_codes;
create policy promo_public_read on public.promo_codes
  for select to anon, authenticated
  using (
    mode in ('auto', 'banner')
    and active
    and (starts_at is null or starts_at <= timezone('utc', now()))
    and (ends_at is null or ends_at >= timezone('utc', now()))
  );
