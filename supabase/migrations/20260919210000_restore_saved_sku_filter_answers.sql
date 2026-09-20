begin;

create temporary table recovered_sku_filter_answers on commit drop as
select
  product.id as product_id,
  inventory.id as inventory_sku_id,
  inventory.sku,
  trim(answer.value->>'name') as filter_name,
  trim(answer.value->>'value') as filter_value,
  answer.ordinality as answer_position
from public.products product
join public.product_options sku_option
  on sku_option.product_id = product.id
 and lower(trim(sku_option.name)) = 'sku'
join public.product_option_values sku_value
  on sku_value.option_id = sku_option.id
join public.inventory_skus inventory
  on inventory.id = sku_value.inventory_sku_id
cross join lateral jsonb_array_elements(
  case
    when jsonb_typeof(inventory.source_metadata->'variant_values') = 'array'
      then inventory.source_metadata->'variant_values'
    else '[]'::jsonb
  end
) with ordinality as answer(value, ordinality)
where nullif(trim(answer.value->>'name'), '') is not null
  and nullif(trim(answer.value->>'value'), '') is not null;

with recovered_names as (
  select
    product_id,
    filter_name,
    min(answer_position) as first_position
  from recovered_sku_filter_answers
  group by product_id, filter_name
), ranked_names as (
  select
    product_id,
    filter_name,
    row_number() over (
      partition by product_id
      order by first_position, filter_name
    ) - 1 as filter_position
  from recovered_names
), grouped_answers as (
  select
    ranked.product_id,
    ranked.filter_name,
    ranked.filter_position,
    recovered.sku,
    max(recovered.filter_value) as filter_value
  from ranked_names ranked
  join recovered_sku_filter_answers recovered
    on recovered.product_id = ranked.product_id
   and recovered.filter_name = ranked.filter_name
  where ranked.filter_position < 3
  group by ranked.product_id, ranked.filter_name, ranked.filter_position, recovered.sku
), definition_options as (
  select
    product_id,
    filter_name,
    filter_position,
    jsonb_object_agg(sku, filter_value) as options
  from grouped_answers
  group by product_id, filter_name, filter_position
), derived_definitions as (
  select
    product_id,
    jsonb_agg(
      jsonb_build_object('label', filter_name, 'options', options)
      order by filter_position
    ) as definitions
  from definition_options
  group by product_id
), existing_definitions as (
  select
    product.id as product_id,
    jsonb_agg(
      jsonb_build_object(
        'label', definition.value->>'label',
        'options', coalesce(definition.value->'options', '{}'::jsonb) || coalesce(recovered.options, '{}'::jsonb)
      )
      order by definition.ordinality
    ) as definitions
  from public.products product
  cross join lateral jsonb_array_elements(product.sku_filter_definitions) with ordinality as definition(value, ordinality)
  left join lateral (
    select jsonb_object_agg(answer.sku, answer.filter_value) as options
    from recovered_sku_filter_answers answer
    where answer.product_id = product.id
      and lower(answer.filter_name) = lower(trim(definition.value->>'label'))
  ) recovered on true
  where jsonb_typeof(product.sku_filter_definitions) = 'array'
    and jsonb_array_length(product.sku_filter_definitions) > 0
  group by product.id
)
update public.products product
set sku_filter_definitions = coalesce(existing.definitions, derived.definitions, '[]'::jsonb),
    updated_at = now()
from derived_definitions derived
full join existing_definitions existing using (product_id)
where product.id = coalesce(existing.product_id, derived.product_id)
  and coalesce(existing.definitions, derived.definitions) is not null;

insert into public.product_filter_assignments (product_id, filter_value_id, inventory_sku_id)
select distinct
  answer.product_id,
  filter_value.id,
  answer.inventory_sku_id
from recovered_sku_filter_answers answer
join public.storefront_filter_definitions filter_definition
  on lower(trim(filter_definition.label)) = lower(answer.filter_name)
 and filter_definition.active
join public.storefront_filter_values filter_value
  on filter_value.filter_id = filter_definition.id
 and filter_value.active
 and (
   lower(trim(filter_value.label)) = lower(answer.filter_value)
   or lower(trim(filter_value.value_key)) = lower(answer.filter_value)
 )
on conflict do nothing;

insert into public.product_filter_assignments (product_id, filter_value_id, inventory_sku_id)
select distinct
  product_option.product_id,
  filter_value.id,
  inventory_sku.id
from public.product_options product_option
join public.product_option_values option_value
  on option_value.option_id = product_option.id
join public.inventory_skus inventory_sku
  on inventory_sku.id = option_value.inventory_sku_id
cross join lateral jsonb_array_elements(
  case
    when jsonb_typeof(option_value.sku_filter_options) = 'array'
      then option_value.sku_filter_options
    else '[]'::jsonb
  end
) as saved_filter(value)
join public.storefront_filter_values filter_value
  on filter_value.id = coalesce(
    nullif(saved_filter.value->>'filter_value_id', '')::uuid,
    nullif(saved_filter.value->>'filterValueId', '')::uuid,
    nullif(saved_filter.value->>'value_id', '')::uuid,
    nullif(saved_filter.value->>'valueId', '')::uuid
  )
where product_option.name = 'SKU'
  and filter_value.active;

commit;
