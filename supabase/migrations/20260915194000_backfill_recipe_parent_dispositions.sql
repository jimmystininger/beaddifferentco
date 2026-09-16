update public.inventory_skus as inventory
set item_type = 'Non-inventory',
    hierarchy = 'Parent',
    source_metadata = coalesce(inventory.source_metadata, '{}'::jsonb)
      || jsonb_build_object('disposition', 'recipe_parent', 'disposition_updated_at', timezone('utc', now())),
    updated_at = timezone('utc', now())
where inventory.id in (
  select distinct bundle_sku_id
  from public.inventory_bundle_components
);
