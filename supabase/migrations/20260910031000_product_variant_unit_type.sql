alter table public.product_option_values
  add column if not exists unit_type text not null default 'Each';

alter table public.product_option_values
  drop constraint if exists product_option_values_unit_type_check;

alter table public.product_option_values
  add constraint product_option_values_unit_type_check
  check (length(trim(unit_type)) > 0);
