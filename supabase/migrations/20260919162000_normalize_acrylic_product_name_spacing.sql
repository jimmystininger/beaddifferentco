UPDATE products
SET
  name = regexp_replace(name, 'Acrylic-\s+', 'Acrylic-', 'gi'),
  seo_title = CASE WHEN seo_title IS NULL THEN NULL ELSE regexp_replace(seo_title, 'Acrylic-\s+', 'Acrylic-', 'gi') END,
  search_text = CASE WHEN search_text IS NULL THEN NULL ELSE regexp_replace(search_text, 'Acrylic-\s+', 'Acrylic-', 'gi') END,
  updated_at = now()
WHERE name ~* 'Acrylic-\s+' OR seo_title ~* 'Acrylic-\s+' OR search_text ~* 'Acrylic-\s+';
