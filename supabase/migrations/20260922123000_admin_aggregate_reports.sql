create or replace function public.get_admin_state_order_tax()
returns table (state text, order_count bigint, order_total numeric, tax_collected numeric)
language sql security definer set search_path = public, private
as $$
  select coalesce(nullif(upper(trim(coalesce(o.shipping_address->>'state',''))),''),'UNKNOWN') as state,
    count(*)::bigint, coalesce(sum(o.total),0), coalesce(sum(o.tax_amount),0)
  from public.orders o
  where lower(coalesce(o.status,'')) not in ('cancelled','refunded')
    and private.is_admin()
  group by 1 order by 1;
$$;

create or replace function public.get_admin_monthly_order_sales(p_since timestamptz default null)
returns table (month_start date, order_total numeric)
language sql security definer set search_path = public, private
as $$
  select date_trunc('month', o.created_at)::date, coalesce(sum(o.total),0)
  from public.orders o
  where lower(coalesce(o.status,'')) not in ('cancelled','refunded')
    and (p_since is null or o.created_at >= p_since)
    and private.is_admin()
  group by 1 order by 1 desc;
$$;

revoke all on function public.get_admin_state_order_tax() from public, anon, authenticated;
revoke all on function public.get_admin_monthly_order_sales(timestamptz) from public, anon, authenticated;
grant execute on function public.get_admin_state_order_tax() to authenticated;
grant execute on function public.get_admin_monthly_order_sales(timestamptz) to authenticated;
