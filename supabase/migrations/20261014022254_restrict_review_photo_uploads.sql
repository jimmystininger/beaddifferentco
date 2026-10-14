insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('review-photos', 'review-photos', true, 15728640, array['image/jpeg']::text[])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists review_media_authenticated_insert on storage.objects;
create policy review_media_authenticated_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'review-photos'
    and name like 'reviews/' || (select auth.uid())::text || '/%'
  );

drop policy if exists review_media_authenticated_select on storage.objects;
create policy review_media_authenticated_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'review-photos'
    and name like 'reviews/' || (select auth.uid())::text || '/%'
  );

drop policy if exists review_media_authenticated_delete on storage.objects;
create policy review_media_authenticated_delete on storage.objects
  for delete to authenticated
  using (
    (bucket_id = 'review-photos' or bucket_id = 'product-media')
    and name like 'reviews/' || (select auth.uid())::text || '/%'
  );
