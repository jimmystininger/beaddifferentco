do $$
declare
  import_definition text;
  reapply_definition text;
  patched_import_definition text;
  patched_reapply_definition text;
begin
  select pg_get_functiondef('public.import_etsy_sales(jsonb,boolean)'::regprocedure)
    into import_definition;
  import_definition := replace(replace(import_definition, E'\r\n', E'\n'), E'\r', E'\n');
  patched_import_definition := import_definition;
  patched_import_definition := replace(patched_import_definition, E'  mapping_id_value uuid;\n', '');
  patched_import_definition := replace(patched_import_definition, E'  mapping_inventory_units integer;\n', '');
  patched_import_definition := replace(patched_import_definition,
    E'    mapping_id_value := null;\n    mapping_inventory_sku := null;\n    mapping_inventory_units := 1;\n',
    E'    mapping_inventory_sku := null;\n');
  patched_import_definition := replace(patched_import_definition, $legacy_lookup$
    if mapping_inventory_sku is null then
      select m.id, m.inventory_sku, m.inventory_units
        into mapping_id_value, mapping_inventory_sku, mapping_inventory_units
      from public.product_etsy_mappings m
      where lower(trim(m.etsy_sku)) = lower(etsy_sku_value)
        and m.active is true
      order by m.sort_order, m.created_at
      limit 1;
    end if;
$legacy_lookup$, '');
  patched_import_definition := replace(patched_import_definition, $mix_gate$
    if lower(etsy_sku_value) ~ '(mix|random|assort)' then
      mapping_inventory_sku := null;
      mapping_id_value := null;
      mapping_inventory_units := 1;
    end if;
$mix_gate$, '');
  patched_import_definition := regexp_replace(patched_import_definition,
    E'    if exists \\(\n      select 1 from public\\.product_etsy_mapping_components c where c\\.mapping_id = mapping_id_value\n    \\) then.*?    else\n(?=      for requirement in\n        select expanded\\.component_sku,)',
    '', 's');
  patched_import_definition := replace(patched_import_definition,
    E'               sum(expanded.quantity * greatest(1, mapping_inventory_units) * abs(delta_units))::integer as quantity',
    E'               sum(expanded.quantity * abs(delta_units))::integer as quantity');
  patched_import_definition := replace(patched_import_definition,
    E'      end loop;\n    end if;\n\n    update public.etsy_sale_lines\n    set inventory_units_applied = desired_units,',
    E'      end loop;\n\n    update public.etsy_sale_lines\n    set inventory_units_applied = desired_units,');

  if position('product_etsy_mapping' in patched_import_definition) > 0
     or position('mapping_id_value' in patched_import_definition) > 0
     or position('mapping_inventory_units' in patched_import_definition) > 0
     or position('(mix|random|assort)' in patched_import_definition) > 0 then
    raise exception 'Unable to remove legacy Etsy mapping and mix-only matching from sales import.';
  end if;
  if patched_import_definition <> import_definition then
    execute patched_import_definition;
  end if;

  select pg_get_functiondef('public.reapply_etsy_unmatched_sales(text)'::regprocedure)
    into reapply_definition;
  reapply_definition := replace(replace(reapply_definition, E'\r\n', E'\n'), E'\r', E'\n');
  patched_reapply_definition := reapply_definition;
  patched_reapply_definition := replace(patched_reapply_definition, E'  mapping_id_value uuid;\n', '');
  patched_reapply_definition := replace(patched_reapply_definition, E'  mapping_inventory_units integer := 1;\n', '');
  patched_reapply_definition := replace(patched_reapply_definition,
    E'  mapping_id_value := null;\n  mapping_inventory_sku := null;\n  mapping_inventory_units := 1;\n',
    E'  mapping_inventory_sku := null;\n');
  patched_reapply_definition := replace(patched_reapply_definition, $legacy_reapply_lookup$
  if mapping_inventory_sku is null then
    select m.id, m.inventory_sku, m.inventory_units
      into mapping_id_value, mapping_inventory_sku, mapping_inventory_units
    from public.product_etsy_mappings m
    where lower(trim(m.etsy_sku)) = lower(requested_sku)
      and m.active is true
    order by m.sort_order, m.created_at
    limit 1;
  end if;
$legacy_reapply_lookup$, '');
  patched_reapply_definition := replace(patched_reapply_definition,
    'No active Etsy mapping or canonical inventory SKU exists for %',
    'No canonical inventory SKU matches %');
  patched_reapply_definition := regexp_replace(patched_reapply_definition,
    E'  if mapping_id_value is not null\n     and exists \\(select 1 from public\\.product_etsy_mapping_components c where c\\.mapping_id = mapping_id_value\\)\n     and not exists \\(.*?  end if;\n\n',
    '', 's');
  patched_reapply_definition := regexp_replace(patched_reapply_definition,
    E'      if mapping_id_value is not null\n         and exists \\(select 1 from public\\.product_etsy_mapping_components c where c\\.mapping_id = mapping_id_value\\) then.*?      else\n(?=        for requirement in\n          select expanded\\.component_sku,)',
    '', 's');
  patched_reapply_definition := replace(patched_reapply_definition,
    E'                 sum(expanded.quantity * greatest(1, mapping_inventory_units) * abs(delta_units))::integer as quantity',
    E'                 sum(expanded.quantity * abs(delta_units))::integer as quantity');
  patched_reapply_definition := replace(patched_reapply_definition,
    E'  if mapping_id_value is null\n     and not exists',
    E'  if not exists');
  patched_reapply_definition := replace(patched_reapply_definition,
    E'        end loop;\n      end if;\n    end if;\n\n    update public.etsy_sale_lines',
    E'        end loop;\n      end if;\n\n    update public.etsy_sale_lines');
  patched_reapply_definition := replace(patched_reapply_definition,
    'Automatically matched after the canonical SKU or Etsy mapping was created.',
    'Automatically matched after its canonical inventory SKU was created.');

  if position('product_etsy_mapping' in patched_reapply_definition) > 0
     or position('mapping_id_value' in patched_reapply_definition) > 0
     or position('mapping_inventory_units' in patched_reapply_definition) > 0 then
    raise exception 'Unable to remove legacy Etsy mapping dependency from sale reapplication.';
  end if;
  if patched_reapply_definition <> reapply_definition then
    execute patched_reapply_definition;
  end if;
end;
$$;
