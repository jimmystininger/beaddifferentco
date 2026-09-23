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
