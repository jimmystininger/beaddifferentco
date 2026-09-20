WITH normalized AS (
  SELECT
    id,
    name AS old_name,
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(
                  regexp_replace(
                    regexp_replace(
                      regexp_replace(name, '\mpacer\M', 'Spacer', 'gi'),
                      '\milicone\M', 'Silicone', 'gi'
                    ),
                    '\mport\M', 'Sport', 'gi'
                  ),
                  '\mquirrel\M', 'Squirrel', 'gi'
                ),
                'hine tone', 'Rhinestone', 'gi'
              ),
              'Chri tma', 'Christmas', 'gi'
            ),
            'Chri tian', 'Christian', 'gi'
          ),
          '\mDi c\M', 'Disc', 'gi'
        ),
        '\mquad\M', 'Squad', 'gi'
      ),
      '\mhell\M', 'Shell', 'gi'
    ) AS display_name
  FROM products
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
