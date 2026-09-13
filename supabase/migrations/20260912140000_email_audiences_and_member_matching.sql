alter table public.email_campaigns
  drop constraint if exists email_campaigns_audience_check;

update public.email_campaigns
set audience = 'all_subscribers_optins'
where audience = 'marketing_opted_in';

alter table public.email_campaigns
  add constraint email_campaigns_audience_check
  check (audience in ('all_subscribers_optins', 'member_optins', 'nonmember_subscribers', 'waitlist_product'));

create or replace function private.sync_subscriber_member_opt_in()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.active and nullif(trim(new.email), '') is not null then
    insert into public.customer_preferences (user_id, marketing_opt_in, updated_at)
    select p.id, true, timezone('utc', now())
    from public.profiles p
    where lower(trim(p.email)) = lower(trim(new.email))
    on conflict (user_id) do update
      set marketing_opt_in = true,
          updated_at = timezone('utc', now());
  end if;
  return new;
end;
$$;

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
  end if;
  return new;
end;
$$;

create or replace function private.sync_profile_subscriber_opt_in()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if nullif(trim(new.email), '') is not null and exists (
    select 1
    from public.notification_subscribers s
    where lower(trim(s.email)) = lower(trim(new.email))
      and s.active
  ) then
    insert into public.customer_preferences (user_id, marketing_opt_in, updated_at)
    values (new.id, true, timezone('utc', now()))
    on conflict (user_id) do update
      set marketing_opt_in = true,
          updated_at = timezone('utc', now());
  end if;
  return new;
end;
$$;

drop trigger if exists on_notification_subscriber_member_match on public.notification_subscribers;
create trigger on_notification_subscriber_member_match
after insert or update of email, active on public.notification_subscribers
for each row execute procedure private.sync_subscriber_member_opt_in();

drop trigger if exists on_member_subscriber_opt_in on public.customer_preferences;
create trigger on_member_subscriber_opt_in
after insert or update of marketing_opt_in on public.customer_preferences
for each row execute procedure private.sync_member_subscriber_opt_in();

drop trigger if exists on_profile_subscriber_match on public.profiles;
create trigger on_profile_subscriber_match
after insert or update of email on public.profiles
for each row execute procedure private.sync_profile_subscriber_opt_in();

revoke all on function private.sync_subscriber_member_opt_in() from public;
revoke all on function private.sync_member_subscriber_opt_in() from public;
revoke all on function private.sync_profile_subscriber_opt_in() from public;
