create or replace function public.get_storefront_featured_content()
returns jsonb
language sql
security definer
set search_path = public, private
as $function$
  select jsonb_build_object(
    'featuredText', coalesce(value->'admin'->>'featuredText', ''),
    'featuredBackgroundImageUrl', coalesce(value->'config'->>'featuredBackgroundImageUrl', value->'admin'->>'featuredBackgroundImageUrl', '')
  )
  from public.site_settings
  where key = 'store'
  union all
  select jsonb_build_object('featuredText', '', 'featuredBackgroundImageUrl', '')
  where not exists (select 1 from public.site_settings where key = 'store')
  limit 1;
$function$;

grant execute on function public.get_storefront_featured_content() to anon, authenticated;
