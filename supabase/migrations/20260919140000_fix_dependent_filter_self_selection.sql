create or replace function public.get_storefront_category_filters(
  p_category_slug text,
  p_filter_selections jsonb default '{}'::jsonb
)
returns jsonb
language sql
stable
set search_path = public
as $function$
select coalesce(jsonb_agg(jsonb_build_object(
  'key', d.key,
  'label', d.label,
  'scope', d.scope,
  'sortOrder', d.sort_order,
  'values', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', v.id,
      'key', v.value_key,
      'label', v.label,
      'sortOrder', v.sort_order
    ) order by v.sort_order, v.label), '[]'::jsonb)
    from public.storefront_filter_values v
    where v.filter_id = d.id
      and v.active
      and (
        jsonb_typeof(coalesce(p_filter_selections, '{}'::jsonb)) <> 'object'
        or not (p_filter_selections ? d.key)
        or jsonb_typeof(p_filter_selections -> d.key) <> 'array'
        or jsonb_array_length(p_filter_selections -> d.key) = 0
        or v.value_key = any(array(select jsonb_array_elements_text(p_filter_selections -> d.key)))
      )
      and exists (
        select 1
        from public.product_options po
        join public.products p on p.id = po.product_id and p.visible
        join public.product_option_values pov on pov.option_id = po.id
        join public.product_filter_assignments pfa
          on pfa.product_id = p.id
         and pfa.inventory_sku_id = pov.inventory_sku_id
         and pfa.filter_value_id = v.id
        where (
          p_category_slug in ('', 'shop-all')
          or p.category_slug = p_category_slug
          or p.subcategory_slug = p_category_slug
          or exists (
            select 1
            from public.product_categories pc
            where pc.product_id = p.id
              and pc.category_slug = p_category_slug
          )
        )
        and not exists (
          select 1
          from jsonb_each(
            case
              when jsonb_typeof(coalesce(p_filter_selections, '{}'::jsonb)) = 'object' then p_filter_selections
              else '{}'::jsonb
            end
          ) s
          join public.storefront_filter_definitions sd
            on sd.key = s.key
           and sd.active
          where s.key <> d.key
            and jsonb_typeof(s.value) = 'array'
            and jsonb_array_length(s.value) > 0
            and not exists (
              select 1
              from public.product_filter_assignments oa
              join public.storefront_filter_values ov on ov.id = oa.filter_value_id
              where oa.product_id = p.id
                and oa.inventory_sku_id = pov.inventory_sku_id
                and ov.filter_id = sd.id
                and ov.value_key = any(array(select jsonb_array_elements_text(s.value)))
            )
        )
      )
  )
) order by d.sort_order, d.label), '[]'::jsonb)
from public.storefront_filter_definitions d
where d.active
  and (
    p_category_slug in ('', 'shop-all')
    or exists (
      select 1
      from public.storefront_filter_categories fc
      join public.categories c on c.slug = fc.category_slug and c.active
      where fc.filter_id = d.id
        and fc.category_slug = p_category_slug
    )
  );
$function$;

revoke all on function public.get_storefront_category_filters(text, jsonb) from public, anon, authenticated;
grant execute on function public.get_storefront_category_filters(text, jsonb) to anon, authenticated;
