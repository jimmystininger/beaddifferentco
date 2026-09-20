begin;

update public.inventory_skus inventory
set source_metadata = jsonb_set(
  coalesce(inventory.source_metadata, '{}'::jsonb),
  '{product_pages}',
  coalesce(
    (
      select jsonb_object_agg(
        page.key,
        case
          when jsonb_typeof(page.value) = 'object'
            then page.value || jsonb_build_object('options', '[]'::jsonb)
          else jsonb_build_object('options', '[]'::jsonb)
        end
      )
      from jsonb_each(
        case
          when jsonb_typeof(inventory.source_metadata->'product_pages') = 'object'
            then inventory.source_metadata->'product_pages'
          else '{}'::jsonb
        end
      ) page
    ),
    '{}'::jsonb
  ),
  true
), updated_at = timezone('utc', now())
where jsonb_typeof(inventory.source_metadata->'product_pages') = 'object';

update public.products
set sku_filter_definitions = coalesce(
  (
    select jsonb_agg(jsonb_build_object('label', trim(definition.value->>'label')) order by definition.ordinality)
    from jsonb_array_elements(coalesce(products.sku_filter_definitions, '[]'::jsonb)) with ordinality definition(value, ordinality)
    where nullif(trim(definition.value->>'label'), '') is not null
  ),
  '[]'::jsonb
), updated_at = timezone('utc', now());

update public.product_option_values
set sku_filter_options = '[]'::jsonb
where sku_filter_options is distinct from '[]'::jsonb;

commit;
