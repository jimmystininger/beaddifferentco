create or replace function public.save_customer_address_atomically(
  address_id_value uuid,
  label_value text,
  recipient_name_value text,
  address_line1_value text,
  address_line2_value text,
  city_value text,
  state_value text,
  postal_code_value text,
  country_value text,
  is_default_value boolean
)
returns setof public.customer_addresses
language plpgsql
security invoker
set search_path = public
as $$
declare
  user_id_value uuid := (select auth.uid());
  saved_address public.customer_addresses%rowtype;
  target_address_id uuid := coalesce(address_id_value, gen_random_uuid());
begin
  if user_id_value is null then
    raise exception 'Sign in before saving an address.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(user_id_value::text, 0));

  if is_default_value then
    update public.customer_addresses
    set is_default = false,
        updated_at = timezone('utc', now())
    where user_id = user_id_value
      and is_default
      and id <> target_address_id;
  end if;

  insert into public.customer_addresses (
    id,
    user_id,
    label,
    recipient_name,
    address_line1,
    address_line2,
    city,
    state,
    postal_code,
    country,
    is_default,
    updated_at
  ) values (
    target_address_id,
    user_id_value,
    label_value,
    recipient_name_value,
    address_line1_value,
    nullif(address_line2_value, ''),
    city_value,
    state_value,
    postal_code_value,
    coalesce(nullif(country_value, ''), 'US'),
    coalesce(is_default_value, false),
    timezone('utc', now())
  )
  on conflict (id) do update set
    label = excluded.label,
    recipient_name = excluded.recipient_name,
    address_line1 = excluded.address_line1,
    address_line2 = excluded.address_line2,
    city = excluded.city,
    state = excluded.state,
    postal_code = excluded.postal_code,
    country = excluded.country,
    is_default = excluded.is_default,
    updated_at = excluded.updated_at
  where public.customer_addresses.user_id = user_id_value
  returning * into saved_address;

  if saved_address.id is null then
    raise exception 'Address was not found or does not belong to this account.';
  end if;

  return next saved_address;
end;
$$;

revoke all on function public.save_customer_address_atomically(uuid, text, text, text, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.save_customer_address_atomically(uuid, text, text, text, text, text, text, text, text, boolean) to authenticated;
