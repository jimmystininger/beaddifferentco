begin;

do $$
declare
  duplicate_product_id constant uuid := '0523d33b-ebc1-4553-92dd-efe4dc8fac52';
  canonical_product_id constant uuid := '4db79c9e-8022-48c1-a3cf-53ee06808540';
  mapping_id constant uuid := '5757a648-ddd0-4650-8fc2-2455b71aae6c';
  import_listing_id constant uuid := 'e2444ac7-b8df-4025-9866-377c89f0c29d';
begin
  if not exists (
    select 1
    from public.products duplicate_product
    where duplicate_product.id = duplicate_product_id
      and duplicate_product.external_id = 'ACR-16MM-YEL-SPRL-1PK'
      and duplicate_product.sku = 'ACR-16MM-YEL-SPRL-1PK'
      and duplicate_product.visible = false
      and not exists (
        select 1 from public.product_images image_record
        where image_record.product_id = duplicate_product.id
      )
  ) then
    raise exception 'Expected hidden duplicate product page no longer matches';
  end if;

  if not exists (
    select 1
    from public.products canonical_product
    where canonical_product.id = canonical_product_id
      and exists (
        select 1 from public.product_images image_record
        where image_record.product_id = canonical_product.id
      )
      and exists (
        select 1
        from public.product_options option_record
        join public.product_option_values value_record
          on value_record.option_id = option_record.id
        left join public.inventory_skus inventory_record
          on inventory_record.id = value_record.inventory_sku_id
        where option_record.product_id = canonical_product.id
          and upper(btrim(coalesce(
            nullif(btrim(value_record.sku), ''),
            nullif(btrim(value_record.inventory_sku), ''),
            nullif(btrim(inventory_record.sku), '')
          ))) = 'ACR-16MM-YEL-SPRL-1PK'
      )
      and exists (
        select 1
        from public.product_options option_record
        join public.product_option_values value_record
          on value_record.option_id = option_record.id
        left join public.inventory_skus inventory_record
          on inventory_record.id = value_record.inventory_sku_id
        where option_record.product_id = canonical_product.id
          and upper(btrim(coalesce(
            nullif(btrim(value_record.sku), ''),
            nullif(btrim(value_record.inventory_sku), ''),
            nullif(btrim(inventory_record.sku), '')
          ))) = 'ACR-16MM-YEL-SPRL-5PK'
      )
  ) then
    raise exception 'Expected image-backed parent with matching 1PK and 5PK options no longer exists';
  end if;

  if not exists (
    select 1
    from public.product_etsy_mappings mapping_record
    where mapping_record.id = mapping_id
      and mapping_record.product_id = duplicate_product_id
      and mapping_record.etsy_sku = 'ACR-16MM-YEL-SPRL-5PK'
      and mapping_record.inventory_sku_id = '9167db62-3fd0-45fd-92bf-2967d86168d9'
      and mapping_record.inventory_units = 5
      and mapping_record.active = true
  ) then
    raise exception 'Expected active Etsy mapping no longer matches';
  end if;

  if not exists (
    select 1
    from public.etsy_import_listings import_record
    where import_record.id = import_listing_id
      and import_record.proposed_product_id = duplicate_product_id
      and import_record.external_listing_id = '4519829677'
      and import_record.proposed_product_sku = 'ACR-16MM-YEL-SPRL-5PK'
      and import_record.review_status = 'pending'
  ) then
    raise exception 'Expected pending Etsy import record no longer matches';
  end if;

  if exists (
    select 1 from public.product_etsy_mappings mapping_record
    where mapping_record.product_id = canonical_product_id
      and lower(btrim(mapping_record.etsy_sku)) = 'acr-16mm-yel-sprl-5pk'
  ) then
    raise exception 'Canonical parent already has this Etsy mapping';
  end if;

  if exists (select 1 from public.product_etsy_mappings where product_id = duplicate_product_id and id <> mapping_id)
    or exists (select 1 from public.etsy_import_listings where proposed_product_id = duplicate_product_id and id <> import_listing_id)
    or exists (select 1 from public.etsy_import_reviews where matched_product_id = duplicate_product_id)
    or exists (select 1 from public.etsy_import_review_targets where product_id = duplicate_product_id)
    or exists (select 1 from public.order_items where product_id = duplicate_product_id)
    or exists (select 1 from public.reviews where product_id = duplicate_product_id)
    or exists (select 1 from public.waitlist_entries where product_id = duplicate_product_id)
    or exists (select 1 from public.inventory_adjustments where product_id = duplicate_product_id)
    or exists (
      select 1
      from public.product_options option_record
      join public.product_option_values value_record
        on value_record.option_id = option_record.id
      join public.inventory_adjustments adjustment_record
        on adjustment_record.option_value_id = value_record.id
      where option_record.product_id = duplicate_product_id
    )
    or exists (select 1 from public.product_change_history where product_id = duplicate_product_id)
    or exists (select 1 from public.inventory_bundle_components where product_id = duplicate_product_id)
    or exists (select 1 from public.customer_favorites where product_id = duplicate_product_id)
    or exists (select 1 from public.customer_cart_items where product_id = duplicate_product_id)
    or exists (select 1 from public.analytics_events where product_id = duplicate_product_id)
    or exists (select 1 from public.email_campaigns where product_id = duplicate_product_id)
    or exists (select 1 from public.product_filter_assignments where product_id = duplicate_product_id) then
    raise exception 'Unexpected product references prevent safe duplicate removal';
  end if;

  update public.product_etsy_mappings
  set product_id = canonical_product_id
  where id = mapping_id and product_id = duplicate_product_id;
  if not found then
    raise exception 'Etsy mapping could not be reassigned';
  end if;

  update public.etsy_import_listings
  set proposed_product_id = canonical_product_id
  where id = import_listing_id and proposed_product_id = duplicate_product_id;
  if not found then
    raise exception 'Pending Etsy import could not be reassigned';
  end if;

  delete from public.products
  where id = duplicate_product_id;
  if not found then
    raise exception 'Duplicate product page could not be removed';
  end if;
end;
$$;

commit;
