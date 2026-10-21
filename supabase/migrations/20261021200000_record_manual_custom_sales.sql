create table public.manual_sales (
  id uuid primary key default gen_random_uuid(),
  sold_at timestamptz not null,
  sales_channel text not null check (sales_channel in ('cash', 'facebook', 'other')),
  customer_reference text,
  notes text,
  total_revenue numeric not null check (total_revenue >= 0),
  discount_amount numeric not null default 0 check (discount_amount >= 0),
  shipping_collected numeric not null default 0 check (shipping_collected >= 0),
  tax_collected numeric not null default 0 check (tax_collected >= 0),
  total_charged numeric not null check (total_charged >= 0),
  total_cost numeric not null default 0 check (total_cost >= 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default timezone('utc', now()),
  voided_at timestamptz,
  voided_by uuid references auth.users(id)
);

create table public.manual_sale_lines (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.manual_sales(id) on delete restrict,
  line_number integer not null check (line_number > 0),
  inventory_sku_id uuid not null references public.inventory_skus(id) on delete restrict,
  sku text not null,
  product_name text not null,
  quantity integer not null check (quantity > 0),
  revenue_amount numeric not null check (revenue_amount >= 0),
  cost_total numeric not null default 0 check (cost_total >= 0),
  unique (sale_id, line_number)
);

create table public.manual_sale_line_components (
  id uuid primary key default gen_random_uuid(),
  sale_line_id uuid not null references public.manual_sale_lines(id) on delete restrict,
  inventory_sku_id uuid not null references public.inventory_skus(id) on delete restrict,
  sku text not null,
  quantity integer not null check (quantity > 0),
  unit_cost_at_sale numeric,
  quantity_before integer not null,
  quantity_after integer not null,
  unique (sale_line_id, inventory_sku_id)
);

create index manual_sales_sold_at_idx on public.manual_sales(sold_at desc);
create index manual_sale_lines_sku_idx on public.manual_sale_lines(inventory_sku_id, sale_id);
create index manual_sale_components_sku_idx on public.manual_sale_line_components(inventory_sku_id, sale_line_id);

alter table public.manual_sales enable row level security;
alter table public.manual_sale_lines enable row level security;
alter table public.manual_sale_line_components enable row level security;

create policy manual_sales_admin_select on public.manual_sales
  for select to authenticated using ((select private.is_admin()));
create policy manual_sale_lines_admin_select on public.manual_sale_lines
  for select to authenticated using ((select private.is_admin()));
create policy manual_sale_components_admin_select on public.manual_sale_line_components
  for select to authenticated using ((select private.is_admin()));

revoke all on public.manual_sales, public.manual_sale_lines, public.manual_sale_line_components from public, anon, authenticated;
grant select on public.manual_sales, public.manual_sale_lines, public.manual_sale_line_components to authenticated;

create or replace function private.expand_manual_sale_sku(requested_sku text, requested_units integer)
returns table(component_sku text, quantity integer)
language sql
stable
security definer
set search_path = public, private
as $$
  with recursive expansion(sku, required_quantity, path) as (
    select inventory.sku, greatest(1, requested_units), array[lower(trim(inventory.sku))]::text[]
    from public.inventory_skus inventory
    where lower(trim(inventory.sku)) = lower(trim(coalesce(requested_sku, '')))
    union all
    select component.sku,
      expansion.required_quantity * recipe.quantity,
      expansion.path || lower(trim(component.sku))
    from expansion
    join public.inventory_skus bundle on lower(trim(bundle.sku)) = lower(trim(expansion.sku))
    join public.inventory_bundle_components recipe on recipe.bundle_sku_id = bundle.id
    join public.inventory_skus component on component.id = recipe.component_sku_id
    where lower(coalesce(bundle.item_type, 'inventory')) = 'non-inventory'
      and not lower(trim(component.sku)) = any(expansion.path)
  ), leaves as (
    select expansion.sku, expansion.required_quantity
    from expansion
    join public.inventory_skus inventory on lower(trim(inventory.sku)) = lower(trim(expansion.sku))
    where lower(coalesce(inventory.item_type, 'inventory')) <> 'non-inventory'
      or not exists (
        select 1 from public.inventory_bundle_components recipe
        where recipe.bundle_sku_id = inventory.id
      )
  )
  select leaves.sku, sum(leaves.required_quantity)::integer
  from leaves
  group by leaves.sku
  order by leaves.sku;
$$;

revoke all on function private.expand_manual_sale_sku(text, integer) from public, anon, authenticated;

create or replace function public.record_manual_custom_sale(
  p_sold_at timestamptz,
  p_channel text,
  p_customer_reference text,
  p_notes text,
  p_discount_amount numeric,
  p_shipping_collected numeric,
  p_tax_collected numeric,
  p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  sale_id uuid;
  sale_line_id uuid;
  line_row jsonb;
  line_number_value integer := 0;
  sku_value text;
  quantity_value integer;
  revenue_value numeric;
  inventory_record record;
  component record;
  lock_record record;
  cost_total_value numeric;
  sale_cost_total numeric := 0;
  sale_revenue_total numeric := 0;
  discount_value numeric := coalesce(p_discount_amount, 0);
  shipping_value numeric := coalesce(p_shipping_collected, 0);
  tax_value numeric := coalesce(p_tax_collected, 0);
  quantity_after_value integer;
  missing_cost_skus text[] := '{}'::text[];
begin
  if not private.is_admin() then
    raise exception 'Admin access required.';
  end if;
  if p_sold_at is null then
    raise exception 'Enter the date of the sale.';
  end if;
  if lower(trim(coalesce(p_channel, ''))) not in ('cash', 'facebook', 'other') then
    raise exception 'Choose Cash, Facebook, or Other as the sale source.';
  end if;
  if discount_value < 0 or shipping_value < 0 or tax_value < 0 then
    raise exception 'Discount, shipping, and tax amounts must be zero or greater.';
  end if;
  if coalesce(jsonb_typeof(p_lines), '') <> 'array' then
    raise exception 'Add between 1 and 100 sale items.';
  end if;
  if jsonb_array_length(p_lines) < 1 or jsonb_array_length(p_lines) > 100 then
    raise exception 'Add between 1 and 100 sale items.';
  end if;

  for line_row in select value from jsonb_array_elements(p_lines) as entries(value)
  loop
    sku_value := nullif(trim(line_row->>'sku'), '');
    if sku_value is null or coalesce(line_row->>'quantity', '') !~ '^[0-9]+$' or (line_row->>'quantity')::integer <= 0 then
      raise exception 'Every sale item needs an existing SKU and a positive whole quantity.';
    end if;
    quantity_value := (line_row->>'quantity')::integer;
    if coalesce(line_row->>'charged_amount', '') !~ '^([0-9]+)(\.[0-9]{1,2})?$' then
      raise exception 'Enter the actual amount charged for each sale item, using dollars and cents.';
    end if;
    revenue_value := (line_row->>'charged_amount')::numeric;
    if revenue_value < 0 then
      raise exception 'Charged amounts cannot be negative.';
    end if;
    select inventory.id, inventory.sku, inventory.name, inventory.item_type
      into inventory_record
    from public.inventory_skus inventory
    where lower(trim(inventory.sku)) = lower(trim(sku_value));
    if not found then
      raise exception 'SKU not found in canonical inventory: %', sku_value;
    end if;
    if lower(coalesce(inventory_record.item_type, 'inventory')) = 'non-inventory'
       and not exists (
         select 1 from public.inventory_bundle_components recipe
         where recipe.bundle_sku_id = inventory_record.id
       ) then
      raise exception 'Non-inventory parent SKU % needs a saved recipe before it can be recorded as a sale.', inventory_record.sku;
    end if;
    sale_revenue_total := sale_revenue_total + revenue_value;
  end loop;

  if discount_value > sale_revenue_total then
    raise exception 'The discount cannot be greater than the item subtotal.';
  end if;

  for lock_record in
    select distinct component_inventory.id, component_inventory.sku
    from jsonb_array_elements(p_lines) as entries(value)
    cross join lateral private.expand_manual_sale_sku(
      entries.value->>'sku',
      (entries.value->>'quantity')::integer
    ) expanded
    join public.inventory_skus component_inventory
      on lower(trim(component_inventory.sku)) = lower(trim(expanded.component_sku))
    order by component_inventory.sku
  loop
    perform 1 from public.inventory_skus where id = lock_record.id for update;
  end loop;

  insert into public.manual_sales (
    sold_at, sales_channel, customer_reference, notes, total_revenue,
    discount_amount, shipping_collected, tax_collected, total_charged, created_by
  ) values (
    p_sold_at, lower(trim(p_channel)), nullif(trim(coalesce(p_customer_reference, '')), ''),
    nullif(trim(coalesce(p_notes, '')), ''), sale_revenue_total,
    discount_value, shipping_value, tax_value,
    sale_revenue_total - discount_value + shipping_value + tax_value, auth.uid()
  ) returning id into sale_id;

  for line_row in select value from jsonb_array_elements(p_lines) as entries(value)
  loop
    line_number_value := line_number_value + 1;
    sku_value := trim(line_row->>'sku');
    quantity_value := (line_row->>'quantity')::integer;
    revenue_value := (line_row->>'charged_amount')::numeric;
    select inventory.id, inventory.sku, inventory.name, inventory.item_type
      into inventory_record
    from public.inventory_skus inventory
    where lower(trim(inventory.sku)) = lower(trim(sku_value));

    insert into public.manual_sale_lines (
      sale_id, line_number, inventory_sku_id, sku, product_name, quantity, revenue_amount
    ) values (
      sale_id, line_number_value, inventory_record.id, inventory_record.sku,
      inventory_record.name, quantity_value, revenue_value
    ) returning id into sale_line_id;

    cost_total_value := 0;
    for component in
      select inventory.id, inventory.sku, inventory.item_type, inventory.cost,
        expanded.quantity
      from private.expand_manual_sale_sku(sku_value, quantity_value) expanded
      join public.inventory_skus inventory
        on lower(trim(inventory.sku)) = lower(trim(expanded.component_sku))
      order by inventory.sku
    loop
      if lower(coalesce(component.item_type, 'inventory')) = 'non-inventory' then
        raise exception 'Recipe for % contains non-inventory component % without a physical inventory leaf.', inventory_record.sku, component.sku;
      end if;
      update public.inventory_skus
      set quantity_on_hand = quantity_on_hand - component.quantity,
          updated_at = timezone('utc', now())
      where id = component.id
      returning quantity_on_hand into quantity_after_value;

      insert into public.manual_sale_line_components (
        sale_line_id, inventory_sku_id, sku, quantity, unit_cost_at_sale,
        quantity_before, quantity_after
      ) values (
        sale_line_id, component.id, component.sku, component.quantity, component.cost,
        quantity_after_value + component.quantity, quantity_after_value
      );
      cost_total_value := cost_total_value + component.quantity * coalesce(component.cost, 0);
      if component.cost is null and not component.sku = any(missing_cost_skus) then
        missing_cost_skus := array_append(missing_cost_skus, component.sku);
      end if;
    end loop;

    update public.manual_sale_lines
    set cost_total = cost_total_value
    where id = sale_line_id;
    sale_cost_total := sale_cost_total + cost_total_value;
  end loop;

  update public.manual_sales set total_cost = sale_cost_total where id = sale_id;

  return jsonb_build_object(
    'sale_id', sale_id,
    'total_revenue', sale_revenue_total,
    'discount_amount', discount_value,
    'shipping_collected', shipping_value,
    'tax_collected', tax_value,
    'total_charged', sale_revenue_total - discount_value + shipping_value + tax_value,
    'total_cost', sale_cost_total,
    'missing_cost_skus', to_jsonb(missing_cost_skus)
  );
end;
$$;

revoke all on function public.record_manual_custom_sale(timestamptz, text, text, text, numeric, numeric, numeric, jsonb) from public, anon;
grant execute on function public.record_manual_custom_sale(timestamptz, text, text, text, numeric, numeric, numeric, jsonb) to authenticated;

create or replace function public.void_manual_custom_sale(p_sale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  sale_row public.manual_sales%rowtype;
  component record;
  restored_count integer := 0;
begin
  if not private.is_admin() then
    raise exception 'Admin access required.';
  end if;
  select * into sale_row from public.manual_sales where id = p_sale_id for update;
  if not found then
    raise exception 'Custom sale was not found.';
  end if;
  if sale_row.voided_at is not null then
    raise exception 'This custom sale was already reversed.';
  end if;

  for component in
    select movement.inventory_sku_id, movement.quantity
    from public.manual_sale_line_components movement
    join public.manual_sale_lines line on line.id = movement.sale_line_id
    where line.sale_id = sale_row.id
    order by movement.sku
  loop
    update public.inventory_skus
    set quantity_on_hand = quantity_on_hand + component.quantity,
        updated_at = timezone('utc', now())
    where id = component.inventory_sku_id;
    if not found then
      raise exception 'Inventory component for this custom sale is no longer available.';
    end if;
    restored_count := restored_count + 1;
  end loop;

  update public.manual_sales
  set voided_at = timezone('utc', now()), voided_by = auth.uid()
  where id = sale_row.id;

  return jsonb_build_object('sale_id', sale_row.id, 'restored_components', restored_count);
end;
$$;

revoke all on function public.void_manual_custom_sale(uuid) from public, anon;
grant execute on function public.void_manual_custom_sale(uuid) to authenticated;

create or replace function public.admin_manual_sales_metrics()
returns table(
  sale_date timestamptz,
  product_name text,
  sku text,
  quantity numeric,
  gross_revenue numeric,
  discount_amount numeric,
  cost_total numeric,
  cost_breakdown jsonb,
  sales_channel text
)
language sql
stable
security definer
set search_path = public, private
as $$
  select sale.sold_at,
    line.product_name,
    line.sku,
    line.quantity::numeric,
    line.revenue_amount,
    case when sale.total_revenue > 0 then sale.discount_amount * line.revenue_amount / sale.total_revenue else 0 end,
    line.cost_total,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'sku', component.sku,
        'quantity', component.quantity,
        'unit_cost', component.unit_cost_at_sale
      ) order by component.sku)
      from public.manual_sale_line_components component
      where component.sale_line_id = line.id
    ), '[]'::jsonb),
    sale.sales_channel
  from public.manual_sales sale
  join public.manual_sale_lines line on line.sale_id = sale.id
  where private.is_admin() and sale.voided_at is null
  order by sale.sold_at desc, line.line_number;
$$;

revoke all on function public.admin_manual_sales_metrics() from public, anon;
grant execute on function public.admin_manual_sales_metrics() to authenticated, service_role;

create or replace function public.admin_manual_sales_history()
returns table(sale_id uuid, sold_at timestamptz, sales_channel text, customer_reference text, notes text, total_revenue numeric, discount_amount numeric, shipping_collected numeric, tax_collected numeric, total_charged numeric, total_cost numeric, voided_at timestamptz, line_summary text)
language sql
stable
security definer
set search_path = public, private
as $$
  select sale.id, sale.sold_at, sale.sales_channel, sale.customer_reference,
    sale.notes, sale.total_revenue, sale.discount_amount, sale.shipping_collected,
    sale.tax_collected, sale.total_charged, sale.total_cost, sale.voided_at,
    string_agg(line.quantity::text || ' × ' || line.sku, ', ' order by line.line_number)
  from public.manual_sales sale
  join public.manual_sale_lines line on line.sale_id = sale.id
  where private.is_admin()
  group by sale.id
  order by sale.sold_at desc
  limit 50;
$$;

revoke all on function public.admin_manual_sales_history() from public, anon;
grant execute on function public.admin_manual_sales_history() to authenticated, service_role;

create or replace function public.admin_inventory_sales_reference()
returns table(id uuid, sku text, name text, quantity_on_hand numeric, reorder_point numeric, reserve_quantity numeric, item_type text, category text, price numeric, cost numeric, preferred_vendor text, unit_type text, weight_value numeric, weight_unit text, taxable boolean, discontinued boolean, source_metadata jsonb)
language sql
stable
security definer
set search_path = public, private
as $$
  with recursive source_skus(sku) as (
    select lower(trim(coalesce(nullif(s.matched_inventory_sku, ''), nullif(s.etsy_sku, ''))))
    from public.etsy_sale_lines s
    where private.is_admin()
      and coalesce(nullif(trim(s.matched_inventory_sku), ''), nullif(trim(s.etsy_sku), '')) is not null
    union
    select lower(trim(coalesce(nullif(s.matched_inventory_sku, ''), nullif(s.etsy_sku, ''))))
    from public.etsy_import_sales s
    where private.is_admin()
      and not exists (select 1 from public.etsy_sale_lines current_row where current_row.external_order_id = s.external_order_id and current_row.external_line_id = s.external_line_id)
      and coalesce(nullif(trim(s.matched_inventory_sku), ''), nullif(trim(s.etsy_sku), '')) is not null
    union
    select lower(trim(coalesce(nullif(i.sku, ''), nullif(i.selected_options->>'sku', ''), nullif(i.selected_options->>'inventorySku', ''), nullif(i.selected_options->>'variantSku', ''))))
    from public.orders o join public.order_items i on i.order_id = o.id
    where private.is_admin()
      and coalesce(nullif(trim(i.sku), ''), nullif(trim(i.selected_options->>'sku'), ''), nullif(trim(i.selected_options->>'inventorySku'), ''), nullif(trim(i.selected_options->>'variantSku'), '')) is not null
    union
    select lower(trim(line.sku)) from public.manual_sales sale
    join public.manual_sale_lines line on line.sale_id = sale.id
    where private.is_admin()
  ), closure(sku) as (
    select sku from source_skus where sku is not null
    union
    select expanded.sku from closure c
    cross join lateral (
      select lower(trim(nullif(i.source_metadata->>'predetermined_inventory_sku', ''))) as sku
      from public.inventory_skus i where lower(trim(i.sku)) = c.sku
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
$$;

revoke all on function public.admin_inventory_sales_reference() from public, anon;
grant execute on function public.admin_inventory_sales_reference() to authenticated, service_role;

create or replace function public.apply_inventory_sku_disposition(
  inventory_sku_id_value uuid,
  disposition_value text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  inventory record;
  normalized_disposition text := lower(trim(coalesce(disposition_value, '')));
  updated_at_value timestamptz;
begin
  if not private.is_admin() then
    raise exception 'Admin access required.';
  end if;
  if normalized_disposition not in ('inventory', 'recipe_parent') then
    raise exception 'SKU type must be Inventory / child or Parent / non-inventory.';
  end if;
  select * into inventory from public.inventory_skus where id = inventory_sku_id_value for update;
  if inventory.id is null then
    raise exception 'Inventory SKU not found.';
  end if;
  if normalized_disposition = 'recipe_parent' and not exists (
    select 1 from public.inventory_bundle_components recipe where recipe.bundle_sku_id = inventory.id
  ) then
    raise exception 'Parent / non-inventory requires a saved recipe first.';
  end if;

  update public.inventory_skus
  set source_metadata = (coalesce(inventory.source_metadata, '{}'::jsonb) - 'predetermined_inventory_sku')
      || jsonb_build_object('disposition', normalized_disposition, 'disposition_updated_at', timezone('utc', now())),
    item_type = case when normalized_disposition = 'recipe_parent' then 'Non-inventory' else 'Inventory' end,
    hierarchy = case when normalized_disposition = 'recipe_parent' then 'Parent' else null end,
    updated_at = timezone('utc', now())
  where id = inventory.id
  returning updated_at into updated_at_value;

  return jsonb_build_object('sku', inventory.sku, 'disposition', normalized_disposition, 'updated_at', updated_at_value);
end;
$$;

revoke all on function public.apply_inventory_sku_disposition(uuid, text) from public, anon, authenticated;
grant execute on function public.apply_inventory_sku_disposition(uuid, text) to authenticated;
