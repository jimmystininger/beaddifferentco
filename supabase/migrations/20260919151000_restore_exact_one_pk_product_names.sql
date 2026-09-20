update public.products product
set
  name = inventory.name,
  seo_title = case when product.seo_title = product.name then inventory.name else product.seo_title end,
  search_text = case when product.search_text = product.name then inventory.name else product.search_text end
from public.inventory_skus inventory
where lower(product.external_id) = lower(inventory.sku)
  and lower(inventory.sku) like '%-1pk'
  and product.name <> inventory.name;
