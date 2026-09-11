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
    update public.inventory_skus
    set name = nullif(trim(audit_row->>'name'), ''),
        variant_name = nullif(trim(audit_row->>'variant_name'), ''),
        quantity_on_hand = (audit_row->>'quantity_on_hand')::integer,
        reorder_point = (audit_row->>'reorder_point')::integer,
        item_type = nullif(trim(audit_row->>'item_type'), ''),
        hierarchy = nullif(trim(audit_row->>'hierarchy'), ''),
        category = nullif(trim(audit_row->>'category'), ''),
        taxable = (audit_row->>'taxable')::boolean,
        price = nullif(audit_row->>'price', '')::numeric,
        cost = nullif(audit_row->>'cost', '')::numeric,
        income_account = nullif(trim(audit_row->>'income_account'), ''),
        expense_account = nullif(trim(audit_row->>'expense_account'), ''),
        inventory_asset_account = nullif(trim(audit_row->>'inventory_asset_account'), ''),
        sales_description = nullif(trim(audit_row->>'sales_description'), ''),
        purchase_description = nullif(trim(audit_row->>'purchase_description'), ''),
        preferred_vendor = nullif(trim(audit_row->>'preferred_vendor'), ''),
        unit_type = coalesce(nullif(trim(audit_row->>'unit_type'), ''), 'Each'),
        weight_value = nullif(audit_row->>'weight_value', '')::numeric,
        weight_unit = coalesce(nullif(trim(audit_row->>'weight_unit'), ''), 'oz'),
        updated_at = timezone('utc', now())
    where sku = trim(audit_row->>'sku');
    get diagnostics updated_rows = row_count;
    if updated_rows <> 1 then
      raise exception 'Audit SKU not found: %', trim(audit_row->>'sku');
    end if;
    updated_count := updated_count + updated_rows;
  end loop;
  return updated_count;
end;
$$;

revoke all on function public.apply_inventory_audit(jsonb) from public;
grant execute on function public.apply_inventory_audit(jsonb) to authenticated;
