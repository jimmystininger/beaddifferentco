create or replace function public.get_storefront_best_sellers(limit_count integer default 25)
returns table (product_external_id text, units_sold numeric)
language sql
security definer
set search_path = public
stable
as $$
  with website_sales as (
    select p.external_id as product_external_id,
           sum(greatest(0, oi.quantity))::numeric as units_sold
    from public.orders o
    join public.order_items oi on oi.order_id = o.id
    join public.products p on p.id = oi.product_id
    where o.status in ('paid', 'processing', 'shipped', 'completed')
      and p.visible = true
    group by p.external_id
  ),
  etsy_product_matches as (
    select distinct esl.id as sale_line_id, p.id as product_id, p.external_id
    from public.etsy_sale_lines esl
    join public.products p on lower(esl.matched_inventory_sku) = lower(p.sku)
    where esl.status in ('paid', 'completed')
      and esl.matched_inventory_sku is not null
      and p.visible = true
    union
    select distinct esl.id as sale_line_id, p.id as product_id, p.external_id
    from public.etsy_sale_lines esl
    join public.product_option_values pov
      on lower(esl.matched_inventory_sku) in (lower(pov.sku), lower(pov.inventory_sku))
    join public.product_options po on po.id = pov.option_id
    join public.products p on p.id = po.product_id
    where esl.status in ('paid', 'completed')
      and esl.matched_inventory_sku is not null
      and p.visible = true
  ),
  etsy_sales as (
    select matches.external_id as product_external_id,
           sum(greatest(0, esl.quantity - esl.refunded_quantity))::numeric as units_sold
    from etsy_product_matches matches
    join public.etsy_sale_lines esl on esl.id = matches.sale_line_id
    group by matches.external_id
  ),
  combined as (
    select product_external_id, units_sold from website_sales
    union all
    select product_external_id, units_sold from etsy_sales
  )
  select combined.product_external_id,
         sum(combined.units_sold)::numeric as units_sold
  from combined
  where combined.product_external_id is not null
  group by combined.product_external_id
  order by sum(combined.units_sold) desc, combined.product_external_id
  limit greatest(1, least(coalesce(limit_count, 25), 25));
$$;

revoke all on function public.get_storefront_best_sellers(integer) from public, anon, authenticated;
grant execute on function public.get_storefront_best_sellers(integer) to anon, authenticated;
