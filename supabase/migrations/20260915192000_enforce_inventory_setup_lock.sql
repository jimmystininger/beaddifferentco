create or replace function public.prevent_locked_inventory_setup_changes()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if coalesce(old.source_metadata->>'setup_locked', 'false') = 'true'
    and coalesce(current_setting('bead.inventory_audit_mode', true), 'false') <> 'true'
    and (
      new.sku is distinct from old.sku
      or new.item_type is distinct from old.item_type
      or new.hierarchy is distinct from old.hierarchy
      or new.reorder_point is distinct from old.reorder_point
      or new.reserve_quantity is distinct from old.reserve_quantity
      or new.unit_type is distinct from old.unit_type
      or new.weight_value is distinct from old.weight_value
      or new.weight_unit is distinct from old.weight_unit
      or new.cost is distinct from old.cost
      or new.source_metadata is distinct from old.source_metadata
    ) then
    raise exception 'Inventory setup is locked. Use the Year-end audit CSV to change this SKU.';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_locked_inventory_setup_changes on public.inventory_skus;
create trigger prevent_locked_inventory_setup_changes
before update on public.inventory_skus
for each row execute function public.prevent_locked_inventory_setup_changes();

create or replace function public.sync_recipe_parent_disposition()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  bundle_id uuid := coalesce(new.bundle_sku_id, old.bundle_sku_id);
  bundle record;
begin
  select * into bundle from public.inventory_skus where id = bundle_id for update;
  if bundle.id is null then
    return coalesce(new, old);
  end if;
  if coalesce(bundle.source_metadata->>'setup_locked', 'false') = 'true'
    and coalesce(current_setting('bead.inventory_audit_mode', true), 'false') <> 'true' then
    raise exception 'Inventory setup is locked. Use the Year-end audit CSV to change this SKU.';
  end if;
  if exists (select 1 from public.inventory_bundle_components where bundle_sku_id = bundle_id) then
    update public.inventory_skus
    set item_type = 'Non-inventory',
        hierarchy = 'Parent',
        source_metadata = coalesce(source_metadata, '{}'::jsonb)
          || jsonb_build_object('disposition', 'recipe_parent', 'disposition_updated_at', timezone('utc', now())),
        updated_at = timezone('utc', now())
    where id = bundle_id;
  elsif tg_op = 'DELETE' then
    update public.inventory_skus
    set item_type = 'Inventory',
        hierarchy = null,
        source_metadata = (coalesce(source_metadata, '{}'::jsonb) - 'predetermined_inventory_sku')
          || jsonb_build_object('disposition', 'unresolved', 'disposition_updated_at', timezone('utc', now())),
        updated_at = timezone('utc', now())
    where id = bundle_id;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists sync_recipe_parent_disposition on public.inventory_bundle_components;
create trigger sync_recipe_parent_disposition
after insert or update or delete on public.inventory_bundle_components
for each row execute function public.sync_recipe_parent_disposition();

create or replace function public.apply_inventory_audit_complete(audit_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public, private
as $$
declare
  audit_row jsonb;
  updated_count integer;
  inventory_id uuid;
  disposition_value text;
  predetermined_sku text;
begin
  if not private.is_admin() then
    raise exception 'Admin access required.';
  end if;
  perform set_config('bead.inventory_audit_mode', 'true', true);
  updated_count := public.apply_inventory_audit(audit_rows);
  for audit_row in select value from jsonb_array_elements(audit_rows) as entries(value)
  loop
    select id into inventory_id
    from public.inventory_skus
    where lower(trim(sku)) = lower(trim(audit_row->>'sku'))
    limit 1;
    disposition_value := nullif(trim(audit_row->>'disposition'), '');
    predetermined_sku := nullif(trim(audit_row->>'predetermined_inventory_sku'), '');
    if inventory_id is null or disposition_value is null then
      raise exception 'Every audit row needs a valid disposition.';
    end if;
    perform public.apply_inventory_sku_disposition(inventory_id, disposition_value, predetermined_sku);
  end loop;
  return updated_count;
end;
$$;

revoke all on function public.prevent_locked_inventory_setup_changes() from public, anon, authenticated;
revoke all on function public.sync_recipe_parent_disposition() from public, anon, authenticated;
revoke all on function public.apply_inventory_audit_complete(jsonb) from public, anon;
grant execute on function public.apply_inventory_audit_complete(jsonb) to authenticated;
