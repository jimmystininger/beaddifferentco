WITH linked AS (
  SELECT
    p.id,
    p.name,
    p.seo_title,
    p.search_text,
    i.name AS sku_name,
    COALESCE(i.source_metadata->>'product_service_name', i.name) AS source_name,
    regexp_replace(upper(COALESCE(pov.inventory_sku, pov.sku)), '-(1|5|10|20|25)PK$', '') AS family_key,
    ROW_NUMBER() OVER (
      PARTITION BY p.id
      ORDER BY CASE WHEN upper(COALESCE(pov.inventory_sku, pov.sku)) LIKE '%-1PK' THEN 0 ELSE 1 END, pov.id
    ) AS row_number
  FROM products p
  JOIN product_options po ON po.product_id = p.id
  JOIN product_option_values pov ON pov.option_id = po.id
  JOIN inventory_skus i ON upper(i.sku) = upper(COALESCE(pov.inventory_sku, pov.sku))
), pure_pages AS (
  SELECT
    id,
    COUNT(DISTINCT family_key) = 1 AS is_pure
  FROM linked
  GROUP BY id
), primary_rows AS (
  SELECT linked.*
  FROM linked
  JOIN pure_pages ON pure_pages.id = linked.id AND pure_pages.is_pure
  WHERE linked.row_number = 1
), source_clean AS (
  SELECT
    primary_rows.*,
    regexp_replace(source_name, '\s+(1|2|5|10|20|25|30|50|100)(PK|PC)$', '', 'i') AS clean_source
  FROM primary_rows
), proposed AS (
  SELECT
    source_clean.*,
    CASE
      WHEN clean_source ~* '^Acrylic\s+[0-9]+MM\s+' THEN
        lower((regexp_match(clean_source, '^Acrylic\s+([0-9]+)MM\s+(.+)$', 'i'))[1])
        || 'mm Acrylic-'
        || (regexp_match(clean_source, '^Acrylic\s+([0-9]+)MM\s+(.+)$', 'i'))[2]
        || CASE WHEN clean_source ~* '\s+(Bead|Spacer)$' THEN '' ELSE ' Bead' END
      WHEN clean_source ~* '^Gem\s+Spacers\s+[0-9]+mm\s+' THEN
        lower((regexp_match(clean_source, '^Gem\s+Spacers\s+([0-9]+)mm\s+(.+)$', 'i'))[1])
        || 'mm Acrylic-'
        || (regexp_match(clean_source, '^Gem\s+Spacers\s+([0-9]+)mm\s+(.+)$', 'i'))[2]
        || ' Gem Spacer'
      WHEN clean_source ~* '^Gem\s+Spacers\s+Wide\s+Hole\s+' AND name ~* '^[0-9]+mm\s+' THEN
        lower((regexp_match(name, '^([0-9]+)mm', 'i'))[1])
        || 'mm Acrylic-'
        || (regexp_match(clean_source, '^Gem\s+Spacers\s+(.+)$', 'i'))[1]
        || ' Gem Spacer'
      WHEN clean_source ~* '^Wavy\s+Gem\s+Spacers\s+.+\s+[0-9]+MM$' THEN
        lower((regexp_match(clean_source, '^Wavy\s+Gem\s+Spacers\s+(.+)\s+([0-9]+)MM$', 'i'))[2])
        || 'mm Acrylic-'
        || (regexp_match(clean_source, '^Wavy\s+Gem\s+Spacers\s+(.+)\s+([0-9]+)MM$', 'i'))[1]
        || ' Wavy Gem Spacer'
      ELSE NULL
    END AS canonical_name
  FROM source_clean
), repaired AS (
  SELECT
    id,
    name AS old_name,
    seo_title,
    search_text,
    CASE
      WHEN canonical_name IS NOT NULL
        AND (name IN ('10mm Gem Spacer', '15mm Bead', '12mm Bead', '16mm Bead', '20mm Bead')
          OR name ~* '(pacer|ilicone|port|quirrel|hine tone|Chri tma|Di c|\\\\1)')
        THEN canonical_name
      ELSE name
    END AS base_name
  FROM proposed
), normalized AS (
  SELECT
    id,
    old_name,
    seo_title,
    search_text,
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(base_name, '\\bpacer\\b', 'Spacer', 'gi'),
                '\\bilicone\\b', 'Silicone', 'gi'
              ),
              '\\bport\\b', 'Sport', 'gi'
            ),
            '\\bquirrel\\b', 'Squirrel', 'gi'
          ),
          'hine tone', 'hinestone', 'gi'
        ),
        'Chri tma', 'Christmas', 'gi'
      ),
      '\\bDi c\\b', 'Disc', 'gi'
    ) AS display_name
  FROM repaired
)
UPDATE products p
SET
  name = normalized.display_name,
  seo_title = CASE WHEN p.seo_title IS NULL OR p.seo_title = normalized.old_name THEN normalized.display_name ELSE p.seo_title END,
  search_text = CASE WHEN p.search_text IS NULL OR p.search_text = normalized.old_name THEN normalized.display_name ELSE p.search_text END,
  updated_at = now()
FROM normalized
WHERE p.id = normalized.id
  AND normalized.display_name <> normalized.old_name;

UPDATE products p
SET
  name = regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(p.name, '\\bpacer\\b', 'Spacer', 'gi'),
            '\\bilicone\\b', 'Silicone', 'gi'
          ),
          '\\bport\\b', 'Sport', 'gi'
        ),
        '\\bquirrel\\b', 'Squirrel', 'gi'
      ),
      'hine tone', 'hinestone', 'gi'
    ),
    'Chri tma', 'Christmas', 'gi'
  ),
  updated_at = now()
WHERE p.name ~* '(pacer|ilicone|port|quirrel|hine tone|Chri tma)';
