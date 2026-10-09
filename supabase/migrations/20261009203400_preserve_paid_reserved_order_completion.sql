create or replace function public.complete_stripe_order(order_id_value uuid, session_id_value text, payment_intent_value text)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  order_row public.orders%rowtype;
  item_row record;
  requirement record;
  component record;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception 'Stripe order completion is server-only.';
  end if;
  select * into order_row from public.orders where id = order_id_value for update;
  if order_row.id is null then raise exception 'Order not found.'; end if;
  if order_row.payment_status = 'paid' then
    return jsonb_build_object('id', order_row.id, 'status', order_row.status, 'payment_status', order_row.payment_status);
  end if;
  if order_row.payment_status <> 'pending' or order_row.status <> 'pending' then
    raise exception 'Order is not awaiting Stripe payment.';
  end if;
  if order_row.stripe_checkout_session_id is not null and order_row.stripe_checkout_session_id <> session_id_value then
    raise exception 'Stripe checkout session does not match the order.';
  end if;

  for item_row in select inventory_sku, quantity, inventory_units from public.order_items where order_id = order_row.id
  loop
    for requirement in
      select expanded.component_sku, sum(expanded.quantity)::integer as quantity
      from public.expand_inventory_sku(item_row.inventory_sku, item_row.quantity * greatest(1, item_row.inventory_units)) expanded
      group by expanded.component_sku
    loop
      select i.id, i.item_type
        into component
      from public.inventory_skus i
      where i.sku = requirement.component_sku
      for update;
      if component.id is null then raise exception 'Component SKU % is not linked to canonical inventory.', requirement.component_sku; end if;
      update public.inventory_skus
      set quantity_on_hand = case when lower(coalesce(item_type, 'inventory')) = 'non-inventory' then quantity_on_hand else quantity_on_hand - requirement.quantity end,
          reserve_quantity = case when lower(coalesce(item_type, 'inventory')) = 'non-inventory' then reserve_quantity else greatest(0, reserve_quantity - requirement.quantity) end,
          updated_at = timezone('utc', now())
      where id = component.id;
    end loop;
  end loop;

  update public.orders
  set status = 'paid', payment_status = 'paid', stripe_payment_intent_id = nullif(trim(payment_intent_value), ''),
      payment_failure_reason = null, updated_at = timezone('utc', now())
  where id = order_row.id;
  insert into public.analytics_events(product_id, event_type)
  select product_id, 'purchase' from public.order_items where order_id = order_row.id;
  return jsonb_build_object('id', order_row.id, 'status', 'paid', 'payment_status', 'paid', 'guest_order_token', order_row.guest_order_token);
end;
$$;

revoke all on function public.complete_stripe_order(uuid, text, text) from public, anon, authenticated;
grant execute on function public.complete_stripe_order(uuid, text, text) to service_role;
