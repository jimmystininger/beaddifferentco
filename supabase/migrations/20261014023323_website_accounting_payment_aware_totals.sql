create or replace function public.admin_website_accounting_totals(
  p_start timestamptz default null,
  p_end timestamptz default null
)
returns table(
  order_count bigint,
  units_sold numeric,
  returned_units numeric,
  gross_sales numeric,
  discounts numeric,
  refunds numeric,
  shipping_collected numeric,
  tax_collected numeric,
  cogs numeric,
  promo_units numeric
)
language sql
security definer
set search_path = public, private
as $$
  with return_quantities as (
    select e.order_item_id, sum(greatest(coalesce(e.quantity, 0), 0)) as quantity
    from public.order_financial_events e
    where e.event_type = 'return'
      and e.order_item_id is not null
    group by e.order_item_id
  ),
  return_tax as (
    select
      e.order_id,
      sum(greatest(0, case
        when trim(coalesce(e.metadata->>'line_tax', '')) ~ '^[0-9]+(\.[0-9]+)?$' then (e.metadata->>'line_tax')::numeric
        else 0
      end)) as tax_amount,
      sum(case when e.metadata ? 'line_tax' then greatest(coalesce(e.amount, 0), 0) else 0 end) as itemized_refund_amount
    from public.order_financial_events e
    where e.event_type = 'return'
    group by e.order_id
  ),
  eligible_orders as (
    select
      o.id,
      o.discount,
      o.shipping_amount,
      o.tax_amount,
      o.total,
      o.refunded_amount,
      o.refunded_shipping_amount
    from public.orders o
    where private.is_admin()
      and (p_start is null or o.created_at >= p_start)
      and (p_end is null or o.created_at < p_end)
      and lower(coalesce(o.payment_status, '')) in ('paid', 'partially_refunded', 'refunded')
  ),
  item_totals as (
    select
      o.id,
      o.discount,
      o.shipping_amount,
      o.tax_amount,
      o.total,
      o.refunded_amount,
      o.refunded_shipping_amount,
      coalesce(sum(greatest(coalesce(i.quantity, 0) - least(coalesce(i.quantity, 0), greatest(coalesce(i.refunded_quantity, 0), coalesce(rq.quantity, 0))), 0)), 0) as units_sold,
      coalesce(sum(least(coalesce(i.quantity, 0), greatest(coalesce(i.refunded_quantity, 0), coalesce(rq.quantity, 0)))), 0) as returned_units,
      coalesce(sum(coalesce(i.unit_price, 0) * coalesce(i.quantity, 0)), 0) as line_gross,
      coalesce(sum(
        case when i.cost_at_purchase is null then coalesce(s.cost, 0) else i.cost_at_purchase end
        * greatest(coalesce(i.quantity, 0) - least(coalesce(i.quantity, 0), greatest(coalesce(i.refunded_quantity, 0), coalesce(rq.quantity, 0))), 0)
      ), 0) as net_line_cogs,
      coalesce(sum(case when i.promo_applied then greatest(coalesce(i.quantity, 0) - least(coalesce(i.quantity, 0), greatest(coalesce(i.refunded_quantity, 0), coalesce(rq.quantity, 0))), 0) else 0 end), 0) as promo_units
    from eligible_orders o
    left join public.order_items i on i.order_id = o.id
    left join return_quantities rq on rq.order_item_id = i.id
    left join public.inventory_skus s on lower(trim(s.sku)) = lower(trim(i.sku))
    group by o.id, o.discount, o.shipping_amount, o.tax_amount, o.total, o.refunded_amount, o.refunded_shipping_amount
  ),
  financial_totals as (
    select
      it.*,
      least(
        greatest(coalesce(it.tax_amount, 0), 0),
        greatest(
          coalesce(rt.tax_amount, 0) + case
            when coalesce(it.total, 0) > 0 then coalesce(it.tax_amount, 0) * least(1, greatest(0, (coalesce(it.refunded_amount, 0) - coalesce(it.refunded_shipping_amount, 0) - coalesce(rt.itemized_refund_amount, 0)) / it.total))
            else 0
          end,
          0
        )
      ) as tax_refunded
    from item_totals it
    left join return_tax rt on rt.order_id = it.id
  )
  select
    count(*)::bigint,
    coalesce(sum(ft.units_sold), 0),
    coalesce(sum(ft.returned_units), 0),
    coalesce(sum(ft.line_gross), 0),
    coalesce(sum(ft.discount), 0),
    coalesce(sum(greatest(coalesce(ft.refunded_amount, 0) - coalesce(ft.refunded_shipping_amount, 0) - ft.tax_refunded, 0)), 0),
    coalesce(sum(greatest(coalesce(ft.shipping_amount, 0) - coalesce(ft.refunded_shipping_amount, 0), 0)), 0),
    coalesce(sum(greatest(coalesce(ft.tax_amount, 0) - ft.tax_refunded, 0)), 0),
    coalesce(sum(ft.net_line_cogs), 0),
    coalesce(sum(ft.promo_units), 0)
  from financial_totals ft;
$$;

revoke all on function public.admin_website_accounting_totals(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_website_accounting_totals(timestamptz, timestamptz) to authenticated, service_role;

create or replace function public.admin_member_financial_summary(p_member_id uuid)
returns table(order_count bigint, total_spent numeric)
language sql
security definer
set search_path = public, private
as $$
  select
    count(*)::bigint,
    coalesce(sum(case
      when lower(coalesce(o.payment_status, '')) in ('paid', 'partially_refunded', 'refunded')
        then greatest(0, coalesce(o.total, 0) - coalesce(o.refunded_amount, 0))
      else 0
    end), 0)::numeric
  from public.orders o
  where private.is_admin()
    and o.user_id = p_member_id
$$;

revoke all on function public.admin_member_financial_summary(uuid) from public, anon;
grant execute on function public.admin_member_financial_summary(uuid) to authenticated, service_role;
