WITH updates AS (
  SELECT
    id,
    name,
    regexp_replace(name, '\s+(1|5|10|20|25)PK$', '', 'i') AS display_name
  FROM products
  WHERE name ~* '\s+(1|5|10|20|25)PK$'
)
UPDATE products p
SET
  name = updates.display_name,
  seo_title = CASE WHEN p.seo_title IS NULL OR p.seo_title = updates.name THEN updates.display_name ELSE p.seo_title END,
  search_text = CASE WHEN p.search_text IS NULL OR p.search_text = updates.name THEN updates.display_name ELSE p.search_text END,
  updated_at = now()
FROM updates
WHERE p.id = updates.id;
