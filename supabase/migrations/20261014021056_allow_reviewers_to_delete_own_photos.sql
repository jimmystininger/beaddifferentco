drop policy if exists review_media_authenticated_delete on storage.objects;
create policy review_media_authenticated_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'product-media'
    and name like 'reviews/' || (select auth.uid())::text || '/%'
  );
