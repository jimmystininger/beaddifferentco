grant select, insert, update, delete on public.site_settings to authenticated;

drop policy if exists site_settings_admin_all on public.site_settings;
create policy site_settings_admin_all
on public.site_settings
for all
to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));
