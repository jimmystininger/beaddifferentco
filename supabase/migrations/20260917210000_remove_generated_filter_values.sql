-- Remove filter values created by the legacy metadata backfill.
-- Keep the original configured choices (sort_order < 1000) intact.
begin;

update public.product_option_values pov
set sku_filter_options = coalesce((
  select jsonb_agg(entry order by ord)
  from jsonb_array_elements(coalesce(pov.sku_filter_options, '[]'::jsonb))
    with ordinality as items(entry, ord)
  where not exists (
    select 1
    from public.storefront_filter_values v
    where v.sort_order >= 1000
      and v.id::text = coalesce(
        entry->>'filter_value_id',
        entry->>'filterValueId',
        entry->>'value_id',
        entry->>'valueId'
      )
  )
), '[]'::jsonb)
where pov.sku_filter_options is not null
  and jsonb_array_length(pov.sku_filter_options) > 0;

delete from public.storefront_filter_values
where sort_order >= 1000;

commit;
