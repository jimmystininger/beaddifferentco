do $$
declare
  table_name text;
begin
  for table_name in
    select quote_ident(n.nspname) || '.' || quote_ident(c.relname)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    execute format('revoke truncate, references, trigger on table %s from anon, authenticated', table_name);
  end loop;
end;
$$;

alter default privileges for role postgres in schema public
revoke truncate, references, trigger on tables from anon, authenticated;

revoke delete on public.orders from anon, authenticated;
drop policy if exists orders_admin_delete on public.orders;

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
     and current_setting('request.jwt.claim.role', true) is distinct from 'service_role' then
    if old.payment_status = 'refunded'
       or old.status in ('cancelled', 'refunded', 'returned') then
      raise exception 'Closed Stripe orders cannot be reopened outside the Stripe workflow.';
    end if;
    if old.payment_status in ('paid', 'partially_refunded')
       and new.status in ('cancelled', 'refunded', 'returned', 'partially_refunded') then
      raise exception 'Paid Stripe orders must use the Stripe refund workflow.';
    end if;
    if old.payment_status not in ('paid', 'partially_refunded', 'refunded')
       and new.status in ('paid', 'processing', 'shipped', 'completed') then
      raise exception 'Stripe payment must be confirmed before fulfillment.';
    end if;
  end if;

  return new;
end;
$$;
