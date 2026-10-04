create or replace function public.create_inventory_sku_batch(sku_rows jsonb, recipe_rows jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  sku_row jsonb;
  recipe_row jsonb;
  sku_value text;
  normalized_sku text;
  sku_type_value text;
  product_name_value text;
  price_value numeric;
  unit_value text;
  cost_value numeric;
  weight_value_value numeric;
  weight_unit_value text;
  quantity_value integer;
  reserve_value integer;
  reorder_value integer;
  parent_sku_value text;
  child_sku_value text;
  normalized_parent_sku text;
  normalized_child_sku text;
  recipe_quantity integer;
  parent_id uuid;
  child_id uuid;
  parent_type text;
  child_type text;
  seen_skus text[] := array[]::text[];
  seen_recipe_keys text[] := array[]::text[];
  seen_recipe_parents text[] := array[]::text[];
  recipe_key text;
  created_sku_count integer := 0;
  created_recipe_count integer := 0;
  recipe_parent_count integer := 0;
begin
  if not private.is_admin() then
    raise exception 'Admin access required.';
  end if;
  if sku_rows is null or jsonb_typeof(sku_rows) <> 'array' then
    raise exception 'SKU rows must be a JSON array.';
  end if;
  if recipe_rows is null or jsonb_typeof(recipe_rows) <> 'array' then
    raise exception 'Recipe rows must be a JSON array.';
  end if;
  if jsonb_array_length(sku_rows) = 0 then
    raise exception 'Add at least one SKU before importing.';
  end if;
  if jsonb_array_length(sku_rows) > 1000 then
    raise exception 'Bulk SKU creator accepts at most 1000 SKUs per import.';
  end if;
  if jsonb_array_length(recipe_rows) > 5000 then
    raise exception 'Bulk SKU creator accepts at most 5000 recipe components per import.';
  end if;

  for sku_row in select value from jsonb_array_elements(sku_rows) as entries(value)
  loop
    if jsonb_typeof(sku_row) <> 'object' then
      raise exception 'Every SKU row must be an object.';
    end if;

    sku_value := nullif(trim(sku_row->>'sku'), '');
    if sku_value is null then
      raise exception 'Every SKU row requires an SKU.';
    end if;
    normalized_sku := lower(sku_value);
    if normalized_sku = any(seen_skus) then
      raise exception 'The import contains duplicate SKU %.', sku_value;
    end if;
    if exists (select 1 from public.inventory_skus where lower(trim(sku)) = normalized_sku) then
      raise exception 'SKU % already exists in canonical inventory.', sku_value;
    end if;
    seen_skus := array_append(seen_skus, normalized_sku);

    sku_type_value := lower(coalesce(nullif(trim(sku_row->>'sku_type'), ''), 'child'));
    if sku_type_value not in ('child', 'parent') then
      raise exception 'SKU % must be marked child or parent.', sku_value;
    end if;
    product_name_value := nullif(trim(sku_row->>'product_name'), '');
    if product_name_value is null then
      raise exception 'SKU % requires a product name.', sku_value;
    end if;
    price_value := nullif(trim(sku_row->>'price'), '')::numeric;
    if price_value is null or price_value < 0 then
      raise exception 'SKU % requires a non-negative price.', sku_value;
    end if;

    if sku_type_value = 'parent' then
      insert into public.inventory_skus (
        sku, name, quantity_on_hand, reorder_point, reserve_quantity, item_type,
        hierarchy, category, taxable, price, unit_type, source_system, source_metadata
      ) values (
        sku_value, product_name_value, 0, 0, 0, 'Non-inventory',
        'Parent', 'mixes-bundles-kits', true, price_value, 'Each',
        'bulk-sku-creator', jsonb_build_object('source', 'bulk-sku-creator')
      );
      created_sku_count := created_sku_count + 1;
      continue;
    end if;

    unit_value := nullif(trim(sku_row->>'unit'), '');
    if unit_value is null then
      raise exception 'Child SKU % requires a unit.', sku_value;
    end if;
    quantity_value := coalesce(nullif(trim(sku_row->>'qty'), ''), '0')::integer;
    reserve_value := coalesce(nullif(trim(sku_row->>'reserve_buffer'), ''), '0')::integer;
    reorder_value := coalesce(nullif(trim(sku_row->>'low_stock'), ''), '0')::integer;
    if quantity_value < 0 or reserve_value < 0 or reorder_value < 0 then
      raise exception 'Child SKU % quantities and thresholds cannot be negative.', sku_value;
    end if;
    cost_value := nullif(trim(sku_row->>'cost'), '')::numeric;
    weight_value_value := nullif(trim(sku_row->>'weight'), '')::numeric;
    if cost_value is not null and cost_value < 0 then
      raise exception 'Child SKU % cost cannot be negative.', sku_value;
    end if;
    if weight_value_value is not null and weight_value_value < 0 then
      raise exception 'Child SKU % weight cannot be negative.', sku_value;
    end if;
    weight_unit_value := lower(coalesce(nullif(trim(sku_row->>'weight_unit'), ''), 'oz'));
    if weight_unit_value not in ('oz', 'lb', 'g', 'kg') then
      raise exception 'Child SKU % has an invalid weight unit.', sku_value;
    end if;

    insert into public.inventory_skus (
      sku, name, quantity_on_hand, reorder_point, reserve_quantity, item_type,
      category, taxable, price, cost, unit_type, weight_value, weight_unit,
      source_system, source_metadata
    ) values (
      sku_value, product_name_value, quantity_value, reorder_value, reserve_value, 'Inventory',
      'uncategorized', true, price_value, cost_value, unit_value, weight_value_value, weight_unit_value,
      'bulk-sku-creator', jsonb_build_object('source', 'bulk-sku-creator')
    );
    created_sku_count := created_sku_count + 1;
  end loop;

  for recipe_row in select value from jsonb_array_elements(recipe_rows) as entries(value)
  loop
    if jsonb_typeof(recipe_row) <> 'object' then
      raise exception 'Every recipe row must be an object.';
    end if;
    parent_sku_value := nullif(trim(recipe_row->>'parent_sku'), '');
    child_sku_value := nullif(trim(recipe_row->>'child_sku'), '');
    if parent_sku_value is null or child_sku_value is null then
      raise exception 'Every recipe row requires a parent SKU and child SKU.';
    end if;
    normalized_parent_sku := lower(parent_sku_value);
    normalized_child_sku := lower(child_sku_value);
    if normalized_parent_sku = normalized_child_sku then
      raise exception 'A recipe cannot use its parent SKU as its own child: %.', parent_sku_value;
    end if;
    recipe_key := normalized_parent_sku || '|' || normalized_child_sku;
    if recipe_key = any(seen_recipe_keys) then
      raise exception 'The import contains duplicate recipe component % → %.', parent_sku_value, child_sku_value;
    end if;
    seen_recipe_keys := array_append(seen_recipe_keys, recipe_key);
    recipe_quantity := coalesce(nullif(trim(recipe_row->>'quantity'), ''), '0')::integer;
    if recipe_quantity < 1 then
      raise exception 'Recipe quantity for % must be a positive whole number.', parent_sku_value;
    end if;

    select id, lower(coalesce(item_type, 'inventory'))
      into parent_id, parent_type
      from public.inventory_skus
     where lower(trim(sku)) = normalized_parent_sku;
    if not found then
      raise exception 'Recipe parent SKU % was not created or found.', parent_sku_value;
    end if;
    if parent_type <> 'non-inventory' then
      raise exception 'Recipe parent SKU % must be a parent/non-inventory SKU.', parent_sku_value;
    end if;

    select id, lower(coalesce(item_type, 'inventory'))
      into child_id, child_type
      from public.inventory_skus
     where lower(trim(sku)) = normalized_child_sku;
    if not found then
      raise exception 'Recipe child SKU % was not created or found.', child_sku_value;
    end if;
    if child_type = 'non-inventory' then
      raise exception 'Recipe child SKU % must be a physical inventory SKU.', child_sku_value;
    end if;

    insert into public.inventory_bundle_components (
      bundle_sku_id, component_sku_id, quantity, sort_order
    ) values (
      parent_id, child_id, recipe_quantity,
      (select coalesce(max(sort_order), -1) + 1 from public.inventory_bundle_components where bundle_sku_id = parent_id)
    );
    created_recipe_count := created_recipe_count + 1;
    if not (normalized_parent_sku = any(seen_recipe_parents)) then
      seen_recipe_parents := array_append(seen_recipe_parents, normalized_parent_sku);
      recipe_parent_count := recipe_parent_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'created_skus', created_sku_count,
    'created_recipe_components', created_recipe_count,
    'parents_with_recipes', recipe_parent_count
  );
end;
$$;

revoke all on function public.create_inventory_sku_batch(jsonb, jsonb) from public, anon;
grant execute on function public.create_inventory_sku_batch(jsonb, jsonb) to authenticated;
