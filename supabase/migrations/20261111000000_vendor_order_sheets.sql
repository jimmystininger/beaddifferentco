create table public.vendor_order_sheets (
  id uuid primary key default gen_random_uuid(),
  vendor_name text not null check (length(btrim(vendor_name)) > 0),
  file_name text not null check (length(btrim(file_name)) > 0),
  csv_content text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

create index vendor_order_sheets_created_at_idx
  on public.vendor_order_sheets (created_at desc);

alter table public.vendor_order_sheets enable row level security;

create policy vendor_order_sheets_admin_all
  on public.vendor_order_sheets
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

revoke all on public.vendor_order_sheets from public, anon, authenticated;
grant select, insert, update, delete on public.vendor_order_sheets to authenticated;
