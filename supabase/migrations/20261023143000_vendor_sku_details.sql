alter table public.inventory_skus
  add column if not exists vendor_reorder_number text,
  add column if not exists vendor_product_image_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vendor-product-images', 'vendor-product-images', false, 10485760, array['image/webp']::text[])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists vendor_product_images_admin_select on storage.objects;
create policy vendor_product_images_admin_select on storage.objects
  for select to authenticated
  using (bucket_id = 'vendor-product-images' and (select private.is_admin()));

drop policy if exists vendor_product_images_admin_insert on storage.objects;
create policy vendor_product_images_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'vendor-product-images' and (select private.is_admin()));

drop policy if exists vendor_product_images_admin_update on storage.objects;
create policy vendor_product_images_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'vendor-product-images' and (select private.is_admin()))
  with check (bucket_id = 'vendor-product-images' and (select private.is_admin()));

drop policy if exists vendor_product_images_admin_delete on storage.objects;
create policy vendor_product_images_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'vendor-product-images' and (select private.is_admin()));

create or replace function public.admin_inventory_vendor_report_page(
  p_mode text default 'low',
  p_page integer default 1,
  p_page_size integer default 25
)
returns table(
  id uuid,
  sku text,
  name text,
  quantity_on_hand numeric,
  reorder_point numeric,
  reserve_quantity numeric,
  item_type text,
  category text,
  price numeric,
  cost numeric,
  preferred_vendor text,
  vendor_reorder_number text,
  vendor_product_image_path text,
  total_count bigint
)
language sql
stable
security definer
set search_path to 'public', 'private'
as $function$
  with filtered as (
    select
      i.id,
      i.sku,
      i.name,
      i.quantity_on_hand,
      i.reorder_point,
      i.reserve_quantity,
      i.item_type,
      i.category,
      i.price,
      i.cost,
      i.preferred_vendor,
      i.vendor_reorder_number,
      i.vendor_product_image_path,
      count(*) over ()::bigint as total_count
    from public.inventory_skus i
    where private.is_admin()
      and lower(coalesce(i.item_type, 'inventory')) <> 'non-inventory'
      and coalesce(i.discontinued, false) = false
      and lower(coalesce(p_mode, 'low')) = 'low'
      and greatest(0, coalesce(i.quantity_on_hand, 0) - coalesce(i.reserve_quantity, 0)) <= coalesce(i.reorder_point, 0)
    order by lower(coalesce(i.name, i.sku)), lower(i.sku), i.id
  )
  select
    f.id,
    f.sku,
    f.name,
    f.quantity_on_hand::numeric,
    f.reorder_point::numeric,
    f.reserve_quantity::numeric,
    f.item_type,
    f.category,
    f.price::numeric,
    f.cost::numeric,
    f.preferred_vendor,
    f.vendor_reorder_number,
    f.vendor_product_image_path,
    f.total_count
  from filtered f
  offset greatest(0, (coalesce(p_page, 1) - 1) * least(greatest(coalesce(p_page_size, 25), 1), 100))
  limit least(greatest(coalesce(p_page_size, 25), 1), 100);
$function$;

revoke all on function public.admin_inventory_vendor_report_page(text, integer, integer) from public, anon;
grant execute on function public.admin_inventory_vendor_report_page(text, integer, integer) to authenticated, service_role;
