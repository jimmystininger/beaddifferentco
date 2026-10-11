begin;

create temporary table etsy_import_review_queue_reconciliation (
  batch_id uuid not null,
  listing_id text not null,
  canonical_product_id uuid not null,
  canonical_product_name text not null,
  page jsonb not null,
  primary key (batch_id, listing_id)
) on commit drop;

insert into etsy_import_review_queue_reconciliation (
  batch_id,
  listing_id,
  canonical_product_id,
  canonical_product_name,
  page
)
select batch_record.id,
  page_record.value->>'listing_id',
  import_record.proposed_product_id,
  canonical_product.name,
  page_record.value
from public.etsy_import_batches batch_record
cross join lateral jsonb_array_elements(
  coalesce(batch_record.metadata->'created_pages', '[]'::jsonb)
) as page_record(value)
join public.etsy_import_listings import_record
  on import_record.external_listing_id = page_record.value->>'listing_id'
join public.products canonical_product
  on canonical_product.id = import_record.proposed_product_id
where (batch_record.kind = 'listings' or batch_record.import_type = 'listings')
  and coalesce((page_record.value->>'created')::boolean, false)
  and import_record.proposed_product_id::text <> page_record.value->>'product_id'
  and not exists (
    select 1
    from public.products old_product
    where old_product.id::text = page_record.value->>'product_id'
  );

do $$
begin
  if exists (
    select 1
    from etsy_import_review_queue_reconciliation reconciliation
    where jsonb_typeof(reconciliation.page->'family_skus') <> 'array'
      or jsonb_array_length(coalesce(reconciliation.page->'family_skus', '[]'::jsonb)) = 0
      or exists (
        select 1
        from jsonb_array_elements(coalesce(reconciliation.page->'family_skus', '[]'::jsonb)) as family(value)
        where nullif(btrim(family.value->>'etsy_sku'), '') is null
          or not exists (
            select 1
            from public.product_options option_record
            join public.product_option_values option_value
              on option_value.option_id = option_record.id
            where option_record.product_id = reconciliation.canonical_product_id
              and option_record.name = 'SKU'
              and (
                upper(btrim(coalesce(option_value.sku, ''))) = upper(btrim(family.value->>'etsy_sku'))
                or upper(btrim(coalesce(option_value.inventory_sku, ''))) = upper(btrim(family.value->>'etsy_sku'))
                or upper(btrim(coalesce(option_value.sku, ''))) = upper(btrim(family.value->>'one_pk_sku'))
                or upper(btrim(coalesce(option_value.inventory_sku, ''))) = upper(btrim(family.value->>'one_pk_sku'))
              )
          )
      )
  ) then
    raise exception 'An import page no longer matches every SKU on its canonical product; review history was not changed';
  end if;

  if exists (
    select 1
    from etsy_import_review_queue_reconciliation reconciliation
    join public.etsy_import_batches batch_record
      on batch_record.id = reconciliation.batch_id
    cross join lateral jsonb_array_elements(
      coalesce(batch_record.metadata->'existing_pages', '[]'::jsonb)
    ) as existing_page(value)
    where existing_page.value->>'listing_id' = reconciliation.listing_id
  ) then
    raise exception 'A reconciled listing is already in the existing-pages history; no duplicate history entry was added';
  end if;
end;
$$;

with batch_pages as (
  select batch_record.id as batch_id,
    batch_record.metadata,
    coalesce((
      select jsonb_agg(page_record.value order by page_record.ordinality)
      from jsonb_array_elements(coalesce(batch_record.metadata->'created_pages', '[]'::jsonb))
        with ordinality as page_record(value, ordinality)
      where not exists (
        select 1
        from etsy_import_review_queue_reconciliation reconciliation
        where reconciliation.batch_id = batch_record.id
          and reconciliation.listing_id = page_record.value->>'listing_id'
      )
    ), '[]'::jsonb) as remaining_created_pages,
    coalesce((
      select jsonb_agg(
        reconciliation.page || jsonb_build_object(
          'product_id', reconciliation.canonical_product_id,
          'product_name', reconciliation.canonical_product_name,
          'created', false,
          'product_page_existed', true,
          'reconciled_duplicate_page', true
        ) order by reconciliation.listing_id
      )
      from etsy_import_review_queue_reconciliation reconciliation
      where reconciliation.batch_id = batch_record.id
    ), '[]'::jsonb) as reconciled_existing_pages
  from public.etsy_import_batches batch_record
  where exists (
    select 1
    from etsy_import_review_queue_reconciliation reconciliation
    where reconciliation.batch_id = batch_record.id
  )
)
update public.etsy_import_batches batch_record
set metadata = jsonb_set(
  jsonb_set(
    batch_pages.metadata,
    '{created_pages}',
    batch_pages.remaining_created_pages,
    true
  ),
  '{existing_pages}',
  coalesce(batch_pages.metadata->'existing_pages', '[]'::jsonb) || batch_pages.reconciled_existing_pages,
  true
)
from batch_pages
where batch_record.id = batch_pages.batch_id;

commit;
