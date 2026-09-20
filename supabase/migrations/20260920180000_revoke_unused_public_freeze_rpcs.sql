begin;

-- Freeze state is exposed through storefront_store_controls. These helper
-- functions are only called by trusted database code and are not part of the
-- browser API, so do not leave direct anonymous execution enabled.
revoke execute on function public.storefront_sales_frozen() from public, anon, authenticated;
revoke execute on function public.etsy_imports_frozen() from public, anon, authenticated;
grant execute on function public.storefront_sales_frozen() to service_role;
grant execute on function public.etsy_imports_frozen() to service_role;

commit;
