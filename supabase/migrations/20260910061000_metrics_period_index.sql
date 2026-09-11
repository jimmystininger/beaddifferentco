create index if not exists analytics_events_created_at_idx
  on public.analytics_events(created_at desc);
