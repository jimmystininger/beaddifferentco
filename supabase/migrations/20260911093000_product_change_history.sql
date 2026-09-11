create table if not exists public.product_change_history (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  inventory_sku_id uuid references public.inventory_skus(id) on delete set null,
  inventory_sku text,
  field_name text not null,
  previous_value text,
  new_value text,
  change_type text not null check (change_type in ('added', 'updated', 'removed')),
  note text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists product_change_history_product_idx
  on public.product_change_history(product_id, created_at desc);

alter table public.product_change_history enable row level security;

drop policy if exists product_change_history_admin_all on public.product_change_history;
create policy product_change_history_admin_all on public.product_change_history
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create or replace function public.apply_inventory_audit(audit_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public, private
as $$
declare
  audit_row jsonb;
  product_record record;
  updated_count integer := 0;
  updated_rows integer;
  category_value text;
  inventory_id uuid;
  previous_quantity integer;
  next_quantity integer;
  previous_category text;
  previous_weight numeric;
  previous_weight_unit text;
  previous_cost numeric;
  previous_price numeric;
  previous_vendor text;
  next_weight numeric;
  next_weight_unit text;
  next_cost numeric;
  next_price numeric;
  next_vendor text;
begin
  if not private.is_admin() then
    raise exception 'Admin access required.';
  end if;
  if jsonb_typeof(audit_rows) <> 'array' then
    raise exception 'Audit rows must be a JSON array.';
  end if;

  for audit_row in select value from jsonb_array_elements(audit_rows) as entries(value)
  loop
    if nullif(trim(audit_row->>'sku'), '') is null then
      raise exception 'Every audit row needs a SKU.';
    end if;
    category_value := nullif(trim(audit_row->>'category'), '');
    if category_value is null or category_value not in (
      'beadable-products',
      'beadable-pen-blanks',
      'mixes-bundles-kits',
      'spacers-accessories',
      'acrylic-flatbacks',
      'rhinestone-beads',
      'focal-beads',
      'silicone',
      'acrylic',
      'cup-charms',
      'completed-pens-keychains',
      'charms-dangles',
      'clearance-section'
    ) then
      raise exception 'Audit category must be one of the 13 canonical categories.';
    end if;

    select id, quantity_on_hand, category, weight_value, weight_unit, cost, price, preferred_vendor
      into inventory_id, previous_quantity, previous_category, previous_weight, previous_weight_unit, previous_cost, previous_price, previous_vendor
      from public.inventory_skus
     where sku = trim(audit_row->>'sku');

    if not found then
      raise exception 'Audit SKU not found: %', trim(audit_row->>'sku');
    end if;

    next_quantity := (audit_row->>'inventory')::integer;
    next_weight := nullif(audit_row->>'weight', '')::numeric;
    next_weight_unit := coalesce(nullif(trim(audit_row->>'weight_unit'), ''), 'oz');
    next_cost := nullif(audit_row->>'cost', '')::numeric;
    next_price := nullif(audit_row->>'price', '')::numeric;
    next_vendor := nullif(trim(audit_row->>'preferred_vendor'), '');

    update public.inventory_skus
    set name = nullif(trim(audit_row->>'product_name'), ''),
        variant_name = nullif(trim(audit_row->>'variant_name'), ''),
        category = category_value,
        quantity_on_hand = next_quantity,
        reorder_point = (audit_row->>'reorder_point')::integer,
        reserve_quantity = (audit_row->>'reserve_quantity')::integer,
        unit_type = coalesce(nullif(trim(audit_row->>'unit_type'), ''), 'Each'),
        weight_value = next_weight,
        weight_unit = next_weight_unit,
        cost = next_cost,
        price = next_price,
        taxable = true,
        preferred_vendor = next_vendor,
        source_system = 'canonical',
        updated_at = timezone('utc', now())
    where id = inventory_id;

    get diagnostics updated_rows = row_count;
    if updated_rows <> 1 then
      raise exception 'Audit SKU not found: %', trim(audit_row->>'sku');
    end if;

    for product_record in
      select distinct option_record.product_id
        from public.product_option_values value_record
        join public.product_options option_record
          on option_record.id = value_record.option_id
       where value_record.inventory_sku_id = inventory_id
    loop
      if previous_quantity <> next_quantity then
        insert into public.inventory_adjustments (product_id, inventory_sku_id, inventory_sku, quantity_delta, quantity_after, note, created_by)
        values (product_record.product_id, inventory_id, trim(audit_row->>'sku'), next_quantity - previous_quantity, next_quantity, 'Bulk upload', auth.uid());
      end if;
      if previous_category is distinct from category_value then
        insert into public.product_change_history (product_id, inventory_sku_id, inventory_sku, field_name, previous_value, new_value, change_type, note)
        values (product_record.product_id, inventory_id, trim(audit_row->>'sku'), 'Category', previous_category, category_value, 'updated', 'Bulk upload');
      end if;
      if previous_weight is distinct from next_weight or previous_weight_unit is distinct from next_weight_unit then
        insert into public.product_change_history (product_id, inventory_sku_id, inventory_sku, field_name, previous_value, new_value, change_type, note)
        values (product_record.product_id, inventory_id, trim(audit_row->>'sku'), 'Weight', case when previous_weight is null then null else previous_weight::text || ' ' || coalesce(previous_weight_unit, 'oz') end, case when next_weight is null then null else next_weight::text || ' ' || next_weight_unit end, 'updated', 'Bulk upload');
      end if;
      if previous_cost is distinct from next_cost then
        insert into public.product_change_history (product_id, inventory_sku_id, inventory_sku, field_name, previous_value, new_value, change_type, note)
        values (product_record.product_id, inventory_id, trim(audit_row->>'sku'), 'Cost', previous_cost::text, next_cost::text, 'updated', 'Bulk upload');
      end if;
      if previous_price is distinct from next_price then
        insert into public.product_change_history (product_id, inventory_sku_id, inventory_sku, field_name, previous_value, new_value, change_type, note)
        values (product_record.product_id, inventory_id, trim(audit_row->>'sku'), 'Price', previous_price::text, next_price::text, 'updated', 'Bulk upload');
      end if;
      if previous_vendor is distinct from next_vendor then
        insert into public.product_change_history (product_id, inventory_sku_id, inventory_sku, field_name, previous_value, new_value, change_type, note)
        values (product_record.product_id, inventory_id, trim(audit_row->>'sku'), 'Preferred vendor', previous_vendor, next_vendor, 'updated', 'Bulk upload');
      end if;
    end loop;

    updated_count := updated_count + updated_rows;
  end loop;
  return updated_count;
end;
$$;

revoke all on function public.apply_inventory_audit(jsonb) from public, anon, authenticated;
grant execute on function public.apply_inventory_audit(jsonb) to authenticated;
