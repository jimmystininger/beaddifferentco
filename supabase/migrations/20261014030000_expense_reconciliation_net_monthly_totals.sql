create or replace function public.get_admin_monthly_order_sales(p_since timestamptz default null)
returns table (month_start date, order_total numeric)
language sql
security definer
set search_path = public, private
as $$
  select
    date_trunc('month', o.created_at)::date,
    coalesce(sum(greatest(0, coalesce(o.total, 0) - coalesce(o.refunded_amount, 0))), 0)
  from public.orders o
  where private.is_admin()
    and lower(coalesce(nullif(o.payment_status, ''), case
      when lower(coalesce(o.status, '')) in ('paid', 'processing', 'shipped', 'completed') then 'paid'
      else ''
    end)) in ('paid', 'partially_refunded', 'refunded')
    and (p_since is null or o.created_at >= p_since)
  group by 1
  order by 1 desc;
$$;

create or replace function public.get_admin_monthly_expense_totals(p_since date default null)
returns table (month_start date, expense_total numeric)
language sql
security definer
set search_path = public, private
as $$
  select
    date_trunc('month', e.expense_date)::date,
    coalesce(sum(e.amount), 0)
  from public.business_expenses e
  where private.is_admin()
    and (p_since is null or e.expense_date >= p_since)
  group by 1
  order by 1 desc;
$$;

revoke all on function public.get_admin_monthly_order_sales(timestamptz) from public, anon;
revoke all on function public.get_admin_monthly_expense_totals(date) from public, anon;
grant execute on function public.get_admin_monthly_order_sales(timestamptz) to authenticated, service_role;
grant execute on function public.get_admin_monthly_expense_totals(date) to authenticated, service_role;
