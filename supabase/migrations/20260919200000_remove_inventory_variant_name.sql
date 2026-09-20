drop view if exists public.storefront_inventory_skus;

alter table public.inventory_skus
  drop column if exists variant_name;

create view public.storefront_inventory_skus as
select id, sku, name, quantity_on_hand, reorder_point, price, unit_type
from public.inventory_skus;

grant select on public.storefront_inventory_skus to anon, authenticated;
