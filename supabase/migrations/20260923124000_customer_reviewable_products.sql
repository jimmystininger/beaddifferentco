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
