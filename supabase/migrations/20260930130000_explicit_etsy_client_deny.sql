create policy etsy_connections_client_deny
  on public.etsy_connections
  for all
  to anon, authenticated
  using (false)
  with check (false);

create policy etsy_oauth_states_client_deny
  on public.etsy_oauth_states
  for all
  to anon, authenticated
  using (false)
  with check (false);
