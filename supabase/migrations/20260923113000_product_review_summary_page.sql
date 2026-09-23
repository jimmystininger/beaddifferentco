create or replace function public.get_product_reviews_page(p_product_id uuid, p_page_size integer default 20)
returns table(rating integer, body text, verified_purchase boolean, created_at timestamptz, average_rating numeric, review_count bigint)
language sql
security invoker
set search_path = public, private
as $$
  select r.rating, r.body, r.verified_purchase, r.created_at,
    avg(r.rating) over() as average_rating,
    count(*) over() as review_count
  from public.reviews r
  where r.product_id = p_product_id
    and r.review_type = 'item'
    and r.status = 'approved'
  order by r.created_at desc
  limit greatest(1, least(coalesce(p_page_size, 20), 50));
$$;

grant execute on function public.get_product_reviews_page(uuid, integer) to anon, authenticated, service_role;
