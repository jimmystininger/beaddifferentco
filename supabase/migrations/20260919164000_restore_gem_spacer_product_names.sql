WITH linked AS (
  SELECT
    p.id,
    p.name,
    regexp_replace(upper(coalesce(pov.inventory_sku, pov.sku)), '-(1|5|10|20|25)PK$', '') AS family_key,
    regexp_replace(i.source_metadata->>'product_service_name', '^Gem Spacers\s+10mm\s+(.+)\s+1PK$', '\\1', 'i') AS color_name,
    row_number() OVER (
      PARTITION BY p.id
      ORDER BY CASE WHEN upper(coalesce(pov.inventory_sku, pov.sku)) LIKE '%-1PK' THEN 0 ELSE 1 END, pov.id
    ) AS row_number
  FROM products p
  JOIN product_options po ON po.product_id = p.id
  JOIN product_option_values pov ON pov.option_id = po.id
  JOIN inventory_skus i ON upper(i.sku) = upper(coalesce(pov.inventory_sku, pov.sku))
), primary_rows AS (
  SELECT * FROM linked WHERE row_number = 1
), pure_pages AS (
  SELECT
    id,
    bool_and(family_key = (SELECT family_key FROM primary_rows primary_row WHERE primary_row.id = linked.id)) AS is_pure
  FROM linked
  GROUP BY id
)
UPDATE products p
SET
  name = '10mm Acrylic-' || primary_row.color_name || ' Gem Spacer',
  seo_title = CASE WHEN p.seo_title IS NULL OR p.seo_title = p.name THEN '10mm Acrylic-' || primary_row.color_name || ' Gem Spacer' ELSE p.seo_title END,
  search_text = CASE WHEN p.search_text IS NULL OR p.search_text = p.name THEN '10mm Acrylic-' || primary_row.color_name || ' Gem Spacer' ELSE p.search_text END,
  updated_at = now()
FROM primary_rows primary_row
JOIN pure_pages ON pure_pages.id = primary_row.id AND pure_pages.is_pure
WHERE p.id = primary_row.id
  AND primary_row.family_key LIKE 'ACC-GEM-%'
  AND primary_row.color_name IS NOT NULL;
