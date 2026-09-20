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
      select coalesce(jsonb_agg(jsonb_build_object('key', v.value_key, 'label', v.label, 'sortOrder', v.sort_order) order by v.sort_order, v.label), '[]'::jsonb)
      from public.storefront_filter_values v
      where v.filter_id = d.id and v.active
        and exists (
          select 1
          from public.product_filter_assignments a
          join public.products p on p.id = a.product_id and p.visible
          where a.filter_value_id = v.id
            and (p.category_slug = p_category_slug or p.subcategory_slug = p_category_slug or exists (select 1 from public.product_categories pc where pc.product_id = p.id and pc.category_slug = p_category_slug))
        )
    )
  ) order by d.sort_order, d.label), '[]'::jsonb)
  from public.storefront_filter_definitions d
  join public.storefront_filter_categories fc on fc.filter_id = d.id
  join public.categories c on c.slug = fc.category_slug and c.active
  where d.active and fc.category_slug = p_category_slug;
$$;

revoke all on function public.get_storefront_category_filters(text) from public, anon, authenticated;
grant execute on function public.get_storefront_category_filters(text) to anon, authenticated;
