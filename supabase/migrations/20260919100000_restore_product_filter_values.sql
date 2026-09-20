create temporary table restored_product_filter_names on commit drop as
with extracted as (
  select
    product_option.product_id,
    trim(variant_value.value->>'name') as name,
    min(variant_value.ordinality)::integer as first_position
  from public.product_options product_option
  join public.product_option_values option_value
    on option_value.option_id = product_option.id
  join public.inventory_skus inventory_sku
    on inventory_sku.id = option_value.inventory_sku_id
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(inventory_sku.source_metadata->'variant_values') = 'array'
        then inventory_sku.source_metadata->'variant_values'
      else '[]'::jsonb
    end
  ) with ordinality as variant_value(value, ordinality)
  where trim(variant_value.value->>'name') <> ''
  group by product_option.product_id, trim(variant_value.value->>'name')
), ranked as (
  select
    product_id,
    name,
    row_number() over (partition by product_id order by first_position, name)::integer - 1 as position
  from extracted
)
select product_id, name, position
from ranked
where position < 3;

insert into public.product_options (product_id, name, required, sort_order)
select restored.product_id, restored.name, false, 100 + restored.position
from restored_product_filter_names restored
where not exists (
  select 1
  from public.product_options existing
  where existing.product_id = restored.product_id
    and existing.name = restored.name
);

with product_skus as (
  select distinct
    product_option.product_id,
    option_value.inventory_sku_id,
    inventory_sku.sku,
    inventory_sku.source_metadata
  from public.product_options product_option
  join public.product_option_values option_value
    on option_value.option_id = product_option.id
  join public.inventory_skus inventory_sku
    on inventory_sku.id = option_value.inventory_sku_id
  where product_option.sort_order < 100
), values_to_restore as (
  select
    product_option.id as option_id,
    product_sku.inventory_sku_id,
    product_sku.sku,
    trim(variant_value.value->>'value') as label,
    row_number() over (
      partition by product_option.id
      order by product_sku.sku, variant_value.ordinality
    )::integer - 1 as sort_order
  from restored_product_filter_names restored
  join public.product_options product_option
    on product_option.product_id = restored.product_id
   and product_option.name = restored.name
  join product_skus product_sku
    on product_sku.product_id = restored.product_id
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(product_sku.source_metadata->'variant_values') = 'array'
        then product_sku.source_metadata->'variant_values'
      else '[]'::jsonb
    end
  ) with ordinality as variant_value(value, ordinality)
  where restored.position < 3
    and trim(variant_value.value->>'name') = restored.name
    and trim(variant_value.value->>'value') <> ''
)
insert into public.product_option_values (
  option_id,
  label,
  sku,
  inventory_sku,
  inventory_sku_id,
  sort_order
)
select
  restored.option_id,
  restored.label,
  restored.sku,
  restored.sku,
  restored.inventory_sku_id,
  restored.sort_order
from values_to_restore restored
where not exists (
  select 1
  from public.product_option_values existing
  where existing.option_id = restored.option_id
    and existing.inventory_sku_id = restored.inventory_sku_id
    and existing.label = restored.label
);
