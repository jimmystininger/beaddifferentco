alter policy inventory_bundle_components_storefront_read
  on public.inventory_bundle_components
  to anon, authenticated
  using (
    exists (
      select 1
      from public.products product
      where product.sku = inventory_bundle_components.bundle_sku
        and product.visible
    )
    or exists (
      select 1
      from public.products product
      where product.id = inventory_bundle_components.product_id
        and product.visible
    )
    or exists (
      select 1
      from public.product_option_values option_value
      join public.product_options product_option
        on product_option.id = option_value.option_id
      join public.products product
        on product.id = product_option.product_id
      where option_value.inventory_sku_id = inventory_bundle_components.bundle_sku_id
        and product.visible
    )
  );
