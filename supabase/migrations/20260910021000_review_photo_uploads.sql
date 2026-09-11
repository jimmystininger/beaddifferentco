alter table public.reviews
  add column if not exists photos text[] not null default '{}';

drop policy if exists review_media_authenticated_insert on storage.objects;
create policy review_media_authenticated_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'product-media'
    and (name like 'reviews/' || (select auth.uid())::text || '/%')
  );
