update public.products
set badges = coalesce(
  (select jsonb_agg(value)
   from jsonb_array_elements(coalesce(products.badges, '[]'::jsonb)) values(value)
   where value #>> '{}' not in ('Single Bead', 'Multi-Pack', 'Single Bead & Multi-Pack')),
  '[]'::jsonb
)
where badges ?| array['Single Bead', 'Multi-Pack', 'Single Bead & Multi-Pack'];
