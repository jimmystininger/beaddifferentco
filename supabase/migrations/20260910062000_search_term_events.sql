alter table public.analytics_events
  add column if not exists search_term text;

alter table public.analytics_events
  drop constraint if exists analytics_events_event_type_check;

alter table public.analytics_events
  add constraint analytics_events_event_type_check
  check (event_type in ('view', 'cart_add', 'purchase', 'search', 'search_result'));

create index if not exists analytics_events_search_term_idx
  on public.analytics_events(created_at desc, search_term)
  where event_type = 'search';
