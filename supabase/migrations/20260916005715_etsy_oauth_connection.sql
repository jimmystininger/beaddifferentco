-- OAuth credentials are accessible only to the backend service role.
create table public.etsy_oauth_states (
  state_hash text primary key,
  admin_id uuid not null references public.profiles(id) on delete cascade,
  code_verifier text not null,
  return_origin text not null,
  expires_at timestamptz not null
);
create index etsy_oauth_states_admin_idx on public.etsy_oauth_states(admin_id);
create index etsy_oauth_states_expiry_idx on public.etsy_oauth_states(expires_at);
create table public.etsy_connections (
  id boolean primary key default true check (id),
  shop_id bigint not null,
  shop_name text not null,
  etsy_user_id bigint not null,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  scopes text not null,
  connected_by uuid references public.profiles(id) on delete set null,
  connected_at timestamptz not null default now(),
  verified_at timestamptz not null default now(),
  refresh_lock_until timestamptz
);
create index etsy_connections_admin_idx on public.etsy_connections(connected_by);
alter table public.etsy_oauth_states enable row level security;
alter table public.etsy_connections enable row level security;
revoke all on public.etsy_oauth_states, public.etsy_connections from public, anon, authenticated;
grant select, insert, update, delete on public.etsy_oauth_states, public.etsy_connections to service_role;
