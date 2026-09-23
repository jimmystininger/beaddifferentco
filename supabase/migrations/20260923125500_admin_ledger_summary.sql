create or replace function public.admin_inventory_ledger_summary(
  p_start timestamptz default null,
  p_end timestamptz default null
)
returns table(shrinkage numeric, inventory_purchases numeric, business_expenses numeric)
language sql
security definer
set search_path = public, private
as $$
  select
    coalesce((
      select sum(coalesce(a.cost_impact, abs(coalesce(a.quantity_delta, 0)) * coalesce(s.cost, 0)))
      from public.inventory_adjustments a
      left join public.inventory_skus s on s.sku = a.inventory_sku
      where a.adjustment_type in ('audit_shrink', 'manual')
        and coalesce(a.quantity_delta, 0) < 0
        and (p_start is null or a.created_at >= p_start)
        and (p_end is null or a.created_at < p_end)
        and private.is_admin()
    ), 0)::numeric,
    coalesce((
      select sum(coalesce(p.total_cost, 0))
      from public.inventory_purchases p
      where (p_start is null or p.purchase_date >= p_start::date)
        and (p_end is null or p.purchase_date < (p_end::date + 1))
        and private.is_admin()
    ), 0)::numeric,
    coalesce((
      select sum(coalesce(e.amount, 0))
      from public.business_expenses e
      where (p_start is null or e.expense_date >= p_start::date)
        and (p_end is null or e.expense_date < (p_end::date + 1))
        and private.is_admin()
    ), 0)::numeric;
$$;

revoke all on function public.admin_inventory_ledger_summary(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_inventory_ledger_summary(timestamptz, timestamptz) to authenticated, service_role;
