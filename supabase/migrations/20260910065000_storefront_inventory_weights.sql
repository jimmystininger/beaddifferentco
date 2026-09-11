create or replace view public.storefront_inventory_skus as
select id, sku, name, variant_name, quantity_on_hand, reorder_point, price, unit_type, weight_value, weight_unit
from public.inventory_skus;

grant select on public.storefront_inventory_skus to anon, authenticated;
