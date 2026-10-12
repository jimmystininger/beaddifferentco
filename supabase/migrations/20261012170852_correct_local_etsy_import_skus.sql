create or replace function public.correct_imported_etsy_sku_family(
  listing_id_value text,
  variant_rows_value jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  import_row public.etsy_import_listings%rowtype;
  variant jsonb;
  component jsonb;
  child_record public.inventory_skus%rowtype;
  parent_record public.inventory_skus%rowtype;
  component_record public.inventory_skus%rowtype;
  variant_sku text;
  corrected_sku text;
  component_sku text;
  component_quantity integer;
  components jsonb;
  updated_variants jsonb;
  updated_payload jsonb;
  batch_record record;
  mapping_record record;
  page_field text;
  updated_pages jsonb;
  updated_count integer := 0;
begin
  if not private.is_admin() then
    raise exception 'Admin access required.';
  end if;
  if nullif(trim(listing_id_value), '') is null or jsonb_typeof(variant_rows_value) <> 'array' then
    raise exception 'A listing ID and SKU family are required.';
  end if;

  select * into import_row
  from public.etsy_import_listings
  where external_listing_id = trim(listing_id_value)
  for update;
  if import_row.id is null then
    raise exception 'The imported Etsy listing could not be found.';
  end if;

  updated_payload := coalesce(import_row.raw_payload, '{}'::jsonb);
  updated_variants := coalesce(updated_payload->'variants', '[]'::jsonb);
  if jsonb_typeof(updated_variants) <> 'array' then
    raise exception 'The saved Etsy SKU family is unavailable; no changes were made.';
  end if;

  for variant in select value from jsonb_array_elements(variant_rows_value)
  loop
    variant_sku := upper(trim(coalesce(variant->>'etsy_sku', '')));
    corrected_sku := upper(trim(coalesce(variant->>'one_pk_sku', '')));
    if variant_sku = '' or corrected_sku = '' or corrected_sku !~ '^[A-Z0-9][A-Z0-9._/-]{0,119}$' then
      raise exception 'Enter a valid local SKU for every Etsy variant.';
    end if;
    if not exists (
      select 1 from jsonb_array_elements(updated_variants) as saved(value)
      where upper(trim(saved.value->>'etsy_sku')) = variant_sku
    ) then
      raise exception 'Etsy SKU % is not part of this saved listing; no changes were made.', variant_sku;
    end if;
    select * into child_record
    from public.inventory_skus inventory
    where inventory.source_metadata->>'source' = 'etsy_listing'
      and inventory.source_metadata->>'etsy_listing_id' = trim(listing_id_value)
      and upper(trim(inventory.source_metadata->>'etsy_sku')) = variant_sku
      and coalesce(inventory.source_metadata->>'disposition', '') = 'inventory'
      and inventory.source_metadata->>'pack_size' = '1'
    for update;
    if child_record.id is null then
      raise exception 'The local inventory SKU for Etsy SKU % could not be verified.', variant_sku;
    end if;
    if exists (select 1 from public.inventory_skus other where upper(trim(other.sku)) = corrected_sku and other.id <> child_record.id) then
      raise exception 'Local SKU % already belongs to another inventory record.', corrected_sku;
    end if;

    update public.inventory_skus
    set sku = corrected_sku,
        source_metadata = jsonb_set(coalesce(source_metadata, '{}'::jsonb), '{corrected_one_pk_sku}', to_jsonb(corrected_sku), true),
        updated_at = timezone('utc', now())
    where id = child_record.id;
    update public.product_option_values
    set inventory_sku = corrected_sku
    where inventory_sku_id = child_record.id;
    update public.product_etsy_mappings
    set inventory_sku = corrected_sku,
        inventory_sku_id = child_record.id
    where product_id = import_row.proposed_product_id
      and upper(trim(etsy_sku)) = variant_sku;

    if variant ? 'recipe_components' then
      components := coalesce(variant->'recipe_components', '[]'::jsonb);
      if jsonb_typeof(components) <> 'array' or jsonb_array_length(components) = 0 then
        raise exception 'Package Etsy SKU % needs at least one recipe component.', variant_sku;
      end if;
      if exists (
        select 1
        from jsonb_array_elements(components) as line(value)
        group by upper(trim(line.value->>'sku'))
        having count(*) > 1
      ) then
        raise exception 'Combine duplicate inventory SKUs into one recipe line for Etsy SKU %.', variant_sku;
      end if;
      select * into parent_record
      from public.inventory_skus inventory
      where upper(trim(inventory.sku)) = variant_sku
        and inventory.source_metadata->>'source' = 'etsy_listing'
        and inventory.source_metadata->>'etsy_listing_id' = trim(listing_id_value)
      for update;
      if parent_record.id is null then
        raise exception 'The imported package SKU % could not be verified for recipe editing.', variant_sku;
      end if;
      delete from public.inventory_bundle_components where bundle_sku_id = parent_record.id;
      for component in select value from jsonb_array_elements(components)
      loop
        component_sku := upper(trim(coalesce(component->>'sku', '')));
        if component_sku = '' or coalesce(component->>'quantity', '') !~ '^[1-9][0-9]*$' then
          raise exception 'Each recipe line needs an inventory SKU and a positive whole-number quantity.';
        end if;
        component_quantity := (component->>'quantity')::integer;
        select * into component_record
        from public.inventory_skus inventory
        where upper(trim(inventory.sku)) = component_sku
        for key share;
        if component_record.id is null then
          raise exception 'Recipe component SKU % does not exist in inventory.', component_sku;
        end if;
        if component_record.id = parent_record.id then
          raise exception 'A package cannot contain itself.';
        end if;
        insert into public.inventory_bundle_components(bundle_sku_id, component_sku_id, quantity, sort_order)
        values (parent_record.id, component_record.id, component_quantity, updated_count);
        updated_count := updated_count + 1;
      end loop;
      select mapping.id into mapping_record
      from public.product_etsy_mappings mapping
      where mapping.product_id = import_row.proposed_product_id
        and upper(trim(mapping.etsy_sku)) = variant_sku
      for update;
      if mapping_record.id is not null then
        delete from public.product_etsy_mapping_components where mapping_id = mapping_record.id;
        insert into public.product_etsy_mapping_components(mapping_id, inventory_sku_id, inventory_sku, inventory_units, sort_order)
        select mapping_record.id, component.component_sku_id, inventory.sku, component.quantity, component.sort_order
        from public.inventory_bundle_components component
        join public.inventory_skus inventory on inventory.id = component.component_sku_id
        where component.bundle_sku_id = parent_record.id;
      end if;
    end if;
  end loop;

  select jsonb_agg(
    case
      when exists (
        select 1 from jsonb_array_elements(variant_rows_value) as changed(value)
        where upper(trim(changed.value->>'etsy_sku')) = upper(trim(saved.value->>'etsy_sku'))
      ) then (
        select
        jsonb_set(
          jsonb_set(saved.value, '{one_pk_sku}', to_jsonb(upper(trim(changed.value->>'one_pk_sku'))), true),
          '{recipe_components}',
          coalesce(changed.value->'recipe_components', saved.value->'recipe_components', '[]'::jsonb),
          true
        )
        from jsonb_array_elements(variant_rows_value) as changed(value)
        where upper(trim(changed.value->>'etsy_sku')) = upper(trim(saved.value->>'etsy_sku'))
        limit 1
      )
      else saved.value
    end order by saved.ordinality
  ) into updated_variants
  from jsonb_array_elements(updated_variants) with ordinality saved(value, ordinality);
  updated_payload := jsonb_set(updated_payload, '{variants}', coalesce(updated_variants, '[]'::jsonb), true);
  updated_payload := jsonb_set(updated_payload, '{one_pk_sku}', coalesce((select saved.value->'one_pk_sku' from jsonb_array_elements(updated_variants) as saved(value) where upper(trim(saved.value->>'etsy_sku')) = upper(trim(updated_payload->>'sku')) limit 1), updated_payload->'one_pk_sku'), true);
  update public.etsy_import_listings
  set raw_payload = updated_payload,
      proposed_single_sku = coalesce((select saved.value->>'one_pk_sku' from jsonb_array_elements(updated_variants) as saved(value) where upper(trim(saved.value->>'etsy_sku')) = upper(trim(updated_payload->>'sku')) limit 1), proposed_single_sku),
      updated_at = timezone('utc', now())
  where id = import_row.id;

  if import_row.batch_id is not null then
    for batch_record in select id, metadata from public.etsy_import_batches where id = import_row.batch_id for update
    loop
      foreach page_field in array array['created_pages', 'existing_pages', 'failed_pages']
      loop
        select jsonb_agg(
          case when page.value->>'listing_id' = trim(listing_id_value)
            then jsonb_set(
              jsonb_set(page.value, '{family_skus}', updated_variants, true),
              '{one_pk_sku}',
              coalesce(updated_payload->'one_pk_sku', page.value->'one_pk_sku'),
              true
            )
            else page.value
          end order by page.ordinality
        ) into updated_pages
        from jsonb_array_elements(coalesce(batch_record.metadata->page_field, '[]'::jsonb)) with ordinality page(value, ordinality);
        batch_record.metadata := jsonb_set(coalesce(batch_record.metadata, '{}'::jsonb), array[page_field], coalesce(updated_pages, '[]'::jsonb), true);
      end loop;
      update public.etsy_import_batches set metadata = batch_record.metadata where id = batch_record.id;
    end loop;
  end if;

  return jsonb_build_object('listing_id', trim(listing_id_value), 'variants_updated', jsonb_array_length(variant_rows_value), 'recipe_components_saved', updated_count);
end;
$$;

revoke all on function public.correct_imported_etsy_sku_family(text, jsonb) from public;
grant execute on function public.correct_imported_etsy_sku_family(text, jsonb) to authenticated;
