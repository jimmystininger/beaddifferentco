begin;

-- The storefront is still in test-checkout mode until a payment provider is
-- connected. Reject any direct RPC call that tries to create a paid order
-- without explicitly opting into that test mode. The current storefront
-- checkout already sends test_order=true, so this does not change its flow.
create or replace function public.create_test_order(order_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  requirement record;
  component record;
  result jsonb;
begin
  if coalesce((order_payload->>'test_order')::boolean, false) is not true then
    raise exception 'Live checkout is not enabled until a payment provider is connected.';
  end if;

  if jsonb_typeof(order_payload->'lines') <> 'array'
     or jsonb_array_length(order_payload->'lines') = 0 then
    raise exception 'Your cart is empty.';
  end if;

  for requirement in
    select expanded.component_sku, sum(expanded.quantity)::integer as quantity
    from jsonb_to_recordset(order_payload->'lines')
      as requested(sku text, quantity integer, inventory_units integer)
    cross join lateral public.expand_inventory_sku(
      requested.sku,
      greatest(1, requested.quantity) * greatest(1, coalesce(requested.inventory_units, 1))
    ) expanded
    group by expanded.component_sku
    order by expanded.component_sku
  loop
    select inventory.id,
           inventory.quantity_on_hand,
           inventory.reserve_quantity,
           inventory.item_type
      into component
    from public.inventory_skus inventory
    where inventory.sku = requirement.component_sku
    for update;

    if component.id is null then
      raise exception 'Component SKU % is not linked to canonical inventory.', requirement.component_sku;
    end if;

    if lower(coalesce(component.item_type, 'inventory')) <> 'non-inventory'
       and component.quantity_on_hand - coalesce(component.reserve_quantity, 0) < requirement.quantity then
      raise exception 'Not enough available inventory for SKU %.', requirement.component_sku;
    end if;
  end loop;

  result := public.create_test_order_shipping_cost_legacy(order_payload);
  return result;
end;
$function$;

commit;
