create or replace function public.admin_member_activity_counts(p_member_ids uuid[])
returns table(member_id uuid, reviews_count bigint, orders_count bigint, notes_count bigint)
language sql
security definer
set search_path = public, private
as $$
  select ids.member_id,
    (select count(*) from public.reviews r where r.user_id = ids.member_id) as reviews_count,
    (select count(*) from public.orders o where o.user_id = ids.member_id) as orders_count,
    (select count(*) from public.member_notes n where n.member_id = ids.member_id) as notes_count
  from unnest(coalesce(p_member_ids, '{}'::uuid[])) as ids(member_id)
  where private.is_admin()
$$;

revoke all on function public.admin_member_activity_counts(uuid[]) from public, anon;
grant execute on function public.admin_member_activity_counts(uuid[]) to authenticated, service_role;

create or replace function public.admin_newsletter_subscriber_page(
  p_search text default '',
  p_page integer default 1,
  p_page_size integer default 25
)
returns table(email text, name text, source text, created_at timestamptz, member_id uuid, total_count bigint)
language sql
security definer
set search_path = public, private
as $$
  with subscriber_rows as (
    select lower(trim(ns.email)) as email, coalesce(p.full_name, '') as name,
      case when p.id is null then coalesce(ns.source, 'Subscriber') else 'Member · ' || coalesce(ns.source, 'Subscriber') end as source,
      ns.created_at, p.id as member_id
    from public.notification_subscribers ns
    left join public.profiles p on lower(trim(p.email)) = lower(trim(ns.email))
    where ns.active = true
  ),
  member_rows as (
    select lower(trim(p.email)) as email, coalesce(p.full_name, '') as name,
      'Member opt-in'::text as source, p.created_at, p.id as member_id
    from public.customer_preferences cp
    join public.profiles p on p.id = cp.user_id
    where cp.marketing_opt_in = true and trim(coalesce(p.email, '')) <> ''
  ),
  merged as (
    select distinct on (email) email, name, source, created_at, member_id
    from (select * from subscriber_rows union all select * from member_rows) merged_rows
    where trim(coalesce(email, '')) <> ''
    order by email, (source like 'Member opt-in') desc, created_at desc nulls last
  ),
  filtered as (
    select * from merged
    where nullif(trim(coalesce(p_search, '')), '') is null
      or email ilike '%' || trim(p_search) || '%'
      or name ilike '%' || trim(p_search) || '%'
      or source ilike '%' || trim(p_search) || '%'
  )
  select filtered.email, filtered.name, filtered.source, filtered.created_at, filtered.member_id,
    count(*) over() as total_count
  from filtered
  where private.is_admin()
  order by filtered.created_at desc nulls last, filtered.email
  limit greatest(1, least(coalesce(p_page_size, 25), 100))
  offset greatest(0, coalesce(p_page - 1, 0)) * greatest(1, least(coalesce(p_page_size, 25), 100));
$$;

revoke all on function public.admin_newsletter_subscriber_page(text, integer, integer) from public, anon;
grant execute on function public.admin_newsletter_subscriber_page(text, integer, integer) to authenticated, service_role;

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

create or replace function public.admin_campaign_recipient_counts()
returns table(all_subscribers_optins bigint, member_optins bigint, nonmember_subscribers bigint, waitlist_product bigint)
language sql
security definer
set search_path = public, private
as $$
  with subscribers as (
    select distinct lower(trim(email)) as email
    from public.notification_subscribers
    where active = true and trim(coalesce(email, '')) <> ''
  ),
  member_optins as (
    select distinct lower(trim(p.email)) as email
    from public.customer_preferences cp
    join public.profiles p on p.id = cp.user_id
    where cp.marketing_opt_in = true and trim(coalesce(p.email, '')) <> ''
  ),
  waitlist as (
    select distinct lower(trim(p.email)) as email
    from public.waitlist_entries w
    join public.profiles p on p.id = w.user_id
    where w.status = 'waiting' and trim(coalesce(p.email, '')) <> ''
  )
  select (select count(*) from (select email from subscribers union select email from member_optins) all_rows),
    (select count(*) from member_optins),
    (select count(*) from subscribers s where not exists(select 1 from public.profiles p where lower(trim(p.email))=s.email)),
    (select count(*) from waitlist)
  where private.is_admin();
$$;

revoke all on function public.admin_campaign_recipient_counts() from public, anon;
grant execute on function public.admin_campaign_recipient_counts() to authenticated, service_role;

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

create or replace function public.admin_member_financial_summary(p_member_id uuid)
returns table(order_count bigint, total_spent numeric)
language sql
security definer
set search_path = public, private
as $$
  select
    count(*)::bigint,
    coalesce(sum(case
      when lower(coalesce(o.status, '')) not in ('cancelled', 'refunded')
        then coalesce(o.total, 0)
      else 0
    end), 0)::numeric
  from public.orders o
  where private.is_admin()
    and o.user_id = p_member_id
$$;

revoke all on function public.admin_member_financial_summary(uuid) from public, anon;
grant execute on function public.admin_member_financial_summary(uuid) to authenticated, service_role;

create or replace function public.get_my_reviewable_product_ids()
returns table(product_id text)
language sql
security invoker
set search_path = public
as $$
  select distinct coalesce(nullif(p.external_id, ''), p.id::text)::text as product_id
  from public.orders o
  join public.order_items oi on oi.order_id = o.id
  join public.products p on p.id = oi.product_id
  where o.user_id = (select auth.uid())
    and o.status in ('paid', 'processing', 'shipped', 'completed')
    and p.id is not null;
$$;

revoke all on function public.get_my_reviewable_product_ids() from public, anon;
grant execute on function public.get_my_reviewable_product_ids() to authenticated, service_role;
