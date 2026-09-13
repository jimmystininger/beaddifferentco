create or replace function private.sync_member_subscriber_opt_in()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.marketing_opt_in then
    update public.notification_subscribers
    set active = true,
        updated_at = timezone('utc', now())
    where lower(trim(email)) = lower(trim((select p.email from public.profiles p where p.id = new.user_id)))
      and not active;
  else
    delete from public.notification_subscribers
    where lower(trim(email)) = lower(trim((select p.email from public.profiles p where p.id = new.user_id)));
  end if;
  return new;
end;
$$;

revoke all on function private.sync_member_subscriber_opt_in() from public;
