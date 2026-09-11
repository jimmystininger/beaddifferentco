alter table public.inventory_bundle_components
  add column if not exists product_id uuid references public.products(id) on delete cascade;

create index if not exists inventory_bundle_components_product_idx
  on public.inventory_bundle_components(product_id, bundle_sku_id, sort_order);

update public.inventory_bundle_components recipe
set product_id = product.id
from public.products product
join public.product_options option_row on option_row.product_id = product.id
join public.product_option_values option_value on option_value.option_id = option_row.id
where recipe.product_id is null
  and option_value.inventory_sku_id = recipe.bundle_sku_id;
