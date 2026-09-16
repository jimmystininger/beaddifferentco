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
        inventory.source_metadata->>'allocation_mode' = 'manual'
        or lower(coalesce(inventory.sku, '')) ~ '(mix|random|assort)'
        or lower(coalesce(inventory.name, '')) ~ '(mix|random|assort)'
      )
  );
$$;

revoke all on function public.is_manual_inventory_allocation_sku(text) from public, anon, authenticated;

create or replace function public.expand_inventory_sku(requested_sku text, requested_units integer default 1)
returns table(component_sku text, quantity integer)
language sql
stable
set search_path = public
as $$
  with recursive expansion(sku, required_quantity, path) as (
    select trim(requested_sku), greatest(1, requested_units), array[trim(requested_sku)]::text[]
    where nullif(trim(requested_sku), '') is not null
      and not public.is_manual_inventory_allocation_sku(requested_sku)
    union all
    select component.sku,
           expansion.required_quantity * recipe.quantity,
           expansion.path || component.sku
    from expansion
    join public.inventory_skus bundle on bundle.sku = expansion.sku
    join public.inventory_bundle_components recipe on recipe.bundle_sku_id = bundle.id
    join public.inventory_skus component on component.id = recipe.component_sku_id
    where not component.sku = any(expansion.path)
  ),
  leaves as (
    select expansion.sku, expansion.required_quantity
    from expansion
    where not exists (
      select 1
      from public.inventory_skus bundle
      join public.inventory_bundle_components recipe on recipe.bundle_sku_id = bundle.id
      where bundle.sku = expansion.sku
    )
  )
  select leaves.sku, sum(leaves.required_quantity)::integer
  from leaves
  group by leaves.sku
  order by leaves.sku;
$$;

grant execute on function public.expand_inventory_sku(text, integer) to anon, authenticated;

create or replace function public.queue_manual_website_pack_allocation()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if public.is_manual_inventory_allocation_sku(new.sku) then
    insert into public.inventory_manual_pack_allocations (
      source_type, order_item_id, parent_sku, units, created_by
    ) values (
      'website', new.id, new.sku, new.quantity, auth.uid()
    ) on conflict (order_item_id) do update
      set parent_sku = excluded.parent_sku,
          units = excluded.units,
          status = case when inventory_manual_pack_allocations.status = 'applied' then 'applied' else 'pending' end;
  end if;
  return new;
end;
$$;

revoke all on function public.queue_manual_website_pack_allocation() from public, anon, authenticated;
