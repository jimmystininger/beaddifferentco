create or replace view public.storefront_inventory_skus as
select
  inventory.id,
  inventory.sku,
  inventory.name,
  inventory.variant_name,
  inventory.quantity_on_hand,
  inventory.reorder_point,
  inventory.price,
  inventory.unit_type,
  inventory.weight_value,
  inventory.weight_unit,
  inventory.reserve_quantity,
  round((
    coalesce((
      select sum(coalesce(component.cost, 0) * recipe.quantity)
      from public.inventory_bundle_components recipe
      join public.inventory_skus component on component.id = recipe.component_sku_id
      where recipe.bundle_sku_id = inventory.id
    ), inventory.cost, 0)
    * (1 + greatest(0, coalesce(
      nullif((select value->'config'->>'msrpMarkupPercent' from public.site_settings where key = 'store' limit 1), '')::numeric,
      100
    )) / 100)
  )::numeric, 2) as msrp
from public.inventory_skus inventory;

grant select on public.storefront_inventory_skus to anon, authenticated;
