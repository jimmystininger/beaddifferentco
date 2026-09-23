create table if not exists public.admin_email_log (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete set null,
  request_id uuid references public.order_support_requests(id) on delete set null,
  contact_id uuid references public.contact_messages(id) on delete set null,
  email_type text not null default 'direct',
  recipient text not null,
  subject text not null,
  body text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists admin_email_log_order_idx on public.admin_email_log(order_id, created_at desc);
create index if not exists admin_email_log_request_idx on public.admin_email_log(request_id, created_at desc);
alter table public.admin_email_log enable row level security;
grant select on public.admin_email_log to authenticated;
drop policy if exists admin_email_log_admin_read on public.admin_email_log;
create policy admin_email_log_admin_read on public.admin_email_log for select to authenticated using ((select private.is_admin()));
revoke all on public.admin_email_log from anon;
