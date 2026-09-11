update public.inventory_skus as inventory
set source_system = 'canonical'
where exists (
  select 1
  from public.product_option_values as option_value
  where option_value.inventory_sku_id = inventory.id
);

delete from public.inventory_skus as inventory
where not exists (
  select 1
  from public.product_option_values as option_value
  where option_value.inventory_sku_id = inventory.id
)
and not exists (
  select 1
  from public.product_etsy_mappings as mapping
  where mapping.inventory_sku_id = inventory.id
);
