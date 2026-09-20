-- Derive storefront filter values from the canonical SKU assignment table.
create or replace function public.get_storefront_category_filters(p_category_slug text)
returns jsonb
language sql
stable
set search_path = public
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'key', d.key, 'label', d.label, 'scope', d.scope, 'sortOrder', d.sort_order,
    'values', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', v.id, 'key', v.value_key, 'label', v.label, 'sortOrder', v.sort_order
      ) order by v.sort_order, v.label), '[]'::jsonb)
      from public.storefront_filter_values v
      where v.filter_id = d.id and v.active
        and exists (
          select 1
          from public.product_options po
          join public.products p on p.id = po.product_id and p.visible
          join public.product_option_values pov on pov.option_id = po.id
          join public.product_filter_assignments pfa
            on pfa.product_id = p.id
           and pfa.inventory_sku_id = pov.inventory_sku_id
           and pfa.filter_value_id = v.id
          where p_category_slug in ('', 'shop-all')
             or p.category_slug = p_category_slug
             or p.subcategory_slug = p_category_slug
             or exists (
               select 1 from public.product_categories pc
               where pc.product_id = p.id and pc.category_slug = p_category_slug
             )
        )
    )
  ) order by d.sort_order, d.label), '[]'::jsonb)
  from public.storefront_filter_definitions d
  where d.active
    and (p_category_slug in ('', 'shop-all') or exists (
      select 1
      from public.storefront_filter_categories fc
      join public.categories c on c.slug = fc.category_slug and c.active
      where fc.filter_id = d.id and fc.category_slug = p_category_slug
    ));
$function$;
