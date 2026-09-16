create index if not exists inventory_skus_normalized_sku_idx
  on public.inventory_skus ((lower(trim(sku))));

create index if not exists product_etsy_mappings_normalized_sku_idx
  on public.product_etsy_mappings ((lower(trim(etsy_sku))))
  where active is true;
