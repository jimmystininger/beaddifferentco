create or replace function public.get_storefront_shipping_settings()
returns jsonb
language sql
security definer
set search_path = public, private
as $$
  select jsonb_build_object(
    'shippingFrom', coalesce(value->'config'->>'shippingFrom', 'Ohio'),
    'shippingOriginPostalCode', coalesce(nullif(value->'config'->>'shippingOriginPostalCode', ''), '43147'),
    'shippingOriginCity', coalesce(value->'config'->>'shippingOriginCity', ''),
    'shippingOriginState', coalesce(nullif(value->'config'->>'shippingOriginState', ''), 'OH'),
    'processingDays', greatest(0, coalesce((value->'config'->>'processingDays')::numeric, 3)),
    'freeShippingThreshold', greatest(0, coalesce((value->'config'->>'freeShippingThreshold')::numeric, 35)),
    'msrpMarkupPercent', greatest(0, coalesce((value->'config'->>'msrpMarkupPercent')::numeric, 100)),
    'rewardThreshold', greatest(0.01, coalesce((value->'config'->>'rewardThreshold')::numeric, 35)),
    'rewardDiscountPercent', least(100, greatest(0.01, coalesce((value->'config'->>'rewardDiscountPercent')::numeric, 5))),
    'shippingCarrier', 'usps',
    'shippingBoxes', coalesce(nullif(value->'config'->'shippingBoxes', '[]'::jsonb), '[{"name":"Smallest USPS parcel","maxWeightOz":70,"lengthIn":6,"widthIn":4,"heightIn":1}]'::jsonb),
    'salesFrozen', coalesce((value->'config'->>'salesFrozen')::boolean, false),
    'etsyImportsFrozen', coalesce((value->'config'->>'etsyImportsFrozen')::boolean, false),
    'smallBusinessMessage', coalesce(value->'admin'->>'smallBusinessMessage', 'SMALL BUSINESS'),
    'bigCreativityMessage', coalesce(value->'admin'->>'bigCreativityMessage', 'BIG CREATIVITY'),
    'shippingPolicy', coalesce(value->'admin'->>'shippingPolicy', 'Shipping options and delivery estimates are shown at checkout. Please contact us if your order arrives with a problem so we can help.'),
    'heroUrl', coalesce(value->'config'->>'heroUrl', value->'admin'->>'heroUrl', ''),
    'logoUrl', coalesce(value->'config'->>'logoUrl', value->'admin'->>'logoUrl', ''),
    'footerLogoUrl', coalesce(value->'config'->>'footerLogoUrl', value->'admin'->>'footerLogoUrl', ''),
    'storyUrl', coalesce(value->'config'->>'storyUrl', value->'admin'->>'storyUrl', ''),
    'pageBackgroundImageUrl', coalesce(value->'config'->>'pageBackgroundImageUrl', value->'admin'->>'pageBackgroundImageUrl', ''),
    'categoryPhotos', coalesce(value->'config'->'categoryPhotos', value->'admin'->'categoryPhotos', '{}'::jsonb),
    'theme', jsonb_build_object(
      'buttonColor', case when coalesce(value->'config'->'theme'->>'buttonColor', value->'admin'->'theme'->>'buttonColor', '') ~ '^#[0-9A-Fa-f]{6}$' then coalesce(value->'config'->'theme'->>'buttonColor', value->'admin'->'theme'->>'buttonColor') else '#050505' end,
      'buttonTextColor', case when coalesce(value->'config'->'theme'->>'buttonTextColor', value->'admin'->'theme'->>'buttonTextColor', '') ~ '^#[0-9A-Fa-f]{6}$' then coalesce(value->'config'->'theme'->>'buttonTextColor', value->'admin'->'theme'->>'buttonTextColor') else '#ffffff' end,
      'bannerColor', case when coalesce(value->'config'->'theme'->>'bannerColor', value->'admin'->'theme'->>'bannerColor', '') ~ '^#[0-9A-Fa-f]{6}$' then coalesce(value->'config'->'theme'->>'bannerColor', value->'admin'->'theme'->>'bannerColor') else '#e482a4' end,
      'headerTextColor', case when coalesce(value->'config'->'theme'->>'headerTextColor', value->'admin'->'theme'->>'headerTextColor', '') ~ '^#[0-9A-Fa-f]{6}$' then coalesce(value->'config'->'theme'->>'headerTextColor', value->'admin'->'theme'->>'headerTextColor') else '#111111' end,
      'cartBadgeColor', case when coalesce(value->'config'->'theme'->>'cartBadgeColor', value->'admin'->'theme'->>'cartBadgeColor', '') ~ '^#[0-9A-Fa-f]{6}$' then coalesce(value->'config'->'theme'->>'cartBadgeColor', value->'admin'->'theme'->>'cartBadgeColor') else '#e482a4' end,
      'pageBackgroundColor', case when coalesce(value->'config'->'theme'->>'pageBackgroundColor', value->'admin'->'theme'->>'pageBackgroundColor', '') ~ '^#[0-9A-Fa-f]{6}$' then coalesce(value->'config'->'theme'->>'pageBackgroundColor', value->'admin'->'theme'->>'pageBackgroundColor') else '#fffdfb' end,
      'accentBackgroundColor', case when coalesce(value->'config'->'theme'->>'accentBackgroundColor', value->'admin'->'theme'->>'accentBackgroundColor', '') ~ '^#[0-9A-Fa-f]{6}$' then coalesce(value->'config'->'theme'->>'accentBackgroundColor', value->'admin'->'theme'->>'accentBackgroundColor') else '#fff1f5' end,
      'footerBackgroundColor', case when coalesce(value->'config'->'theme'->>'footerBackgroundColor', value->'admin'->'theme'->>'footerBackgroundColor', '') ~ '^#[0-9A-Fa-f]{6}$' then coalesce(value->'config'->'theme'->>'footerBackgroundColor', value->'admin'->'theme'->>'footerBackgroundColor') else '#111111' end,
      'footerHeaderTextColor', case when coalesce(value->'config'->'theme'->>'footerHeaderTextColor', value->'admin'->'theme'->>'footerHeaderTextColor', '') ~ '^#[0-9A-Fa-f]{6}$' then coalesce(value->'config'->'theme'->>'footerHeaderTextColor', value->'admin'->'theme'->>'footerHeaderTextColor') else '#f185aa' end,
      'footerButtonColor', case when coalesce(value->'config'->'theme'->>'footerButtonColor', value->'admin'->'theme'->>'footerButtonColor', '') ~ '^#[0-9A-Fa-f]{6}$' then coalesce(value->'config'->'theme'->>'footerButtonColor', value->'admin'->'theme'->>'footerButtonColor') else '#f185aa' end,
      'footerTextColor', case when coalesce(value->'config'->'theme'->>'footerTextColor', value->'admin'->'theme'->>'footerTextColor', '') ~ '^#[0-9A-Fa-f]{6}$' then coalesce(value->'config'->'theme'->>'footerTextColor', value->'admin'->'theme'->>'footerTextColor') else '#ffffff' end
    )
  )
  from public.site_settings
  where key = 'store'
  union all
  select jsonb_build_object(
    'shippingFrom', 'Ohio',
    'shippingOriginPostalCode', '43147',
    'shippingOriginCity', '',
    'shippingOriginState', 'OH',
    'processingDays', 3,
    'freeShippingThreshold', 35,
    'msrpMarkupPercent', 100,
    'rewardThreshold', 35,
    'rewardDiscountPercent', 5,
    'shippingCarrier', 'usps',
    'shippingBoxes', '[{"name":"Smallest USPS parcel","maxWeightOz":70,"lengthIn":6,"widthIn":4,"heightIn":1}]'::jsonb,
    'salesFrozen', false,
    'etsyImportsFrozen', false,
    'smallBusinessMessage', 'SMALL BUSINESS',
    'bigCreativityMessage', 'BIG CREATIVITY',
    'shippingPolicy', 'Shipping options and delivery estimates are shown at checkout. Please contact us if your order arrives with a problem so we can help.',
    'heroUrl', '',
    'logoUrl', '',
    'footerLogoUrl', '',
    'storyUrl', '',
    'pageBackgroundImageUrl', '',
    'categoryPhotos', '{}'::jsonb,
    'theme', jsonb_build_object(
      'buttonColor', '#050505',
      'buttonTextColor', '#ffffff',
      'bannerColor', '#e482a4',
      'headerTextColor', '#111111',
      'cartBadgeColor', '#e482a4',
      'pageBackgroundColor', '#fffdfb',
      'accentBackgroundColor', '#fff1f5',
      'footerBackgroundColor', '#111111',
      'footerHeaderTextColor', '#f185aa',
      'footerButtonColor', '#f185aa',
      'footerTextColor', '#ffffff'
    )
  )
  where not exists (select 1 from public.site_settings where key = 'store')
  limit 1;
$$;

revoke all on function public.get_storefront_shipping_settings() from public, anon, authenticated;
grant execute on function public.get_storefront_shipping_settings() to anon, authenticated;
