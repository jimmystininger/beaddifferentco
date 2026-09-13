create or replace function public.subscribe_to_newsletter(subscriber_email text)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  normalized_email text := lower(trim(subscriber_email));
begin
  if normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'A valid email address is required.';
  end if;

  insert into public.notification_subscribers (email, source, active, updated_at)
  values (normalized_email, 'footer', true, timezone('utc', now()))
  on conflict (email) do update
    set source = 'footer',
        active = true,
        updated_at = timezone('utc', now());
end;
$$;

revoke all on function public.subscribe_to_newsletter(text) from public;
grant execute on function public.subscribe_to_newsletter(text) to anon, authenticated;
