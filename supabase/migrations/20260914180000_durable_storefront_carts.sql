alter table public.customer_carts
  add column if not exists id uuid,
  add column if not exists guest_token uuid;

update public.customer_carts
set id = gen_random_uuid()
where id is null;

alter table public.customer_cart_items
  add column if not exists cart_id uuid;

alter table public.customer_cart_items
  drop constraint if exists customer_cart_items_cart_user_id_fkey,
  drop constraint if exists customer_cart_items_pkey;

alter table public.customer_carts
  drop constraint if exists customer_carts_pkey;

alter table public.customer_carts
  alter column id set default gen_random_uuid(),
  alter column id set not null,
  alter column user_id drop not null;

update public.customer_cart_items items
set cart_id = carts.id
from public.customer_carts carts
where carts.user_id = items.cart_user_id
  and items.cart_id is null;

alter table public.customer_cart_items
  alter column cart_user_id drop not null,
  alter column cart_id set not null;

alter table public.customer_carts
  add constraint customer_carts_pkey primary key (id);

alter table public.customer_carts
  add constraint customer_carts_guest_token_unique unique (guest_token);

alter table public.customer_carts
  add constraint customer_carts_user_id_unique unique (user_id);

alter table public.customer_cart_items
  add constraint customer_cart_items_cart_id_fkey
    foreign key (cart_id) references public.customer_carts(id) on delete cascade,
  add constraint customer_cart_items_pkey primary key (cart_id, product_id, line_key);

create index if not exists customer_cart_items_cart_idx
  on public.customer_cart_items(cart_id, updated_at desc);

drop policy if exists customer_carts_self_all on public.customer_carts;
create policy customer_carts_self_all on public.customer_carts
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists customer_cart_items_self_all on public.customer_cart_items;
create policy customer_cart_items_self_all on public.customer_cart_items
  for all to authenticated
  using (exists (
    select 1
    from public.customer_carts carts
    where carts.id = cart_id
      and carts.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1
    from public.customer_carts carts
    where carts.id = cart_id
      and carts.user_id = (select auth.uid())
  ));

create or replace function public.get_or_create_storefront_cart(p_guest_token uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  current_user_id uuid := (select auth.uid());
  cart_id uuid;
  guest_cart_id uuid;
  effective_guest_token uuid := coalesce(p_guest_token, gen_random_uuid());
begin
  if current_user_id is not null then
    select id into cart_id
    from public.customer_carts
    where user_id = current_user_id
    for update;

    if cart_id is not null and p_guest_token is not null then
      select id into guest_cart_id
      from public.customer_carts
      where user_id is null
        and guest_token = p_guest_token
      for update;

      if guest_cart_id is not null and guest_cart_id <> cart_id then
        insert into public.customer_cart_items (
          cart_id, cart_user_id, product_id, quantity, line_key, selected_options, updated_at
        )
        select cart_id, current_user_id, items.product_id, items.quantity, items.line_key,
               items.selected_options, timezone('utc', now())
        from public.customer_cart_items items
        where items.cart_id = guest_cart_id
        on conflict (cart_id, product_id, line_key) do update
          set quantity = customer_cart_items.quantity + excluded.quantity,
              updated_at = timezone('utc', now());

        delete from public.customer_cart_items where cart_id = guest_cart_id;
        delete from public.customer_carts where id = guest_cart_id;
      end if;
    end if;

    if cart_id is null and p_guest_token is not null then
      select id into guest_cart_id
      from public.customer_carts
      where user_id is null
        and guest_token = p_guest_token
      for update;

      if guest_cart_id is not null then
        update public.customer_carts
        set user_id = current_user_id,
            guest_token = null,
            updated_at = timezone('utc', now())
        where id = guest_cart_id;
        cart_id := guest_cart_id;
      end if;
    end if;

    if cart_id is null then
      insert into public.customer_carts (user_id)
      values (current_user_id)
      on conflict (user_id) do update
        set updated_at = timezone('utc', now())
      returning id into cart_id;
    end if;
  else
    select id into cart_id
    from public.customer_carts
    where user_id is null
      and guest_token = effective_guest_token
    for update;

    if cart_id is null then
      insert into public.customer_carts (guest_token)
      values (effective_guest_token)
      on conflict (guest_token) do update
        set updated_at = timezone('utc', now())
      returning id into cart_id;
    end if;
  end if;

  return jsonb_build_object(
    'id', cart_id,
    'guestToken', case when current_user_id is null then effective_guest_token else null end,
    'userId', current_user_id
  );
end;
$$;

create or replace function public.get_storefront_cart(p_cart_id uuid, p_guest_token uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  current_user_id uuid := (select auth.uid());
  cart record;
begin
  select id, user_id, guest_token into cart
  from public.customer_carts
  where id = p_cart_id;

  if cart.id is null or not (
    (current_user_id is not null and cart.user_id = current_user_id)
    or (cart.user_id is null and cart.guest_token = p_guest_token)
  ) then
    raise exception 'Cart is not available.';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'product_id', items.product_id,
      'quantity', items.quantity,
      'line_key', items.line_key,
      'selected_options', items.selected_options
    ) order by items.updated_at, items.product_id, items.line_key)
    from public.customer_cart_items items
    where items.cart_id = p_cart_id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.replace_storefront_cart(
  p_cart_id uuid,
  p_items jsonb,
  p_guest_token uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  current_user_id uuid := (select auth.uid());
  cart record;
  line jsonb;
  product_id uuid;
  quantity integer;
  line_key text;
begin
  select id, user_id, guest_token into cart
  from public.customer_carts
  where id = p_cart_id
  for update;

  if cart.id is null or not (
    (current_user_id is not null and cart.user_id = current_user_id)
    or (cart.user_id is null and cart.guest_token = p_guest_token)
  ) then
    raise exception 'Cart is not available.';
  end if;

  delete from public.customer_cart_items
  where cart_id = p_cart_id;

  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'Cart items must be an array.';
  end if;

  for line in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as entries(value)
  loop
    product_id := nullif(line->>'product_id', '')::uuid;
    quantity := (line->>'quantity')::integer;
    line_key := coalesce(nullif(line->>'line_key', ''), 'default');
    if product_id is null or quantity is null or quantity <= 0 then
      raise exception 'Every cart line needs a product and positive quantity.';
    end if;
    insert into public.customer_cart_items (
      cart_id, cart_user_id, product_id, quantity, line_key, selected_options, updated_at
    ) values (
      p_cart_id, cart.user_id, product_id, quantity, line_key,
      coalesce(line->'selected_options', '[]'::jsonb), timezone('utc', now())
    );
  end loop;

  update public.customer_carts
  set updated_at = timezone('utc', now())
  where id = p_cart_id;

  return public.get_storefront_cart(p_cart_id, p_guest_token);
end;
$$;

revoke all on function public.get_or_create_storefront_cart(uuid) from public, anon, authenticated;
revoke all on function public.get_storefront_cart(uuid, uuid) from public, anon, authenticated;
revoke all on function public.replace_storefront_cart(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.get_or_create_storefront_cart(uuid) to anon, authenticated;
grant execute on function public.get_storefront_cart(uuid, uuid) to anon, authenticated;
grant execute on function public.replace_storefront_cart(uuid, jsonb, uuid) to anon, authenticated;
