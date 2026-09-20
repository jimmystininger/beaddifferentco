WITH linked AS (
  SELECT
    p.id,
    p.name,
    p.seo_title,
    p.search_text,
    i.name AS sku_name,
    COALESCE(i.source_metadata->>'product_service_name', i.name) AS source_name,
    regexp_replace(upper(COALESCE(pov.inventory_sku, pov.sku)), '-(1|2|5|10|20|25)PK$', '') AS family_key,
    ROW_NUMBER() OVER (
      PARTITION BY p.id
      ORDER BY CASE WHEN upper(COALESCE(pov.inventory_sku, pov.sku)) LIKE '%-1PK' THEN 0 ELSE 1 END, pov.id
    ) AS row_number
  FROM products p
  JOIN product_options po ON po.product_id = p.id
  JOIN product_option_values pov ON pov.option_id = po.id
  JOIN inventory_skus i ON upper(i.sku) = upper(COALESCE(pov.inventory_sku, pov.sku))
), pure AS (
  SELECT id
  FROM linked
  GROUP BY id
  HAVING COUNT(DISTINCT family_key) = 1
), candidates AS (
  SELECT
    linked.id,
    linked.name AS old_name,
    linked.seo_title,
    linked.search_text,
    regexp_replace(linked.source_name, '\s+(1|2|5|10|20|25)(PK|PC)$', '', 'i') AS clean_source
  FROM linked
  JOIN pure ON pure.id = linked.id
  WHERE linked.row_number = 1
    AND linked.name IN ('20mm Bead', '15mm Bead', '12mm Bead', '16mm Bead')
), updates AS (
  SELECT
    id,
    old_name,
    seo_title,
    search_text,
    clean_source || CASE WHEN clean_source ~* '\s+Bead$' THEN '' ELSE ' Bead' END AS display_name
  FROM candidates
  WHERE clean_source ~* '^[0-9]+mm\s+Rhinestone\s+'
)
UPDATE products p
SET
  name = updates.display_name,
  seo_title = CASE WHEN p.seo_title IS NULL OR p.seo_title = updates.old_name THEN updates.display_name ELSE p.seo_title END,
  search_text = CASE WHEN p.search_text IS NULL OR p.search_text = updates.old_name THEN updates.display_name ELSE p.search_text END,
  updated_at = now()
FROM updates
WHERE p.id = updates.id;
