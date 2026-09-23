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
