create or replace function public.admin_website_inventory_sales_metrics()
returns table(
  sale_date date,
  product_id uuid,
  product_name text,
  sku text,
  quantity numeric,
  gross_revenue numeric
)
language sql
security definer
set search_path = public, private
as $$
  with returned_quantities as (
    select e.order_item_id, sum(greatest(coalesce(e.quantity, 0), 0)) as quantity
    from public.order_financial_events e
    where e.event_type = 'return'
      and e.order_item_id is not null
    group by e.order_item_id
  ), eligible_orders as (
    select o.id, o.created_at
    from public.orders o
    where private.is_admin()
      and lower(coalesce(o.payment_status, '')) in ('paid', 'partially_refunded', 'refunded')
      and lower(coalesce(o.status, '')) not in ('cancelled', 'expired')
  ), sale_lines as (
    select
      date_trunc('day', o.created_at)::date as sale_date,
      i.product_id,
      i.product_name,
      coalesce(
        nullif(trim(i.sku), ''),
        nullif(trim(i.selected_options->>'sku'), ''),
        nullif(trim(i.selected_options->>'inventorySku'), ''),
        nullif(trim(i.selected_options->>'variantSku'), ''),
        'Unassigned SKU'
      ) as sku,
      greatest(coalesce(i.quantity, 0) - least(coalesce(i.quantity, 0), greatest(coalesce(i.refunded_quantity, 0), coalesce(rq.quantity, 0))), 0) as quantity,
      coalesce(i.unit_price, 0) as unit_price
    from eligible_orders o
    join public.order_items i on i.order_id = o.id
    left join returned_quantities rq on rq.order_item_id = i.id
  )
  select sale_date, product_id, product_name, sku,
    sum(quantity)::numeric,
    sum(quantity * unit_price)::numeric
  from sale_lines
  where quantity > 0
  group by sale_date, product_id, product_name, sku;
$$;

revoke all on function public.admin_website_inventory_sales_metrics() from public, anon;
grant execute on function public.admin_website_inventory_sales_metrics() to authenticated, service_role;

create table if not exists private.public_write_rate_limits (
  rate_key text primary key,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0)
);

revoke all on private.public_write_rate_limits from public, anon, authenticated;

create or replace function private.guard_public_store_writes()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  request_headers jsonb;
  client_ip text;
  rate_key_value text;
  request_count_value integer;
  order_row public.orders%rowtype;
  normalized_order_number text;
begin
  if tg_table_name = 'analytics_events' then
    if new.event_type = 'purchase' and current_setting('request.jwt.claim.role', true) <> 'service_role' then
      raise exception 'Purchase events are recorded by the payment system.' using errcode = '42501';
    end if;
    if current_setting('request.jwt.claim.role', true) = 'service_role' then
      return new;
    end if;
    request_headers := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
    client_ip := coalesce(
      nullif(request_headers->>'cf-connecting-ip', ''),
      nullif(request_headers->>'x-real-ip', ''),
      nullif(split_part(coalesce(request_headers->>'x-forwarded-for', ''), ',', 1), ''),
      'unknown'
    );
    rate_key_value := 'analytics:' || md5(client_ip);
    insert into private.public_write_rate_limits(rate_key, window_started_at, request_count)
    values (rate_key_value, now(), 1)
    on conflict (rate_key) do update
      set request_count = case
            when private.public_write_rate_limits.window_started_at < now() - interval '10 minutes' then 1
            else private.public_write_rate_limits.request_count + 1
          end,
          window_started_at = case
            when private.public_write_rate_limits.window_started_at < now() - interval '10 minutes' then now()
            else private.public_write_rate_limits.window_started_at
          end
    returning request_count into request_count_value;
    if request_count_value > 300 then
      raise exception 'Analytics event rate limit exceeded.' using errcode = 'P0001';
    end if;
    return new;
  end if;

  new.email := lower(trim(new.email));
  if (select count(*) from public.contact_messages m where lower(m.email) = new.email and m.created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many messages were submitted for this email address. Please try again later.' using errcode = 'P0001';
  end if;
  if tg_table_name = 'contact_messages' then
    return new;
  end if;

  if (select count(*) from public.order_support_requests r where lower(r.email) = new.email and r.created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many order requests were submitted for this email address. Please try again later.' using errcode = 'P0001';
  end if;
  if new.order_id is null then
    raise exception 'Choose a valid order before sending an order support request.' using errcode = '23514';
  end if;
  select * into order_row from public.orders o where o.id = new.order_id;
  normalized_order_number := nullif(regexp_replace(coalesce(new.order_number, ''), '[^0-9]', '', 'g'), '');
  if order_row.id is null or normalized_order_number is null or normalized_order_number !~ '^[0-9]{1,19}$' then
    raise exception 'The order details do not match the supplied account or email.' using errcode = '23514';
  end if;
  if normalized_order_number::numeric <> order_row.order_number
     or not (
       (order_row.user_id is not null and order_row.user_id = new.user_id)
       or lower(coalesce(order_row.customer_email, '')) = new.email
     ) then
    raise exception 'The order details do not match the supplied account or email.' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_public_store_writes() from public, anon, authenticated;

drop trigger if exists guard_analytics_event_public_writes on public.analytics_events;
create trigger guard_analytics_event_public_writes
before insert on public.analytics_events
for each row execute function private.guard_public_store_writes();

drop trigger if exists guard_contact_message_public_writes on public.contact_messages;
create trigger guard_contact_message_public_writes
before insert on public.contact_messages
for each row execute function private.guard_public_store_writes();

drop trigger if exists guard_order_support_public_writes on public.order_support_requests;
create trigger guard_order_support_public_writes
before insert on public.order_support_requests
for each row execute function private.guard_public_store_writes();

drop policy if exists analytics_events_public_insert on public.analytics_events;
create policy analytics_events_public_insert
  on public.analytics_events for insert to anon, authenticated
  with check (
    event_type in ('view', 'cart_add', 'search', 'search_result')
    and (product_id is null or exists (select 1 from public.products where id = product_id and visible))
  );
