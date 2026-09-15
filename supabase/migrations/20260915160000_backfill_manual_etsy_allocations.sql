insert into public.inventory_manual_pack_allocations (
  source_type, etsy_sale_line_id, parent_sku, units, status, created_at
)
select
  'etsy', line.id, line.etsy_sku,
  greatest(0, coalesce(line.quantity, 0) - least(coalesce(line.quantity, 0), coalesce(line.refunded_quantity, 0))),
  'pending', coalesce(line.sale_date, timezone('utc', now()))
from public.etsy_sale_lines line
where line.matched_inventory_sku is null
  and greatest(0, coalesce(line.quantity, 0) - least(coalesce(line.quantity, 0), coalesce(line.refunded_quantity, 0))) > 0
  and coalesce(line.inventory_allocation_status, 'not_required') <> 'applied'
on conflict (etsy_sale_line_id) do update
set parent_sku = excluded.parent_sku,
    units = excluded.units,
    status = case when inventory_manual_pack_allocations.status = 'applied' then 'applied' else 'pending' end;

update public.etsy_sale_lines line
set inventory_allocation_status = 'pending',
    match_status = 'unmatched',
    updated_at = timezone('utc', now())
where line.matched_inventory_sku is null
  and exists (
    select 1
    from public.inventory_manual_pack_allocations allocation
    where allocation.etsy_sale_line_id = line.id
      and allocation.status = 'pending'
  );
