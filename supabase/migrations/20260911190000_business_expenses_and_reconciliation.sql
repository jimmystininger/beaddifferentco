create table if not exists public.business_expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null default current_date,
  vendor text not null,
  amount numeric(12,2) not null check (amount >= 0),
  notes text,
  receipt_path text,
  receipt_name text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists business_expenses_date_idx
  on public.business_expenses(expense_date desc);

create index if not exists business_expenses_vendor_idx
  on public.business_expenses(vendor);

alter table public.business_expenses enable row level security;

drop policy if exists business_expenses_admin_all on public.business_expenses;
create policy business_expenses_admin_all on public.business_expenses
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

revoke all on public.business_expenses from public, anon, authenticated;
grant select, insert, update, delete on public.business_expenses to authenticated;

create table if not exists public.business_bank_reconciliations (
  id uuid primary key default gen_random_uuid(),
  period_month date not null unique check (extract(day from period_month) = 1),
  starting_balance numeric(12,2) not null default 0 check (starting_balance >= 0),
  ending_balance numeric(12,2) check (ending_balance >= 0),
  notes text,
  reconciled_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists business_bank_reconciliations_month_idx
  on public.business_bank_reconciliations(period_month desc);

alter table public.business_bank_reconciliations enable row level security;

drop policy if exists business_bank_reconciliations_admin_all on public.business_bank_reconciliations;
create policy business_bank_reconciliations_admin_all on public.business_bank_reconciliations
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

revoke all on public.business_bank_reconciliations from public, anon, authenticated;
grant select, insert, update, delete on public.business_bank_reconciliations to authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('expense-receipts', 'expense-receipts', false, 10485760)
on conflict (id) do nothing;

drop policy if exists expense_receipts_admin_select on storage.objects;
create policy expense_receipts_admin_select on storage.objects
  for select to authenticated
  using (bucket_id = 'expense-receipts' and (select private.is_admin()));

drop policy if exists expense_receipts_admin_insert on storage.objects;
create policy expense_receipts_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'expense-receipts' and (select private.is_admin()));

drop policy if exists expense_receipts_admin_update on storage.objects;
create policy expense_receipts_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'expense-receipts' and (select private.is_admin()))
  with check (bucket_id = 'expense-receipts' and (select private.is_admin()));

drop policy if exists expense_receipts_admin_delete on storage.objects;
create policy expense_receipts_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'expense-receipts' and (select private.is_admin()));
