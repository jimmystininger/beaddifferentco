create or replace function public.is_manual_inventory_allocation_sku(requested_sku text)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.inventory_skus inventory
    where lower(trim(inventory.sku)) = lower(trim(coalesce(requested_sku, '')))
      and (
        inventory.source_metadata->>'disposition' = 'unresolved'
        or inventory.source_metadata->>'allocation_mode' = 'manual'
        or (
          coalesce(inventory.source_metadata->>'disposition', '') = ''
          and (
            lower(coalesce(inventory.sku, '')) ~ '(mix|random|assort)'
            or lower(coalesce(inventory.name, '')) ~ '(mix|random|assort)'
          )
        )
      )
  );
$$;

revoke all on function public.is_manual_inventory_allocation_sku(text) from public, anon, authenticated;

create or replace function private.validate_stripe_order_item()
returns trigger
language plpgsql
set search_path = public, private
as $$
declare
  parent_order public.orders%rowtype;
begin
  select * into parent_order from public.orders where id = new.order_id;
  if parent_order.payment_provider <> 'stripe' or parent_order.payment_status <> 'pending' then
    return new;
  end if;
  if not exists (
    select 1
    from public.products product
    join public.product_options option_row on option_row.product_id = product.id
    join public.product_option_values option_value on option_value.option_id = option_row.id
    join public.inventory_skus inventory on inventory.id = option_value.inventory_sku_id
    where product.id = new.product_id
      and product.visible
      and inventory.sku = new.inventory_sku
      and option_value.inventory_units = new.inventory_units
  ) then
    raise exception 'The selected SKU is not an available option for this product.';
  end if;
  if exists (
    select 1
    from public.inventory_skus inventory
    where inventory.sku = new.inventory_sku
      and lower(coalesce(inventory.item_type, 'inventory')) <> 'non-inventory'
  ) and not exists (
    select 1
    from public.expand_inventory_sku(new.inventory_sku, new.quantity * greatest(1, new.inventory_units)) expanded
    join public.inventory_skus component on component.sku = expanded.component_sku
    where lower(coalesce(component.item_type, 'inventory')) <> 'non-inventory'
  ) then
    raise exception 'Inventory for SKU % cannot be tracked at checkout.', new.inventory_sku;
  end if;
  return new;
end;
$$;

revoke all on function private.validate_stripe_order_item() from public, anon, authenticated;
