create table if not exists public.order_support_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  order_number text not null,
  request_type text not null check (request_type in ('cancellation','issue')),
  name text not null,
  email text not null,
  subject text not null,
  message text not null check (char_length(trim(message)) between 1 and 10000),
  priority text not null default 'high' check (priority in ('high','urgent')),
  status text not null default 'new' check (status in ('new','in_progress','resolved','declined')),
  admin_notes text,
  resolved_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists order_support_requests_queue_idx
  on public.order_support_requests(request_type, status, created_at desc);

alter table public.order_support_requests enable row level security;

grant insert on public.order_support_requests to anon, authenticated;
grant select, update on public.order_support_requests to authenticated;

drop policy if exists order_support_requests_insert on public.order_support_requests;
create policy order_support_requests_insert
  on public.order_support_requests for insert
  to anon, authenticated
  with check (user_id is null or user_id = (select auth.uid()));

drop policy if exists order_support_requests_admin_read on public.order_support_requests;
create policy order_support_requests_admin_read
  on public.order_support_requests for select
  to authenticated
  using ((select private.is_admin()));

drop policy if exists order_support_requests_admin_update on public.order_support_requests;
create policy order_support_requests_admin_update
  on public.order_support_requests for update
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));
