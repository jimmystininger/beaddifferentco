grant select on public.etsy_import_sales to authenticated;

drop policy if exists etsy_import_sales_admin_select on public.etsy_import_sales;
create policy etsy_import_sales_admin_select
on public.etsy_import_sales
for select
to authenticated
using ((select private.is_admin()));
