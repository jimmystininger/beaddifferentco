CREATE OR REPLACE FUNCTION public.expire_pending_stripe_orders()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  order_id_value uuid;
  item_row record;
  requirement record;
  released_count integer := 0;
begin
  for order_id_value in
    select id
    from public.orders
    where payment_provider = 'stripe'
      and status = 'pending'
      and payment_status = 'pending'
      and payment_expires_at is not null
      and payment_expires_at <= timezone('utc', now())
    order by payment_expires_at, id
    for update skip locked
  loop
    for item_row in
      select inventory_sku, sku, quantity, inventory_units
      from public.order_items
      where order_id = order_id_value
    loop
      for requirement in
        select expanded.component_sku, sum(expanded.quantity)::integer as quantity
        from public.expand_inventory_sku(
          coalesce(item_row.inventory_sku, item_row.sku),
          item_row.quantity * greatest(1, coalesce(item_row.inventory_units, 1))
        ) expanded
        group by expanded.component_sku
      loop
        update public.inventory_skus
        set reserve_quantity = greatest(0, coalesce(reserve_quantity, 0) - requirement.quantity),
            updated_at = timezone('utc', now())
        where sku = requirement.component_sku
          and lower(coalesce(item_type, 'inventory')) <> 'non-inventory';
      end loop;
    end loop;

    perform set_config('bead.order_reversal_context', 'rpc', true);

    update public.orders
    set status = 'cancelled',
        payment_status = 'expired',
        payment_failure_reason = 'Stripe Checkout payment was not completed before the reservation expired.',
        updated_at = timezone('utc', now())
    where id = order_id_value
      and status = 'pending'
      and payment_status = 'pending';

    if found then
      released_count := released_count + 1;
    end if;
  end loop;

  return jsonb_build_object('released_count', released_count);
end;
$function$;


CREATE OR REPLACE FUNCTION public.release_stripe_order(order_id_value uuid, reason_value text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  order_row public.orders%rowtype;
  item_row record;
  requirement record;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception 'Stripe order release is server-only.';
  end if;
  select * into order_row from public.orders where id = order_id_value for update;
  if order_row.id is null then raise exception 'Order not found.'; end if;
  if order_row.payment_status <> 'pending' then
    return jsonb_build_object('id', order_row.id, 'status', order_row.status, 'payment_status', order_row.payment_status);
  end if;
  for item_row in select inventory_sku, quantity, inventory_units from public.order_items where order_id = order_row.id
  loop
    for requirement in
      select expanded.component_sku, sum(expanded.quantity)::integer as quantity
      from public.expand_inventory_sku(item_row.inventory_sku, item_row.quantity * greatest(1, item_row.inventory_units)) expanded
      group by expanded.component_sku
    loop
      update public.inventory_skus
      set reserve_quantity = greatest(0, reserve_quantity - requirement.quantity), updated_at = timezone('utc', now())
      where sku = requirement.component_sku and lower(coalesce(item_type, 'inventory')) <> 'non-inventory';
    end loop;
  end loop;
  perform set_config('bead.order_reversal_context', 'rpc', true);
  update public.orders
  set status = 'cancelled', payment_status = 'expired', payment_failure_reason = nullif(trim(reason_value), ''),
      updated_at = timezone('utc', now())
  where id = order_row.id;
  return jsonb_build_object('id', order_row.id, 'status', 'cancelled', 'payment_status', 'expired');
end;
$function$;


CREATE OR REPLACE FUNCTION public.apply_stripe_refund(order_id_value uuid, refund_amount_value numeric, reason_value text DEFAULT NULL::text, stripe_refund_id_value text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  order_row public.orders%rowtype;
  applied numeric := round(coalesce(refund_amount_value, 0), 2);
  remaining numeric;
  existing_refund_status text;
  next_status text;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception 'Stripe refund application is server-only.';
  end if;
  select * into order_row from public.orders where id = order_id_value for update;
  if order_row.id is null then raise exception 'Order not found.'; end if;
  remaining := round(greatest(0, order_row.total - coalesce(order_row.refunded_amount, 0)), 2);
  if applied <= 0 or applied > remaining then
    raise exception 'Refund must be greater than zero and no more than the remaining refundable amount of $%.', remaining;
  end if;
  if nullif(trim(stripe_refund_id_value), '') is not null then
    select status into existing_refund_status
    from public.stripe_refunds
    where stripe_refund_id = trim(stripe_refund_id_value)
    for update;
    if existing_refund_status is null then
      insert into public.stripe_refunds(order_id, stripe_refund_id, amount, status, reason, resolved_at)
      values(order_row.id, trim(stripe_refund_id_value), applied, 'succeeded', nullif(trim(reason_value), ''), timezone('utc', now()));
    elsif existing_refund_status = 'succeeded' then
      return jsonb_build_object('id', order_row.id, 'status', order_row.status, 'refunded_amount', order_row.refunded_amount, 'stripe_refund_id', trim(stripe_refund_id_value), 'already_applied', true);
    elsif existing_refund_status in ('failed', 'canceled') then
      raise exception 'Stripe refund % cannot be applied because it is already %.', trim(stripe_refund_id_value), existing_refund_status;
    else
      update public.stripe_refunds
      set amount = applied, reason = coalesce(nullif(trim(reason_value), ''), reason), status = 'succeeded', resolved_at = timezone('utc', now())
      where stripe_refund_id = trim(stripe_refund_id_value);
    end if;
  end if;
  next_status := case when applied >= remaining then 'refunded' else 'partially_refunded' end;
  perform set_config('bead.order_reversal_context', 'rpc', true);
  update public.orders
  set refunded_amount = round(coalesce(refunded_amount, 0) + applied, 2), refunded_at = timezone('utc', now()),
      refund_reason = nullif(trim(reason_value), ''), status = next_status, payment_status = case when next_status = 'refunded' then 'refunded' else 'partially_refunded' end,
      updated_at = timezone('utc', now())
  where id = order_row.id;
  insert into public.order_financial_events(order_id, event_type, amount, reason, metadata, created_by)
  values(order_row.id, 'refund', applied, nullif(trim(reason_value), ''), jsonb_build_object('stripe_refund_id', nullif(trim(stripe_refund_id_value), '')), null);
  return jsonb_build_object('id', order_row.id, 'status', next_status, 'refunded_amount', round(coalesce(order_row.refunded_amount, 0) + applied, 2), 'refund_amount', applied, 'remaining', greatest(0, remaining - applied), 'stripe_refund_id', nullif(trim(stripe_refund_id_value), ''));
end;
$function$;


CREATE OR REPLACE FUNCTION public.process_stripe_satisfaction_refund(order_id_value uuid, amount_value numeric, reason_value text DEFAULT NULL::text, stripe_refund_id_value text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  order_row public.orders%rowtype;
  applied numeric := round(coalesce(amount_value, 0), 2);
  remaining numeric;
  existing_refund_status text;
  next_status text;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception 'Stripe refund application is server-only.';
  end if;
  select * into order_row from public.orders where id = order_id_value for update;
  if order_row.id is null then raise exception 'Order not found.'; end if;
  remaining := round(greatest(0, coalesce(order_row.total, 0) - coalesce(order_row.refunded_amount, 0)), 2);
  if applied <= 0 or applied > remaining then
    raise exception 'Amount must be between $0.01 and the remaining balance of $%.', remaining;
  end if;
  if nullif(trim(stripe_refund_id_value), '') is not null then
    select status into existing_refund_status
    from public.stripe_refunds
    where stripe_refund_id = trim(stripe_refund_id_value)
    for update;
    if existing_refund_status is null then
      insert into public.stripe_refunds(order_id, stripe_refund_id, amount, status, reason, resolved_at)
      values(order_row.id, trim(stripe_refund_id_value), applied, 'succeeded', nullif(trim(reason_value), ''), timezone('utc', now()));
    elsif existing_refund_status = 'succeeded' then
      return jsonb_build_object('id', order_row.id, 'status', order_row.status, 'refunded_amount', order_row.refunded_amount, 'stripe_refund_id', trim(stripe_refund_id_value), 'already_applied', true);
    elsif existing_refund_status in ('failed', 'canceled') then
      raise exception 'Stripe refund % cannot be applied because it is already %.', trim(stripe_refund_id_value), existing_refund_status;
    else
      update public.stripe_refunds
      set amount = applied, reason = coalesce(nullif(trim(reason_value), ''), reason), status = 'succeeded', resolved_at = timezone('utc', now())
      where stripe_refund_id = trim(stripe_refund_id_value);
    end if;
  end if;
  next_status := case when applied >= remaining then 'refunded' else 'partially_refunded' end;
  perform set_config('bead.order_reversal_context', 'rpc', true);
  update public.orders
  set refunded_amount = round(coalesce(refunded_amount, 0) + applied, 2),
      refunded_at = timezone('utc', now()), refund_reason = nullif(trim(reason_value), ''), status = next_status,
      payment_status = next_status, updated_at = timezone('utc', now())
  where id = order_row.id;
  insert into public.order_financial_events(order_id, event_type, amount, reason, metadata, created_by)
  values(order_row.id, 'satisfaction_refund', applied, nullif(trim(reason_value), ''), jsonb_build_object('stripe_refund_id', nullif(trim(stripe_refund_id_value), '')), null);
  return jsonb_build_object('id', order_row.id, 'status', next_status, 'refund_amount', applied, 'refunded_amount', round(coalesce(order_row.refunded_amount, 0) + applied, 2), 'remaining', greatest(0, remaining - applied), 'stripe_refund_id', nullif(trim(stripe_refund_id_value), ''));
end;
$function$;
