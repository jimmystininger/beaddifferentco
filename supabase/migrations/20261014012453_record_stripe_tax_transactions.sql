alter table public.orders
  add column if not exists stripe_tax_calculation_id text,
  add column if not exists stripe_tax_transaction_id text;

alter table public.stripe_refunds
  add column if not exists stripe_tax_reversal_id text;
