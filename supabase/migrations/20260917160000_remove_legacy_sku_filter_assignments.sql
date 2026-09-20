-- The original storefront-filter migration inferred assignments from product
-- options. Filter assignments are now explicit admin data only.
delete from public.product_filter_assignments;
