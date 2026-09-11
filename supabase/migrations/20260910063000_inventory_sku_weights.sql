alter table public.inventory_skus
  add column if not exists weight_value numeric check (weight_value is null or weight_value >= 0);

alter table public.inventory_skus
  add column if not exists weight_unit text not null default 'oz'
  check (weight_unit in ('oz', 'lb', 'g', 'kg'));

create index if not exists inventory_skus_weight_idx
  on public.inventory_skus(weight_value, weight_unit);
