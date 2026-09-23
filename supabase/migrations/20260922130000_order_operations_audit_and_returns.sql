alter table public.orders
  drop constraint if exists orders_status_check;

alter table public.orders
  add constraint orders_status_check check (status in ('pending','paid','processing','shipped','completed','partially_refunded','returned','cancelled','refunded'));

alter table public.order_items
  add column if not exists refunded_quantity integer not null default 0 check (refunded_quantity >= 0),
  add column if not exists refunded_amount numeric not null default 0 check (refunded_amount >= 0);

create table if not exists public.order_financial_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  order_item_id uuid references public.order_items(id) on delete set null,
  event_type text not null check (event_type in ('return','refund','satisfaction_refund','cancellation')),
  quantity integer not null default 0 check (quantity >= 0),
  amount numeric not null default 0 check (amount >= 0),
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists order_financial_events_order_idx on public.order_financial_events(order_id, created_at desc);
alter table public.order_financial_events enable row level security;
grant select on public.order_financial_events to authenticated;
drop policy if exists order_financial_events_admin_read on public.order_financial_events;
create policy order_financial_events_admin_read on public.order_financial_events for select to authenticated using ((select private.is_admin()));

create table if not exists public.order_support_request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.order_support_requests(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  event_type text not null check (event_type in ('note','status_change','email_response')),
  body text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists order_support_request_events_request_idx on public.order_support_request_events(request_id, created_at desc);
alter table public.order_support_request_events enable row level security;
grant select on public.order_support_request_events to authenticated;
drop policy if exists order_support_request_events_admin_read on public.order_support_request_events;
create policy order_support_request_events_admin_read on public.order_support_request_events for select to authenticated using ((select private.is_admin()));

create or replace function public.add_order_support_note(request_id_value uuid, body_value text)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare request_row public.order_support_requests%rowtype; note_text text := nullif(trim(body_value), '');
begin
  if not private.is_admin() then raise exception 'Admin access required.'; end if;
  if note_text is null then raise exception 'Enter a note before saving.'; end if;
  select * into request_row from public.order_support_requests where id = request_id_value for update;
  if request_row.id is null then raise exception 'Request not found.'; end if;
  insert into public.order_support_request_events(request_id, order_id, event_type, body, created_by)
  values(request_row.id, request_row.order_id, 'note', note_text, auth.uid());
  update public.order_support_requests set admin_notes = note_text, updated_at = timezone('utc', now()) where id = request_row.id;
  return jsonb_build_object('saved', true);
end; $$;
revoke all on function public.add_order_support_note(uuid, text) from public, anon;
grant execute on function public.add_order_support_note(uuid, text) to authenticated;

create or replace function public.process_order_return(order_id_value uuid, line_items jsonb, reason_value text default null, refund_shipping boolean default false)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  order_row public.orders%rowtype; item_row public.order_items%rowtype; line jsonb; requested_qty integer; eligible_qty integer;
  line_gross numeric; line_discount numeric; line_tax numeric; line_refund numeric; refund_total numeric := 0; remaining numeric;
  subtotal_after_discount numeric; requirement record;
begin
  if not private.is_admin() then raise exception 'Admin access required.'; end if;
  if jsonb_typeof(line_items) <> 'array' or jsonb_array_length(line_items) = 0 then raise exception 'Select at least one line to return.'; end if;
  select * into order_row from public.orders where id = order_id_value for update;
  if order_row.id is null then raise exception 'Order not found.'; end if;
  if order_row.status in ('cancelled','refunded','returned') then raise exception 'This order is already closed.'; end if;
  subtotal_after_discount := greatest(0, coalesce(order_row.subtotal,0) - coalesce(order_row.discount,0));
  for line in select value from jsonb_array_elements(line_items) entries(value)
  loop
    select * into item_row from public.order_items where id = nullif(line->>'item_id','')::uuid and order_id = order_id_value for update;
    if item_row.id is null then raise exception 'Order line not found.'; end if;
    requested_qty := greatest(0, (line->>'quantity')::integer);
    eligible_qty := item_row.quantity - coalesce(item_row.refunded_quantity,0);
    if requested_qty = 0 or requested_qty > eligible_qty then raise exception 'Return quantity exceeds the remaining quantity for %.', item_row.product_name; end if;
    line_gross := round(item_row.unit_price * requested_qty, 2);
    line_discount := case when coalesce(order_row.subtotal,0) > 0 then round(coalesce(order_row.discount,0) * (item_row.unit_price * requested_qty) / order_row.subtotal, 2) else 0 end;
    line_tax := case when subtotal_after_discount > 0 then round(coalesce(order_row.tax_amount,0) * greatest(0, line_gross-line_discount) / subtotal_after_discount, 2) else 0 end;
    line_refund := greatest(0, round(line_gross - line_discount + line_tax, 2));
    refund_total := refund_total + line_refund;
    update public.order_items set refunded_quantity = coalesce(refunded_quantity,0) + requested_qty, refunded_amount = round(coalesce(refunded_amount,0) + line_refund,2) where id = item_row.id;
    for requirement in select expanded.component_sku, sum(expanded.quantity)::integer quantity from public.expand_inventory_sku(coalesce(item_row.inventory_sku,item_row.sku), requested_qty * greatest(1,coalesce(item_row.inventory_units,1))) expanded group by expanded.component_sku
    loop
      update public.inventory_skus set quantity_on_hand = coalesce(quantity_on_hand,0) + requirement.quantity, updated_at = timezone('utc', now()) where sku = requirement.component_sku and lower(coalesce(item_type,'inventory')) <> 'non-inventory';
      if not found then raise exception 'Component SKU % is not linked to canonical inventory.', requirement.component_sku; end if;
    end loop;
    insert into public.order_financial_events(order_id,order_item_id,event_type,quantity,amount,reason,metadata,created_by) values(order_row.id,item_row.id,'return',requested_qty,line_refund,nullif(trim(reason_value),''),jsonb_build_object('line_gross',line_gross,'line_discount',line_discount,'line_tax',line_tax),auth.uid());
  end loop;
  if refund_shipping then refund_total := refund_total + coalesce(order_row.shipping_amount,order_row.shipping_cost,0); end if;
  remaining := greatest(0, round(coalesce(order_row.total,0) - coalesce(order_row.refunded_amount,0) - refund_total,2));
  update public.orders set refunded_amount = round(coalesce(refunded_amount,0)+refund_total,2), refunded_at=timezone('utc',now()), refund_reason=nullif(trim(reason_value),''), status=case when remaining=0 then 'returned' else 'partially_refunded' end, updated_at=timezone('utc',now()) where id=order_row.id;
  return jsonb_build_object('status',case when remaining=0 then 'returned' else 'partially_refunded' end,'refund_amount',round(refund_total,2),'refunded_amount',round(coalesce(order_row.refunded_amount,0)+refund_total,2),'remaining',remaining);
end; $$;
revoke all on function public.process_order_return(uuid, jsonb, text, boolean) from public, anon;
grant execute on function public.process_order_return(uuid, jsonb, text, boolean) to authenticated;

create or replace function public.process_customer_satisfaction_refund(order_id_value uuid, amount_value numeric, reason_value text default null)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare order_row public.orders%rowtype; applied numeric; remaining numeric;
begin
  if not private.is_admin() then raise exception 'Admin access required.'; end if;
  select * into order_row from public.orders where id=order_id_value for update;
  if order_row.id is null then raise exception 'Order not found.'; end if;
  applied:=round(coalesce(amount_value,0),2); remaining:=round(greatest(0,coalesce(order_row.total,0)-coalesce(order_row.refunded_amount,0)),2);
  if applied<=0 or applied>remaining then raise exception 'Amount must be between $0.01 and the remaining balance of $%.',remaining; end if;
  insert into public.order_financial_events(order_id,event_type,amount,reason,created_by) values(order_row.id,'satisfaction_refund',applied,nullif(trim(reason_value),''),auth.uid());
  update public.orders set refunded_amount=round(coalesce(refunded_amount,0)+applied,2),refunded_at=timezone('utc',now()),refund_reason=nullif(trim(reason_value),''),status=case when applied=remaining then 'refunded' else 'partially_refunded' end,updated_at=timezone('utc',now()) where id=order_row.id;
  return jsonb_build_object('status',case when applied=remaining then 'refunded' else 'partially_refunded' end,'refund_amount',applied,'refunded_amount',round(coalesce(order_row.refunded_amount,0)+applied,2),'remaining',round(remaining-applied,2));
end; $$;
revoke all on function public.process_customer_satisfaction_refund(uuid,numeric,text) from public, anon;
grant execute on function public.process_customer_satisfaction_refund(uuid,numeric,text) to authenticated;
