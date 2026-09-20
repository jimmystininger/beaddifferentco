with normalized as (
  select regexp_replace(
           regexp_replace(
             regexp_replace(
               value->'admin'->>'shippingPolicy',
               '<div style="line-height:1\\.5"></div>',
               '',
               'g'
             ),
             '^(<div style="line-height:1\\.5">)+',
             ''
           ),
           '(</div>)+$',
           ''
         ) as policy,
         value
  from public.site_settings
  where key = 'store'
)
update public.site_settings s
set value = jsonb_set(normalized.value, '{admin,shippingPolicy}', to_jsonb(normalized.policy)),
    updated_at = now()
from normalized
where s.key = 'store';
