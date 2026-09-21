begin;

-- The guest checkout function's local variable has the same name as the
-- orders column. Qualify the RETURNING column so test orders compile and
-- return the generated guest token instead of failing at checkout.
do $migration$
declare
  definition text;
  old_returning text := 'returning id, guest_order_token into order_id, guest_order_token;';
  new_returning text := 'returning id, public.orders.guest_order_token into order_id, guest_order_token;';
begin
  select pg_get_functiondef('public.create_test_order_legacy(jsonb)'::regprocedure)
    into definition;
  if position(old_returning in definition) = 0 then
    raise exception 'Expected guest checkout RETURNING clause was not found.';
  end if;
  execute replace(definition, old_returning, new_returning);
end;
$migration$;

commit;
