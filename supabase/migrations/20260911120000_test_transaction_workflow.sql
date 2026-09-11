alter table public.customer_cart_items
  add column if not exists line_key text not null default 'default';

alter table public.customer_cart_items
  drop constraint if exists customer_cart_items_pkey;

alter table public.customer_cart_items
  add constraint customer_cart_items_pkey primary key (cart_user_id, product_id, line_key);

create index if not exists customer_cart_items_user_idx
  on public.customer_cart_items(cart_user_id, updated_at desc);

alter table public.orders
  add column if not exists shipping_amount numeric not null default 0 check (shipping_amount >= 0),
  add column if not exists promo_code text;

alter table public.order_items
  add column if not exists inventory_sku text,
  add column if not exists inventory_units integer not null default 1 check (inventory_units > 0),
  add column if not exists cost_at_purchase numeric not null default 0 check (cost_at_purchase >= 0),
  add column if not exists promo_applied boolean not null default false;

create or replace function public.create_test_order(order_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  current_user_id uuid := (select auth.uid());
  order_id uuid;
  line jsonb;
  line_product_id uuid;
  line_sku text;
  line_quantity integer;
  product_name text;
  product_visible boolean;
  product_price numeric;
  inventory_id uuid;
  inventory_price numeric;
  inventory_cost numeric;
  inventory_item_type text;
  line_inventory_units integer;
  normalized_lines jsonb := '[]'::jsonb;
  requirement record;
  component record;
  subtotal numeric := 0;
  discount numeric := 0;
  shipping_amount numeric := 0;
  total numeric := 0;
  promo_code_value text;
  promo_discount_type text;
  promo_value numeric;
  shipping_name text;
  shipping_address jsonb;
  line_unit_price numeric;
  line_promo_applied boolean;
begin
  if current_user_id is null then
    raise exception 'Please sign in before checking out.';
  end if;
  if public.storefront_sales_frozen() then
    raise exception 'Sales are paused while an inventory audit is in progress.';
  end if;
  if jsonb_typeof(order_payload->'lines') <> 'array' or jsonb_array_length(order_payload->'lines') = 0 then
    raise exception 'Your cart is empty.';
  end if;

  shipping_name := nullif(trim(order_payload->>'shipping_name'), '');
  shipping_address := coalesce(order_payload->'shipping_address', '{}'::jsonb);
  promo_code_value := upper(nullif(trim(order_payload->>'promo_code'), ''));

  if promo_code_value is not null then
    select discount_type, value
      into promo_discount_type, promo_value
    from public.promo_codes
    where upper(code) = promo_code_value
      and mode = 'manual'
      and active
      and (starts_at is null or starts_at <= timezone('utc', now()))
      and (ends_at is null or ends_at >= timezone('utc', now()))
    limit 1;
    if promo_discount_type is null then
      raise exception 'That promo code is not available.';
    end if;
  end if;

  for line in select value from jsonb_array_elements(order_payload->'lines') as entries(value)
  loop
    line_product_id := nullif(line->>'product_id', '')::uuid;
    line_sku := nullif(trim(line->>'sku'), '');
    line_quantity := (line->>'quantity')::integer;
    line_inventory_units := greatest(1, coalesce((line->>'inventory_units')::integer, 1));
    if line_product_id is null or line_sku is null or line_quantity is null or line_quantity <= 0 then
      raise exception 'Every cart line needs a product, SKU, and positive quantity.';
    end if;

    select p.name, p.visible, p.price
      into product_name, product_visible, product_price
    from public.products p
    where p.id = line_product_id;
    if product_name is null or product_visible is not true then
      raise exception 'A product in your cart is no longer available.';
    end if;

    select i.id, i.price, i.cost, i.item_type
      into inventory_id, inventory_price, inventory_cost, inventory_item_type
    from public.inventory_skus i
    where i.sku = line_sku
    for update;
    if inventory_id is null then
      raise exception 'SKU % is not linked to canonical inventory.', line_sku;
    end if;

    line_unit_price := coalesce(inventory_price, product_price, 0);
    line_promo_applied := false;
    subtotal := subtotal + line_unit_price * line_quantity;
    normalized_lines := normalized_lines || jsonb_build_array(jsonb_build_object(
      'product_id', line_product_id,
      'product_name', product_name,
      'sku', line_sku,
      'quantity', line_quantity,
      'inventory_units', line_inventory_units,
      'unit_price', line_unit_price,
      'cost_at_purchase', coalesce(inventory_cost, 0),
      'promo_applied', line_promo_applied,
      'selected_options', coalesce(line->'selected_options', '{}'::jsonb)
    ));

    for requirement in
      select expanded.component_sku, expanded.quantity
      from public.expand_inventory_sku(line_sku, line_quantity * line_inventory_units) expanded
    loop
      select i.id, i.quantity_on_hand, i.reserve_quantity, i.item_type
        into component
      from public.inventory_skus i
      where i.sku = requirement.component_sku
      for update;
      if component.id is null then
        raise exception 'Component SKU % is not linked to canonical inventory.', requirement.component_sku;
      end if;
      if lower(coalesce(component.item_type, 'inventory')) <> 'non-inventory'
         and component.quantity_on_hand - coalesce(component.reserve_quantity, 0) < requirement.quantity then
        raise exception 'Not enough available inventory for SKU %.', requirement.component_sku;
      end if;
    end loop;
  end loop;

  if promo_code_value is null then
    select discount_type, value
      into promo_discount_type, promo_value
    from public.promo_codes
    where mode = 'auto'
      and active
      and (starts_at is null or starts_at <= timezone('utc', now()))
      and (ends_at is null or ends_at >= timezone('utc', now()))
    order by least(subtotal, case when discount_type = 'percent'
      then subtotal * greatest(0, value) / 100
      else greatest(0, value)
    end) desc
    limit 1;
  end if;

  if promo_discount_type = 'percent' then
    discount := least(subtotal, subtotal * greatest(0, promo_value) / 100);
  elsif promo_discount_type = 'fixed' then
    discount := least(subtotal, greatest(0, promo_value));
  end if;
  shipping_amount := case when subtotal >= 35 then 0 else 5 end;
  total := greatest(0, subtotal - discount + shipping_amount);

  insert into public.orders (
    user_id, status, subtotal, discount, total, shipping_amount, promo_code,
    shipping_name, shipping_address, carrier
  ) values (
    current_user_id, 'paid', subtotal, discount, total, shipping_amount, promo_code_value,
    shipping_name, shipping_address, 'Test checkout'
  ) returning id into order_id;

  for line in select value from jsonb_array_elements(normalized_lines) as entries(value)
  loop
    insert into public.order_items (
      order_id, product_id, product_name, sku, inventory_sku, quantity,
      unit_price, cost_at_purchase, promo_applied, selected_options
    ) values (
      order_id, (line->>'product_id')::uuid, line->>'product_name', line->>'sku', line->>'sku',
      (line->>'quantity')::integer, (line->>'unit_price')::numeric,
      (line->>'cost_at_purchase')::numeric, (line->>'promo_applied')::boolean,
      coalesce(line->'selected_options', '{}'::jsonb)
    );
  end loop;

  for requirement in
    select expanded.component_sku, sum(expanded.quantity)::integer as quantity
    from jsonb_to_recordset(order_payload->'lines') as requested(sku text, quantity integer, inventory_units integer)
    cross join lateral public.expand_inventory_sku(requested.sku, greatest(1, requested.quantity) * greatest(1, coalesce(requested.inventory_units, 1))) expanded
    group by expanded.component_sku
  loop
    update public.inventory_skus
    set quantity_on_hand = quantity_on_hand - requirement.quantity,
        updated_at = timezone('utc', now())
    where sku = requirement.component_sku
      and lower(coalesce(item_type, 'inventory')) <> 'non-inventory';
  end loop;

  for line in select value from jsonb_array_elements(normalized_lines) as entries(value)
  loop
    insert into public.analytics_events (product_id, event_type)
    values ((line->>'product_id')::uuid, 'purchase');
  end loop;

  return jsonb_build_object(
    'id', order_id,
    'status', 'paid',
    'subtotal', subtotal,
    'discount', discount,
    'shipping_amount', shipping_amount,
    'total', total,
    'promo_code', promo_code_value
  );
end;
$$;

revoke all on function public.create_test_order(jsonb) from public, anon, authenticated;
grant execute on function public.create_test_order(jsonb) to authenticated;

create or replace function public.lookup_test_promo(promo_code text)
returns jsonb
language sql
security definer
set search_path = public, private
as $$
  select jsonb_build_object(
    'code', code,
    'discount_type', discount_type,
    'value', value,
    'mode', mode
  )
  from public.promo_codes
  where upper(code) = upper(trim(lookup_test_promo.promo_code))
    and mode = 'manual'
    and active
    and (starts_at is null or starts_at <= timezone('utc', now()))
    and (ends_at is null or ends_at >= timezone('utc', now()))
  limit 1;
$$;

revoke all on function public.lookup_test_promo(text) from public, anon, authenticated;
grant execute on function public.lookup_test_promo(text) to authenticated;
