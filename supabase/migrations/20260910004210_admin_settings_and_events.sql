create table public.site_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete set null,
  event_type text not null check (event_type in ('view', 'cart_add', 'purchase')),
  created_at timestamptz not null default timezone('utc', now())
);

create index analytics_events_product_type_idx on public.analytics_events(product_id, event_type, created_at desc);
alter table public.site_settings enable row level security;
alter table public.analytics_events enable row level security;

create policy site_settings_admin_all on public.site_settings for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy analytics_events_public_insert on public.analytics_events for insert to anon, authenticated with check (product_id is null or exists (select 1 from public.products where id = product_id and visible));
create policy analytics_events_admin_read on public.analytics_events for select to authenticated using ((select private.is_admin()));
