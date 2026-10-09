create or replace function private.validate_stripe_order_item()
returns trigger
language plpgsql
set search_path = public, private
as $$
declare
  parent_order public.orders%rowtype;
begin
  select * into parent_order from public.orders where id = new.order_id;
  if parent_order.payment_provider <> 'stripe' or parent_order.payment_status <> 'pending' then
    return new;
  end if;
  if not exists (
    select 1
    from public.products product
    join public.product_options option_row on option_row.product_id = product.id
    join public.product_option_values option_value on option_value.option_id = option_row.id
    join public.inventory_skus inventory on inventory.id = option_value.inventory_sku_id
    where product.id = new.product_id
      and product.visible
      and inventory.sku = new.inventory_sku
      and option_value.inventory_units = new.inventory_units
  ) then
    raise exception 'The selected SKU is not an available option for this product.';
  end if;
  return new;
end;
$$;

create trigger validate_stripe_order_item
before insert on public.order_items
for each row execute function private.validate_stripe_order_item();

create or replace function private.prevent_new_inventory_overreservation()
returns trigger
language plpgsql
set search_path = public, private
as $$
begin
  if new.reserve_quantity > old.reserve_quantity
     and lower(coalesce(new.item_type, 'inventory')) <> 'non-inventory'
     and new.reserve_quantity > new.quantity_on_hand then
    raise exception 'Not enough available inventory for SKU %.', new.sku;
  end if;
  return new;
end;
$$;

create trigger prevent_new_inventory_overreservation
before update of reserve_quantity on public.inventory_skus
for each row execute function private.prevent_new_inventory_overreservation();

create or replace function public.get_checkout_shipping_weight(order_id_value uuid)
returns numeric
language plpgsql
security definer
set search_path = public, private
as $$
declare
  total_weight numeric;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception 'Checkout shipping weight is server-only.';
  end if;
  select coalesce(sum(item.quantity * coalesce(inventory.weight_value, 0) *
    case inventory.weight_unit
      when 'lb' then 16
      when 'g' then 1 / 28.349523125
      when 'kg' then 35.27396195
      else 1
    end), 0)
  into total_weight
  from public.order_items item
  join public.inventory_skus inventory on inventory.sku = item.inventory_sku
  where item.order_id = order_id_value;
  return greatest(0.01, total_weight);
end;
$$;

revoke all on function public.get_checkout_shipping_weight(uuid) from public, anon, authenticated;
grant execute on function public.get_checkout_shipping_weight(uuid) to service_role;

alter table public.stripe_refunds
  add column if not exists request_key uuid unique;

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
      'already_submitted', existing.stripe_refund_id like 're_%');
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
  if stripe_refund_id_value !~ '^re_[A-Za-z0-9]+$' then
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

create or replace function public.discard_rejected_stripe_refund_request(request_key_value uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception 'Stripe refund requests are server-only.';
  end if;
  delete from public.stripe_refunds
  where request_key = request_key_value
    and stripe_refund_id = 'pending:' || request_key_value::text
    and status = 'pending';
end;
$$;

revoke all on function public.discard_rejected_stripe_refund_request(uuid) from public, anon, authenticated;
grant execute on function public.discard_rejected_stripe_refund_request(uuid) to service_role;

create table if not exists private.storefront_request_limits (
  action text not null,
  client_hash text not null,
  window_start timestamptz not null,
  request_count integer not null default 0,
  primary key (action, client_hash, window_start)
);

create or replace function public.check_storefront_request_limit(
  action_value text,
  client_hash_value text,
  request_limit integer,
  window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
declare
  bucket timestamptz;
  current_count integer;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception 'Storefront request limits are server-only.';
  end if;
  if action_value not in ('checkout', 'tax', 'shipping', 'status')
     or client_hash_value !~ '^[0-9a-f]{64}$'
     or request_limit not between 1 and 500
     or window_seconds not between 60 and 3600 then
    raise exception 'Invalid storefront rate limit.';
  end if;
  bucket := to_timestamp(floor(extract(epoch from now()) / window_seconds) * window_seconds);
  insert into private.storefront_request_limits(action, client_hash, window_start, request_count)
  values(action_value, client_hash_value, bucket, 1)
  on conflict (action, client_hash, window_start)
  do update set request_count = private.storefront_request_limits.request_count + 1
  returning request_count into current_count;
  if random() < 0.005 then
    delete from private.storefront_request_limits
    where window_start < now() - interval '2 hours';
  end if;
  return current_count <= request_limit;
end;
$$;

revoke all on private.storefront_request_limits from public, anon, authenticated;
revoke all on function public.check_storefront_request_limit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.check_storefront_request_limit(text, text, integer, integer) to service_role;

create or replace function private.protect_customer_reviews()
returns trigger
language plpgsql
set search_path = public, private
as $$
begin
  if current_setting('request.jwt.claim.role', true) = 'service_role' or (select private.is_admin()) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.user_id is distinct from (select auth.uid())
       or new.status <> 'pending'
       or new.external_source is not null
       or new.external_review_id is not null
       or new.admin_response is not null then
      raise exception 'Customer reviews must be submitted for moderation.';
    end if;
    if new.review_type = 'website' then
      if new.verified_purchase or new.product_id is not null then
        raise exception 'Website reviews cannot claim a verified purchase.';
      end if;
    elsif new.review_type = 'item' then
      if not new.verified_purchase or new.product_id is null or not exists (
        select 1 from public.order_items item
        join public.orders order_record on order_record.id = item.order_id
        where order_record.user_id = new.user_id
          and item.product_id = new.product_id
          and order_record.status in ('paid', 'processing', 'shipped', 'completed')
      ) then
        raise exception 'A verified item review requires a completed purchase.';
      end if;
    end if;
    new.created_at := timezone('utc', now());
    new.updated_at := new.created_at;
  elsif tg_op = 'UPDATE' then
    if old.user_id is distinct from (select auth.uid()) or old.status <> 'pending'
       or (to_jsonb(new) - array['rating','body','photos','updated_at'])
          is distinct from (to_jsonb(old) - array['rating','body','photos','updated_at']) then
      raise exception 'Only the content of your pending review can be edited.';
    end if;
    new.updated_at := timezone('utc', now());
  end if;
  return new;
end;
$$;

create trigger protect_customer_reviews
before insert or update on public.reviews
for each row execute function private.protect_customer_reviews();

create policy reviews_customer_insert_guard on public.reviews
as restrictive
for insert to authenticated
with check ((select private.is_admin()) or ((select auth.uid()) = user_id
  and review_type = 'website' and verified_purchase = false
  and status = 'pending' and product_id is null));

create policy reviews_customer_update_guard on public.reviews
as restrictive
for update to authenticated
using (((select auth.uid()) = user_id and status = 'pending') or (select private.is_admin()))
with check (((select auth.uid()) = user_id and status = 'pending') or (select private.is_admin()));

revoke all on function private.validate_stripe_order_item() from public, anon, authenticated;
revoke all on function private.prevent_new_inventory_overreservation() from public, anon, authenticated;
revoke all on function private.protect_customer_reviews() from public, anon, authenticated;
