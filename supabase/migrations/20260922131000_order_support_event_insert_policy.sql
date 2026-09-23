grant insert on public.order_support_request_events to authenticated;
drop policy if exists order_support_request_events_admin_insert on public.order_support_request_events;
create policy order_support_request_events_admin_insert on public.order_support_request_events
for insert to authenticated with check ((select private.is_admin()));
