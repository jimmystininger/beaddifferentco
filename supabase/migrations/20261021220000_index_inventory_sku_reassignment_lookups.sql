create index if not exists etsy_sale_lines_reassignment_sku_lookup_idx
  on public.etsy_sale_lines (
    (lower(trim(coalesce(nullif(matched_inventory_sku, ''), nullif(etsy_sku, ''), '')))),
    sale_date desc
  );

create index if not exists etsy_import_sales_reassignment_sku_lookup_idx
  on public.etsy_import_sales (
    (lower(trim(coalesce(nullif(matched_inventory_sku, ''), nullif(etsy_sku, ''), '')))),
    sale_date desc
  );

create index if not exists order_items_reassignment_inventory_sku_lookup_idx
  on public.order_items ((lower(trim(coalesce(inventory_sku, '')))));

create index if not exists order_items_reassignment_sku_lookup_idx
  on public.order_items ((lower(trim(coalesce(sku, '')))));

create index if not exists order_items_reassignment_selected_sku_lookup_idx
  on public.order_items ((lower(trim(coalesce(selected_options ->> 'sku', '')))));

create index if not exists order_items_reassignment_selected_inventory_sku_lookup_idx
  on public.order_items ((lower(trim(coalesce(selected_options ->> 'inventorySku', '')))));

create index if not exists order_items_reassignment_selected_variant_sku_lookup_idx
  on public.order_items ((lower(trim(coalesce(selected_options ->> 'variantSku', '')))));

create index if not exists manual_sale_lines_reassignment_sku_lookup_idx
  on public.manual_sale_lines ((lower(trim(coalesce(sku, '')))));
