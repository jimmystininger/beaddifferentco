do $$
declare
  import_definition text;
  patched_import_definition text;
  reapply_definition text;
  patched_reapply_definition text;
  old_import_lookup text := $old_import$
    select m.id, m.inventory_sku, m.inventory_units
      into mapping_id_value, mapping_inventory_sku, mapping_inventory_units
    from public.product_etsy_mappings m
    where lower(trim(m.etsy_sku)) = lower(etsy_sku_value)
      and m.active is true
    order by m.sort_order, m.created_at
    limit 1;

    if mapping_inventory_sku is null then
      select i.sku
        into mapping_inventory_sku
      from public.inventory_skus i
      where lower(trim(i.sku)) = lower(etsy_sku_value)
      limit 1;
      if mapping_inventory_sku is not null then
        mapping_inventory_units := 1;
      end if;
    end if;
$old_import$;
  new_import_lookup text := $new_import$
    mapping_id_value := null;
    mapping_inventory_sku := null;
    mapping_inventory_units := 1;

    select i.sku
      into mapping_inventory_sku
    from public.inventory_skus i
    where lower(trim(i.sku)) = lower(etsy_sku_value)
    limit 1;

    if mapping_inventory_sku is null then
      select m.id, m.inventory_sku, m.inventory_units
        into mapping_id_value, mapping_inventory_sku, mapping_inventory_units
      from public.product_etsy_mappings m
      where lower(trim(m.etsy_sku)) = lower(etsy_sku_value)
        and m.active is true
      order by m.sort_order, m.created_at
      limit 1;
    end if;
$new_import$;
  old_reapply_lookup text := $old_reapply$
  select m.id, m.inventory_sku, m.inventory_units
    into mapping_id_value, mapping_inventory_sku, mapping_inventory_units
  from public.product_etsy_mappings m
  where lower(trim(m.etsy_sku)) = lower(requested_sku)
    and m.active is true
  order by m.sort_order, m.created_at
  limit 1;

  if mapping_inventory_sku is null then
    select i.sku
      into mapping_inventory_sku
    from public.inventory_skus i
    where lower(trim(i.sku)) = lower(requested_sku)
    limit 1;
    if mapping_inventory_sku is not null then
      mapping_inventory_units := 1;
    end if;
  end if;
$old_reapply$;
  new_reapply_lookup text := $new_reapply$
  mapping_id_value := null;
  mapping_inventory_sku := null;
  mapping_inventory_units := 1;

  select i.sku
    into mapping_inventory_sku
  from public.inventory_skus i
  where lower(trim(i.sku)) = lower(requested_sku)
  limit 1;

  if mapping_inventory_sku is null then
    select m.id, m.inventory_sku, m.inventory_units
      into mapping_id_value, mapping_inventory_sku, mapping_inventory_units
    from public.product_etsy_mappings m
    where lower(trim(m.etsy_sku)) = lower(requested_sku)
      and m.active is true
    order by m.sort_order, m.created_at
    limit 1;
  end if;
$new_reapply$;
begin
  select pg_get_functiondef('public.import_etsy_sales(jsonb,boolean)'::regprocedure)
    into import_definition;
  import_definition := replace(replace(import_definition, E'\r\n', E'\n'), E'\r', E'\n');
  patched_import_definition := replace(import_definition, old_import_lookup, new_import_lookup);
  if patched_import_definition = import_definition then
    raise exception 'Unable to change Etsy sales to prefer exact canonical SKU matches.';
  end if;
  execute patched_import_definition;

  select pg_get_functiondef('public.reapply_etsy_unmatched_sales(text)'::regprocedure)
    into reapply_definition;
  reapply_definition := replace(replace(reapply_definition, E'\r\n', E'\n'), E'\r', E'\n');
  patched_reapply_definition := replace(reapply_definition, old_reapply_lookup, new_reapply_lookup);
  if patched_reapply_definition = reapply_definition then
    raise exception 'Unable to change Etsy sale reapplication to prefer exact canonical SKU matches.';
  end if;
  execute patched_reapply_definition;
end;
$$;
