begin;

delete from public.product_option_values
where option_id in (
  select id
  from public.product_options
  where lower(trim(name)) <> 'sku'
);

delete from public.product_options
where lower(trim(name)) <> 'sku';

update public.products product
set sku_filter_definitions = coalesce(
      (
        select jsonb_agg(
                 jsonb_build_object('label', trim(definition.value->>'label'))
                 order by definition.ordinality
               )
        from jsonb_array_elements(coalesce(product.sku_filter_definitions, '[]'::jsonb))
             with ordinality as definition(value, ordinality)
        where nullif(trim(definition.value->>'label'), '') is not null
      ),
      '[]'::jsonb
    ),
    updated_at = timezone('utc', now())
where jsonb_typeof(product.sku_filter_definitions) = 'array';

update public.product_option_values
set sku_filter_options = '[]'::jsonb;

create or replace function public.product_page_filter_labels_only(value jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(coalesce(value, '[]'::jsonb)) = 'array'
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(value, '[]'::jsonb)) definition
      cross join lateral jsonb_object_keys(definition) as object_key(name)
      where object_key.name <> 'label'
    );
$$;

alter table public.products
  drop constraint if exists products_sku_filter_definitions_labels_only;

alter table public.products
  add constraint products_sku_filter_definitions_labels_only
  check (public.product_page_filter_labels_only(sku_filter_definitions));

alter table public.product_option_values
  drop constraint if exists product_option_values_no_legacy_filter_answers;

alter table public.product_option_values
  add constraint product_option_values_no_legacy_filter_answers
  check (sku_filter_options = '[]'::jsonb);

commit;
