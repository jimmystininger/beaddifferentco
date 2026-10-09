revoke all on function public.process_order_refund(uuid, numeric, text) from public, anon, authenticated;
revoke all on function public.process_order_return(uuid, jsonb, text, boolean) from public, anon, authenticated;
revoke all on function public.process_customer_satisfaction_refund(uuid, numeric, text) from public, anon, authenticated;

grant execute on function public.process_order_refund(uuid, numeric, text) to service_role;
grant execute on function public.process_order_return(uuid, jsonb, text, boolean) to service_role;
grant execute on function public.process_customer_satisfaction_refund(uuid, numeric, text) to service_role;
