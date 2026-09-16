create or replace function public.enforce_inventory_bundle_component_types()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  bundle_item_type text;
  component_item_type text;
begin
  select lower(coalesce(item_type, 'inventory'))
    into bundle_item_type
    from public.inventory_skus
   where id = new.bundle_sku_id;

  if bundle_item_type = 'non-inventory' then
    raise exception 'Bundle recipe rejected: bundle SKU must be an inventory SKU, not an Etsy mapping.';
  end if;

  select lower(coalesce(item_type, 'inventory'))
    into component_item_type
    from public.inventory_skus
   where id = new.component_sku_id;

  if component_item_type = 'non-inventory' then
    raise exception 'Bundle recipe rejected: component SKU must be an inventory SKU, not an Etsy mapping.';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_inventory_bundle_component_types() from public, anon, authenticated;

drop trigger if exists inventory_bundle_components_inventory_only on public.inventory_bundle_components;

create trigger inventory_bundle_components_inventory_only
before insert or update of bundle_sku_id, component_sku_id
on public.inventory_bundle_components
for each row
execute function public.enforce_inventory_bundle_component_types();

create or replace function public.enforce_inventory_purchase_line_inventory_type()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  item_type_value text;
begin
  select lower(coalesce(item_type, 'inventory'))
    into item_type_value
    from public.inventory_skus
   where id = new.inventory_sku_id;

  if item_type_value is null then
    raise exception 'Purchase rejected: SKU is not present in canonical inventory.';
  end if;

  if item_type_value = 'non-inventory' then
    raise exception 'Purchase rejected: SKU is an Etsy mapping/non-inventory SKU. Create or choose an inventory SKU first.';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_inventory_purchase_line_inventory_type() from public, anon, authenticated;

drop trigger if exists inventory_purchase_lines_inventory_only on public.inventory_purchase_lines;

create trigger inventory_purchase_lines_inventory_only
before insert or update of inventory_sku_id
on public.inventory_purchase_lines
for each row
execute function public.enforce_inventory_purchase_line_inventory_type();
