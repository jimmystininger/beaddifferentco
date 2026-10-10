create or replace function public.reserve_stripe_refund_request(
  order_id_value uuid,
  request_key_value uuid,
  amount_value numeric,
  reason_value text,
  metadata_value jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  order_row public.orders%rowtype;
  existing public.stripe_refunds%rowtype;
  requested numeric := round(coalesce(amount_value, 0), 2);
  pending_total numeric;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception 'Stripe refund requests are server-only.';
  end if;
  if request_key_value is null or requested <= 0 then
    raise exception 'A refund request id and positive amount are required.';
  end if;
  select * into order_row from public.orders where id = order_id_value for update;
  if order_row.id is null or order_row.stripe_payment_intent_id is null then
    raise exception 'A paid Stripe order is required.';
  end if;
  select * into existing from public.stripe_refunds where request_key = request_key_value for update;
  if existing.id is not null then
    if existing.order_id <> order_id_value or existing.amount <> requested
       or existing.metadata <> coalesce(metadata_value, '{}'::jsonb) then
      raise exception 'Refund request id was already used for a different refund.';
    end if;
    return jsonb_build_object('stripe_refund_id', existing.stripe_refund_id,
      'status', existing.status, 'refund_amount', existing.amount,
      'already_submitted', existing.stripe_refund_id !~ '^pending:');
  end if;
  select coalesce(sum(amount), 0) into pending_total
  from public.stripe_refunds where order_id = order_id_value and status = 'pending';
  if requested > round(greatest(0, order_row.total - coalesce(order_row.refunded_amount, 0) - pending_total), 2) then
    raise exception 'Refund exceeds the remaining balance after pending refunds.';
  end if;
  insert into public.stripe_refunds(order_id, stripe_refund_id, request_key, amount, status, reason, metadata)
  values(order_id_value, 'pending:' || request_key_value::text, request_key_value,
    requested, 'pending', nullif(trim(reason_value), ''), coalesce(metadata_value, '{}'::jsonb));
  return jsonb_build_object('status', 'pending', 'refund_amount', requested, 'already_submitted', false);
end;
$$;

create or replace function public.attach_stripe_refund_request(
  request_key_value uuid,
  stripe_refund_id_value text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  refund_row public.stripe_refunds%rowtype;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception 'Stripe refund requests are server-only.';
  end if;
  if stripe_refund_id_value !~ '^[a-z]+_[A-Za-z0-9]+$' then
    raise exception 'A valid Stripe refund id is required.';
  end if;
  select * into refund_row from public.stripe_refunds where request_key = request_key_value for update;
  if refund_row.id is null then raise exception 'Refund request not found.'; end if;
  if refund_row.stripe_refund_id <> 'pending:' || request_key_value::text
     and refund_row.stripe_refund_id <> stripe_refund_id_value then
    raise exception 'Refund request is already attached to another Stripe refund.';
  end if;
  update public.stripe_refunds
  set stripe_refund_id = stripe_refund_id_value
  where id = refund_row.id and stripe_refund_id <> stripe_refund_id_value;
  return jsonb_build_object('stripe_refund_id', stripe_refund_id_value,
    'status', refund_row.status, 'refund_amount', refund_row.amount,
    'pending', refund_row.status = 'pending');
end;
$$;

revoke all on function public.reserve_stripe_refund_request(uuid, uuid, numeric, text, jsonb) from public, anon, authenticated;
grant execute on function public.reserve_stripe_refund_request(uuid, uuid, numeric, text, jsonb) to service_role;
revoke all on function public.attach_stripe_refund_request(uuid, text) from public, anon, authenticated;
grant execute on function public.attach_stripe_refund_request(uuid, text) to service_role;
