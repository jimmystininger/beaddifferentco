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
    'shippingPolicy', coalesce(value->'admin'->>'shippingPolicy', 'Shipping options and delivery estimates are shown at checkout. Please contact us if your order arrives with a problem so we can help.')
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
    'shippingPolicy', 'Shipping options and delivery estimates are shown at checkout. Please contact us if your order arrives with a problem so we can help.'
  )
  where not exists (select 1 from public.site_settings where key = 'store')
  limit 1;
$$;

revoke all on function public.get_storefront_shipping_settings() from public, anon, authenticated;
grant execute on function public.get_storefront_shipping_settings() to anon, authenticated;
