create or replace function public.guard_order_reversal()
returns trigger
language plpgsql
set search_path = public, private
as $$
begin
  if new.status in ('cancelled', 'refunded')
     and old.status not in ('cancelled', 'refunded')
     and coalesce(current_setting('bead.order_reversal_context', true), '') <> 'rpc' then
    raise exception 'Order cancellations and refunds must use the guarded reversal workflow.';
  end if;

  if new.status is distinct from old.status
     and old.payment_provider = 'stripe'
     and current_setting('request.jwt.claim.role', true) is distinct from 'service_role'
     and coalesce(current_setting('bead.order_reversal_context', true), '') <> 'rpc' then
    if old.payment_status = 'refunded'
       or old.status in ('cancelled', 'refunded', 'returned') then
      raise exception 'Closed Stripe orders cannot be reopened outside the Stripe workflow.';
    end if;
    if old.payment_status in ('paid', 'partially_refunded')
       and new.status in ('cancelled', 'refunded', 'returned', 'partially_refunded') then
      raise exception 'Paid Stripe orders must use the Stripe refund workflow.';
    end if;
    if new.payment_status not in ('paid', 'partially_refunded', 'refunded')
       and new.status in ('paid', 'processing', 'shipped', 'completed') then
      raise exception 'Stripe payment must be confirmed before fulfillment.';
    end if;
  end if;

  return new;
end;
$$;
