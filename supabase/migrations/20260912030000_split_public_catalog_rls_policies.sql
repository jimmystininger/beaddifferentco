drop policy if exists categories_public_read on public.categories;
create policy categories_public_read on public.categories
  for select to anon, authenticated
  using (active);

drop policy if exists categories_admin_read on public.categories;
create policy categories_admin_read on public.categories
  for select to authenticated
  using ((select private.is_admin()));

drop policy if exists products_public_read on public.products;
create policy products_public_read on public.products
  for select to anon, authenticated
  using (visible);

drop policy if exists products_admin_read on public.products;
create policy products_admin_read on public.products
  for select to authenticated
  using ((select private.is_admin()));

drop policy if exists product_images_public_read on public.product_images;
create policy product_images_public_read on public.product_images
  for select to anon, authenticated
  using (exists (
    select 1
    from public.products p
    where p.id = product_id
      and p.visible
  ));

drop policy if exists product_images_admin_read on public.product_images;
create policy product_images_admin_read on public.product_images
  for select to authenticated
  using ((select private.is_admin()));

drop policy if exists product_options_public_read on public.product_options;
create policy product_options_public_read on public.product_options
  for select to anon, authenticated
  using (exists (
    select 1
    from public.products p
    where p.id = product_id
      and p.visible
  ));

drop policy if exists product_options_admin_read on public.product_options;
create policy product_options_admin_read on public.product_options
  for select to authenticated
  using ((select private.is_admin()));

drop policy if exists option_values_public_read on public.product_option_values;
create policy option_values_public_read on public.product_option_values
  for select to anon, authenticated
  using (exists (
    select 1
    from public.product_options o
    join public.products p on p.id = o.product_id
    where o.id = option_id
      and p.visible
  ));

drop policy if exists option_values_admin_read on public.product_option_values;
create policy option_values_admin_read on public.product_option_values
  for select to authenticated
  using ((select private.is_admin()));

drop policy if exists reviews_public_read on public.reviews;
create policy reviews_public_read on public.reviews
  for select to anon, authenticated
  using (status = 'approved');

drop policy if exists reviews_self_read on public.reviews;
create policy reviews_self_read on public.reviews
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists reviews_admin_read on public.reviews;
create policy reviews_admin_read on public.reviews
  for select to authenticated
  using ((select private.is_admin()));

drop policy if exists promo_public_read on public.promo_codes;
create policy promo_public_read on public.promo_codes
  for select to anon, authenticated
  using (
    mode = 'auto'
    and active
    and (starts_at is null or starts_at <= timezone('utc', now()))
    and (ends_at is null or ends_at >= timezone('utc', now()))
  );

drop policy if exists promo_admin_read on public.promo_codes;
create policy promo_admin_read on public.promo_codes
  for select to authenticated
  using ((select private.is_admin()));
