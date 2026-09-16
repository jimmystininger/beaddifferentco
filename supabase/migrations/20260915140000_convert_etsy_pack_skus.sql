create or replace function public.import_etsy_sales(
  sales_rows jsonb,
  apply_inventory boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  existing_definition text;
  patched_definition text;
begin
  select pg_get_functiondef('public.import_etsy_sales(jsonb,boolean)'::regprocedure)
    into existing_definition;
  patched_definition := replace(
    existing_definition,
    E'    insert into public.etsy_sale_lines (',
    E'    if mapping_inventory_sku is null then\n' ||
    E'      select i.sku\n' ||
    E'        into mapping_inventory_sku\n' ||
    E'      from public.inventory_skus i\n' ||
    E'      where lower(trim(i.sku)) = lower(etsy_sku_value)\n' ||
    E'      limit 1;\n' ||
    E'      if mapping_inventory_sku is not null then\n' ||
    E'        mapping_inventory_units := 1;\n' ||
    E'      end if;\n' ||
    E'    end if;\n\n' ||
    E'    insert into public.etsy_sale_lines ('
  );
  if patched_definition = existing_definition then
    raise exception 'Unable to add direct Etsy SKU resolution.';
  end if;
  execute patched_definition;
end;
$$;

drop trigger if exists refresh_inventory_sellable_pack_after_recipe_change
  on public.inventory_bundle_components;

do $$
begin
  create temporary table _converted_etsy_links on commit drop as
  select distinct
    m.id as mapping_id,
    m.product_id,
    trim(m.etsy_sku) as parent_sku,
    trim(c.inventory_sku) as child_sku,
    c.inventory_sku_id as child_id,
    greatest(1, c.inventory_units)::integer as child_quantity
  from public.product_etsy_mappings m
  join public.product_etsy_mapping_components c on c.mapping_id = m.id
  join public.products p on p.id = m.product_id
  join public.inventory_skus child_inventory on child_inventory.id = c.inventory_sku_id
  where m.active is true
    and lower(trim(m.etsy_sku)) <> lower(trim(c.inventory_sku))
    and lower(coalesce(m.etsy_sku, '')) !~ '(mix|random|assort)'
    and lower(coalesce(p.name, '')) !~ '(mix|random|assort)'
    and lower(coalesce(child_inventory.item_type, 'inventory')) <> 'non-inventory';

  create index _converted_etsy_links_parent_idx on _converted_etsy_links(parent_sku);
  create index _converted_etsy_links_product_idx on _converted_etsy_links(product_id);

  create temporary table _converted_parent_specs on commit drop as
  select distinct on (links.parent_sku)
    links.parent_sku,
    coalesce(nullif(trim(option_value.label), ''), nullif(trim(product.name), ''), links.parent_sku) as parent_name,
    coalesce(product.category_slug, 'uncategorized') as category,
    greatest(0, coalesce(product.price, 0) + coalesce(option_value.price_delta, 0)) as price,
    coalesce(nullif(option_value.unit_type, ''), 'Each') as unit_type
  from _converted_etsy_links links
  join public.products product on product.id = links.product_id
  left join lateral (
    select value_record.label, value_record.price_delta, value_record.unit_type
    from public.product_options option_record
    join public.product_option_values value_record on value_record.option_id = option_record.id
    where option_record.product_id = links.product_id
      and lower(coalesce(value_record.inventory_sku, value_record.sku, '')) = lower(links.child_sku)
    order by case when value_record.inventory_units = links.child_quantity then 0 else 1 end,
             value_record.sort_order, value_record.id
    limit 1
  ) option_value on true
  order by links.parent_sku, links.product_id, links.mapping_id;

  insert into public.inventory_skus (
    sku, name, variant_name, quantity_on_hand, reorder_point, item_type,
    hierarchy, category, taxable, price, cost, unit_type, source_system,
    source_metadata, discontinued
  )
  select specs.parent_sku, specs.parent_name, 'Sellable pack', 0, 0, 'non-inventory',
         'parent', specs.category, false, specs.price, null, specs.unit_type,
         'etsy-parent-conversion',
         jsonb_build_object('source', 'etsy_mapping', 'etsy_sku', specs.parent_sku, 'converted_at', timezone('utc', now())),
         false
  from _converted_parent_specs specs
  where not exists (
    select 1 from public.inventory_skus existing
    where lower(trim(existing.sku)) = lower(trim(specs.parent_sku))
  );

  create temporary table _converted_parent_ids on commit drop as
  select specs.parent_sku, inventory.id as parent_id
  from _converted_parent_specs specs
  join public.inventory_skus inventory
    on lower(trim(inventory.sku)) = lower(trim(specs.parent_sku));

  insert into public.inventory_bundle_components (
    bundle_sku_id, component_sku_id, quantity, sort_order
  )
  select parents.parent_id, links.child_id, max(links.child_quantity),
         row_number() over (partition by parents.parent_id order by links.child_id)::integer - 1
  from _converted_etsy_links links
  join _converted_parent_ids parents on parents.parent_sku = links.parent_sku
  group by parents.parent_id, links.child_id
  on conflict (bundle_sku_id, component_sku_id)
  do update set quantity = excluded.quantity, updated_at = timezone('utc', now());

  update public.product_option_values value_record
  set sku = links.parent_sku,
      inventory_sku = links.parent_sku,
      inventory_sku_id = parents.parent_id,
      inventory_units = 1,
      quantity = inventory_parent.quantity_on_hand
  from public.product_options option_record,
       _converted_etsy_links links,
       _converted_parent_ids parents,
       public.inventory_skus inventory_parent
  where value_record.option_id = option_record.id
    and option_record.product_id = links.product_id
    and lower(coalesce(value_record.inventory_sku, value_record.sku, '')) = lower(links.child_sku)
    and value_record.inventory_units = links.child_quantity
    and parents.parent_sku = links.parent_sku
    and inventory_parent.id = parents.parent_id;

  insert into public.product_option_values (
    option_id, label, price_delta, sort_order, sku, inventory_sku, inventory_units,
    quantity, low_stock_threshold, image_url, unit_type, inventory_sku_id
  )
  select primary_option.id,
         coalesce(nullif(child_value.label, ''), links.parent_sku) || ' (' || links.child_quantity || ' pack)',
         coalesce(child_value.price_delta, 0),
         coalesce((select max(existing.sort_order) + 1 from public.product_option_values existing where existing.option_id = primary_option.id), 0),
         links.parent_sku, links.parent_sku, 1, inventory_parent.quantity_on_hand, 0,
         child_value.image_url, coalesce(nullif(child_value.unit_type, ''), 'Each'), parents.parent_id
  from (select distinct product_id, parent_sku, child_sku, child_quantity from _converted_etsy_links) links
  join _converted_parent_ids parents on parents.parent_sku = links.parent_sku
  join public.inventory_skus inventory_parent on inventory_parent.id = parents.parent_id
  join lateral (
    select option_record.id
    from public.product_options option_record
    where option_record.product_id = links.product_id
    order by option_record.sort_order, option_record.id
    limit 1
  ) primary_option on true
  left join lateral (
    select value_record.label, value_record.price_delta, value_record.image_url, value_record.unit_type
    from public.product_options option_record
    join public.product_option_values value_record on value_record.option_id = option_record.id
    where option_record.product_id = links.product_id
      and lower(coalesce(value_record.inventory_sku, value_record.sku, '')) = lower(links.child_sku)
    order by case when value_record.inventory_units = 1 then 0 else 1 end,
             value_record.sort_order, value_record.id
    limit 1
  ) child_value on true
  where not exists (
    select 1
    from public.product_option_values existing
    join public.product_options existing_option on existing_option.id = existing.option_id
    where existing_option.product_id = links.product_id
      and lower(coalesce(existing.inventory_sku, existing.sku, '')) = lower(links.parent_sku)
  );

  with metrics as (
    select recipe.bundle_sku_id,
           min(floor(greatest(0, child.quantity_on_hand - coalesce(child.reserve_quantity, 0))::numeric / recipe.quantity))::integer as available_quantity,
           case when count(*) = count(child.cost) then sum(child.cost * recipe.quantity) end as unit_cost,
           case when count(*) = count(child.weight_value) then sum(
             case lower(coalesce(child.weight_unit, 'oz'))
               when 'lb' then child.weight_value * 16
               when 'g' then child.weight_value / 28.349523125
               when 'kg' then child.weight_value * 35.27396195
               else child.weight_value
             end * recipe.quantity
           ) end as unit_weight
    from public.inventory_bundle_components recipe
    join public.inventory_skus child on child.id = recipe.component_sku_id
    join public.inventory_skus parent on parent.id = recipe.bundle_sku_id
    where parent.source_system = 'etsy-parent-conversion'
    group by recipe.bundle_sku_id
  )
  update public.inventory_skus parent
  set quantity_on_hand = coalesce(metrics.available_quantity, 0),
      cost = metrics.unit_cost,
      weight_value = metrics.unit_weight,
      weight_unit = 'oz',
      updated_at = timezone('utc', now())
  from metrics
  where parent.id = metrics.bundle_sku_id;

  update public.etsy_sale_lines sale
  set matched_inventory_sku = sale.etsy_sku,
      match_status = 'matched',
      updated_at = timezone('utc', now())
  where exists (
    select 1 from _converted_etsy_links links
    where lower(links.parent_sku) = lower(sale.etsy_sku)
  );

  delete from public.product_etsy_mapping_components component
  where component.mapping_id in (select mapping_id from _converted_etsy_links);
  delete from public.product_etsy_mappings mapping
  where mapping.id in (select mapping_id from _converted_etsy_links);
end;
$$;

create trigger refresh_inventory_sellable_pack_after_recipe_change
after insert or update or delete
on public.inventory_bundle_components
for each row
execute function public.refresh_inventory_sellable_pack_after_recipe_change();
