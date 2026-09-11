create table if not exists public.inventory_bundle_components (
  id uuid primary key default gen_random_uuid(),
  bundle_sku_id uuid not null references public.inventory_skus(id) on delete cascade,
  component_sku_id uuid not null references public.inventory_skus(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (bundle_sku_id, component_sku_id),
  check (bundle_sku_id <> component_sku_id)
);

create index if not exists inventory_bundle_components_bundle_idx
  on public.inventory_bundle_components(bundle_sku_id, sort_order);

create index if not exists inventory_bundle_components_component_idx
  on public.inventory_bundle_components(component_sku_id);

alter table public.inventory_bundle_components enable row level security;

drop policy if exists inventory_bundle_components_admin_all on public.inventory_bundle_components;
create policy inventory_bundle_components_admin_all on public.inventory_bundle_components
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

drop policy if exists inventory_bundle_components_storefront_read on public.inventory_bundle_components;
create policy inventory_bundle_components_storefront_read on public.inventory_bundle_components
  for select to anon, authenticated
  using (true);

grant select on public.inventory_bundle_components to anon, authenticated;
grant insert, update, delete on public.inventory_bundle_components to authenticated;

create or replace function public.expand_inventory_sku(requested_sku text, requested_units integer default 1)
returns table(component_sku text, quantity integer)
language sql
stable
set search_path = public
as $$
  with recursive expansion(sku, required_quantity, path) as (
    select trim(requested_sku), greatest(1, requested_units), array[trim(requested_sku)]::text[]
    where nullif(trim(requested_sku), '') is not null
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

create or replace function public.expand_inventory_order(order_lines jsonb)
returns table(component_sku text, quantity integer)
language sql
stable
set search_path = public
as $$
  select expanded.component_sku, sum(expanded.quantity)::integer
  from jsonb_to_recordset(coalesce(order_lines, '[]'::jsonb)) as line(sku text, quantity integer)
  cross join lateral public.expand_inventory_sku(line.sku, greatest(1, coalesce(line.quantity, 1))) expanded
  group by expanded.component_sku
  order by expanded.component_sku;
$$;

grant execute on function public.expand_inventory_order(jsonb) to anon, authenticated;

alter table public.inventory_bundle_components
  add column if not exists bundle_sku text,
  add column if not exists component_sku text;

update public.inventory_bundle_components recipe
set bundle_sku = bundle.sku,
    component_sku = component.sku
from public.inventory_skus bundle,
     public.inventory_skus component
where recipe.bundle_sku_id = bundle.id
  and recipe.component_sku_id = component.id;

alter table public.inventory_bundle_components
  alter column bundle_sku set not null,
  alter column component_sku set not null;

create or replace function public.sync_inventory_bundle_component_skus()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.bundle_sku := (select sku from public.inventory_skus where id = new.bundle_sku_id);
  new.component_sku := (select sku from public.inventory_skus where id = new.component_sku_id);
  return new;
end;
$$;

revoke all on function public.sync_inventory_bundle_component_skus() from public;

drop trigger if exists sync_inventory_bundle_component_skus_before_write
  on public.inventory_bundle_components;
create trigger sync_inventory_bundle_component_skus_before_write
before insert or update of bundle_sku_id, component_sku_id
on public.inventory_bundle_components
for each row execute function public.sync_inventory_bundle_component_skus();

create or replace function public.sync_inventory_bundle_component_sku_names()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.sku is distinct from old.sku then
    update public.inventory_bundle_components
    set bundle_sku = case when bundle_sku_id = new.id then new.sku else bundle_sku end,
        component_sku = case when component_sku_id = new.id then new.sku else component_sku end,
        updated_at = timezone('utc', now())
    where bundle_sku_id = new.id or component_sku_id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.sync_inventory_bundle_component_sku_names() from public;

drop trigger if exists sync_inventory_bundle_component_sku_names_after_update
  on public.inventory_skus;
create trigger sync_inventory_bundle_component_sku_names_after_update
after update of sku on public.inventory_skus
for each row execute function public.sync_inventory_bundle_component_sku_names();

grant select on public.inventory_bundle_components to anon, authenticated;
