begin;

with image_products as materialized (
  select distinct product_id
  from public.product_images
), sku_links as materialized (
  select id as product_id, lower(btrim(sku)) as sku
  from public.products
  where nullif(btrim(sku), '') is not null

  union

  select option_record.product_id,
    lower(btrim(coalesce(
      nullif(btrim(value_record.sku), ''),
      nullif(btrim(value_record.inventory_sku), ''),
      nullif(btrim(inventory_record.sku), '')
    ))) as sku
  from public.product_options option_record
  join public.product_option_values value_record
    on value_record.option_id = option_record.id
  left join public.inventory_skus inventory_record
    on inventory_record.id = value_record.inventory_sku_id
  where nullif(btrim(coalesce(
    nullif(btrim(value_record.sku), ''),
    nullif(btrim(value_record.inventory_sku), ''),
    nullif(btrim(inventory_record.sku), '')
  )), '') is not null
), duplicate_pages as materialized (
  select product_record.id
  from public.products product_record
  where lower(coalesce(product_record.external_id, '')) like '%-1pk'
    and lower(btrim(product_record.sku)) = lower(btrim(product_record.external_id))
    and product_record.visible = false
    and not exists (
      select 1
      from image_products
      where image_products.product_id = product_record.id
    )
    and exists (
      select 1
      from sku_links
      join image_products
        on image_products.product_id = sku_links.product_id
      where sku_links.product_id <> product_record.id
        and sku_links.sku = lower(btrim(product_record.external_id))
    )
    and not exists (select 1 from public.order_items where product_id = product_record.id)
    and not exists (select 1 from public.reviews where product_id = product_record.id)
    and not exists (select 1 from public.waitlist_entries where product_id = product_record.id)
    and not exists (select 1 from public.product_etsy_mappings where product_id = product_record.id)
    and not exists (select 1 from public.etsy_import_review_targets where product_id = product_record.id)
    and not exists (select 1 from public.etsy_import_listings where proposed_product_id = product_record.id)
    and not exists (select 1 from public.etsy_import_reviews where matched_product_id = product_record.id)
    and not exists (select 1 from public.inventory_adjustments where product_id = product_record.id)
    and not exists (
      select 1
      from public.product_options option_record
      join public.product_option_values value_record
        on value_record.option_id = option_record.id
      join public.inventory_adjustments adjustment_record
        on adjustment_record.option_value_id = value_record.id
      where option_record.product_id = product_record.id
    )
    and not exists (select 1 from public.product_change_history where product_id = product_record.id)
    and not exists (select 1 from public.inventory_bundle_components where product_id = product_record.id)
    and not exists (select 1 from public.customer_favorites where product_id = product_record.id)
    and not exists (select 1 from public.customer_cart_items where product_id = product_record.id)
    and not exists (select 1 from public.analytics_events where product_id = product_record.id)
    and not exists (select 1 from public.email_campaigns where product_id = product_record.id)
    and not exists (select 1 from public.product_filter_assignments where product_id = product_record.id)
)
delete from public.products product_record
using duplicate_pages
where product_record.id = duplicate_pages.id;

commit;
