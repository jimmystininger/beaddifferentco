create table public.inventory_sku_vendors (
  id uuid primary key default gen_random_uuid(),
  inventory_sku_id uuid not null references public.inventory_skus(id) on delete cascade,
  vendor_name text not null check (length(trim(vendor_name)) > 0),
  vendor_reorder_number text,
  vendor_product_image_path text,
  is_preferred boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index inventory_sku_vendors_name_idx
  on public.inventory_sku_vendors (inventory_sku_id, lower(trim(vendor_name)));
create unique index inventory_sku_vendors_one_preferred_idx
  on public.inventory_sku_vendors (inventory_sku_id)
  where is_preferred;
create index inventory_sku_vendors_sku_idx
  on public.inventory_sku_vendors (inventory_sku_id);

alter table public.inventory_sku_vendors enable row level security;
revoke all on public.inventory_sku_vendors from public, anon, authenticated;

create policy inventory_sku_vendors_admin_select
  on public.inventory_sku_vendors for select to authenticated
  using ((select private.is_admin()));

grant select on public.inventory_sku_vendors to authenticated;

insert into public.inventory_sku_vendors (
  inventory_sku_id,
  vendor_name,
  vendor_reorder_number,
  vendor_product_image_path,
  is_preferred
)
select
  i.id,
  coalesce(nullif(trim(i.preferred_vendor), ''), 'Unassigned vendor'),
  i.vendor_reorder_number,
  i.vendor_product_image_path,
  nullif(trim(i.preferred_vendor), '') is not null
from public.inventory_skus i
where nullif(trim(i.preferred_vendor), '') is not null
   or nullif(trim(i.vendor_reorder_number), '') is not null
   or nullif(trim(i.vendor_product_image_path), '') is not null
on conflict (inventory_sku_id, (lower(trim(vendor_name)))) do nothing;

create or replace function private.sync_inventory_sku_vendor_option()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  matched_option public.inventory_sku_vendors%rowtype;
begin
  if new.preferred_vendor is distinct from old.preferred_vendor then
    select * into matched_option
    from public.inventory_sku_vendors
    where inventory_sku_id = new.id
      and lower(trim(vendor_name)) = lower(trim(new.preferred_vendor))
    limit 1;
    if found then
      new.vendor_reorder_number := matched_option.vendor_reorder_number;
      new.vendor_product_image_path := matched_option.vendor_product_image_path;
    else
      new.vendor_reorder_number := null;
      new.vendor_product_image_path := null;
    end if;
  end if;
  return new;
end;
$function$;

create or replace function private.persist_inventory_sku_vendor_option()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  option_id uuid;
begin
  if new.preferred_vendor is null or length(trim(new.preferred_vendor)) = 0 then
    update public.inventory_sku_vendors
    set is_preferred = false, updated_at = timezone('utc', now())
    where inventory_sku_id = new.id and is_preferred;
    return new;
  end if;

  update public.inventory_sku_vendors
  set is_preferred = false, updated_at = timezone('utc', now())
  where inventory_sku_id = new.id
    and is_preferred
    and lower(trim(vendor_name)) <> lower(trim(new.preferred_vendor));

  select id into option_id
  from public.inventory_sku_vendors
  where inventory_sku_id = new.id
    and lower(trim(vendor_name)) = lower(trim(new.preferred_vendor))
  limit 1;

  if option_id is null then
    insert into public.inventory_sku_vendors (
      inventory_sku_id, vendor_name, vendor_reorder_number,
      vendor_product_image_path, is_preferred
    ) values (
      new.id, trim(new.preferred_vendor), new.vendor_reorder_number,
      new.vendor_product_image_path, true
    );
  else
    update public.inventory_sku_vendors
    set vendor_name = trim(new.preferred_vendor),
        vendor_reorder_number = new.vendor_reorder_number,
        vendor_product_image_path = new.vendor_product_image_path,
        is_preferred = true,
        updated_at = timezone('utc', now())
    where id = option_id;
  end if;
  return new;
end;
$function$;

create trigger inventory_skus_sync_vendor_option_before
  before update of preferred_vendor on public.inventory_skus
  for each row
  when (new.preferred_vendor is distinct from old.preferred_vendor)
  execute function private.sync_inventory_sku_vendor_option();

create trigger inventory_skus_sync_vendor_option_after
  after update of preferred_vendor, vendor_reorder_number, vendor_product_image_path
  on public.inventory_skus
  for each row
  when (
    new.preferred_vendor is distinct from old.preferred_vendor
    or new.vendor_reorder_number is distinct from old.vendor_reorder_number
    or new.vendor_product_image_path is distinct from old.vendor_product_image_path
  )
  execute function private.persist_inventory_sku_vendor_option();

create or replace function public.admin_replace_inventory_sku_vendors(
  p_inventory_sku_id uuid,
  p_vendors jsonb
)
returns setof public.inventory_sku_vendors
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  preferred_count integer;
  preferred_option jsonb;
begin
  if not private.is_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_vendors, '[]'::jsonb)) <> 'array' then
    raise exception 'Vendor options must be provided as a list.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.inventory_skus where id = p_inventory_sku_id) then
    raise exception 'Canonical inventory SKU was not found.' using errcode = 'P0002';
  end if;

  select count(*) into preferred_count
  from jsonb_array_elements(coalesce(p_vendors, '[]'::jsonb)) as item
  where coalesce((item->>'is_preferred')::boolean, false);
  if preferred_count > 1 then
    raise exception 'Only one vendor can be preferred for a SKU.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_vendors, '[]'::jsonb)) as item
    group by lower(trim(coalesce(item->>'vendor_name', '')))
    having count(*) > 1 or length(trim(coalesce(item->>'vendor_name', ''))) = 0
  ) then
    raise exception 'Vendor names must be non-empty and unique for this SKU.' using errcode = '22023';
  end if;

  delete from public.inventory_sku_vendors where inventory_sku_id = p_inventory_sku_id;
  insert into public.inventory_sku_vendors (
    id, inventory_sku_id, vendor_name, vendor_reorder_number,
    vendor_product_image_path, is_preferred
  )
  select
    coalesce(nullif(item->>'id', '')::uuid, gen_random_uuid()),
    p_inventory_sku_id,
    trim(item->>'vendor_name'),
    nullif(trim(item->>'vendor_reorder_number'), ''),
    nullif(trim(item->>'vendor_product_image_path'), ''),
    coalesce((item->>'is_preferred')::boolean, false)
  from jsonb_array_elements(coalesce(p_vendors, '[]'::jsonb)) as item;

  select item into preferred_option
  from jsonb_array_elements(coalesce(p_vendors, '[]'::jsonb)) as item
  where coalesce((item->>'is_preferred')::boolean, false)
  limit 1;

  update public.inventory_skus
  set preferred_vendor = nullif(trim(preferred_option->>'vendor_name'), ''),
      vendor_reorder_number = nullif(trim(preferred_option->>'vendor_reorder_number'), ''),
      vendor_product_image_path = nullif(trim(preferred_option->>'vendor_product_image_path'), ''),
      updated_at = timezone('utc', now())
  where id = p_inventory_sku_id;

  return query
  select v.* from public.inventory_sku_vendors v
  where v.inventory_sku_id = p_inventory_sku_id
  order by v.is_preferred desc, lower(v.vendor_name), v.id;
end;
$function$;

revoke all on function private.sync_inventory_sku_vendor_option() from public, anon, authenticated;
revoke all on function private.persist_inventory_sku_vendor_option() from public, anon, authenticated;
revoke all on function public.admin_replace_inventory_sku_vendors(uuid, jsonb) from public, anon;
grant execute on function public.admin_replace_inventory_sku_vendors(uuid, jsonb) to authenticated, service_role;

