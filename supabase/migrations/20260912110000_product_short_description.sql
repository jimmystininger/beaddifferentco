alter table public.products
  add column if not exists short_description text;

create or replace function public.refresh_product_search_text()
returns trigger
language plpgsql
as $$
begin
  new.search_text := concat_ws(' ', new.name, new.seo_title, new.short_description, new.description, new.item_details, new.shipping_details);
  return new;
end;
$$;

drop trigger if exists products_refresh_search_text on public.products;
create trigger products_refresh_search_text
before insert or update of name, seo_title, short_description, description, item_details, shipping_details
on public.products
for each row execute function public.refresh_product_search_text();

update public.products
set search_text = concat_ws(' ', name, seo_title, short_description, description, item_details, shipping_details);
