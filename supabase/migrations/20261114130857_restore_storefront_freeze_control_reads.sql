-- The public controls view is intentionally readable by the storefront. Its
-- security-definer helpers only read the two public freeze settings, so the
-- helper EXECUTE grants are required for the view to work for browser roles.
grant execute on function public.storefront_sales_frozen() to anon, authenticated;
grant execute on function public.etsy_imports_frozen() to anon, authenticated;

grant select on public.storefront_store_controls to anon, authenticated;
