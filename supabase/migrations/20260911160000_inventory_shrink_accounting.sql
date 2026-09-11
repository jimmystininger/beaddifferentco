alter table public.inventory_adjustments
  alter column product_id drop not null;

alter table public.inventory_adjustments
  add column if not exists adjustment_type text not null default 'manual',
  add column if not exists cost_impact numeric not null default 0;

alter table public.inventory_adjustments
  drop constraint if exists inventory_adjustments_type_check;

alter table public.inventory_adjustments
  add constraint inventory_adjustments_type_check
  check (adjustment_type in ('manual', 'audit_shrink', 'audit_gain', 'purchase', 'bundle_conversion'));

create index if not exists inventory_adjustments_type_idx
  on public.inventory_adjustments(adjustment_type, created_at desc);

create or replace function public.apply_inventory_audit(audit_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public, private
as $$
declare
  audit_row jsonb;
  updated_count integer := 0;
  updated_rows integer;
  category_value text;
  inventory_id uuid;
  previous_quantity integer;
  next_quantity integer;
  previous_cost numeric;
  quantity_delta integer;
  product_id_value uuid;
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
      'beadable-products', 'beadable-pen-blanks', 'mixes-bundles-kits',
      'spacers-accessories', 'acrylic-flatbacks', 'rhinestone-beads',
      'focal-beads', 'silicone', 'acrylic', 'cup-charms',
      'completed-pens-keychains', 'charms-dangles', 'clearance-section'
    ) then
      raise exception 'Audit category must be one of the 13 canonical categories.';
    end if;

    select id, quantity_on_hand, cost
      into inventory_id, previous_quantity, previous_cost
      from public.inventory_skus
     where sku = trim(audit_row->>'sku')
     for update;
    if not found then
      raise exception 'Audit SKU not found: %', trim(audit_row->>'sku');
    end if;

    next_quantity := (audit_row->>'inventory')::integer;
    quantity_delta := next_quantity - previous_quantity;

    update public.inventory_skus
    set name = nullif(trim(audit_row->>'product_name'), ''),
        variant_name = nullif(trim(audit_row->>'variant_name'), ''),
        category = category_value,
        quantity_on_hand = next_quantity,
        reorder_point = (audit_row->>'reorder_point')::integer,
        reserve_quantity = (audit_row->>'reserve_quantity')::integer,
        unit_type = coalesce(nullif(trim(audit_row->>'unit_type'), ''), 'Each'),
        weight_value = nullif(audit_row->>'weight', '')::numeric,
        weight_unit = coalesce(nullif(trim(audit_row->>'weight_unit'), ''), 'oz'),
        cost = nullif(audit_row->>'cost', '')::numeric,
        price = nullif(audit_row->>'price', '')::numeric,
        taxable = true,
        source_system = 'canonical',
        updated_at = timezone('utc', now())
    where id = inventory_id;

    get diagnostics updated_rows = row_count;
    if updated_rows <> 1 then
      raise exception 'Audit SKU not found: %', trim(audit_row->>'sku');
    end if;

    if quantity_delta <> 0 then
      select option_record.product_id
        into product_id_value
      from public.product_option_values value_record
      join public.product_options option_record on option_record.id = value_record.option_id
      where value_record.inventory_sku_id = inventory_id
      limit 1;
      if product_id_value is null then
        select p.id into product_id_value from public.products p where p.sku = trim(audit_row->>'sku') limit 1;
      end if;
      insert into public.inventory_adjustments (
        product_id, inventory_sku_id, inventory_sku, quantity_delta, quantity_after,
        note, created_by, adjustment_type, cost_impact
      ) values (
        product_id_value, inventory_id, trim(audit_row->>'sku'), quantity_delta, next_quantity,
        'Bulk upload', auth.uid(),
        case when quantity_delta < 0 then 'audit_shrink' else 'audit_gain' end,
        case when quantity_delta < 0 then abs(quantity_delta) * coalesce(previous_cost, 0) else 0 end
      );
    end if;

    updated_count := updated_count + updated_rows;
  end loop;
  return updated_count;
end;
$$;

revoke all on function public.apply_inventory_audit(jsonb) from public, anon, authenticated;
grant execute on function public.apply_inventory_audit(jsonb) to authenticated;
