update public.products p
set badges = coalesce((
  select jsonb_agg(entry.value order by entry.ordinality)
  from jsonb_array_elements(coalesce(p.badges, '[]'::jsonb)) with ordinality as entry(value, ordinality)
  where entry.value <> '"Fits on Beadable Pen"'::jsonb
), '[]'::jsonb)
where coalesce(p.badges, '[]'::jsonb) @> '["Fits on Beadable Pen"]'::jsonb;
