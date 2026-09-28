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
    'socialLinks', coalesce(value->'admin'->'socialLinks', '{}'::jsonb),
    'storyTitle', coalesce(value->'admin'->>'storyTitle', 'Our Story'),
    'storyBody', coalesce(value->'admin'->>'storyBody', 'Bead Different Co. is a small, family-run creative supply shop built around colorful ideas, useful supplies, and making something that feels like you.'),
    'faqItems', coalesce(value->'admin'->'faqItems', '[{"question":"How long does shipping take?","answer":"Shipping options and delivery estimates are shown at checkout."},{"question":"Do you accept returns?","answer":"Please contact us through the Contact Us page so we can review your order and help."}]'::jsonb),
    'footerShippingPolicy', coalesce(value->'admin'->>'footerShippingPolicy', 'Shipping options and delivery estimates are shown at checkout. Contact us if your order arrives with a problem so we can help.'),
    'contactEmail', coalesce(value->'admin'->>'contactEmail', ''),
    'featuredText', coalesce(value->'admin'->>'featuredText', ''),
    'heroUrl', coalesce(value->'config'->>'heroUrl', value->'admin'->>'heroUrl', ''),
    'logoUrl', coalesce(value->'config'->>'logoUrl', value->'admin'->>'logoUrl', ''),
    'footerLogoUrl', coalesce(value->'config'->>'footerLogoUrl', value->'admin'->>'footerLogoUrl', ''),
    'storyUrl', coalesce(value->'config'->>'storyUrl', value->'admin'->>'storyUrl', ''),
    'pageBackgroundImageUrl', coalesce(value->'config'->>'pageBackgroundImageUrl', value->'admin'->>'pageBackgroundImageUrl', ''),
    'categoryPhotos', coalesce(value->'config'->'categoryPhotos', value->'admin'->'categoryPhotos', '{}'::jsonb),
    'theme', coalesce(value->'config'->'theme', value->'admin'->'theme', '{}'::jsonb)
  )
  from public.site_settings
  where key = 'store'
  union all
  select jsonb_build_object(
    'shippingFrom', 'Ohio', 'shippingOriginPostalCode', '43147', 'shippingOriginCity', '', 'shippingOriginState', 'OH',
    'processingDays', 3, 'freeShippingThreshold', 35, 'msrpMarkupPercent', 100, 'rewardThreshold', 35,
    'rewardDiscountPercent', 5, 'shippingCarrier', 'usps',
    'shippingBoxes', '[{"name":"Smallest USPS parcel","maxWeightOz":70,"lengthIn":6,"widthIn":4,"heightIn":1}]'::jsonb,
    'salesFrozen', false, 'etsyImportsFrozen', false, 'smallBusinessMessage', 'SMALL BUSINESS',
    'bigCreativityMessage', 'BIG CREATIVITY',
    'shippingPolicy', 'Shipping options and delivery estimates are shown at checkout. Please contact us if your order arrives with a problem so we can help.',
    'socialLinks', '{}'::jsonb, 'storyTitle', 'Our Story',
    'storyBody', 'Bead Different Co. is a small, family-run creative supply shop built around colorful ideas, useful supplies, and making something that feels like you.',
    'faqItems', '[{"question":"How long does shipping take?","answer":"Shipping options and delivery estimates are shown at checkout."},{"question":"Do you accept returns?","answer":"Please contact us through the Contact Us page so we can review your order and help."}]'::jsonb,
    'footerShippingPolicy', 'Shipping options and delivery estimates are shown at checkout. Contact us if your order arrives with a problem so we can help.',
    'contactEmail', '', 'featuredText', '', 'heroUrl', '', 'logoUrl', '', 'footerLogoUrl', '', 'storyUrl', '', 'pageBackgroundImageUrl', '',
    'categoryPhotos', '{}'::jsonb, 'theme', '{}'::jsonb
  )
  where not exists (select 1 from public.site_settings where key = 'store')
  limit 1;
$$;

revoke all on function public.get_storefront_shipping_settings() from public, anon, authenticated;
grant execute on function public.get_storefront_shipping_settings() to anon, authenticated;
