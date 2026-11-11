-- Save reusable outside-sales channels and optional customer details.
alter table public.manual_sales
  add column if not exists customer_name text,
  add column if not exists customer_phone text,
  add column if not exists customer_address text,
  add column if not exists other_fees numeric not null default 0;
alter table public.manual_sales
  add constraint manual_sales_other_fees_nonnegative check (other_fees >= 0),
  add constraint manual_sales_customer_name_length check (customer_name is null or length(customer_name) <= 120),
  add constraint manual_sales_customer_phone_length check (customer_phone is null or length(customer_phone) <= 40),
  add constraint manual_sales_customer_address_length check (customer_address is null or length(customer_address) <= 500);

create table public.manual_sales_channels (
  name text not null check (length(btrim(name)) between 1 and 80),
  normalized_name text generated always as (lower(btrim(name))) stored unique,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now())
);
insert into public.manual_sales_channels(name)
values ('Cash'), ('Facebook Marketplace'), ('In-person'), ('Other')
on conflict (normalized_name) do nothing;

alter table public.manual_sales_channels enable row level security;
revoke all on public.manual_sales_channels from public, anon, authenticated;
grant select, insert on public.manual_sales_channels to authenticated;
create policy manual_sales_channels_admin_select on public.manual_sales_channels
  for select to authenticated using ((select private.is_admin()));
create policy manual_sales_channels_admin_insert on public.manual_sales_channels
  for insert to authenticated with check ((select private.is_admin()));

drop function if exists public.record_manual_custom_sale(timestamptz, text, text, text, numeric, numeric, numeric, jsonb);
create function public.record_manual_custom_sale(
  p_sold_at timestamptz,
  p_channel text,
  p_customer_reference text,
  p_notes text,
  p_discount_amount numeric,
  p_shipping_collected numeric,
  p_tax_collected numeric,
  p_other_fees numeric,
  p_customer_name text,
  p_customer_phone text,
  p_customer_address text,
  p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  sale_id uuid;
  sale_line_id uuid;
  line_row jsonb;
  line_number_value integer := 0;
  sku_value text;
  quantity_value integer;
  revenue_value numeric;
  inventory_record record;
  component record;
  lock_record record;
  cost_total_value numeric;
  sale_cost_total numeric := 0;
  sale_revenue_total numeric := 0;
  discount_value numeric := coalesce(p_discount_amount, 0);
  shipping_value numeric := coalesce(p_shipping_collected, 0);
  tax_value numeric := coalesce(p_tax_collected, 0);
  fees_value numeric := coalesce(p_other_fees, 0);
  channel_value text;
  quantity_after_value integer;
  missing_cost_skus text[] := '{}'::text[];
begin
  if not private.is_admin() then
    raise exception 'Admin access required.';
  end if;
  if p_sold_at is null then
    raise exception 'Enter the date of the sale.';
  end if;
  select channel.name into channel_value
  from public.manual_sales_channels channel
  where channel.active and channel.normalized_name = lower(trim(coalesce(p_channel, '')));
  if channel_value is null then
    raise exception 'Choose a saved sales avenue.';
  end if;
  if discount_value < 0 or shipping_value < 0 or tax_value < 0 or fees_value < 0 then
    raise exception 'Discount, shipping, tax, and other fees must be zero or greater.';
  end if;
  if coalesce(jsonb_typeof(p_lines), '') <> 'array' then
    raise exception 'Add between 1 and 100 sale items.';
  end if;
  if jsonb_array_length(p_lines) < 1 or jsonb_array_length(p_lines) > 100 then
    raise exception 'Add between 1 and 100 sale items.';
  end if;

  for line_row in select value from jsonb_array_elements(p_lines) as entries(value)
  loop
    sku_value := nullif(trim(line_row->>'sku'), '');
    if sku_value is null or coalesce(line_row->>'quantity', '') !~ '^[0-9]+$' or (line_row->>'quantity')::integer <= 0 then
      raise exception 'Every sale item needs an existing SKU and a positive whole quantity.';
    end if;
    quantity_value := (line_row->>'quantity')::integer;
    if coalesce(line_row->>'charged_amount', '') !~ '^([0-9]+)(\.[0-9]{1,2})?$' then
      raise exception 'Enter the actual amount charged for each sale item, using dollars and cents.';
    end if;
    revenue_value := (line_row->>'charged_amount')::numeric;
    if revenue_value < 0 then
      raise exception 'Charged amounts cannot be negative.';
    end if;
    select inventory.id, inventory.sku, inventory.name, inventory.item_type
      into inventory_record
    from public.inventory_skus inventory
    where lower(trim(inventory.sku)) = lower(trim(sku_value));
    if not found then
      raise exception 'SKU not found in canonical inventory: %', sku_value;
    end if;
    if lower(coalesce(inventory_record.item_type, 'inventory')) = 'non-inventory'
       and not exists (
         select 1 from public.inventory_bundle_components recipe
         where recipe.bundle_sku_id = inventory_record.id
       ) then
      raise exception 'Non-inventory parent SKU % needs a saved recipe before it can be recorded as a sale.', inventory_record.sku;
    end if;
    sale_revenue_total := sale_revenue_total + revenue_value;
  end loop;

  if discount_value > sale_revenue_total then
    raise exception 'The discount cannot be greater than the item subtotal.';
  end if;

  for lock_record in
    select distinct component_inventory.id, component_inventory.sku
    from jsonb_array_elements(p_lines) as entries(value)
    cross join lateral private.expand_manual_sale_sku(
      entries.value->>'sku',
      (entries.value->>'quantity')::integer
    ) expanded
    join public.inventory_skus component_inventory
      on lower(trim(component_inventory.sku)) = lower(trim(expanded.component_sku))
    order by component_inventory.sku
  loop
    perform 1 from public.inventory_skus where id = lock_record.id for update;
  end loop;

  insert into public.manual_sales (
    sold_at, sales_channel, customer_reference, notes, customer_name,
    customer_phone, customer_address, total_revenue, discount_amount,
    shipping_collected, tax_collected, other_fees, total_charged, created_by
  ) values (
    p_sold_at, channel_value, nullif(trim(coalesce(p_customer_reference, '')), ''),
    nullif(trim(coalesce(p_notes, '')), ''), nullif(trim(p_customer_name), ''),
    nullif(trim(p_customer_phone), ''), nullif(trim(p_customer_address), ''),
    sale_revenue_total, discount_value, shipping_value, tax_value, fees_value,
    sale_revenue_total - discount_value + shipping_value + tax_value, auth.uid()
  ) returning id into sale_id;

  for line_row in select value from jsonb_array_elements(p_lines) as entries(value)
  loop
    line_number_value := line_number_value + 1;
    sku_value := trim(line_row->>'sku');
    quantity_value := (line_row->>'quantity')::integer;
    revenue_value := (line_row->>'charged_amount')::numeric;
    select inventory.id, inventory.sku, inventory.name, inventory.item_type
      into inventory_record
    from public.inventory_skus inventory
    where lower(trim(inventory.sku)) = lower(trim(sku_value));

    insert into public.manual_sale_lines (
      sale_id, line_number, inventory_sku_id, sku, product_name, quantity, revenue_amount
    ) values (
      sale_id, line_number_value, inventory_record.id, inventory_record.sku,
      inventory_record.name, quantity_value, revenue_value
    ) returning id into sale_line_id;

    cost_total_value := 0;
    for component in
      select inventory.id, inventory.sku, inventory.item_type, inventory.cost,
        expanded.quantity
      from private.expand_manual_sale_sku(sku_value, quantity_value) expanded
      join public.inventory_skus inventory
        on lower(trim(inventory.sku)) = lower(trim(expanded.component_sku))
      order by inventory.sku
    loop
      if lower(coalesce(component.item_type, 'inventory')) = 'non-inventory' then
        raise exception 'Recipe for % contains non-inventory component % without a physical inventory leaf.', inventory_record.sku, component.sku;
      end if;
      update public.inventory_skus
      set quantity_on_hand = quantity_on_hand - component.quantity,
          updated_at = timezone('utc', now())
      where id = component.id
      returning quantity_on_hand into quantity_after_value;

      insert into public.manual_sale_line_components (
        sale_line_id, inventory_sku_id, sku, quantity, unit_cost_at_sale,
        quantity_before, quantity_after
      ) values (
        sale_line_id, component.id, component.sku, component.quantity, component.cost,
        quantity_after_value + component.quantity, quantity_after_value
      );
      cost_total_value := cost_total_value + component.quantity * coalesce(component.cost, 0);
      if component.cost is null and not component.sku = any(missing_cost_skus) then
        missing_cost_skus := array_append(missing_cost_skus, component.sku);
      end if;
    end loop;

    update public.manual_sale_lines
    set cost_total = cost_total_value
    where id = sale_line_id;
    sale_cost_total := sale_cost_total + cost_total_value;
  end loop;

  update public.manual_sales set total_cost = sale_cost_total where id = sale_id;

  return jsonb_build_object(
    'sale_id', sale_id,
    'total_revenue', sale_revenue_total,
    'discount_amount', discount_value,
    'shipping_collected', shipping_value,
    'tax_collected', tax_value,
    'other_fees', fees_value,
    'total_charged', sale_revenue_total - discount_value + shipping_value + tax_value,
    'total_cost', sale_cost_total,
    'missing_cost_skus', to_jsonb(missing_cost_skus)
  );
end;
$$;


revoke all on function public.record_manual_custom_sale(timestamptz, text, text, text, numeric, numeric, numeric, numeric, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_manual_custom_sale(timestamptz, text, text, text, numeric, numeric, numeric, numeric, text, text, text, jsonb) to authenticated;

drop function if exists public.admin_manual_sales_history();
create function public.admin_manual_sales_history()
returns table(
  sale_id uuid, sold_at timestamptz, sales_channel text, customer_reference text,
  notes text, total_revenue numeric, discount_amount numeric,
  shipping_collected numeric, tax_collected numeric, other_fees numeric,
  total_charged numeric, total_cost numeric, voided_at timestamptz,
  line_summary text, customer_name text, customer_phone text, customer_address text
)
language sql stable security definer set search_path = public, private
as $$
  select sale.id, sale.sold_at, sale.sales_channel, sale.customer_reference,
    sale.notes, sale.total_revenue, sale.discount_amount, sale.shipping_collected,
    sale.tax_collected, sale.other_fees, sale.total_charged, sale.total_cost,
    sale.voided_at,
    string_agg(line.quantity::text || ' × ' || line.sku, ', ' order by line.line_number),
    sale.customer_name, sale.customer_phone, sale.customer_address
  from public.manual_sales sale
  join public.manual_sale_lines line on line.sale_id = sale.id
  where private.is_admin()
  group by sale.id
  order by sale.sold_at desc
  limit 50;
$$;
revoke all on function public.admin_manual_sales_history() from public, anon;
grant execute on function public.admin_manual_sales_history() to authenticated, service_role;
