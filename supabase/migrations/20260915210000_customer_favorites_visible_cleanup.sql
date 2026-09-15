delete from public.customer_favorites favorites
using public.products products
where favorites.product_id = products.id
  and products.visible is false;

create or replace function private.remove_hidden_product_favorites()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  if new.visible is false and old.visible is distinct from new.visible then
    delete from public.customer_favorites
    where product_id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function private.remove_hidden_product_favorites() from public, anon, authenticated;

drop trigger if exists remove_hidden_product_favorites on public.products;
create trigger remove_hidden_product_favorites
after update of visible on public.products
for each row
when (old.visible is distinct from new.visible and new.visible is false)
execute function private.remove_hidden_product_favorites();
