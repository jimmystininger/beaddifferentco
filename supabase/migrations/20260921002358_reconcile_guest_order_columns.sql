begin;

-- The live checkout RPC already accepts guest orders and writes these fields.
-- Keep this as a forward reconciliation migration because the historical guest
-- checkout migration is present locally but absent from the deployed schema.
alter table public.orders
  add column if not exists customer_email text,
  add column if not exists guest_order_token uuid not null default gen_random_uuid();

create unique index if not exists orders_guest_order_token_idx
  on public.orders (guest_order_token);

create or replace function private.link_guest_orders_to_profile()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $function$
begin
  update public.orders
  set user_id = new.id,
      updated_at = timezone('utc', now())
  where user_id is null
    and customer_email is not null
    and lower(trim(customer_email)) = lower(trim(new.email));
  return new;
end;
$function$;

drop trigger if exists on_profile_link_guest_orders on public.profiles;
create trigger on_profile_link_guest_orders
after insert or update of email on public.profiles
for each row execute procedure private.link_guest_orders_to_profile();

revoke execute on function private.link_guest_orders_to_profile() from public, anon, authenticated;

commit;
