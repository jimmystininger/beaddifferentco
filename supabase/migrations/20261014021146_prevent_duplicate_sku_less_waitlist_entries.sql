create unique index if not exists waitlist_entries_waiting_product_no_sku_unique
  on public.waitlist_entries(user_id, product_id)
  where status = 'waiting' and inventory_sku_id is null;
