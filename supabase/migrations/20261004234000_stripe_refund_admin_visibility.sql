grant select on table public.stripe_refunds to authenticated;

create policy stripe_refunds_admin_read
  on public.stripe_refunds
  for select
  to authenticated
  using ((select private.is_admin()));
