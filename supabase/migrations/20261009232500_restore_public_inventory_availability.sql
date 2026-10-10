create function private.storefront_bundle_quantity_available(requested_sku text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select metrics.quantity_available
    from public.inventory_sku_bundle_metrics(requested_sku) metrics
  ), 0);
$$;

revoke all on function private.storefront_bundle_quantity_available(text) from public, anon, authenticated;
grant execute on function private.storefront_bundle_quantity_available(text) to anon, authenticated;

create or replace view public.storefront_inventory_skus as
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
      then private.storefront_bundle_quantity_available(inventory.sku)
    else greatest(0, coalesce(inventory.quantity_on_hand, 0) - coalesce(inventory.reserve_quantity, 0))
  end as quantity_available,
  inventory.price,
  inventory.unit_type,
  inventory.weight_value,
  inventory.weight_unit,
  coalesce((
    select jsonb_object_agg(page.product_id, page.page_data)
    from jsonb_each(
      case
        when jsonb_typeof(inventory.source_metadata->'product_pages') = 'object'
          then inventory.source_metadata->'product_pages'
        else '{}'::jsonb
      end
    ) as page(product_id, page_data)
    join public.products product
      on product.id::text = page.product_id
      and product.visible
  ), '{}'::jsonb) as product_pages
from public.inventory_skus inventory
where exists (
  select 1
  from public.product_option_values option_value
  join public.product_options product_option on product_option.id = option_value.option_id
  join public.products product on product.id = product_option.product_id
  where option_value.inventory_sku_id = inventory.id
    and product.visible
)
or exists (
  select 1
  from public.products product
  where product.sku = inventory.sku
    and product.visible
)
or exists (
  select 1
  from public.inventory_bundle_components recipe
  join public.product_option_values option_value on option_value.inventory_sku_id = recipe.bundle_sku_id
  join public.product_options product_option on product_option.id = option_value.option_id
  join public.products product on product.id = product_option.product_id
  where recipe.component_sku_id = inventory.id
    and product.visible
);
