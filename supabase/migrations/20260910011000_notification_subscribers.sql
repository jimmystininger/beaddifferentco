create table public.notification_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  active boolean not null default true,
  source text not null default 'footer',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index notification_subscribers_active_idx on public.notification_subscribers(active, created_at desc);
alter table public.notification_subscribers enable row level security;
create policy notification_subscribers_public_insert on public.notification_subscribers for insert to anon, authenticated with check (active = true and source in ('footer', 'signup'));
create policy notification_subscribers_admin_all on public.notification_subscribers for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
