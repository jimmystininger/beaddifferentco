create temp table canonical_sku_values on commit drop as
with candidates as (
  select
    po.product_id,
    pov.label,
    pov.price_delta,
    pov.sku,
    pov.inventory_sku,
    pov.inventory_units,
    pov.quantity,
    pov.low_stock_threshold,
    pov.image_url,
    pov.unit_type,
    pov.inventory_sku_id,
    pov.sort_order as source_value_order,
    po.sort_order as source_option_order,
    row_number() over (
      partition by po.product_id, lower(coalesce(nullif(trim(pov.inventory_sku), ''), nullif(trim(pov.sku), '')))
      order by
        case when lower(trim(po.name)) = 'sku' then 0 else 1 end,
        po.sort_order,
        pov.sort_order,
        pov.id
    ) as duplicate_rank
  from public.product_options po
  join public.product_option_values pov on pov.option_id = po.id
  where coalesce(nullif(trim(pov.inventory_sku), ''), nullif(trim(pov.sku), '')) is not null
), deduped as (
  select * from candidates where duplicate_rank = 1
)
select
  *,
  row_number() over (
    partition by product_id
    order by
      case
        when coalesce(nullif(trim(inventory_sku), ''), nullif(trim(sku), '')) ~* '-([0-9]+)PK$'
          then ((regexp_match(coalesce(nullif(trim(inventory_sku), ''), nullif(trim(sku), '')), '-([0-9]+)PK$'))[1])::integer
        else 999999
      end,
      source_option_order,
      source_value_order,
      coalesce(inventory_sku, sku),
      product_id
  ) - 1 as canonical_order
from deduped;

create temp table canonical_sku_options on commit drop as
select distinct product_id, gen_random_uuid() as id
from canonical_sku_values;

insert into public.product_options (id, product_id, name, required, sort_order)
select id, product_id, 'SKU', true, 0
from canonical_sku_options;

insert into public.product_option_values (
  option_id,
  label,
  price_delta,
  sort_order,
  sku,
  inventory_sku,
  inventory_units,
  quantity,
  low_stock_threshold,
  image_url,
  unit_type,
  inventory_sku_id
)
select
  options.id,
  values.label,
  values.price_delta,
  values.canonical_order,
  values.sku,
  values.inventory_sku,
  values.inventory_units,
  values.quantity,
  values.low_stock_threshold,
  values.image_url,
  values.unit_type,
  values.inventory_sku_id
from canonical_sku_values values
join canonical_sku_options options on options.product_id = values.product_id;

delete from public.product_options
where product_id in (select product_id from canonical_sku_options)
  and id not in (select id from canonical_sku_options);
