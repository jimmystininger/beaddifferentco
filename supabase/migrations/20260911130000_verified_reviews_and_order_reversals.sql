alter table public.orders
  add column if not exists inventory_restored_at timestamptz,
  add column if not exists inventory_restored_by uuid references public.profiles(id) on delete set null,
  add column if not exists cancellation_reason text;

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
  return new;
end;
$$;

drop trigger if exists orders_guard_reversal on public.orders;
create trigger orders_guard_reversal
before update of status on public.orders
for each row execute function public.guard_order_reversal();

create or replace function public.cancel_test_order(
  order_id uuid,
  target_status text,
  reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_status text;
  requirement record;
begin
  if current_user_id is null or not private.is_admin() then
    raise exception 'Only an administrator can cancel or refund an order.';
  end if;
  if target_status not in ('cancelled', 'refunded') then
    raise exception 'The reversal status must be cancelled or refunded.';
  end if;

  select status
    into current_status
  from public.orders
  where id = cancel_test_order.order_id
  for update;

  if current_status is null then
    raise exception 'Order not found.';
  end if;
  if current_status in ('cancelled', 'refunded') then
    raise exception 'This order has already been cancelled or refunded.';
  end if;
  if current_status in ('shipped', 'completed') then
    raise exception 'Shipped or completed orders require a separate return workflow.';
  end if;

  perform set_config('bead.order_reversal_context', 'rpc', true);

  for requirement in
    select expanded.component_sku, sum(expanded.quantity)::integer as quantity
    from public.order_items item
    cross join lateral public.expand_inventory_sku(
      coalesce(item.inventory_sku, item.sku),
      item.quantity * greatest(1, coalesce(item.inventory_units, 1))
    ) expanded
    where item.order_id = cancel_test_order.order_id
      and coalesce(item.inventory_sku, item.sku) is not null
    group by expanded.component_sku
  loop
    update public.inventory_skus
    set quantity_on_hand = coalesce(quantity_on_hand, 0) + requirement.quantity,
        updated_at = timezone('utc', now())
    where sku = requirement.component_sku
      and lower(coalesce(item_type, 'inventory')) <> 'non-inventory';
    if not found then
      raise exception 'Component SKU % is not linked to canonical inventory.', requirement.component_sku;
    end if;
  end loop;

  update public.orders
  set status = target_status,
      inventory_restored_at = timezone('utc', now()),
      inventory_restored_by = current_user_id,
      cancellation_reason = nullif(trim(reason), ''),
      updated_at = timezone('utc', now())
  where id = cancel_test_order.order_id;

  return jsonb_build_object(
    'id', cancel_test_order.order_id,
    'status', target_status,
    'inventory_restored', true
  );
end;
$$;

revoke all on function public.cancel_test_order(uuid, text, text) from public, anon, authenticated;
grant execute on function public.cancel_test_order(uuid, text, text) to authenticated;

create or replace function public.submit_item_review(review_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  current_user_id uuid := (select auth.uid());
  product_id_value uuid;
  rating_value integer;
  body_value text;
  photos_value text[];
  review_id uuid;
begin
  if current_user_id is null then
    raise exception 'Please log in before leaving a review.';
  end if;

  product_id_value := nullif(review_payload->>'product_id', '')::uuid;
  rating_value := (review_payload->>'rating')::integer;
  body_value := nullif(trim(review_payload->>'body'), '');
  photos_value := coalesce(array(
    select jsonb_array_elements_text(
      case when jsonb_typeof(review_payload->'photos') = 'array'
        then review_payload->'photos'
        else '[]'::jsonb
      end
    )
  ), '{}'::text[]);

  if product_id_value is null or not exists (
    select 1 from public.products where id = product_id_value
  ) then
    raise exception 'Purchased item not found.';
  end if;
  if rating_value is null or rating_value < 1 or rating_value > 5 then
    raise exception 'Rating must be between 1 and 5.';
  end if;
  if body_value is null or length(body_value) > 5000 then
    raise exception 'Review text is required and must be 5000 characters or fewer.';
  end if;
  if not exists (
    select 1
    from public.order_items item
    join public.orders order_record on order_record.id = item.order_id
    where order_record.user_id = current_user_id
      and item.product_id = product_id_value
      and order_record.status in ('paid', 'processing', 'shipped', 'completed')
  ) then
    raise exception 'You can only review an item purchased from this account.';
  end if;
  if exists (
    select 1
    from public.reviews existing
    where existing.user_id = current_user_id
      and existing.product_id = product_id_value
      and existing.review_type = 'item'
      and existing.status <> 'blocked'
  ) then
    raise exception 'You have already submitted a review for this item.';
  end if;

  insert into public.reviews (
    user_id, product_id, review_type, rating, body, photos, status, verified_purchase
  ) values (
    current_user_id, product_id_value, 'item', rating_value, body_value,
    photos_value, 'pending', true
  ) returning id into review_id;

  return jsonb_build_object('id', review_id, 'status', 'pending', 'verified_purchase', true);
end;
$$;

revoke all on function public.submit_item_review(jsonb) from public, anon, authenticated;
grant execute on function public.submit_item_review(jsonb) to authenticated;

drop policy if exists reviews_self_insert on public.reviews;
create policy reviews_self_insert on public.reviews
for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and review_type = 'website'
  and verified_purchase = false
);
