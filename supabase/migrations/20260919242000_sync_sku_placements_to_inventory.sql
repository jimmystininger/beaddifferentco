begin;

update public.product_option_values placement
set
  label = canonical.name,
  sku = canonical.sku,
  inventory_sku = canonical.sku,
  inventory_sku_id = canonical.id,
  quantity = canonical.quantity_on_hand,
  low_stock_threshold = canonical.reorder_point,
  unit_type = canonical.unit_type,
  price_delta = canonical.price - coalesce(product.price, 0)
from public.product_options option_group
join public.products product on product.id = option_group.product_id
cross join lateral (
  select inventory.id, inventory.sku, inventory.name, inventory.quantity_on_hand,
         inventory.reorder_point, inventory.unit_type, inventory.price
  from public.inventory_skus inventory
  where inventory.id = placement.inventory_sku_id
     or lower(trim(inventory.sku)) = lower(trim(coalesce(placement.inventory_sku, placement.sku)))
  order by (inventory.id = placement.inventory_sku_id) desc
  limit 1
) canonical
where placement.option_id = option_group.id
  and lower(trim(option_group.name)) = 'sku';

update public.products product
set sku_filter_definitions = coalesce(
  (
    select jsonb_agg(jsonb_build_object('label', trim(definition.value->>'label')) order by definition.ordinality)
    from jsonb_array_elements(coalesce(product.sku_filter_definitions, '[]'::jsonb)) with ordinality definition(value, ordinality)
    where nullif(trim(definition.value->>'label'), '') is not null
  ),
  '[]'::jsonb
);

commit;
