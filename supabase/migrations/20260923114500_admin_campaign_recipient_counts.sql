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
