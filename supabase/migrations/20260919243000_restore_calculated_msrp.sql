drop view if exists public.storefront_inventory_skus;

create view public.storefront_inventory_skus
as
select
  inventory.id,
  inventory.sku,
  inventory.name,
  greatest(0, coalesce(inventory.quantity_on_hand, 0) - coalesce(inventory.reserve_quantity, 0)) as quantity_available,
  inventory.price,
  inventory.unit_type,
  inventory.weight_value,
  inventory.weight_unit,
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
  )::numeric, 2) as msrp,
  coalesce(inventory.source_metadata->'product_pages', '{}'::jsonb) as product_pages
from public.inventory_skus inventory;

revoke all on public.storefront_inventory_skus from public, anon, authenticated;
grant select on public.storefront_inventory_skus to anon, authenticated;
