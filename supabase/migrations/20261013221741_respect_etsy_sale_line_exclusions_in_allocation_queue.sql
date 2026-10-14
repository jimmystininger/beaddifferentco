create or replace function public.queue_manual_etsy_pack_allocation()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.matched_inventory_sku is null
     and greatest(0, coalesce(new.quantity, 0) - least(coalesce(new.quantity, 0), coalesce(new.refunded_quantity, 0))) > 0
     and coalesce(new.inventory_allocation_status, 'not_required') not in ('applied', 'ignored')
     and not exists (
       select 1
       from public.etsy_sale_line_exclusions exclusion
       where exclusion.external_order_id = new.external_order_id
         and exclusion.external_line_id = new.external_line_id
     ) then
    insert into public.inventory_manual_pack_allocations (
      source_type, etsy_sale_line_id, parent_sku, units, created_by
    ) values (
      'etsy', new.id, new.etsy_sku,
      greatest(0, coalesce(new.quantity, 0) - least(coalesce(new.quantity, 0), coalesce(new.refunded_quantity, 0))),
      auth.uid()
    ) on conflict (etsy_sale_line_id) do update
      set parent_sku = excluded.parent_sku,
          units = excluded.units,
          status = case when inventory_manual_pack_allocations.status = 'applied' then 'applied' else 'pending' end;
    if new.inventory_allocation_status <> 'applied' then
      update public.etsy_sale_lines
      set inventory_allocation_status = 'pending', match_status = 'unmatched', updated_at = timezone('utc', now())
      where id = new.id and inventory_allocation_status <> 'pending';
    end if;
  end if;
  return new;
end;
$$;

update public.etsy_sale_lines line
set inventory_allocation_status = 'ignored',
    updated_at = timezone('utc', now())
from public.etsy_sale_line_exclusions exclusion
where exclusion.external_order_id = line.external_order_id
  and exclusion.external_line_id = line.external_line_id
  and line.matched_inventory_sku is null
  and coalesce(line.inventory_allocation_status, 'not_required') <> 'applied';

update public.inventory_manual_pack_allocations allocation
set status = 'cancelled',
    note = 'Excluded from inventory allocation at user request; Etsy sale history retained.'
from public.etsy_sale_lines line
join public.etsy_sale_line_exclusions exclusion
  on exclusion.external_order_id = line.external_order_id
 and exclusion.external_line_id = line.external_line_id
where allocation.etsy_sale_line_id = line.id
  and allocation.status = 'pending';
