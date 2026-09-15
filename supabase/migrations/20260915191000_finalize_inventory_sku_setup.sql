create or replace function public.finalize_inventory_sku_setup(inventory_sku_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public, private
as $$
declare
  updated_count integer;
begin
  if not private.is_admin() then
    raise exception 'Admin access required.';
  end if;
  if inventory_sku_ids is null or coalesce(array_length(inventory_sku_ids, 1), 0) = 0 then
    raise exception 'Choose at least one inventory SKU to finalize.';
  end if;
  update public.inventory_skus
  set source_metadata = coalesce(source_metadata, '{}'::jsonb)
    || jsonb_build_object('setup_locked', true, 'setup_locked_at', timezone('utc', now())),
      updated_at = timezone('utc', now())
  where id = any(inventory_sku_ids);
  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

revoke all on function public.finalize_inventory_sku_setup(uuid[]) from public, anon, authenticated;
grant execute on function public.finalize_inventory_sku_setup(uuid[]) to authenticated;
