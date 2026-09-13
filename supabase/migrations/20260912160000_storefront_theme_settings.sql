create or replace function public.get_storefront_shipping_settings()
returns jsonb
language sql
security definer
set search_path = public, private
as $$
  select jsonb_build_object(
    'shippingFrom', coalesce(value->'config'->>'shippingFrom', 'Ohio'),
    'shippingOriginPostalCode', coalesce(value->'config'->>'shippingOriginPostalCode', ''),
    'shippingOriginCity', coalesce(value->'config'->>'shippingOriginCity', ''),
    'shippingOriginState', coalesce(value->'config'->>'shippingOriginState', ''),
    'processingDays', greatest(0, coalesce((value->'config'->>'processingDays')::numeric, 3)),
    'freeShippingThreshold', greatest(0, coalesce((value->'config'->>'freeShippingThreshold')::numeric, 35)),
    'smallBusinessMessage', coalesce(value->'admin'->>'smallBusinessMessage', 'SMALL BUSINESS'),
    'bigCreativityMessage', coalesce(value->'admin'->>'bigCreativityMessage', 'BIG CREATIVITY'),
    'shippingPolicy', coalesce(value->'admin'->>'shippingPolicy', 'Shipping options and delivery estimates are shown at checkout. Please contact us if your order arrives with a problem so we can help.'),
    'heroUrl', coalesce(value->'admin'->>'heroUrl', ''),
    'logoUrl', coalesce(value->'admin'->>'logoUrl', ''),
    'storyUrl', coalesce(value->'admin'->>'storyUrl', ''),
    'categoryPhotos', coalesce(value->'admin'->'categoryPhotos', '{}'::jsonb),
    'theme', jsonb_build_object(
      'buttonColor', case when coalesce(value->'admin'->'theme'->>'buttonColor', '') ~ '^#[0-9A-Fa-f]{6}$' then value->'admin'->'theme'->>'buttonColor' else '#050505' end,
      'buttonTextColor', case when coalesce(value->'admin'->'theme'->>'buttonTextColor', '') ~ '^#[0-9A-Fa-f]{6}$' then value->'admin'->'theme'->>'buttonTextColor' else '#ffffff' end,
      'bannerColor', case when coalesce(value->'admin'->'theme'->>'bannerColor', '') ~ '^#[0-9A-Fa-f]{6}$' then value->'admin'->'theme'->>'bannerColor' else '#e482a4' end,
      'headerTextColor', case when coalesce(value->'admin'->'theme'->>'headerTextColor', '') ~ '^#[0-9A-Fa-f]{6}$' then value->'admin'->'theme'->>'headerTextColor' else '#111111' end,
      'cartBadgeColor', case when coalesce(value->'admin'->'theme'->>'cartBadgeColor', '') ~ '^#[0-9A-Fa-f]{6}$' then value->'admin'->'theme'->>'cartBadgeColor' else '#e482a4' end,
      'pageBackgroundColor', case when coalesce(value->'admin'->'theme'->>'pageBackgroundColor', '') ~ '^#[0-9A-Fa-f]{6}$' then value->'admin'->'theme'->>'pageBackgroundColor' else '#fffdfb' end
    )
  )
  from public.site_settings
  where key = 'store'
  union all
  select jsonb_build_object(
    'shippingFrom', 'Ohio',
    'shippingOriginPostalCode', '',
    'shippingOriginCity', '',
    'shippingOriginState', '',
    'processingDays', 3,
    'freeShippingThreshold', 35,
    'smallBusinessMessage', 'SMALL BUSINESS',
    'bigCreativityMessage', 'BIG CREATIVITY',
    'shippingPolicy', 'Shipping options and delivery estimates are shown at checkout. Please contact us if your order arrives with a problem so we can help.',
    'heroUrl', '',
    'logoUrl', '',
    'storyUrl', '',
    'categoryPhotos', '{}'::jsonb,
    'theme', jsonb_build_object(
      'buttonColor', '#050505',
      'buttonTextColor', '#ffffff',
      'bannerColor', '#e482a4',
      'headerTextColor', '#111111',
      'cartBadgeColor', '#e482a4',
      'pageBackgroundColor', '#fffdfb'
    )
  )
  where not exists (select 1 from public.site_settings where key = 'store')
  limit 1;
$$;

revoke all on function public.get_storefront_shipping_settings() from public, anon, authenticated;
grant execute on function public.get_storefront_shipping_settings() to anon, authenticated;
