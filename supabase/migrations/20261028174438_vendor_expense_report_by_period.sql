create or replace function public.get_admin_vendor_expense_report(p_period_month date)
returns table (
  vendor text,
  month_total numeric,
  prior_month_total numeric,
  month_change numeric,
  month_change_percent numeric,
  year_to_date_total numeric,
  prior_year_to_date_total numeric,
  year_to_date_change numeric,
  year_to_date_change_percent numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month_start date;
  v_month_end date;
  v_year_start date;
  v_prior_month_start date;
  v_prior_year_start date;
  v_prior_ytd_end date;
begin
  if not private.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  if p_period_month is null then
    raise exception 'Choose a report month' using errcode = '22023';
  end if;

  v_month_start := date_trunc('month', p_period_month)::date;
  v_month_end := (v_month_start + interval '1 month')::date;
  v_year_start := make_date(extract(year from v_month_start)::integer, 1, 1);
  v_prior_month_start := (v_month_start - interval '1 year')::date;
  v_prior_year_start := make_date(extract(year from v_month_start)::integer - 1, 1, 1);
  v_prior_ytd_end := (v_month_end - interval '1 year')::date;

  return query
  with vendor_totals as (
    select
      coalesce(nullif(btrim(e.vendor), ''), '(No vendor)') as vendor_name,
      coalesce(sum(e.amount) filter (
        where e.expense_date >= v_month_start and e.expense_date < v_month_end
      ), 0)::numeric as current_month,
      coalesce(sum(e.amount) filter (
        where e.expense_date >= v_prior_month_start and e.expense_date < (v_prior_month_start + interval '1 month')::date
      ), 0)::numeric as previous_month,
      coalesce(sum(e.amount) filter (
        where e.expense_date >= v_year_start and e.expense_date < v_month_end
      ), 0)::numeric as current_ytd,
      coalesce(sum(e.amount) filter (
        where e.expense_date >= v_prior_year_start and e.expense_date < v_prior_ytd_end
      ), 0)::numeric as previous_ytd
    from public.business_expenses e
    where e.expense_date >= v_prior_year_start
      and e.expense_date < v_month_end
    group by coalesce(nullif(btrim(e.vendor), ''), '(No vendor)')
  )
  select
    t.vendor_name,
    t.current_month,
    t.previous_month,
    t.current_month - t.previous_month,
    case when t.previous_month = 0 then null
      else round((t.current_month - t.previous_month) * 100 / t.previous_month, 1)
    end,
    t.current_ytd,
    t.previous_ytd,
    t.current_ytd - t.previous_ytd,
    case when t.previous_ytd = 0 then null
      else round((t.current_ytd - t.previous_ytd) * 100 / t.previous_ytd, 1)
    end
  from vendor_totals t
  order by t.current_ytd desc, t.vendor_name asc;
end;
$$;

revoke all on function public.get_admin_vendor_expense_report(date) from public, anon;
grant execute on function public.get_admin_vendor_expense_report(date) to authenticated, service_role;
