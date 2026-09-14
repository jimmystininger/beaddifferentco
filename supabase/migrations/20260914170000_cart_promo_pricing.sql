create or replace function public.create_test_order(order_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  current_user_id uuid := (select auth.uid());
  order_id uuid;
  guest_order_token uuid;
  line jsonb;
  line_product_id uuid;
  line_sku text;
  line_quantity integer;
  product_name text;
  product_visible boolean;
  product_price numeric;
  product_promo_price numeric;
  product_promo_percent numeric;
  product_promo_skus jsonb;
  product_promo_starts_at timestamptz;
  product_promo_ends_at timestamptz;
  inventory_id uuid;
  inventory_price numeric;
  inventory_cost numeric;
  inventory_item_type text;
  line_inventory_units integer;
  normalized_lines jsonb := '[]'::jsonb;
  requirement record;
  component record;
  subtotal numeric := 0;
  promo_eligible_subtotal numeric := 0;
  discount numeric := 0;
  shipping_amount numeric := 0;
  tax_amount numeric := 0;
  tax_rate numeric := 0;
  tax_state text;
  tax_jurisdiction text;
  total numeric := 0;
  promo_code_value text;
  promo_discount_type text;
  promo_value numeric;
  shipping_name text;
  shipping_address jsonb;
  shipping_method text;
  customer_email text;
  line_unit_price numeric;
  line_original_price numeric;
  line_promo_applied boolean;
begin
  if public.storefront_sales_frozen() then
    raise exception 'Sales are paused while an inventory audit is in progress.';
  end if;
  if jsonb_typeof(order_payload->'lines') <> 'array' or jsonb_array_length(order_payload->'lines') = 0 then
    raise exception 'Your cart is empty.';
  end if;

  customer_email := lower(nullif(trim(order_payload->>'customer_email'), ''));
  if customer_email is null and current_user_id is not null then
    select lower(email) into customer_email from auth.users where id = current_user_id;
  end if;
  if customer_email is null or customer_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'A valid email address is required for order updates.';
  end if;

  shipping_name := nullif(trim(order_payload->>'shipping_name'), '');
  shipping_address := coalesce(order_payload->'shipping_address', '{}'::jsonb);
  shipping_method := lower(coalesce(nullif(trim(order_payload->>'shipping_method'), ''), 'standard'));
  shipping_method := regexp_replace(shipping_method, '\s+shipping$', '');
  if shipping_method not in ('standard', 'priority') then
    raise exception 'Choose Standard or Priority shipping.';
  end if;
  promo_code_value := upper(nullif(trim(order_payload->>'promo_code'), ''));
  tax_amount := coalesce(nullif(order_payload->>'tax_amount', '')::numeric, 0);
  tax_rate := coalesce(nullif(order_payload->>'tax_rate', '')::numeric, 0);
  tax_state := upper(nullif(trim(order_payload->>'tax_state'), ''));
  tax_jurisdiction := nullif(trim(order_payload->>'tax_jurisdiction'), '');
  if tax_amount < 0 or tax_rate < 0 then
    raise exception 'Sales tax values must be zero or greater.';
  end if;
  if upper(coalesce(shipping_address->>'state', '')) in ('OH', 'OHIO') then
    if tax_rate <= 0 and coalesce((order_payload->>'test_order')::boolean, false) is not true then
      raise exception 'A current Ohio sales tax quote is required before placing the order.';
    end if;
    tax_state := 'OH';
  else
    tax_amount := 0;
    tax_rate := 0;
    tax_state := null;
    tax_jurisdiction := null;
  end if;

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

    select p.name, p.visible, p.price, p.promo_price, p.promo_discount_percent,
           p.promo_skus, p.promo_starts_at, p.promo_ends_at
      into product_name, product_visible, product_price, product_promo_price,
           product_promo_percent, product_promo_skus, product_promo_starts_at,
           product_promo_ends_at
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

    line_original_price := coalesce(inventory_price, product_price, 0);
    line_unit_price := line_original_price;
    line_promo_applied := (
      (coalesce(product_promo_percent, 0) > 0 or (product_promo_price is not null and product_promo_price > 0 and product_promo_price < line_original_price))
      and (product_promo_starts_at is null or product_promo_starts_at <= timezone('utc', now()))
      and (product_promo_ends_at is null or product_promo_ends_at >= timezone('utc', now()))
      and (
        jsonb_typeof(coalesce(product_promo_skus, '[]'::jsonb)) <> 'array'
        or jsonb_array_length(coalesce(product_promo_skus, '[]'::jsonb)) = 0
        or exists (
          select 1
          from jsonb_array_elements_text(coalesce(product_promo_skus, '[]'::jsonb)) as promo_sku(value)
          where lower(trim(promo_sku.value)) = lower(line_sku)
        )
      )
    );
    if line_promo_applied then
      line_unit_price := least(line_original_price, coalesce(nullif(product_promo_price, 0), line_original_price * (1 - greatest(0, least(100, product_promo_percent)) / 100)));
    end if;
    subtotal := subtotal + line_unit_price * line_quantity;
    if not line_promo_applied then
      promo_eligible_subtotal := promo_eligible_subtotal + line_unit_price * line_quantity;
    end if;
    normalized_lines := normalized_lines || jsonb_build_array(jsonb_build_object(
      'product_id', line_product_id,
      'product_name', product_name,
      'sku', line_sku,
      'quantity', line_quantity,
      'inventory_units', line_inventory_units,
      'unit_price', line_unit_price,
      'cost_at_purchase', coalesce(inventory_cost, 0),
      'promo_applied', line_promo_applied,
      'selected_options', coalesce(line->'selected_options', '[]'::jsonb)
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
    order by least(promo_eligible_subtotal, case when discount_type = 'percent'
      then promo_eligible_subtotal * greatest(0, value) / 100
      else greatest(0, value)
    end) desc
    limit 1;
  end if;

  if promo_discount_type = 'percent' then
    discount := least(promo_eligible_subtotal, promo_eligible_subtotal * greatest(0, promo_value) / 100);
  elsif promo_discount_type = 'fixed' then
    discount := least(promo_eligible_subtotal, greatest(0, promo_value));
  end if;
  shipping_amount := coalesce(nullif(order_payload->>'shipping_amount', '')::numeric, 0);
  if shipping_amount < 0 then
    raise exception 'Shipping amount must be zero or greater.';
  end if;
  if shipping_method = 'standard' and subtotal >= 35 then
    shipping_amount := 0;
  elsif shipping_amount <= 0 and coalesce((order_payload->>'test_order')::boolean, false) is not true then
    raise exception 'A valid USPS shipping quote is required before placing the order.';
  end if;
  total := greatest(0, subtotal - discount + shipping_amount + tax_amount);

  insert into public.orders (
    user_id, customer_email, guest_order_token, status, subtotal, discount, total, shipping_amount, tax_amount, tax_rate,
    tax_state, tax_jurisdiction, promo_code, shipping_name, shipping_address, carrier
  ) values (
    current_user_id, customer_email, gen_random_uuid(), 'paid', subtotal, discount, total, shipping_amount, tax_amount, tax_rate,
    tax_state, tax_jurisdiction, promo_code_value, shipping_name, shipping_address,
    initcap(shipping_method) || ' shipping'
  ) returning id, guest_order_token into order_id, guest_order_token;

  for line in select value from jsonb_array_elements(normalized_lines) as entries(value)
  loop
    insert into public.order_items (
      order_id, product_id, product_name, sku, inventory_sku, quantity,
      unit_price, cost_at_purchase, promo_applied, selected_options
    ) values (
      order_id, (line->>'product_id')::uuid, line->>'product_name', line->>'sku', line->>'sku',
      (line->>'quantity')::integer, (line->>'unit_price')::numeric,
      (line->>'cost_at_purchase')::numeric, (line->>'promo_applied')::boolean,
      coalesce(line->'selected_options', '[]'::jsonb)
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
    'shipping_method', shipping_method,
    'tax_amount', tax_amount,
    'tax_rate', tax_rate,
    'tax_state', tax_state,
    'tax_jurisdiction', tax_jurisdiction,
    'total', total,
    'promo_code', promo_code_value,
    'customer_email', customer_email,
    'guest_order_token', guest_order_token
  );
end;
$$;

revoke all on function public.create_test_order(jsonb) from public, anon, authenticated;
grant execute on function public.create_test_order(jsonb) to anon, authenticated;
