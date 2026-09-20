WITH linked AS (
  SELECT
    p.id,
    p.name,
    p.seo_title,
    p.search_text,
    regexp_replace(upper(coalesce(pov.inventory_sku, pov.sku)), '-(1|5|10|20|25)PK$', '') AS family_key,
    regexp_replace(i.name, '\s+(1|5|10|20|25)PK$', '', 'i') AS source_name,
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
), proposed AS (
  SELECT
    primary_row.id,
    primary_row.name,
    primary_row.seo_title,
    primary_row.search_text,
    CASE
      WHEN primary_row.source_name ~* '^Acrylic\s+[0-9]+MM\s+' THEN
        lower((regexp_match(primary_row.source_name, '^Acrylic\s+([0-9]+)MM\s+(.+)$', 'i'))[1]) || 'mm Acrylic-' || (regexp_match(primary_row.source_name, '^Acrylic\s+([0-9]+)MM\s+(.+)$', 'i'))[2]
      WHEN primary_row.source_name ~* '^Acrylic\s+[0-9]+mm\s+' THEN
        lower((regexp_match(primary_row.source_name, '^Acrylic\s+([0-9]+)mm\s+(.+)$', 'i'))[1]) || 'mm Acrylic-' || (regexp_match(primary_row.source_name, '^Acrylic\s+([0-9]+)mm\s+(.+)$', 'i'))[2]
      WHEN primary_row.source_name ~* '^Acrylic\s+' AND primary_row.family_key ~ '^ACR-([0-9]+)MM' THEN
        (regexp_match(primary_row.family_key, '^ACR-([0-9]+)MM', 'i'))[1] || 'mm Acrylic-' || regexp_replace(primary_row.source_name, '^Acrylic\s+', '', 'i')
      WHEN primary_row.source_name ~* '^Rhinestones\s+.+\s+[0-9]+MM$' THEN
        (regexp_match(primary_row.source_name, '^Rhinestones\s+(.+)\s+([0-9]+)MM$', 'i'))[2] || 'mm Rhinestones ' || (regexp_match(primary_row.source_name, '^Rhinestones\s+(.+)\s+([0-9]+)MM$', 'i'))[1]
      WHEN primary_row.source_name ~* '^[0-9]+mm\s+' THEN primary_row.source_name
      WHEN primary_row.family_key LIKE 'SIL15-%' THEN '15mm ' || primary_row.source_name
      ELSE primary_row.source_name
    END AS name_without_suffix
  FROM primary_rows primary_row
  JOIN pure_pages ON pure_pages.id = primary_row.id AND pure_pages.is_pure
  WHERE primary_row.name ~* '1PK$'
), updates AS (
  SELECT
    id,
    name,
    seo_title,
    search_text,
    regexp_replace(
      CASE WHEN name_without_suffix ~* '\s+Bead$' THEN name_without_suffix ELSE name_without_suffix || ' Bead' END,
      'Acrylic-\s+', 'Acrylic-', 'i'
    ) AS display_name
  FROM proposed
)
UPDATE products p
SET
  name = updates.display_name,
  seo_title = CASE WHEN p.seo_title IS NULL OR p.seo_title = updates.name THEN updates.display_name ELSE p.seo_title END,
  search_text = CASE WHEN p.search_text IS NULL OR p.search_text = updates.name THEN updates.display_name ELSE p.search_text END,
  updated_at = now()
FROM updates
WHERE p.id = updates.id;
