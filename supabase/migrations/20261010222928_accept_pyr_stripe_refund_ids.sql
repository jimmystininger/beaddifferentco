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
  normalized_refund_id text := btrim(stripe_refund_id_value);
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception 'Stripe refund requests are server-only.';
  end if;
  if normalized_refund_id is null
     or normalized_refund_id !~ '^(re|pyr)_[A-Za-z0-9]+$' then
    raise exception 'A valid Stripe refund id is required.';
  end if;
  select * into refund_row from public.stripe_refunds where request_key = request_key_value for update;
  if refund_row.id is null then raise exception 'Refund request not found.'; end if;
  if refund_row.stripe_refund_id <> 'pending:' || request_key_value::text
     and refund_row.stripe_refund_id <> normalized_refund_id then
    raise exception 'Refund request is already attached to another Stripe refund.';
  end if;
  update public.stripe_refunds
  set stripe_refund_id = normalized_refund_id
  where id = refund_row.id and stripe_refund_id <> normalized_refund_id;
  return jsonb_build_object('stripe_refund_id', normalized_refund_id,
    'status', refund_row.status, 'refund_amount', refund_row.amount,
    'pending', refund_row.status = 'pending');
end;
$$;

revoke all on function public.attach_stripe_refund_request(uuid, text) from public, anon, authenticated;
grant execute on function public.attach_stripe_refund_request(uuid, text) to service_role;
