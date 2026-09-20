begin;

create temporary table canonical_sku_category_answers on commit drop as
with candidates as (
  select
    assignment.inventory_sku_id,
    trim(definition.label) as name,
    trim(value.label) as value,
    definition.sort_order as definition_order,
    value.sort_order as value_order
  from public.product_filter_assignments assignment
  join public.storefront_filter_values value on value.id = assignment.filter_value_id
  join public.storefront_filter_definitions definition on definition.id = value.filter_id
  where assignment.inventory_sku_id is not null
    and definition.active
    and value.active
    and nullif(trim(definition.label), '') is not null
    and nullif(trim(value.label), '') is not null
), ranked as (
  select
    candidates.*,
    row_number() over (
      partition by inventory_sku_id, lower(name)
      order by definition_order, value_order, name, value
    ) as name_rank
  from candidates
), selected as (
  select inventory_sku_id, jsonb_build_object('name', name, 'value', value) as answer, definition_order, value_order
  from ranked
  where name_rank = 1
)
select inventory_sku_id, jsonb_agg(answer order by definition_order, value_order, answer->>'name') as variant_values
from selected
group by inventory_sku_id;

create temporary table canonical_sku_page_answers on commit drop as
with definition_answers as (
  select
    product.id as product_id,
    inventory.id as inventory_sku_id,
    trim(definition.value->>'label') as name,
    trim(definition_option.value) as value,
    1 as priority,
    definition.ordinality as definition_order,
    definition_option.ordinality as value_order
  from public.products product
  join public.product_options sku_option
    on sku_option.product_id = product.id
   and lower(trim(sku_option.name)) = 'sku'
  join public.product_option_values sku_value on sku_value.option_id = sku_option.id
  join public.inventory_skus inventory on inventory.id = sku_value.inventory_sku_id
  cross join lateral jsonb_array_elements(coalesce(product.sku_filter_definitions, '[]'::jsonb)) with ordinality as definition(value, ordinality)
  cross join lateral jsonb_each_text(coalesce(definition.value->'options', '{}'::jsonb)) with ordinality as definition_option(key, value, ordinality)
  where lower(definition_option.key) = lower(inventory.sku)
    and nullif(trim(definition.value->>'label'), '') is not null
    and nullif(trim(definition_option.value), '') is not null
), legacy_answers as (
  select
    product_option.product_id,
    inventory.id as inventory_sku_id,
    trim(product_option.name) as name,
    trim(option_value.label) as value,
    2 as priority,
    product_option.sort_order as definition_order,
    option_value.sort_order as value_order
  from public.product_options product_option
  join public.product_option_values option_value on option_value.option_id = product_option.id
  join public.inventory_skus inventory on inventory.id = option_value.inventory_sku_id
  where lower(trim(product_option.name)) <> 'sku'
    and nullif(trim(product_option.name), '') is not null
    and nullif(trim(option_value.label), '') is not null
), candidates as (
  select * from definition_answers
  union all
  select * from legacy_answers
), ranked as (
  select
    candidates.*,
    row_number() over (
      partition by product_id, inventory_sku_id, lower(name)
      order by priority, definition_order, value_order, name, value
    ) as name_rank
  from candidates
), selected as (
  select product_id, inventory_sku_id, name, value, definition_order, value_order
  from ranked
  where name_rank = 1
), page_options as (
  select
    product_id,
    inventory_sku_id,
    jsonb_agg(jsonb_build_object('name', name, 'value', value) order by definition_order, value_order, name) as options
  from selected
  group by product_id, inventory_sku_id
), grouped as (
  select
    inventory_sku_id,
    jsonb_object_agg(product_id::text, jsonb_build_object('options', options)) as product_pages
  from page_options
  group by inventory_sku_id
)
select inventory_sku_id, product_pages
from grouped;

update public.inventory_skus inventory
set source_metadata =
      jsonb_set(
        jsonb_set(
          coalesce(inventory.source_metadata, '{}'::jsonb),
          '{variant_values}',
          coalesce(category.variant_values, coalesce(inventory.source_metadata->'variant_values', '[]'::jsonb)),
          true
        ),
        '{product_pages}',
        coalesce(pages.product_pages, coalesce(inventory.source_metadata->'product_pages', '{}'::jsonb)),
        true
      ),
    updated_at = timezone('utc', now())
from canonical_sku_category_answers category
left join canonical_sku_page_answers pages on pages.inventory_sku_id = category.inventory_sku_id
where inventory.id = category.inventory_sku_id;

update public.inventory_skus inventory
set source_metadata = jsonb_set(
      coalesce(inventory.source_metadata, '{}'::jsonb),
      '{product_pages}',
      pages.product_pages,
      true
    ),
    updated_at = timezone('utc', now())
from canonical_sku_page_answers pages
where inventory.id = pages.inventory_sku_id
  and not exists (
    select 1
    from canonical_sku_category_answers category
    where category.inventory_sku_id = inventory.id
  );

commit;
