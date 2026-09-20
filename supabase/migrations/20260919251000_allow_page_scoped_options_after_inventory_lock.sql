create or replace function public.prevent_locked_inventory_setup_changes()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if coalesce(old.source_metadata->>'setup_locked', 'false') = 'true'
    and coalesce(current_setting('bead.inventory_audit_mode', true), 'false') <> 'true'
    and (
      new.sku is distinct from old.sku
      or new.item_type is distinct from old.item_type
      or new.hierarchy is distinct from old.hierarchy
      or new.reorder_point is distinct from old.reorder_point
      or new.reserve_quantity is distinct from old.reserve_quantity
      or new.unit_type is distinct from old.unit_type
      or new.weight_value is distinct from old.weight_value
      or new.weight_unit is distinct from old.weight_unit
      or new.cost is distinct from old.cost
      or (coalesce(new.source_metadata, '{}'::jsonb) - 'product_pages') is distinct from
         (coalesce(old.source_metadata, '{}'::jsonb) - 'product_pages')
    ) then
    raise exception 'Inventory setup is locked. Use the Year-end audit CSV to change this SKU.';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_locked_inventory_setup_changes() from public, anon, authenticated;
