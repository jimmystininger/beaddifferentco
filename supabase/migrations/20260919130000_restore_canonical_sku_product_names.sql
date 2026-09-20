with canonical as (
  select pov.id,
         coalesce(
           nullif(trim(i.source_metadata->>'variant_name'), ''),
           concat(
             'Acrylic ',
             trim(i.name),
             ' ',
             replace(trim(i.source_metadata->>'pack_display_name'), ' Pack', 'PK')
           )
         ) as label
  from public.product_option_values pov
  join public.product_options po on po.id = pov.option_id and lower(po.name) = 'sku'
  join public.inventory_skus i on lower(i.sku) = lower(coalesce(pov.inventory_sku, pov.sku))
  where lower(trim(coalesce(pov.label,''))) in ('green','red','christmas')
    and i.name is not null
)
update public.product_option_values pov
set label = canonical.label
from canonical
where pov.id = canonical.id;
