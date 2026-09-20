alter table public.analytics_events
  add column if not exists inventory_sku_id uuid references public.inventory_skus(id) on delete set null;

create index if not exists analytics_events_inventory_sku_type_idx
  on public.analytics_events(inventory_sku_id, event_type, created_at desc)
  where inventory_sku_id is not null;
