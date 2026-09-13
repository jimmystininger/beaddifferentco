drop policy if exists notification_subscribers_public_update on public.notification_subscribers;

create policy notification_subscribers_public_update
on public.notification_subscribers
for update
to anon, authenticated
using (source in ('footer', 'signup'))
with check (active = true and source in ('footer', 'signup'));
