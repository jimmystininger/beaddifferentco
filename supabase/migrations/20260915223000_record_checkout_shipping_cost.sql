alter function public.create_test_order(jsonb)
  rename to create_test_order_legacy;

create or replace function public.create_test_order(order_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  result jsonb;
  created_order_id uuid;
  recorded_shipping_cost numeric;
begin
  result := public.create_test_order_legacy(order_payload);
  created_order_id := nullif(result->>'id', '')::uuid;
  recorded_shipping_cost := greatest(0, coalesce(nullif(order_payload->>'shipping_cost', '')::numeric, 0));

  update public.orders
  set shipping_cost = recorded_shipping_cost,
      updated_at = timezone('utc', now())
  where id = created_order_id;

  return result;
end;
$$;

revoke all on function public.create_test_order(jsonb) from public, anon, authenticated;
grant execute on function public.create_test_order(jsonb) to anon, authenticated;
