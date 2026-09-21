begin;

-- These functions are invoked by table triggers, not by browser RPC calls.
-- Trigger execution does not require EXECUTE grants for anon/authenticated;
-- removing them narrows the public attack surface without changing writes.
revoke all on function private.redeem_customer_reward_promo() from public, anon, authenticated;
revoke all on function private.record_free_shipping_threshold() from public, anon, authenticated;
revoke all on function public.refresh_product_search_text() from public, anon, authenticated;
revoke all on function public.force_canonical_inventory_taxable() from public, anon, authenticated;
revoke all on function public.sync_inventory_bundle_component_skus() from public, anon, authenticated;
revoke all on function public.sync_inventory_bundle_component_sku_names() from public, anon, authenticated;
revoke all on function public.sync_product_etsy_mapping_component_sku() from public, anon, authenticated;
revoke all on function public.sync_product_etsy_mapping_component_sku_names() from public, anon, authenticated;
revoke all on function public.guard_order_reversal() from public, anon, authenticated;
revoke all on function public.prevent_legacy_product_option_image() from public, anon, authenticated;

commit;
