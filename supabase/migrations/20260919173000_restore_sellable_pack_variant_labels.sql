UPDATE inventory_skus
SET
  variant_name = NULLIF(TRIM(source_metadata->>'pack_display_name'), ''),
  updated_at = now()
WHERE lower(COALESCE(variant_name, '')) = 'sellable pack'
  AND NULLIF(TRIM(source_metadata->>'pack_display_name'), '') IS NOT NULL;
