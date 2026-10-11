begin;

create temporary table etsy_import_duplicate_product_reconciliation (
  listing_id text primary key,
  duplicate_product_id uuid not null unique,
  canonical_product_id uuid not null
) on commit drop;

with imported as (
  select product_record.id as duplicate_product_id,
    import_record.external_listing_id as listing_id,
    import_record.raw_payload
  from public.products product_record
  join public.etsy_import_listings import_record
    on import_record.proposed_product_id = product_record.id
  where product_record.created_at >= '2026-10-11 00:00:00+00'
    and import_record.created_at >= '2026-10-11 00:00:00+00'
    and product_record.etsy_listing_id::text = import_record.external_listing_id
), expected as (
  select imported.duplicate_product_id,
    imported.listing_id,
    count(distinct upper(btrim(source_sku.value))) as sku_count
  from imported
  cross join lateral jsonb_array_elements_text(
    coalesce(imported.raw_payload->'variant_skus', '[]'::jsonb)
  ) as source_sku(value)
  where nullif(btrim(source_sku.value), '') is not null
  group by imported.duplicate_product_id, imported.listing_id
), candidates as (
  select expected.duplicate_product_id,
    expected.listing_id,
    canonical_product.id as canonical_product_id,
    count(distinct upper(btrim(source_sku.value))) as matched_sku_count
  from expected
  join imported
    on imported.duplicate_product_id = expected.duplicate_product_id
    and imported.listing_id = expected.listing_id
  cross join lateral jsonb_array_elements_text(
    coalesce(imported.raw_payload->'variant_skus', '[]'::jsonb)
  ) as source_sku(value)
  join public.products canonical_product
    on canonical_product.id <> expected.duplicate_product_id
    and canonical_product.created_at < '2026-10-11 00:00:00+00'
  join public.product_options option_record
    on option_record.product_id = canonical_product.id
    and option_record.name = 'SKU'
  join public.product_option_values option_value
    on option_value.option_id = option_record.id
    and (
      upper(btrim(coalesce(option_value.sku, ''))) = upper(btrim(source_sku.value))
      or upper(btrim(coalesce(option_value.inventory_sku, ''))) = upper(btrim(source_sku.value))
    )
  where nullif(btrim(source_sku.value), '') is not null
  group by expected.duplicate_product_id,
    expected.listing_id,
    expected.sku_count,
    canonical_product.id
  having count(distinct upper(btrim(source_sku.value))) = expected.sku_count
), unique_candidates as (
  select candidates.duplicate_product_id,
    candidates.listing_id,
    min(candidates.canonical_product_id::text)::uuid as canonical_product_id
  from candidates
  group by candidates.duplicate_product_id, candidates.listing_id
  having count(*) = 1
)
insert into etsy_import_duplicate_product_reconciliation (
  listing_id,
  duplicate_product_id,
  canonical_product_id
)
select unique_candidates.listing_id,
  unique_candidates.duplicate_product_id,
  unique_candidates.canonical_product_id
from unique_candidates;

do $$
declare
  duplicate_count integer;
  deleted_count integer;
begin
  select count(*) into duplicate_count
  from etsy_import_duplicate_product_reconciliation;
  if duplicate_count <> 23 then
    raise exception 'Expected 23 unambiguous Etsy-import duplicates; found %; no pages were removed', duplicate_count;
  end if;

  if exists (
    select 1
    from etsy_import_duplicate_product_reconciliation reconciliation
    left join public.products duplicate_product
      on duplicate_product.id = reconciliation.duplicate_product_id
    left join public.products canonical_product
      on canonical_product.id = reconciliation.canonical_product_id
    where duplicate_product.id is null
      or canonical_product.id is null
      or duplicate_product.etsy_listing_id::text <> reconciliation.listing_id
      or duplicate_product.created_at < '2026-10-11 00:00:00+00'
      or canonical_product.created_at >= '2026-10-11 00:00:00+00'
      or not exists (
        select 1
        from public.etsy_import_listings import_record
        where import_record.proposed_product_id = duplicate_product.id
          and import_record.external_listing_id = reconciliation.listing_id
      )
  ) then
    raise exception 'An Etsy duplicate no longer matches its verified import page; no pages were removed';
  end if;

  if exists (
    select 1 from public.order_items record
    join etsy_import_duplicate_product_reconciliation reconciliation
      on reconciliation.duplicate_product_id = record.product_id
    union all
    select 1 from public.reviews record
    join etsy_import_duplicate_product_reconciliation reconciliation
      on reconciliation.duplicate_product_id = record.product_id
    union all
    select 1 from public.waitlist_entries record
    join etsy_import_duplicate_product_reconciliation reconciliation
      on reconciliation.duplicate_product_id = record.product_id
    union all
    select 1 from public.customer_cart_items record
    join etsy_import_duplicate_product_reconciliation reconciliation
      on reconciliation.duplicate_product_id = record.product_id
    union all
    select 1 from public.customer_favorites record
    join etsy_import_duplicate_product_reconciliation reconciliation
      on reconciliation.duplicate_product_id = record.product_id
    union all
    select 1 from public.inventory_adjustments record
    join etsy_import_duplicate_product_reconciliation reconciliation
      on reconciliation.duplicate_product_id = record.product_id
    union all
    select 1
    from public.product_options option_record
    join public.product_option_values option_value
      on option_value.option_id = option_record.id
    join public.inventory_adjustments adjustment_record
      on adjustment_record.option_value_id = option_value.id
    join etsy_import_duplicate_product_reconciliation reconciliation
      on reconciliation.duplicate_product_id = option_record.product_id
    union all
    select 1 from public.inventory_bundle_components record
    join etsy_import_duplicate_product_reconciliation reconciliation
      on reconciliation.duplicate_product_id = record.product_id
    union all
    select 1 from public.product_change_history record
    join etsy_import_duplicate_product_reconciliation reconciliation
      on reconciliation.duplicate_product_id = record.product_id
    union all
    select 1 from public.etsy_import_review_targets record
    join etsy_import_duplicate_product_reconciliation reconciliation
      on reconciliation.duplicate_product_id = record.product_id
    union all
    select 1 from public.etsy_import_reviews record
    join etsy_import_duplicate_product_reconciliation reconciliation
      on reconciliation.duplicate_product_id = record.matched_product_id
    union all
    select 1 from public.analytics_events record
    join etsy_import_duplicate_product_reconciliation reconciliation
      on reconciliation.duplicate_product_id = record.product_id
    union all
    select 1 from public.email_campaigns record
    join etsy_import_duplicate_product_reconciliation reconciliation
      on reconciliation.duplicate_product_id = record.product_id
    union all
    select 1 from public.product_filter_assignments record
    join etsy_import_duplicate_product_reconciliation reconciliation
      on reconciliation.duplicate_product_id = record.product_id
  ) then
    raise exception 'Customer, order, review, or inventory records reference an imported duplicate; no pages were removed';
  end if;

  if exists (
    select 1
    from etsy_import_duplicate_product_reconciliation reconciliation
    join public.product_etsy_mappings duplicate_mapping
      on duplicate_mapping.product_id = reconciliation.duplicate_product_id
    join public.product_etsy_mappings canonical_mapping
      on canonical_mapping.product_id = reconciliation.canonical_product_id
      and upper(btrim(canonical_mapping.etsy_sku)) = upper(btrim(duplicate_mapping.etsy_sku))
  ) then
    raise exception 'A canonical page already has a matching Etsy mapping; no pages were removed';
  end if;

  insert into public.product_images (product_id, url, alt_text, sort_order, media_type)
  with unique_images as (
    select distinct on (reconciliation.canonical_product_id, duplicate_image.url)
      reconciliation.canonical_product_id,
      duplicate_image.url,
      duplicate_image.alt_text,
      duplicate_image.sort_order,
      duplicate_image.media_type
    from etsy_import_duplicate_product_reconciliation reconciliation
    join public.product_images duplicate_image
      on duplicate_image.product_id = reconciliation.duplicate_product_id
    where duplicate_image.url is not null
      and not exists (
      select 1 from public.product_images canonical_image
      where canonical_image.product_id = reconciliation.canonical_product_id
        and canonical_image.url = duplicate_image.url
    )
    order by reconciliation.canonical_product_id,
      duplicate_image.url,
      duplicate_image.sort_order nulls last,
      duplicate_image.id
  ), numbered_images as (
    select unique_images.*,
      row_number() over (
        partition by unique_images.canonical_product_id
        order by unique_images.sort_order nulls last, unique_images.url
      ) as image_number
    from unique_images
  ), canonical_max_order as (
    select product_id, coalesce(max(sort_order), -1) as max_sort_order
    from public.product_images
    group by product_id
  )
  select numbered_images.canonical_product_id,
    numbered_images.url,
    numbered_images.alt_text,
    coalesce(canonical_max_order.max_sort_order, -1) + numbered_images.image_number,
    numbered_images.media_type
  from numbered_images
  left join canonical_max_order
    on canonical_max_order.product_id = numbered_images.canonical_product_id;

  insert into public.product_categories (product_id, category_slug, sort_order)
  select distinct on (reconciliation.canonical_product_id, duplicate_category.category_slug)
    reconciliation.canonical_product_id,
    duplicate_category.category_slug,
    duplicate_category.sort_order
  from etsy_import_duplicate_product_reconciliation reconciliation
  join public.product_categories duplicate_category
    on duplicate_category.product_id = reconciliation.duplicate_product_id
  order by reconciliation.canonical_product_id,
    duplicate_category.category_slug,
    duplicate_category.sort_order
  on conflict (product_id, category_slug) do nothing;

  update public.product_etsy_mappings mapping_record
  set product_id = reconciliation.canonical_product_id
  from etsy_import_duplicate_product_reconciliation reconciliation
  where mapping_record.product_id = reconciliation.duplicate_product_id;

  update public.etsy_import_listings import_record
  set proposed_product_id = reconciliation.canonical_product_id
  from etsy_import_duplicate_product_reconciliation reconciliation
  where import_record.proposed_product_id = reconciliation.duplicate_product_id
    and import_record.external_listing_id = reconciliation.listing_id;

  delete from public.products duplicate_product
  using etsy_import_duplicate_product_reconciliation reconciliation
  where duplicate_product.id = reconciliation.duplicate_product_id;
  get diagnostics deleted_count = row_count;
  if deleted_count <> duplicate_count then
    raise exception 'Expected to remove % duplicate pages; removed %; transaction rolled back', duplicate_count, deleted_count;
  end if;
end;
$$;

commit;
