begin;

create temporary table recovery_one_pk_pages on commit drop as
select
  lower(one.sku) as one_sku,
  regexp_replace(lower(one.sku), '-1pk$', '') as family,
  one.name as one_name,
  one.price as one_price,
  one.quantity_on_hand as one_quantity,
  one.cost as one_cost,
  one.reorder_point as one_reorder_point,
  one.unit_type as one_unit_type,
  one.id as one_inventory_sku_id,
  source_product.id as source_product_id,
  source_product.category_slug,
  source_product.subcategory_slug,
  source_product.description,
  source_product.item_details,
  source_product.shipping_details,
  source_product.waitlist_enabled,
  source_product.visible,
  source_product.added_at,
  source_product.etsy_units_per_sale,
  source_product.promo_discount_percent,
  source_product.short_description,
  source_product.featured,
  source_product.sku_filter_definitions
from public.inventory_skus one
join lateral (
  select product.*
  from public.product_option_values source_value
  join public.product_options source_option on source_option.id = source_value.option_id
  join public.products product on product.id = source_option.product_id
  where lower(source_value.inventory_sku) = lower(one.sku)
  order by product.added_at nulls last, product.id
  limit 1
) source_product on true
where lower(one.sku) like '%-1pk'
  and not exists (
    select 1
    from public.products existing_product
    where lower(existing_product.external_id) = lower(one.sku)
  );

insert into public.products (
  external_id,
  sku,
  category_slug,
  subcategory_slug,
  name,
  seo_title,
  search_text,
  description,
  item_details,
  shipping_details,
  price,
  quantity,
  visible,
  waitlist_enabled,
  added_at,
  estimated_cost,
  low_stock_threshold,
  badges,
  promo_price,
  promo_starts_at,
  promo_ends_at,
  etsy_units_per_sale,
  promo_discount_percent,
  promo_skus,
  short_description,
  featured,
  sku_filter_definitions
)
select
  page.one_sku,
  page.one_sku,
  page.category_slug,
  page.subcategory_slug,
  page.one_name,
  page.one_name,
  page.one_name,
  page.description,
  page.item_details,
  page.shipping_details,
  coalesce(page.one_price, 0),
  greatest(page.one_quantity, 0),
  page.visible,
  page.waitlist_enabled,
  page.added_at,
  coalesce(page.one_cost, 0),
  greatest(page.one_reorder_point, 0),
  '[]'::jsonb,
  null,
  null,
  null,
  coalesce(page.etsy_units_per_sale, 1),
  coalesce(page.promo_discount_percent, 0),
  '[]'::jsonb,
  page.short_description,
  coalesce(page.featured, false),
  coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'label', definition.value->>'label',
        'options', matching.options
      )
      order by definition.ordinality
    )
    from jsonb_array_elements(coalesce(page.sku_filter_definitions, '[]'::jsonb)) with ordinality definition(value, ordinality)
    cross join lateral (
      select jsonb_object_agg(option_entry.key, option_entry.value order by option_entry.key) as options
      from jsonb_each(coalesce(definition.value->'options', '{}'::jsonb)) option_entry
      where regexp_replace(lower(option_entry.key), '-(1|5|10|20)pk$', '') = page.family
        and exists (
          select 1
          from public.inventory_skus matching_inventory
          where lower(matching_inventory.sku) = lower(option_entry.key)
        )
    ) matching
    where matching.options is not null
  ), '[]'::jsonb)
from recovery_one_pk_pages page;

create temporary table recovery_created_products on commit drop as
select created.id, created.external_id, page.*
from public.products created
join recovery_one_pk_pages page on page.one_sku = lower(created.external_id);

insert into public.product_categories (product_id, category_slug, sort_order)
select created.id, source_category.category_slug, source_category.sort_order
from recovery_created_products created
join public.product_categories source_category on source_category.product_id = created.source_product_id
on conflict (product_id, category_slug) do nothing;

create temporary table recovery_created_options (
  id uuid not null,
  product_id uuid not null
) on commit drop;

with inserted_options as (
  insert into public.product_options (product_id, name, required, sort_order)
  select created.id, 'SKU', true, 0
  from recovery_created_products created
  returning id, product_id
)
insert into recovery_created_options (id, product_id)
select id, product_id
from inserted_options;

insert into public.product_option_values (
  option_id,
  label,
  price_delta,
  sku,
  inventory_sku,
  inventory_units,
  quantity,
  low_stock_threshold,
  image_url,
  unit_type,
  inventory_sku_id,
  sku_filter_options,
  sort_order
)
select
  option_row.id,
  case
    when upper(inventory.sku) like '%-1PK' then inventory.name
    else inventory.name || ' ' || upper(regexp_replace(inventory.sku, '^.*-(1|5|10|20)PK$', '\1PK'))
  end,
  coalesce(inventory.price, 0) - coalesce(created.one_price, 0),
  inventory.sku,
  inventory.sku,
  coalesce(source_value.inventory_units, 1),
  greatest(inventory.quantity_on_hand, 0),
  greatest(inventory.reorder_point, 0),
  source_value.image_url,
  coalesce(source_value.unit_type, inventory.unit_type, 'Each'),
  inventory.id,
  '[]'::jsonb,
  case upper(regexp_replace(inventory.sku, '^.*-(1|5|10|20)PK$', '\1'))
    when '1' then 0
    when '5' then 1
    when '10' then 2
    when '20' then 3
  end
from recovery_created_products created
join recovery_created_options option_row on option_row.product_id = created.id
join public.inventory_skus inventory
  on regexp_replace(lower(inventory.sku), '-(1|5|10|20)pk$', '') = created.family
 and lower(inventory.sku) ~ '-(1|5|10|20)pk$'
left join lateral (
  select source_value.inventory_units, source_value.image_url, source_value.unit_type
  from public.product_option_values source_value
  join public.product_options source_option on source_option.id = source_value.option_id
  where source_option.product_id = created.source_product_id
    and source_option.name = 'SKU'
    and lower(source_value.inventory_sku) = lower(inventory.sku)
  order by source_value.sort_order, source_value.id
  limit 1
) source_value on true;

insert into public.product_images (product_id, url, alt_text, sort_order, media_type)
select distinct on (created.id, source_value.image_url)
  created.id,
  source_value.image_url,
  inventory.name,
  row_number() over (partition by created.id order by source_value.sort_order, source_value.id) - 1,
  case when source_value.image_url ~* '\.(mp4|m4v|webm|mov|ogv)([?#].*)?$' then 'video' else 'image' end
from recovery_created_products created
join public.product_option_values source_value on true
join public.product_options source_option on source_option.id = source_value.option_id
join public.inventory_skus inventory on lower(inventory.sku) = lower(source_value.inventory_sku)
where source_option.product_id = created.source_product_id
  and source_option.name = 'SKU'
  and source_value.image_url is not null
  and regexp_replace(lower(source_value.inventory_sku), '-(1|5|10|20)pk$', '') = created.family
order by created.id, source_value.image_url, source_value.sort_order, source_value.id;

insert into public.product_filter_assignments (product_id, filter_value_id, inventory_sku_id)
select distinct
  created.id,
  source_assignment.filter_value_id,
  source_assignment.inventory_sku_id
from recovery_created_products created
join public.product_filter_assignments source_assignment on source_assignment.product_id = created.source_product_id
join public.inventory_skus assigned_inventory on assigned_inventory.id = source_assignment.inventory_sku_id
where regexp_replace(lower(assigned_inventory.sku), '-(1|5|10|20)pk$', '') = created.family
on conflict do nothing;

commit;
