create table if not exists public.etsy_import_state (
  id smallint primary key check (id = 1),
  last_successful_cursor text,
  last_successful_import_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now())
);

insert into public.etsy_import_state (id)
values (1)
on conflict (id) do nothing;

create table if not exists public.etsy_import_line_records (
  id uuid primary key default gen_random_uuid(),
  external_order_id text not null,
  external_line_id text not null,
  etsy_sku text not null,
  quantity numeric not null,
  imported_at timestamptz not null default timezone('utc', now()),
  unique (external_order_id, external_line_id)
);

create index if not exists etsy_import_line_records_sku_idx
  on public.etsy_import_line_records(etsy_sku);

alter table public.etsy_import_state enable row level security;
alter table public.etsy_import_line_records enable row level security;

drop policy if exists etsy_import_state_admin_all on public.etsy_import_state;
create policy etsy_import_state_admin_all on public.etsy_import_state
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

drop policy if exists etsy_import_line_records_admin_all on public.etsy_import_line_records;
create policy etsy_import_line_records_admin_all on public.etsy_import_line_records
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

revoke all on public.etsy_import_state from anon, authenticated;
revoke all on public.etsy_import_line_records from anon, authenticated;
grant select, insert, update on public.etsy_import_state to authenticated;
grant select, insert on public.etsy_import_line_records to authenticated;
