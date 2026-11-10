create table public.business_expense_vendors (
  id uuid primary key default gen_random_uuid(),
  vendor_name text not null check (length(btrim(vendor_name)) > 0),
  created_at timestamptz not null default timezone('utc', now())
);

create unique index business_expense_vendors_normalized_name_idx
  on public.business_expense_vendors (lower(btrim(vendor_name)));

alter table public.business_expense_vendors enable row level security;

create policy business_expense_vendors_admin_all
  on public.business_expense_vendors
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

revoke all on public.business_expense_vendors from public, anon, authenticated;
grant select, insert, update, delete on public.business_expense_vendors to authenticated;

insert into public.business_expense_vendors (vendor_name)
select distinct on (lower(btrim(vendor)))
  btrim(vendor)
from public.business_expenses
where nullif(btrim(vendor), '') is not null
order by lower(btrim(vendor)), btrim(vendor)
on conflict do nothing;
