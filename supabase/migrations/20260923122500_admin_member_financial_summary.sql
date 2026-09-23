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
