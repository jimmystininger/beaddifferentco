create index if not exists products_lower_sku_idx
  on public.products (lower(sku));

create index if not exists product_option_values_lower_sku_idx
  on public.product_option_values (lower(sku))
  where sku is not null;

create index if not exists product_option_values_lower_inventory_sku_idx
  on public.product_option_values (lower(inventory_sku))
  where inventory_sku is not null;

create index if not exists etsy_sale_lines_lower_matched_sku_status_idx
  on public.etsy_sale_lines (lower(matched_inventory_sku), status)
  where matched_inventory_sku is not null;
