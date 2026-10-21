create or replace function public.admin_preview_inventory_sku_reassignment_movements(
  p_source_sku text,
  p_target_sku text,
  p_units integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  source_value text := nullif(trim(coalesce(p_source_sku, '')), '');
  target_value text := nullif(trim(coalesce(p_target_sku, '')), '');
  units_value integer := greatest(0, coalesce(p_units, 0));
  restore_rows jsonb := '[]'::jsonb;
  deduct_rows jsonb := '[]'::jsonb;
begin
  if not private.is_admin() then
    raise exception 'Admin access required.';
  end if;
  if source_value is null or target_value is null then
    raise exception 'Choose both SKUs before previewing inventory movements.';
  end if;
  if not exists (select 1 from public.inventory_skus where lower(trim(sku)) = lower(source_value))
     or not exists (select 1 from public.inventory_skus where lower(trim(sku)) = lower(target_value)) then
    raise exception 'Both SKUs must exist in canonical inventory.';
  end if;
  if lower(source_value) = lower(target_value) then
    raise exception 'The replacement must be a different SKU.';
  end if;
  if units_value > 0 then
    select coalesce(jsonb_agg(jsonb_build_object('component_sku', expanded.component_sku, 'quantity', expanded.quantity)), '[]'::jsonb)
      into restore_rows
    from public.expand_inventory_sku(source_value, units_value) expanded;
    select coalesce(jsonb_agg(jsonb_build_object('component_sku', expanded.component_sku, 'quantity', expanded.quantity)), '[]'::jsonb)
      into deduct_rows
    from public.expand_inventory_sku(target_value, units_value) expanded;
  end if;
  return jsonb_build_object('restore', restore_rows, 'deduct', deduct_rows);
end;
$$;

revoke all on function public.admin_preview_inventory_sku_reassignment_movements(text, text, integer) from public, anon;
grant execute on function public.admin_preview_inventory_sku_reassignment_movements(text, text, integer) to authenticated, service_role;
