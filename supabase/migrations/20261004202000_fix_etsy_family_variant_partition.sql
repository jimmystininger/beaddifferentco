do $migration$
declare
  function_definition text;
begin
  select pg_get_functiondef('public.sync_etsy_product_sku_family(uuid,jsonb)'::regprocedure)
    into function_definition;
  function_definition := replace(function_definition, '    from normalized_rows', '    from family_indexed');
  function_definition := replace(
    function_definition,
    '  ), family_rows as (',
    '  ), family_indexed as (select normalized_rows.*, min(ordinality) over (partition by child_sku) as family_order from normalized_rows), family_rows as ('
  );
  function_definition := replace(
    function_definition,
    'min(ordinality) over (partition by child_sku) as family_order,',
    'family_order,'
  );
  execute function_definition;
end;
$migration$;

do $backfill$
declare
  page record;
begin
  for page in
    select p.id as product_id,
           coalesce(listing.raw_payload->'variants', '[]'::jsonb) as variants
    from public.products p
    left join lateral (
      select raw_payload
      from public.etsy_import_listings listing_row
      where listing_row.proposed_product_id = p.id
      order by listing_row.updated_at desc nulls last, listing_row.id
      limit 1
    ) listing on true
    where p.etsy_listing_id is not null
       or listing.raw_payload is not null
  loop
    perform public.sync_etsy_product_sku_family(page.product_id, page.variants);
  end loop;
end;
$backfill$;
