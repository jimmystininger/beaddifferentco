create index if not exists orders_created_at_idx
  on public.orders(created_at desc);

create index if not exists reviews_created_at_idx
  on public.reviews(created_at desc);

create index if not exists waitlist_entries_status_created_at_idx
  on public.waitlist_entries(status, created_at desc);

create index if not exists customer_favorites_user_created_at_idx
  on public.customer_favorites(user_id, created_at desc);
