create table if not exists public.etsy_refund_status_sync_state (
  id boolean primary key default true check (id),
  backfill_status text not null default 'pending' check (backfill_status in ('pending', 'running', 'complete')),
  min_created bigint,
  max_created bigint,
  backfill_start bigint,
  backfill_end bigint,
  receipt_offset integer not null default 0 check (receipt_offset >= 0),
  ledger_offset integer not null default 0 check (ledger_offset >= 0),
  receipts_done boolean not null default false,
  ledger_done boolean not null default false,
  scanned_receipts integer not null default 0,
  updated_lines integer not null default 0,
  cancelled_receipts integer not null default 0,
  refunded_receipts integer not null default 0,
  partial_refund_receipts integer not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.etsy_refund_status_sync_state enable row level security;
revoke all on public.etsy_refund_status_sync_state from public, anon, authenticated;
grant select, insert, update, delete on public.etsy_refund_status_sync_state to service_role;
