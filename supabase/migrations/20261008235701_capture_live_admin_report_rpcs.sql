create or replace function public.admin_catalog_snapshot_part(p_section text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'private'
as $function$
declare
  result jsonb;
begin
  if not private.is_admin() then return null; end if;
  if p_section = 'inventory' then
    select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'sku',i.sku,'name',i.name,'quantity_on_hand',i.quantity_on_hand,'reorder_point',i.reorder_point,'item_type',i.item_type,'hierarchy',i.hierarchy,'category',i.category,'taxable',i.taxable,'price',i.price,'cost',i.cost,'preferred_vendor',i.preferred_vendor,'unit_type',i.unit_type,'weight_value',i.weight_value,'weight_unit',i.weight_unit,'reserve_quantity',i.reserve_quantity,'discontinued',i.discontinued,'source_metadata',i.source_metadata) order by i.id),'[]'::jsonb) into result from public.inventory_skus i;
  elsif p_section = 'products' then
    select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'external_id',p.external_id,'sku',p.sku,'name',p.name,'quantity',p.quantity,'price',p.price,'estimated_cost',p.estimated_cost,'low_stock_threshold',p.low_stock_threshold,'category_slug',p.category_slug,'visible',p.visible,'waitlist_enabled',p.waitlist_enabled) order by p.id),'[]'::jsonb) into result from public.products p;
  elsif p_section = 'options' then
    with option_value_rows as (
      select v.option_id,jsonb_agg(jsonb_build_object('id',v.id,'label',v.label,'price_delta',v.price_delta,'sku',v.sku,'inventory_sku',v.inventory_sku,'inventory_sku_id',v.inventory_sku_id,'inventory_units',v.inventory_units,'quantity',v.quantity,'low_stock_threshold',v.low_stock_threshold,'unit_type',v.unit_type,'sort_order',v.sort_order) order by v.sort_order,v.id) as values
      from public.product_option_values v
      group by v.option_id
    )
    select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'product_id',o.product_id,'name',o.name,'required',o.required,'sort_order',o.sort_order,'product_option_values',coalesce(v.values,'[]'::jsonb)) order by o.product_id,o.sort_order,o.id),'[]'::jsonb) into result
    from public.product_options o
    left join option_value_rows v on v.option_id=o.id;
  elsif p_section = 'recipes' then
    select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'bundle_sku_id',r.bundle_sku_id,'component_sku_id',r.component_sku_id,'quantity',r.quantity,'sort_order',r.sort_order,'product_id',r.product_id) order by r.bundle_sku_id,r.sort_order,r.id),'[]'::jsonb) into result from public.inventory_bundle_components r;
  elsif p_section = 'mappings' then
    select coalesce(jsonb_agg(jsonb_build_object('inventory_sku',m.inventory_sku,'inventory_sku_id',m.inventory_sku_id) order by m.inventory_sku),'[]'::jsonb) into result from public.product_etsy_mappings m;
  elsif p_section = 'mapping_components' then
    select coalesce(jsonb_agg(jsonb_build_object('inventory_sku',c.inventory_sku,'inventory_sku_id',c.inventory_sku_id) order by c.inventory_sku),'[]'::jsonb) into result from public.product_etsy_mapping_components c;
  else
    raise exception 'Unknown catalog snapshot section: %',p_section using errcode='22023';
  end if;
  return result;
end;
$function$;

create or replace function public.admin_inventory_disposition_review()
returns table(id uuid, sku text, name text, quantity_on_hand numeric, reorder_point numeric, reserve_quantity numeric, item_type text, category text, price numeric, cost numeric, preferred_vendor text, unit_type text, weight_value numeric, weight_unit text, taxable boolean, discontinued boolean, source_metadata jsonb)
language sql
stable
security definer
set search_path to 'public', 'private'
as $function$
  select i.id, i.sku, i.name, i.quantity_on_hand::numeric, i.reorder_point::numeric,
    i.reserve_quantity::numeric, i.item_type, i.category, i.price, i.cost,
    i.preferred_vendor, i.unit_type, i.weight_value, i.weight_unit, i.taxable,
    i.discontinued, i.source_metadata
  from public.inventory_skus i
  where private.is_admin()
    and (
      lower(coalesce(i.source_metadata->>'disposition', 'unresolved')) in ('recipe_parent', 'predetermined_random', 'unresolved')
      or i.sku ilike '%mix%'
      or i.sku ilike '%random%'
      or i.sku ilike '%assort%'
      or i.name ilike '%mix%'
      or i.name ilike '%random%'
      or i.name ilike '%assort%'
    )
  order by i.sku;
$function$;

create or replace function public.admin_inventory_orphan_report()
returns table(id uuid, sku text, name text, quantity_on_hand numeric, item_type text, preferred_vendor text, discontinued boolean)
language sql
stable
security definer
set search_path to 'public', 'private'
as $function$
  select i.id, i.sku, i.name, i.quantity_on_hand::numeric, i.item_type,
    i.preferred_vendor, i.discontinued
  from public.inventory_skus i
  where private.is_admin()
    and i.discontinued is not true
    and not exists (select 1 from public.products p where lower(trim(p.sku)) = lower(trim(i.sku)))
    and not exists (
      select 1 from public.product_option_values v
      where lower(trim(coalesce(v.inventory_sku, v.sku))) = lower(trim(i.sku))
    )
    and not exists (select 1 from public.product_etsy_mappings m where lower(trim(m.inventory_sku)) = lower(trim(i.sku)))
    and not exists (select 1 from public.product_etsy_mapping_components m where lower(trim(m.inventory_sku)) = lower(trim(i.sku)))
    and not exists (
      select 1
      from public.inventory_bundle_components b
      join public.inventory_skus bundle on bundle.id = b.bundle_sku_id
      join public.inventory_skus child on child.id = b.component_sku_id
      where lower(trim(bundle.sku)) = lower(trim(i.sku))
         or lower(trim(child.sku)) = lower(trim(i.sku))
    )
  order by i.sku;
$function$;

create or replace function public.admin_inventory_recipe_lookup(p_search text default null::text, p_finished_only boolean default false, p_limit integer default 50)
returns table(bundle_id uuid, bundle_sku text, bundle_name text, bundle_item_type text, component_id uuid, component_sku text, component_name text, component_quantity numeric, component_sort_order integer)
language sql
stable
security definer
set search_path to 'public', 'private'
as $function$
  with candidates as (
    select i.id, i.sku, i.name, i.item_type
    from public.inventory_skus i
    where private.is_admin()
      and exists (select 1 from public.inventory_bundle_components c where c.bundle_sku_id = i.id)
      and (not p_finished_only or lower(coalesce(i.item_type, '')) <> 'non-inventory')
      and (nullif(trim(coalesce(p_search, '')), '') is null or i.sku ilike '%' || trim(p_search) || '%' or i.name ilike '%' || trim(p_search) || '%')
    order by lower(coalesce(i.name, i.sku)), lower(i.sku)
    limit greatest(1, least(coalesce(p_limit, 50), 100))
  )
  select bundle.id, bundle.sku, bundle.name, bundle.item_type,
    child.id, child.sku, child.name, component.quantity, component.sort_order
  from candidates bundle
  join public.inventory_bundle_components component on component.bundle_sku_id = bundle.id
  join public.inventory_skus child on child.id = component.component_sku_id
  order by lower(coalesce(bundle.name, bundle.sku)), lower(bundle.sku), component.sort_order, child.id;
$function$;

create or replace function public.admin_inventory_sales_reference()
returns table(id uuid, sku text, name text, quantity_on_hand numeric, reorder_point numeric, reserve_quantity numeric, item_type text, category text, price numeric, cost numeric, preferred_vendor text, unit_type text, weight_value numeric, weight_unit text, taxable boolean, discontinued boolean, source_metadata jsonb)
language sql
stable
security definer
set search_path to 'public', 'private'
as $function$
  with recursive source_skus(sku) as (
    select lower(trim(coalesce(nullif(s.matched_inventory_sku, ''), nullif(s.etsy_sku, ''))))
    from public.etsy_sale_lines s
    where private.is_admin()
      and coalesce(nullif(trim(s.matched_inventory_sku), ''), nullif(trim(s.etsy_sku), '')) is not null
    union
    select lower(trim(coalesce(nullif(s.matched_inventory_sku, ''), nullif(s.etsy_sku, ''))))
    from public.etsy_import_sales s
    where private.is_admin()
      and not exists (
        select 1 from public.etsy_sale_lines current_row
        where current_row.external_order_id = s.external_order_id
          and current_row.external_line_id = s.external_line_id
      )
      and coalesce(nullif(trim(s.matched_inventory_sku), ''), nullif(trim(s.etsy_sku), '')) is not null
    union
    select lower(trim(coalesce(nullif(i.sku, ''), nullif(i.selected_options->>'sku', ''), nullif(i.selected_options->>'inventorySku', ''), nullif(i.selected_options->>'variantSku', ''))))
    from public.orders o
    join public.order_items i on i.order_id = o.id
    where private.is_admin()
      and coalesce(nullif(trim(i.sku), ''), nullif(trim(i.selected_options->>'sku'), ''), nullif(trim(i.selected_options->>'inventorySku'), ''), nullif(trim(i.selected_options->>'variantSku'), '')) is not null
  ), closure(sku) as (
    select sku from source_skus where sku is not null
    union
    select expanded.sku
    from closure c
    cross join lateral (
      select lower(trim(nullif(i.source_metadata->>'predetermined_inventory_sku', ''))) as sku
      from public.inventory_skus i
      where lower(trim(i.sku)) = c.sku
      union all
      select lower(trim(child.sku)) as sku
      from public.inventory_skus bundle
      join public.inventory_bundle_components component on component.bundle_sku_id = bundle.id
      join public.inventory_skus child on child.id = component.component_sku_id
      where lower(trim(bundle.sku)) = c.sku
    ) expanded
    where expanded.sku is not null
  )
  select i.id, i.sku, i.name, i.quantity_on_hand::numeric, i.reorder_point::numeric,
    i.reserve_quantity::numeric, i.item_type, i.category, i.price, i.cost,
    i.preferred_vendor, i.unit_type, i.weight_value, i.weight_unit, i.taxable,
    i.discontinued, i.source_metadata
  from public.inventory_skus i
  where private.is_admin() and lower(trim(i.sku)) in (select sku from closure)
  order by i.sku;
$function$;

create or replace function public.admin_inventory_sku_lookup_page(p_search text default null::text, p_mode text default 'all'::text, p_page integer default 1, p_page_size integer default 60)
returns table(id uuid, sku text, name text, quantity_on_hand numeric, reorder_point numeric, reserve_quantity numeric, item_type text, category text, price numeric, cost numeric, preferred_vendor text, unit_type text, weight_value numeric, weight_unit text, taxable boolean, discontinued boolean, source_metadata jsonb, total_count bigint)
language sql
stable
security definer
set search_path to 'public', 'private'
as $function$
  with filtered as (
    select
      i.id, i.sku, i.name, i.quantity_on_hand, i.reorder_point, i.reserve_quantity,
      i.item_type, i.category, i.price, i.cost, i.preferred_vendor, i.unit_type,
      i.weight_value, i.weight_unit, i.taxable, i.discontinued, i.source_metadata,
      count(*) over ()::bigint as total_count
    from public.inventory_skus i
    where private.is_admin()
      and (
        nullif(trim(coalesce(p_search, '')), '') is null
        or lower(trim(i.sku)) = lower(trim(p_search))
        or i.sku ilike '%' || trim(p_search) || '%'
        or i.name ilike '%' || trim(p_search) || '%'
      )
      and (
        lower(coalesce(p_mode, 'all')) = 'all'
        or (lower(p_mode) = 'physical' and lower(coalesce(i.item_type, 'inventory')) <> 'non-inventory')
        or (lower(p_mode) = 'low' and lower(coalesce(i.item_type, 'inventory')) <> 'non-inventory'
          and coalesce(i.discontinued, false) = false
          and greatest(0, coalesce(i.quantity_on_hand, 0) - coalesce(i.reserve_quantity, 0)) <= coalesce(i.reorder_point, 0))
      )
    order by lower(coalesce(i.name, i.sku)), lower(i.sku), i.id
  )
  select
    f.id, f.sku, f.name, f.quantity_on_hand::numeric, f.reorder_point::numeric,
    f.reserve_quantity::numeric, f.item_type, f.category, f.price::numeric,
    f.cost::numeric, f.preferred_vendor, f.unit_type, f.weight_value::numeric,
    f.weight_unit, f.taxable, f.discontinued, f.source_metadata, f.total_count
  from filtered f
  offset greatest(0, (coalesce(p_page, 1) - 1) * least(greatest(coalesce(p_page_size, 60), 1), 100))
  limit least(greatest(coalesce(p_page_size, 60), 1), 100);
$function$;

create or replace function public.admin_uncategorized_product_page(p_page integer default 1, p_page_size integer default 100)
returns table(id uuid, external_id text, sku text, name text, visible boolean, category_slug text, total_count bigint)
language plpgsql
stable
security definer
set search_path to 'public', 'private'
as $function$
declare
  v_page integer := greatest(1, coalesce(p_page, 1));
  v_page_size integer := least(100, greatest(1, coalesce(p_page_size, 100)));
begin
  if not private.is_admin() then return; end if;
  return query
  with filtered as (
    select p.id, p.external_id, p.sku, p.name, p.visible, p.category_slug,
      count(*) over () as total_count
    from public.products p
    where nullif(trim(coalesce(p.category_slug, '')), '') is null
    order by lower(coalesce(p.name, p.external_id, p.sku, '')), p.id
  )
  select f.id, f.external_id, f.sku, f.name, f.visible, f.category_slug, f.total_count
  from filtered f
  limit v_page_size offset (v_page - 1) * v_page_size;
end;
$function$;

create or replace function public.admin_website_research_sales_metrics(p_start timestamp with time zone default null::timestamp with time zone, p_end timestamp with time zone default null::timestamp with time zone)
returns table(sale_date timestamp with time zone, product_id uuid, product_name text, sku text, quantity numeric, unit_price numeric)
language sql
stable
security definer
set search_path to 'public', 'private'
as $function$
  select
    date_trunc('day', o.created_at) as sale_date,
    i.product_id,
    i.product_name,
    coalesce(
      nullif(trim(i.sku), ''),
      nullif(trim(i.selected_options->>'sku'), ''),
      nullif(trim(i.selected_options->>'inventorySku'), ''),
      nullif(trim(i.selected_options->>'variantSku'), ''),
      'Unassigned SKU'
    ) as sku,
    coalesce(sum(i.quantity), 0) as quantity,
    i.unit_price
  from public.orders o
  join public.order_items i on i.order_id = o.id
  where private.is_admin()
    and (p_start is null or o.created_at >= p_start)
    and (p_end is null or o.created_at < p_end)
    and lower(coalesce(o.status, '')) in ('paid', 'processing', 'shipped', 'completed')
  group by
    date_trunc('day', o.created_at),
    i.product_id,
    i.product_name,
    coalesce(
      nullif(trim(i.sku), ''),
      nullif(trim(i.selected_options->>'sku'), ''),
      nullif(trim(i.selected_options->>'inventorySku'), ''),
      nullif(trim(i.selected_options->>'variantSku'), ''),
      'Unassigned SKU'
    ),
    i.unit_price;
$function$;

revoke all on function public.admin_catalog_snapshot_part(text) from public, anon;
revoke all on function public.admin_inventory_disposition_review() from public, anon;
revoke all on function public.admin_inventory_orphan_report() from public, anon;
revoke all on function public.admin_inventory_recipe_lookup(text, boolean, integer) from public, anon;
revoke all on function public.admin_inventory_sales_reference() from public, anon;
revoke all on function public.admin_inventory_sku_lookup_page(text, text, integer, integer) from public, anon;
revoke all on function public.admin_uncategorized_product_page(integer, integer) from public, anon;
revoke all on function public.admin_website_research_sales_metrics(timestamp with time zone, timestamp with time zone) from public, anon;

grant execute on function public.admin_catalog_snapshot_part(text) to authenticated, service_role;
grant execute on function public.admin_inventory_disposition_review() to authenticated, service_role;
grant execute on function public.admin_inventory_orphan_report() to authenticated, service_role;
grant execute on function public.admin_inventory_recipe_lookup(text, boolean, integer) to authenticated, service_role;
grant execute on function public.admin_inventory_sales_reference() to authenticated, service_role;
grant execute on function public.admin_inventory_sku_lookup_page(text, text, integer, integer) to authenticated, service_role;
grant execute on function public.admin_uncategorized_product_page(integer, integer) to authenticated, service_role;
grant execute on function public.admin_website_research_sales_metrics(timestamp with time zone, timestamp with time zone) to authenticated, service_role;
