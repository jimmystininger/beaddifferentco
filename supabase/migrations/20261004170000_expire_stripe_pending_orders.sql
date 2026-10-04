create extension if not exists pg_cron with schema pg_catalog;

create index if not exists orders_stripe_pending_expiry_idx
  on public.orders (payment_expires_at)
  where payment_provider = 'stripe' and status = 'pending' and payment_status = 'pending';

create or replace function public.expire_pending_stripe_orders()
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
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
$$;

revoke all on function public.expire_pending_stripe_orders() from public, anon, authenticated;
grant execute on function public.expire_pending_stripe_orders() to service_role;

select cron.schedule(
  'expire-stripe-pending-orders',
  '*/5 * * * *',
  'select public.expire_pending_stripe_orders();'
)
where not exists (
  select 1 from cron.job where jobname = 'expire-stripe-pending-orders'
);
