alter table public.orders
  add column if not exists refunded_amount numeric not null default 0 check (refunded_amount >= 0),
  add column if not exists refunded_at timestamptz,
  add column if not exists refund_reason text;

create or replace function public.process_order_refund(
  order_id uuid,
  refund_amount_value numeric,
  reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  current_user_id uuid := (select auth.uid());
  order_row public.orders%rowtype;
  remaining numeric;
  applied numeric;
  next_status text;
begin
  if current_user_id is null or not private.is_admin() then
    raise exception 'Only an administrator can issue refunds.';
  end if;
  select * into order_row from public.orders where id = process_order_refund.order_id for update;
  if order_row.id is null then raise exception 'Order not found.'; end if;
  if order_row.status = 'cancelled' then raise exception 'Cancelled orders cannot be refunded.'; end if;
  if order_row.status = 'refunded' then raise exception 'This order is already fully refunded.'; end if;
  applied := round(coalesce(refund_amount_value, 0), 2);
  remaining := round(greatest(0, order_row.total - coalesce(order_row.refunded_amount, 0)), 2);
  if applied <= 0 or applied > remaining then
    raise exception 'Refund must be greater than zero and no more than the remaining refundable amount of $%.', remaining;
  end if;
  next_status := case when applied >= remaining then 'refunded' else 'partially_refunded' end;
  update public.orders
  set refunded_amount = round(coalesce(refunded_amount, 0) + applied, 2),
      refunded_at = timezone('utc', now()),
      refund_reason = nullif(trim(reason), ''),
      status = next_status,
      updated_at = timezone('utc', now())
  where id = order_row.id;
  return jsonb_build_object('id', order_row.id, 'status', next_status, 'refunded_amount', round(coalesce(order_row.refunded_amount, 0) + applied, 2));
end;
$$;

revoke all on function public.process_order_refund(uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.process_order_refund(uuid, numeric, text) to authenticated;
