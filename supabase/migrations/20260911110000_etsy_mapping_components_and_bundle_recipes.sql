create table if not exists public.product_etsy_mapping_components (
  id uuid primary key default gen_random_uuid(),
  mapping_id uuid not null references public.product_etsy_mappings(id) on delete cascade,
  inventory_sku_id uuid not null references public.inventory_skus(id) on delete restrict,
  inventory_sku text not null,
  inventory_units integer not null default 1 check (inventory_units > 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique(mapping_id, inventory_sku_id)
);

create index if not exists product_etsy_mapping_components_mapping_idx
  on public.product_etsy_mapping_components(mapping_id, sort_order);

create index if not exists product_etsy_mapping_components_sku_idx
  on public.product_etsy_mapping_components(inventory_sku_id);

alter table public.product_etsy_mapping_components enable row level security;

drop policy if exists product_etsy_mapping_components_admin_all on public.product_etsy_mapping_components;
create policy product_etsy_mapping_components_admin_all on public.product_etsy_mapping_components
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

grant select, insert, update, delete on public.product_etsy_mapping_components to authenticated;

insert into public.product_etsy_mapping_components (mapping_id, inventory_sku_id, inventory_sku, inventory_units, sort_order)
select m.id, m.inventory_sku_id, m.inventory_sku, m.inventory_units, 0
from public.product_etsy_mappings m
where m.inventory_sku_id is not null
on conflict (mapping_id, inventory_sku_id) do nothing;

create or replace function public.sync_product_etsy_mapping_component_sku()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.inventory_sku := (select sku from public.inventory_skus where id = new.inventory_sku_id);
  return new;
end;
$$;

revoke all on function public.sync_product_etsy_mapping_component_sku() from public;

drop trigger if exists sync_product_etsy_mapping_component_sku_before_write
  on public.product_etsy_mapping_components;
create trigger sync_product_etsy_mapping_component_sku_before_write
before insert or update of inventory_sku_id
on public.product_etsy_mapping_components
for each row execute function public.sync_product_etsy_mapping_component_sku();

create or replace function public.sync_product_etsy_mapping_component_sku_names()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.sku is distinct from old.sku then
    update public.product_etsy_mapping_components
    set inventory_sku = new.sku,
        updated_at = timezone('utc', now())
    where inventory_sku_id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.sync_product_etsy_mapping_component_sku_names() from public;

drop trigger if exists sync_product_etsy_mapping_component_sku_names_after_update
  on public.inventory_skus;
create trigger sync_product_etsy_mapping_component_sku_names_after_update
after update of sku
on public.inventory_skus
for each row execute function public.sync_product_etsy_mapping_component_sku_names();
