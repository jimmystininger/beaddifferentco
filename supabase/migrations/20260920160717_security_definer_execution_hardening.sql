begin;

-- These functions are not part of the storefront API. The first exposes
-- internal inventory cost data; the second is an obsolete admin-only import
-- path. Keep them callable by service_role for controlled maintenance only.
revoke execute on function public.inventory_sku_bundle_metrics(text) from public, anon, authenticated;
revoke execute on function public.apply_staged_historical_etsy_sales() from public, anon, authenticated;
grant execute on function public.inventory_sku_bundle_metrics(text) to service_role;
grant execute on function public.apply_staged_historical_etsy_sales() to service_role;

-- Public catalog RPCs evaluate RLS policies that call this boolean-only
-- security-definer helper. Anonymous callers must be able to execute it so
-- those policies resolve to false instead of aborting the storefront query.
grant execute on function private.is_admin() to anon, authenticated;

-- Keep trigger lookup behavior deterministic regardless of caller/session
-- search_path settings.
alter function public.refresh_product_search_text() set search_path = public, pg_catalog;

-- The storefront only reads freeze-state controls. Do not expose write-class
-- privileges on the public security-definer view.
revoke all on table public.storefront_store_controls from anon, authenticated;
grant select on table public.storefront_store_controls to anon, authenticated;

commit;
