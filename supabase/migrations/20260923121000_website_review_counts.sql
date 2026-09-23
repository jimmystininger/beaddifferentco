create or replace function public.get_website_review_counts()
returns table(rating integer, review_count bigint)
language sql
security invoker
set search_path = public, private
as $$
  select r.rating, count(*) as review_count
  from public.reviews r
  where r.review_type = 'website' and r.status = 'approved'
  group by r.rating
  order by r.rating;
$$;

grant execute on function public.get_website_review_counts() to anon, authenticated, service_role;
