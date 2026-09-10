create policy profiles_select_self on public.profiles for select to authenticated using ((select auth.uid()) = id or (select private.is_admin()));
create policy profiles_insert_self on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy profiles_update_self on public.profiles for update to authenticated using ((select auth.uid()) = id or (select private.is_admin())) with check ((select auth.uid()) = id or (select private.is_admin()));

create policy categories_public_read on public.categories for select to anon, authenticated using (active or (select private.is_admin()));
create policy categories_admin_insert on public.categories for insert to authenticated with check ((select private.is_admin()));
create policy categories_admin_update on public.categories for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy categories_admin_delete on public.categories for delete to authenticated using ((select private.is_admin()));

create policy products_public_read on public.products for select to anon, authenticated using (visible or (select private.is_admin()));
create policy products_admin_insert on public.products for insert to authenticated with check ((select private.is_admin()));
create policy products_admin_update on public.products for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy products_admin_delete on public.products for delete to authenticated using ((select private.is_admin()));

create policy product_images_public_read on public.product_images for select to anon, authenticated using (exists (select 1 from public.products p where p.id = product_id and (p.visible or (select private.is_admin()))));
create policy product_images_admin_insert on public.product_images for insert to authenticated with check ((select private.is_admin()));
create policy product_images_admin_update on public.product_images for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy product_images_admin_delete on public.product_images for delete to authenticated using ((select private.is_admin()));

create policy product_options_public_read on public.product_options for select to anon, authenticated using (exists (select 1 from public.products p where p.id = product_id and (p.visible or (select private.is_admin()))));
create policy product_options_admin_insert on public.product_options for insert to authenticated with check ((select private.is_admin()));
create policy product_options_admin_update on public.product_options for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy product_options_admin_delete on public.product_options for delete to authenticated using ((select private.is_admin()));

create policy option_values_public_read on public.product_option_values for select to anon, authenticated using (exists (select 1 from public.product_options o join public.products p on p.id = o.product_id where o.id = option_id and (p.visible or (select private.is_admin()))));
create policy option_values_admin_insert on public.product_option_values for insert to authenticated with check ((select private.is_admin()));
create policy option_values_admin_update on public.product_option_values for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy option_values_admin_delete on public.product_option_values for delete to authenticated using ((select private.is_admin()));

create policy waitlist_self_read on public.waitlist_entries for select to authenticated using ((select auth.uid()) = user_id or (select private.is_admin()));
create policy waitlist_self_insert on public.waitlist_entries for insert to authenticated with check ((select auth.uid()) = user_id);
create policy waitlist_self_update on public.waitlist_entries for update to authenticated using ((select auth.uid()) = user_id or (select private.is_admin())) with check ((select auth.uid()) = user_id or (select private.is_admin()));
create policy waitlist_admin_delete on public.waitlist_entries for delete to authenticated using ((select private.is_admin()));

create policy reviews_public_read on public.reviews for select to anon, authenticated using (status = 'approved' or (select auth.uid()) = user_id or (select private.is_admin()));
create policy reviews_self_insert on public.reviews for insert to authenticated with check ((select auth.uid()) = user_id);
create policy reviews_self_update on public.reviews for update to authenticated using ((select auth.uid()) = user_id or (select private.is_admin())) with check ((select auth.uid()) = user_id or (select private.is_admin()));
create policy reviews_admin_delete on public.reviews for delete to authenticated using ((select private.is_admin()));

create policy promo_public_read on public.promo_codes for select to anon, authenticated using ((mode = 'auto' and active and (starts_at is null or starts_at <= timezone('utc', now())) and (ends_at is null or ends_at >= timezone('utc', now()))) or (select private.is_admin()));
create policy promo_admin_insert on public.promo_codes for insert to authenticated with check ((select private.is_admin()));
create policy promo_admin_update on public.promo_codes for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy promo_admin_delete on public.promo_codes for delete to authenticated using ((select private.is_admin()));

create policy orders_self_read on public.orders for select to authenticated using ((select auth.uid()) = user_id or (select private.is_admin()));
create policy orders_self_insert on public.orders for insert to authenticated with check ((select auth.uid()) = user_id);
create policy orders_self_update on public.orders for update to authenticated using ((select auth.uid()) = user_id or (select private.is_admin())) with check ((select auth.uid()) = user_id or (select private.is_admin()));
create policy orders_admin_delete on public.orders for delete to authenticated using ((select private.is_admin()));
create policy order_items_self_read on public.order_items for select to authenticated using (exists (select 1 from public.orders o where o.id = order_id and (o.user_id = (select auth.uid()) or (select private.is_admin()))));
create policy order_items_insert on public.order_items for insert to authenticated with check (exists (select 1 from public.orders o where o.id = order_id and (o.user_id = (select auth.uid()) or (select private.is_admin()))));
create policy order_items_admin_update on public.order_items for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy order_items_admin_delete on public.order_items for delete to authenticated using ((select private.is_admin()));

create policy member_notes_admin_all on public.member_notes for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
