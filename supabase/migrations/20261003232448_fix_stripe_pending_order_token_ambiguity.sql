do $$
declare
  function_definition text;
begin
  select pg_get_functiondef('public.create_stripe_pending_order(jsonb, uuid)'::regprocedure)
    into function_definition;

  function_definition := replace(
    function_definition,
    '  guest_order_token uuid;',
    '  guest_order_token_value uuid;'
  );
  function_definition := replace(
    function_definition,
    'returning id, guest_order_token into order_id, guest_order_token;',
    'returning id, guest_order_token into order_id, guest_order_token_value;'
  );
  function_definition := replace(
    function_definition,
    '''guest_order_token'', guest_order_token',
    '''guest_order_token'', guest_order_token_value'
  );

  execute function_definition;
end;
$$;
