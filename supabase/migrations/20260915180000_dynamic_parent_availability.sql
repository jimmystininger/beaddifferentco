drop view if exists public.storefront_inventory_skus;

create view public.storefront_inventory_skus
as
select
  inventory.id,
  inventory.sku,
  inventory.name,
  inventory.variant_name,
  case
    when lower(coalesce(inventory.item_type, 'inventory')) = 'non-inventory'
      and exists (
        select 1
        from public.inventory_bundle_components recipe
        where recipe.bundle_sku_id = inventory.id
      )
      then coalesce((
        select metrics.quantity_available
        from public.inventory_sku_bundle_metrics(inventory.sku) metrics
      ), 0)
    else greatest(0, coalesce(inventory.quantity_on_hand, 0) - coalesce(inventory.reserve_quantity, 0))
  end as quantity_available,
  inventory.price,
  inventory.unit_type,
  inventory.weight_value,
  inventory.weight_unit
from public.inventory_skus inventory;

revoke all on public.storefront_inventory_skus from public, anon, authenticated;
grant select on public.storefront_inventory_skus to anon, authenticated;
