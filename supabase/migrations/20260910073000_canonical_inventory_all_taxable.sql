update public.inventory_skus
set taxable = true,
    updated_at = timezone('utc', now())
where source_system = 'canonical';

create or replace function public.force_canonical_inventory_taxable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.taxable := true;
  return new;
end;
$$;

drop trigger if exists force_canonical_inventory_taxable on public.inventory_skus;
create trigger force_canonical_inventory_taxable
before insert or update on public.inventory_skus
for each row
execute function public.force_canonical_inventory_taxable();

revoke all on function public.force_canonical_inventory_taxable() from public;

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
    update public.inventory_skus
    set name = nullif(trim(audit_row->>'product_name'), ''),
        variant_name = nullif(trim(audit_row->>'variant_name'), ''),
        category = category_value,
        quantity_on_hand = (audit_row->>'inventory')::integer,
        reorder_point = (audit_row->>'reorder_point')::integer,
        unit_type = coalesce(nullif(trim(audit_row->>'unit_type'), ''), 'Each'),
        cost = nullif(audit_row->>'cost', '')::numeric,
        price = nullif(audit_row->>'price', '')::numeric,
        taxable = true,
        source_system = 'canonical',
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
