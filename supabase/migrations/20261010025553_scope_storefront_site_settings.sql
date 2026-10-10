create function public.get_storefront_site_settings(p_scope text)
returns jsonb
language sql
security invoker
set search_path to 'public'
as $function$
  select public.get_storefront_shipping_settings() - case p_scope
    when 'home' then array['faqItems', 'footerShippingPolicy', 'storyBody']::text[]
    when 'story' then array['faqItems', 'footerShippingPolicy', 'featuredText']::text[]
    when 'faq' then array['footerShippingPolicy', 'storyBody', 'featuredText']::text[]
    when 'returns' then array['faqItems', 'storyBody', 'featuredText']::text[]
    else array['faqItems', 'footerShippingPolicy', 'storyBody', 'featuredText']::text[]
  end;
$function$;

revoke all on function public.get_storefront_site_settings(text) from public;
grant execute on function public.get_storefront_site_settings(text) to anon, authenticated;
