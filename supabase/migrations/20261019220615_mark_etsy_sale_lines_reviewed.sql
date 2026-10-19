create or replace function public.mark_etsy_sale_lines_reviewed(p_sale_line_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  excluded_count integer := 0;
  ignored_count integer := 0;
  cancelled_count integer := 0;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Admin access required.';
  end if;

  if coalesce(cardinality(p_sale_line_ids), 0) > 10000 then
    raise exception 'Too many Etsy sale lines were selected for review.';
  end if;

  insert into public.etsy_sale_line_exclusions (
    external_order_id,
    external_line_id,
    reason
  )
  select distinct
    line.external_order_id,
    line.external_line_id,
    'Marked reviewed in Etsy import history; retained for sales metrics and excluded from inventory follow-up.'
  from public.etsy_sale_lines line
  where line.id = any(coalesce(p_sale_line_ids, '{}'::uuid[]))
    and line.matched_inventory_sku is null
    and coalesce(line.inventory_allocation_status, 'not_required') not in ('applied', 'ignored')
    and coalesce(line.inventory_units_applied, 0) = 0
  on conflict (external_order_id, external_line_id) do nothing;
  get diagnostics excluded_count = row_count;

  update public.etsy_sale_lines line
  set inventory_allocation_status = 'ignored',
      updated_at = timezone('utc', now())
  where line.id = any(coalesce(p_sale_line_ids, '{}'::uuid[]))
    and line.matched_inventory_sku is null
    and coalesce(line.inventory_allocation_status, 'not_required') not in ('applied', 'ignored')
    and coalesce(line.inventory_units_applied, 0) = 0;
  get diagnostics ignored_count = row_count;

  update public.inventory_manual_pack_allocations allocation
  set status = 'cancelled',
      note = 'Marked reviewed in Etsy import history; sale retained for metrics and inventory was not changed.'
  from public.etsy_sale_lines line
  where allocation.etsy_sale_line_id = line.id
    and line.id = any(coalesce(p_sale_line_ids, '{}'::uuid[]))
    and allocation.status = 'pending';
  get diagnostics cancelled_count = row_count;

  return jsonb_build_object(
    'excluded', excluded_count,
    'ignored', ignored_count,
    'cancelled_allocations', cancelled_count
  );
end;
$$;

revoke all on function public.mark_etsy_sale_lines_reviewed(uuid[]) from public, anon;
grant execute on function public.mark_etsy_sale_lines_reviewed(uuid[]) to authenticated;
