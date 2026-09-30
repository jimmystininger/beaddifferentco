create or replace function public.admin_patch_store_settings(p_patch jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, private
as $$
declare
  current_value jsonb := '{}'::jsonb;
  next_value jsonb;
begin
  select coalesce(value, '{}'::jsonb)
    into current_value
    from public.site_settings
   where key = 'store'
   for update;

  next_value := current_value || coalesce(p_patch, '{}'::jsonb);

  if jsonb_typeof(p_patch->'config') = 'object' then
    next_value := jsonb_set(
      next_value,
      '{config}',
      coalesce(current_value->'config', '{}'::jsonb) || p_patch->'config',
      true
    );
  end if;

  if jsonb_typeof(p_patch->'admin') = 'object' then
    next_value := jsonb_set(
      next_value,
      '{admin}',
      coalesce(current_value->'admin', '{}'::jsonb) || p_patch->'admin',
      true
    );
  end if;

  insert into public.site_settings (key, value, updated_at)
  values ('store', next_value, timezone('utc'::text, now()))
  on conflict (key) do update
    set value = excluded.value,
        updated_at = excluded.updated_at;

  return next_value;
end;
$$;

revoke all on function public.admin_patch_store_settings(jsonb) from public, anon;
grant execute on function public.admin_patch_store_settings(jsonb) to authenticated;

update storage.buckets
   set file_size_limit = 104857600,
       allowed_mime_types = array[
         'image/avif',
         'image/gif',
         'image/jpeg',
         'image/png',
         'image/webp',
         'video/mp4',
         'video/webm'
       ]::text[]
 where id = 'product-media';

create index if not exists admin_email_log_contact_id_idx on public.admin_email_log(contact_id);
create index if not exists business_bank_reconciliations_created_by_idx on public.business_bank_reconciliations(created_by);
create index if not exists business_expenses_created_by_idx on public.business_expenses(created_by);
create index if not exists contact_messages_responded_by_idx on public.contact_messages(responded_by);
create index if not exists contact_messages_user_id_idx on public.contact_messages(user_id);
create index if not exists customer_cart_items_product_id_idx on public.customer_cart_items(product_id);
create index if not exists email_campaigns_author_id_idx on public.email_campaigns(author_id);
create index if not exists email_campaigns_product_id_idx on public.email_campaigns(product_id);
create index if not exists etsy_import_listings_batch_id_idx on public.etsy_import_listings(batch_id);
create index if not exists etsy_import_listings_proposed_product_id_idx on public.etsy_import_listings(proposed_product_id);
create index if not exists etsy_import_orders_applied_order_id_idx on public.etsy_import_orders(applied_order_id);
create index if not exists etsy_import_orders_batch_id_idx on public.etsy_import_orders(batch_id);
create index if not exists etsy_import_review_targets_applied_review_id_idx on public.etsy_import_review_targets(applied_review_id);
create index if not exists etsy_import_reviews_applied_review_id_idx on public.etsy_import_reviews(applied_review_id);
create index if not exists etsy_import_reviews_batch_id_idx on public.etsy_import_reviews(batch_id);
create index if not exists etsy_import_reviews_matched_product_id_idx on public.etsy_import_reviews(matched_product_id);
create index if not exists etsy_import_sales_batch_id_idx on public.etsy_import_sales(batch_id);
create index if not exists inventory_adjustments_created_by_idx on public.inventory_adjustments(created_by);
create index if not exists inventory_manual_pack_allocations_created_by_idx on public.inventory_manual_pack_allocations(created_by);
create index if not exists inventory_purchase_lines_purchase_id_idx on public.inventory_purchase_lines(purchase_id);
create index if not exists inventory_purchases_created_by_idx on public.inventory_purchases(created_by);
create index if not exists order_financial_events_created_by_idx on public.order_financial_events(created_by);
create index if not exists order_financial_events_order_item_id_idx on public.order_financial_events(order_item_id);
create index if not exists order_notes_created_by_idx on public.order_notes(created_by);
create index if not exists order_support_request_events_created_by_idx on public.order_support_request_events(created_by);
create index if not exists order_support_request_events_order_id_idx on public.order_support_request_events(order_id);
create index if not exists order_support_requests_user_id_idx on public.order_support_requests(user_id);
create index if not exists product_change_history_created_by_idx on public.product_change_history(created_by);
create index if not exists product_change_history_inventory_sku_id_idx on public.product_change_history(inventory_sku_id);
create index if not exists product_filter_assignments_inventory_sku_id_idx on public.product_filter_assignments(inventory_sku_id);
create index if not exists waitlist_restock_notifications_inventory_sku_id_idx on public.waitlist_restock_notifications(inventory_sku_id);
create index if not exists waitlist_restock_notifications_restock_event_id_idx on public.waitlist_restock_notifications(restock_event_id);
