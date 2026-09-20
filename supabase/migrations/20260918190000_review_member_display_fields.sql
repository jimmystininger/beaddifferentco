alter table public.reviews
  add column if not exists reviewer_member_since timestamptz;

update public.reviews review_row
set reviewer_name = nullif(split_part(trim(profile.full_name), ' ', 1), ''),
    reviewer_member_since = profile.created_at
from public.profiles profile
where review_row.user_id = profile.id
  and (review_row.reviewer_name is null or review_row.reviewer_member_since is null);

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
  reviewer_name_value text;
  reviewer_member_since_value timestamptz;
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
  select nullif(split_part(trim(full_name), ' ', 1), ''), created_at
  into reviewer_name_value, reviewer_member_since_value
  from public.profiles
  where id = current_user_id;

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
    user_id, product_id, review_type, rating, body, photos, status,
    verified_purchase, reviewer_name, reviewer_member_since
  ) values (
    current_user_id, product_id_value, 'item', rating_value, body_value,
    photos_value, 'pending', true, reviewer_name_value, reviewer_member_since_value
  ) returning id into review_id;

  return jsonb_build_object('id', review_id, 'status', 'pending', 'verified_purchase', true);
end;
$$;

revoke all on function public.submit_item_review(jsonb) from public, anon, authenticated;
grant execute on function public.submit_item_review(jsonb) to authenticated;
