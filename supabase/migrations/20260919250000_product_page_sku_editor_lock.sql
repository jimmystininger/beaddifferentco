alter table public.products
  add column if not exists sku_editor_locked boolean not null default false;

update public.products
set sku_editor_locked = false
where sku_editor_locked = true;

create or replace function public.finalize_inventory_sku_setup(inventory_sku_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public, private
as $$
declare
  updated_count integer;
begin
  if not private.is_admin() then
    raise exception 'Admin access required.';
  end if;
  if inventory_sku_ids is null or coalesce(array_length(inventory_sku_ids, 1), 0) = 0 then
    raise exception 'Choose at least one inventory SKU to lock.';
  end if;

  update public.products as product
  set sku_editor_locked = true,
      updated_at = timezone('utc', now())
  where product.id in (
    select distinct option_row.product_id
    from public.product_options option_row
    join public.product_option_values option_value on option_value.option_id = option_row.id
    where option_value.inventory_sku_id = any(inventory_sku_ids)
  )
  and product.sku_editor_locked is distinct from true;

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

revoke all on function public.finalize_inventory_sku_setup(uuid[]) from public, anon, authenticated;
grant execute on function public.finalize_inventory_sku_setup(uuid[]) to authenticated;

create or replace function public.prevent_locked_product_page_edits()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if old.sku_editor_locked
    and (to_jsonb(new) - 'sku_editor_locked' - 'updated_at') is distinct from
        (to_jsonb(old) - 'sku_editor_locked' - 'updated_at') then
    raise exception 'This product-page SKU editor is locked. Unlock the page before editing it.';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_locked_product_page_edits on public.products;
create trigger prevent_locked_product_page_edits
before update on public.products
for each row execute function public.prevent_locked_product_page_edits();

revoke all on function public.prevent_locked_product_page_edits() from public, anon, authenticated;
