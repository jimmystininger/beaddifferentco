alter table public.stripe_refunds
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists resolved_at timestamptz;

create or replace function public.record_stripe_refund_request(
  order_id_value uuid,
  stripe_refund_id_value text,
  amount_value numeric,
  reason_value text default null,
  metadata_value jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  order_row public.orders%rowtype;
  existing_refund public.stripe_refunds%rowtype;
  requested numeric := round(coalesce(amount_value, 0), 2);
  pending_total numeric;
  remaining numeric;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception 'Stripe refund recording is server-only.';
  end if;
  if nullif(trim(stripe_refund_id_value), '') is null then
    raise exception 'Stripe refund id is required.';
  end if;
  select * into existing_refund
  from public.stripe_refunds
  where stripe_refund_id = trim(stripe_refund_id_value)
  for update;
  if existing_refund.id is not null then
    return jsonb_build_object(
      'stripe_refund_id', existing_refund.stripe_refund_id,
      'status', existing_refund.status,
      'refund_amount', existing_refund.amount,
      'pending', existing_refund.status = 'pending'
    );
  end if;
  if requested <= 0 then raise exception 'Refund amount must be greater than zero.'; end if;
  select * into order_row from public.orders where id = order_id_value for update;
  if order_row.id is null then raise exception 'Order not found.'; end if;
  select coalesce(sum(amount), 0) into pending_total
  from public.stripe_refunds
  where order_id = order_row.id and status = 'pending';
  remaining := round(greatest(0, coalesce(order_row.total, 0) - coalesce(order_row.refunded_amount, 0) - pending_total), 2);
  if requested > remaining then
    raise exception 'Refund exceeds the remaining refundable balance of $%.', remaining;
  end if;
  insert into public.stripe_refunds(order_id, stripe_refund_id, amount, status, reason, metadata)
  values(order_row.id, trim(stripe_refund_id_value), requested, 'pending', nullif(trim(reason_value), ''), coalesce(metadata_value, '{}'::jsonb));
  return jsonb_build_object(
    'stripe_refund_id', trim(stripe_refund_id_value),
    'status', 'pending',
    'refund_amount', requested,
    'pending', true
  );
end;
$$;

revoke all on function public.record_stripe_refund_request(uuid, text, numeric, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_stripe_refund_request(uuid, text, numeric, text, jsonb) to service_role;

create or replace function public.apply_stripe_refund(order_id_value uuid, refund_amount_value numeric, reason_value text default null, stripe_refund_id_value text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
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
  update public.orders
  set refunded_amount = round(coalesce(refunded_amount, 0) + applied, 2), refunded_at = timezone('utc', now()),
      refund_reason = nullif(trim(reason_value), ''), status = next_status, payment_status = case when next_status = 'refunded' then 'refunded' else 'partially_refunded' end,
      updated_at = timezone('utc', now())
  where id = order_row.id;
  insert into public.order_financial_events(order_id, event_type, amount, reason, metadata, created_by)
  values(order_row.id, 'refund', applied, nullif(trim(reason_value), ''), jsonb_build_object('stripe_refund_id', nullif(trim(stripe_refund_id_value), '')), null);
  return jsonb_build_object('id', order_row.id, 'status', next_status, 'refunded_amount', round(coalesce(order_row.refunded_amount, 0) + applied, 2), 'refund_amount', applied, 'remaining', greatest(0, remaining - applied), 'stripe_refund_id', nullif(trim(stripe_refund_id_value), ''));
end;
$$;

revoke all on function public.apply_stripe_refund(uuid, numeric, text, text) from public, anon, authenticated;
grant execute on function public.apply_stripe_refund(uuid, numeric, text, text) to service_role;

create or replace function public.process_stripe_satisfaction_refund(
  order_id_value uuid,
  amount_value numeric,
  reason_value text default null,
  stripe_refund_id_value text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
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
  update public.orders
  set refunded_amount = round(coalesce(refunded_amount, 0) + applied, 2),
      refunded_at = timezone('utc', now()), refund_reason = nullif(trim(reason_value), ''), status = next_status,
      payment_status = next_status, updated_at = timezone('utc', now())
  where id = order_row.id;
  insert into public.order_financial_events(order_id, event_type, amount, reason, metadata, created_by)
  values(order_row.id, 'satisfaction_refund', applied, nullif(trim(reason_value), ''), jsonb_build_object('stripe_refund_id', nullif(trim(stripe_refund_id_value), '')), null);
  return jsonb_build_object('id', order_row.id, 'status', next_status, 'refund_amount', applied, 'refunded_amount', round(coalesce(order_row.refunded_amount, 0) + applied, 2), 'remaining', greatest(0, remaining - applied), 'stripe_refund_id', nullif(trim(stripe_refund_id_value), ''));
end;
$$;

revoke all on function public.process_stripe_satisfaction_refund(uuid, numeric, text, text) from public, anon, authenticated;
grant execute on function public.process_stripe_satisfaction_refund(uuid, numeric, text, text) to service_role;

create or replace function public.process_stripe_order_return(
  order_id_value uuid,
  line_items jsonb,
  reason_value text default null,
  refund_shipping boolean default false,
  expected_amount numeric default null,
  stripe_refund_id_value text default null,
  dry_run boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  order_row public.orders%rowtype;
  item_row public.order_items%rowtype;
  line jsonb;
  requested_qty integer;
  eligible_qty integer;
  line_gross numeric;
  line_discount numeric;
  line_tax numeric;
  line_refund numeric;
  refund_total numeric := 0;
  remaining numeric;
  available_before numeric;
  subtotal_after_discount numeric;
  requirement record;
  shipping_refund numeric := 0;
  shipping_remaining numeric;
  existing_refund_status text;
  next_status text;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception 'Stripe refund application is server-only.';
  end if;
  if jsonb_typeof(line_items) <> 'array' or (jsonb_array_length(line_items) = 0 and not refund_shipping) then
    raise exception 'Select at least one line or choose shipping.';
  end if;
  select * into order_row from public.orders where id = order_id_value for update;
  if order_row.id is null then raise exception 'Order not found.'; end if;
  if order_row.status in ('cancelled', 'refunded', 'returned') then raise exception 'This order is already closed.'; end if;
  available_before := greatest(0, round(coalesce(order_row.total, 0) - coalesce(order_row.refunded_amount, 0), 2));
  if available_before <= 0 then raise exception 'This order has no refundable balance remaining.'; end if;
  subtotal_after_discount := greatest(0, coalesce(order_row.subtotal, 0) - coalesce(order_row.discount, 0));
  for line in select value from jsonb_array_elements(line_items) entries(value)
  loop
    select * into item_row from public.order_items where id = nullif(line->>'item_id', '')::uuid and order_id = order_id_value for update;
    if item_row.id is null then raise exception 'Order line not found.'; end if;
    requested_qty := greatest(0, (line->>'quantity')::integer);
    eligible_qty := item_row.quantity - coalesce(item_row.refunded_quantity, 0);
    if requested_qty = 0 or requested_qty > eligible_qty then raise exception 'Return quantity exceeds the remaining quantity for %.', item_row.product_name; end if;
    line_gross := round(item_row.unit_price * requested_qty, 2);
    line_discount := case when coalesce(order_row.subtotal, 0) > 0 then round(coalesce(order_row.discount, 0) * (item_row.unit_price * requested_qty) / order_row.subtotal, 2) else 0 end;
    line_tax := case when subtotal_after_discount > 0 then round(coalesce(order_row.tax_amount, 0) * greatest(0, line_gross - line_discount) / subtotal_after_discount, 2) else 0 end;
    line_refund := greatest(0, round(line_gross - line_discount + line_tax, 2));
    refund_total := refund_total + line_refund;
  end loop;
  shipping_remaining := greatest(0, round(coalesce(order_row.shipping_amount, order_row.shipping_cost, 0) - coalesce(order_row.refunded_shipping_amount, 0), 2));
  if refund_shipping and shipping_remaining > 0 then
    shipping_refund := least(shipping_remaining, greatest(0, available_before - refund_total));
    refund_total := refund_total + shipping_refund;
  end if;
  if refund_shipping and shipping_refund = 0 and jsonb_array_length(line_items) = 0 then raise exception 'Shipping has already been fully refunded or no refundable balance remains.'; end if;
  if refund_total > available_before then raise exception 'Refund exceeds the remaining order balance of $%.', to_char(available_before, 'FM999999990.00'); end if;
  if expected_amount is not null and round(expected_amount, 2) <> round(refund_total, 2) then raise exception 'Return refund changed. Refresh the order and try again.'; end if;
  remaining := greatest(0, round(available_before - refund_total, 2));
  next_status := case when remaining = 0 then 'returned' else 'partially_refunded' end;
  if dry_run then return jsonb_build_object('status', next_status, 'refund_amount', round(refund_total, 2), 'remaining', remaining, 'shipping_refund', shipping_refund); end if;
  if nullif(trim(stripe_refund_id_value), '') is not null then
    select status into existing_refund_status from public.stripe_refunds where stripe_refund_id = trim(stripe_refund_id_value) for update;
    if existing_refund_status is null then
      insert into public.stripe_refunds(order_id, stripe_refund_id, amount, status, reason, resolved_at)
      values(order_row.id, trim(stripe_refund_id_value), round(refund_total, 2), 'succeeded', nullif(trim(reason_value), ''), timezone('utc', now()));
    elsif existing_refund_status = 'succeeded' then
      return jsonb_build_object('id', order_row.id, 'status', order_row.status, 'refunded_amount', order_row.refunded_amount, 'stripe_refund_id', trim(stripe_refund_id_value), 'already_applied', true);
    elsif existing_refund_status in ('failed', 'canceled') then
      raise exception 'Stripe refund % cannot be applied because it is already %.', trim(stripe_refund_id_value), existing_refund_status;
    else
      update public.stripe_refunds set amount = round(refund_total, 2), reason = coalesce(nullif(trim(reason_value), ''), reason), status = 'succeeded', resolved_at = timezone('utc', now()) where stripe_refund_id = trim(stripe_refund_id_value);
    end if;
  end if;
  for line in select value from jsonb_array_elements(line_items) entries(value)
  loop
    select * into item_row from public.order_items where id = nullif(line->>'item_id', '')::uuid and order_id = order_id_value for update;
    requested_qty := greatest(0, (line->>'quantity')::integer);
    line_gross := round(item_row.unit_price * requested_qty, 2);
    line_discount := case when coalesce(order_row.subtotal, 0) > 0 then round(coalesce(order_row.discount, 0) * (item_row.unit_price * requested_qty) / order_row.subtotal, 2) else 0 end;
    line_tax := case when subtotal_after_discount > 0 then round(coalesce(order_row.tax_amount, 0) * greatest(0, line_gross - line_discount) / subtotal_after_discount, 2) else 0 end;
    line_refund := greatest(0, round(line_gross - line_discount + line_tax, 2));
    update public.order_items set refunded_quantity = coalesce(refunded_quantity, 0) + requested_qty, refunded_amount = round(coalesce(refunded_amount, 0) + line_refund, 2) where id = item_row.id;
    for requirement in select expanded.component_sku, sum(expanded.quantity)::integer quantity from public.expand_inventory_sku(coalesce(item_row.inventory_sku, item_row.sku), requested_qty * greatest(1, coalesce(item_row.inventory_units, 1))) expanded group by expanded.component_sku loop
      update public.inventory_skus set quantity_on_hand = coalesce(quantity_on_hand, 0) + requirement.quantity, updated_at = timezone('utc', now()) where sku = requirement.component_sku and lower(coalesce(item_type, 'inventory')) <> 'non-inventory';
      if not found then raise exception 'Component SKU % is not linked to canonical inventory.', requirement.component_sku; end if;
    end loop;
    insert into public.order_financial_events(order_id, order_item_id, event_type, quantity, amount, reason, metadata, created_by)
    values(order_row.id, item_row.id, 'return', requested_qty, line_refund, nullif(trim(reason_value), ''), jsonb_build_object('line_gross', line_gross, 'line_discount', line_discount, 'line_tax', line_tax, 'stripe_refund_id', nullif(trim(stripe_refund_id_value), '')), null);
  end loop;
  if shipping_refund > 0 then
    insert into public.order_financial_events(order_id, event_type, amount, reason, metadata, created_by)
    values(order_row.id, 'refund', shipping_refund, nullif(trim(reason_value), ''), jsonb_build_object('component', 'shipping', 'stripe_refund_id', nullif(trim(stripe_refund_id_value), '')), null);
  end if;
  update public.orders
  set refunded_amount = round(coalesce(refunded_amount, 0) + refund_total, 2), refunded_shipping_amount = round(coalesce(refunded_shipping_amount, 0) + shipping_refund, 2), refunded_at = timezone('utc', now()), refund_reason = nullif(trim(reason_value), ''), status = next_status, payment_status = case when remaining = 0 then 'refunded' else 'partially_refunded' end, updated_at = timezone('utc', now())
  where id = order_row.id;
  return jsonb_build_object('id', order_row.id, 'status', next_status, 'refund_amount', round(refund_total, 2), 'refunded_amount', round(coalesce(order_row.refunded_amount, 0) + refund_total, 2), 'remaining', remaining, 'shipping_refund', shipping_refund, 'stripe_refund_id', nullif(trim(stripe_refund_id_value), ''));
end;
$$;

revoke all on function public.process_stripe_order_return(uuid, jsonb, text, boolean, numeric, text, boolean) from public, anon, authenticated;
grant execute on function public.process_stripe_order_return(uuid, jsonb, text, boolean, numeric, text, boolean) to service_role;

create or replace function public.finalize_stripe_refund(
  stripe_refund_id_value text,
  order_id_value uuid default null,
  amount_value numeric default null,
  status_value text default 'succeeded',
  reason_value text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  refund_row public.stripe_refunds%rowtype;
  refund_status text := lower(coalesce(nullif(trim(status_value), ''), 'succeeded'));
  refund_amount numeric;
  refund_reason text;
  refund_kind text;
  refund_shipping boolean;
  result jsonb;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception 'Stripe refund finalization is server-only.';
  end if;
  if refund_status not in ('pending', 'succeeded', 'failed', 'canceled') then raise exception 'Unsupported Stripe refund status.'; end if;
  select * into refund_row from public.stripe_refunds where stripe_refund_id = nullif(trim(stripe_refund_id_value), '') for update;
  if refund_row.id is null then
    if order_id_value is null or amount_value is null or amount_value <= 0 then raise exception 'Stripe refund record not found.'; end if;
    insert into public.stripe_refunds(order_id, stripe_refund_id, amount, status, reason, metadata)
    values(order_id_value, trim(stripe_refund_id_value), round(amount_value, 2), 'pending', nullif(trim(reason_value), ''), jsonb_build_object('refund_kind', 'order'))
    returning * into refund_row;
  end if;
  if refund_row.status = 'succeeded' then
    return jsonb_build_object('status', 'succeeded', 'stripe_refund_id', refund_row.stripe_refund_id, 'refund_amount', refund_row.amount, 'already_applied', true);
  end if;
  if refund_status in ('failed', 'canceled', 'pending') then
    update public.stripe_refunds
    set status = refund_status, reason = coalesce(nullif(trim(reason_value), ''), reason), resolved_at = case when refund_status in ('failed', 'canceled') then timezone('utc', now()) else null end
    where id = refund_row.id;
    return jsonb_build_object('status', refund_status, 'stripe_refund_id', refund_row.stripe_refund_id, 'refund_amount', refund_row.amount, 'error', case when refund_status in ('failed', 'canceled') then coalesce(nullif(trim(reason_value), ''), 'Stripe refund failed.') else null end);
  end if;
  refund_amount := round(coalesce(amount_value, refund_row.amount), 2);
  refund_reason := coalesce(nullif(trim(reason_value), ''), refund_row.reason, 'Refund processed in Stripe.');
  refund_kind := lower(coalesce(refund_row.metadata->>'refund_kind', 'order'));
  if refund_kind = 'return' then
    refund_shipping := lower(coalesce(refund_row.metadata->>'refund_shipping', 'false')) = 'true';
    result := public.process_stripe_order_return(refund_row.order_id, coalesce(refund_row.metadata->'line_items', '[]'::jsonb), refund_reason, refund_shipping, refund_amount, refund_row.stripe_refund_id, false);
  elsif refund_kind = 'satisfaction' then
    result := public.process_stripe_satisfaction_refund(refund_row.order_id, refund_amount, refund_reason, refund_row.stripe_refund_id);
  else
    result := public.apply_stripe_refund(refund_row.order_id, refund_amount, refund_reason, refund_row.stripe_refund_id);
  end if;
  return result || jsonb_build_object('stripe_refund_id', refund_row.stripe_refund_id, 'stripe_status', 'succeeded');
end;
$$;

revoke all on function public.finalize_stripe_refund(text, uuid, numeric, text, text) from public, anon, authenticated;
grant execute on function public.finalize_stripe_refund(text, uuid, numeric, text, text) to service_role;
