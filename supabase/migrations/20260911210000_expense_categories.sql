alter table public.business_expenses
  add column if not exists category text not null default 'Other';

create index if not exists business_expenses_category_idx
  on public.business_expenses(category);

comment on column public.business_expenses.category is
  'Admin-defined accounting bucket such as Website fees, Insurance, or Office supplies.';
