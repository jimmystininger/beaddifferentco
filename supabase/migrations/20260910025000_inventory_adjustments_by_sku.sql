alter table public.inventory_adjustments
  add column if not exists option_value_id uuid references public.product_option_values(id) on delete set null,
  add column if not exists inventory_sku text;

create index if not exists inventory_adjustments_option_value_idx
  on public.inventory_adjustments(option_value_id, created_at desc);
