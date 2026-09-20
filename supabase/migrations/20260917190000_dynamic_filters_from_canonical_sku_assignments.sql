create or replace function public.get_storefront_category_filters(p_category_slug text)
returns jsonb
language sql stable set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'key', d.key,
    'label', d.label,
    'scope', d.scope,
    'sortOrder', d.sort_order,
    'values', (
      select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'key', v.value_key, 'label', v.label, 'sortOrder', v.sort_order) order by v.sort_order, v.label), '[]'::jsonb)
      from public.storefront_filter_values v
      where v.filter_id = d.id and v.active
        and exists (
          select 1
          from public.product_options po
          join public.products p on p.id = po.product_id and p.visible
          join public.product_option_values pov on pov.option_id = po.id
          where (p_category_slug in ('', 'shop-all') or p.category_slug = p_category_slug or p.subcategory_slug = p_category_slug or exists (select 1 from public.product_categories pc where pc.product_id = p.id and pc.category_slug = p_category_slug))
            and exists (select 1 from jsonb_array_elements(coalesce(pov.sku_filter_options, '[]'::jsonb)) entry where entry->>'filter_value_id' = v.id::text or entry->>'filterValueId' = v.id::text or entry->>'value_id' = v.id::text or entry->>'valueId' = v.id::text)
        )
    )
  ) order by d.sort_order, d.label), '[]'::jsonb)
  from public.storefront_filter_definitions d
  where d.active and (p_category_slug in ('', 'shop-all') or exists (select 1 from public.storefront_filter_categories fc join public.categories c on c.slug = fc.category_slug and c.active where fc.filter_id = d.id and fc.category_slug = p_category_slug));
$$;

revoke all on function public.get_storefront_category_filters(text) from public, anon, authenticated;
grant execute on function public.get_storefront_category_filters(text) to anon, authenticated;
