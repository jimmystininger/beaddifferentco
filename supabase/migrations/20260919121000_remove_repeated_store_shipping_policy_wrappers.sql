update public.site_settings
set value = jsonb_set(value, '{admin,shippingPolicy}', to_jsonb(replace(replace(value->'admin'->>'shippingPolicy', '<div style="line-height:1.5">', ''), '</div>', ''))),
    updated_at = now()
where key = 'store';
