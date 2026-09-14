alter table public.inventory_skus
  add column if not exists discontinued boolean not null default false;

create index if not exists inventory_skus_active_report_idx
  on public.inventory_skus (sku)
  where discontinued = false;
