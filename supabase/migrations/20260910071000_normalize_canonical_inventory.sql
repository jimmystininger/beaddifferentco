with category_by_sku as (
  select
    option_value.inventory_sku_id,
    min(product.category_slug) filter (where product.category_slug in (
      'beadable-products',
      'beadable-pen-blanks',
      'mixes-bundles-kits',
      'spacers-accessories',
      'acrylic-flatbacks',
      'rhinestone-beads',
      'focal-beads',
      'silicone',
      'acrylic',
      'cup-charms',
      'completed-pens-keychains',
      'charms-dangles',
      'clearance-section'
    )) as canonical_category,
    count(distinct product.category_slug) filter (where product.category_slug in (
      'beadable-products',
      'beadable-pen-blanks',
      'mixes-bundles-kits',
      'spacers-accessories',
      'acrylic-flatbacks',
      'rhinestone-beads',
      'focal-beads',
      'silicone',
      'acrylic',
      'cup-charms',
      'completed-pens-keychains',
      'charms-dangles',
      'clearance-section'
    )) as canonical_category_count
  from public.product_option_values as option_value
  join public.product_options as product_option on product_option.id = option_value.option_id
  join public.products as product on product.id = product_option.product_id
  group by option_value.inventory_sku_id
)
update public.inventory_skus as inventory
set category = case when category_by_sku.canonical_category_count = 1 then category_by_sku.canonical_category else null end,
    variant_name = null,
    hierarchy = null,
    income_account = null,
    expense_account = null,
    inventory_asset_account = null,
    sales_description = null,
    purchase_description = null,
    source_system = 'canonical',
    updated_at = timezone('utc', now())
from category_by_sku
where inventory.id = category_by_sku.inventory_sku_id;
