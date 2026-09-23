begin;

create sequence if not exists public.orders_order_number_seq;

alter table public.orders
  add column if not exists order_number bigint;

select setval(
  'public.orders_order_number_seq',
  coalesce((select max(order_number) from public.orders), 0) + 1,
  false
);

update public.orders
set order_number = nextval('public.orders_order_number_seq')
where order_number is null;

select setval(
  'public.orders_order_number_seq',
  greatest(coalesce((select max(order_number) from public.orders), 0), 1),
  true
);

alter table public.orders
  alter column order_number set default nextval('public.orders_order_number_seq'),
  alter column order_number set not null;

create unique index if not exists orders_order_number_uidx
  on public.orders(order_number);

alter function public.create_test_order(jsonb)
  rename to create_test_order_order_number_legacy;

create or replace function public.create_test_order(order_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  result jsonb;
  created_order_id uuid;
  public_order_number bigint;
begin
  result := public.create_test_order_order_number_legacy(order_payload);
  created_order_id := nullif(result->>'id', '')::uuid;

  select order_number
    into public_order_number
  from public.orders
  where id = created_order_id;

  return result || jsonb_build_object('order_number', public_order_number);
end;
$function$;

revoke all on function public.create_test_order_order_number_legacy(jsonb) from public, anon, authenticated;
revoke all on function public.create_test_order(jsonb) from public, anon, authenticated;
grant execute on function public.create_test_order(jsonb) to anon, authenticated;

commit;
