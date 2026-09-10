alter table public.products
  add column if not exists promo_price numeric,
  add column if not exists promo_starts_at timestamptz,
  add column if not exists promo_ends_at timestamptz;

alter table public.product_images
  add column if not exists media_type text not null default 'image';

alter table public.product_images
  drop constraint if exists product_images_media_type_check;

alter table public.product_images
  add constraint product_images_media_type_check
  check (media_type in ('image', 'video'));

create or replace function public.refresh_product_search_text()
returns trigger
language plpgsql
as $$
begin
  new.search_text := concat_ws(' ', new.name, new.seo_title, new.description, new.item_details, new.shipping_details);
  return new;
end;
$$;

drop trigger if exists products_refresh_search_text on public.products;
create trigger products_refresh_search_text
before insert or update of name, seo_title, description, item_details, shipping_details
on public.products
for each row execute function public.refresh_product_search_text();

update public.products
set search_text = concat_ws(' ', name, seo_title, description, item_details, shipping_details);

insert into storage.buckets (id, name, public)
values ('product-media', 'product-media', true)
on conflict (id) do update set public = true;

drop policy if exists product_media_public_read on storage.objects;
create policy product_media_public_read
on storage.objects for select
to public
using (bucket_id = 'product-media');

drop policy if exists product_media_admin_insert on storage.objects;
create policy product_media_admin_insert
on storage.objects for insert
to authenticated
with check (bucket_id = 'product-media' and (select private.is_admin()));

drop policy if exists product_media_admin_update on storage.objects;
create policy product_media_admin_update
on storage.objects for update
to authenticated
using (bucket_id = 'product-media' and (select private.is_admin()))
with check (bucket_id = 'product-media' and (select private.is_admin()));

drop policy if exists product_media_admin_delete on storage.objects;
create policy product_media_admin_delete
on storage.objects for delete
to authenticated
using (bucket_id = 'product-media' and (select private.is_admin()));
