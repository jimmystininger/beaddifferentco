alter table public.business_expense_vendors
  add column if not exists is_active boolean not null default true,
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

create index if not exists business_expense_vendors_active_name_idx
  on public.business_expense_vendors (is_active, lower(btrim(vendor_name)));

create or replace function public.rename_admin_expense_vendor(p_vendor_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_old_name text;
  v_new_name text := btrim(coalesce(p_name, ''));
begin
  if not private.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if v_new_name = '' then
    raise exception 'Vendor name is required' using errcode = '22023';
  end if;
  select vendor_name into v_old_name
  from public.business_expense_vendors
  where id = p_vendor_id and is_active
  for update;
  if not found then
    raise exception 'Active vendor not found' using errcode = 'P0002';
  end if;
  update public.business_expense_vendors
  set vendor_name = v_new_name, updated_at = timezone('utc', now())
  where id = p_vendor_id;
  update public.business_expenses
  set vendor = v_new_name, updated_at = timezone('utc', now())
  where vendor = v_old_name;
end;
$$;

create or replace function public.archive_admin_expense_vendor(p_vendor_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not private.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  update public.business_expense_vendors
  set is_active = false, updated_at = timezone('utc', now())
  where id = p_vendor_id and is_active;
  if not found then
    raise exception 'Active vendor not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.rename_admin_expense_vendor(uuid, text) from public, anon;
grant execute on function public.rename_admin_expense_vendor(uuid, text) to authenticated, service_role;
revoke all on function public.archive_admin_expense_vendor(uuid) from public, anon;
grant execute on function public.archive_admin_expense_vendor(uuid) to authenticated, service_role;

create or replace function public.admin_member_contact_message_counts(p_member_ids uuid[])
returns table(member_id uuid, messages_count bigint)
language sql
security definer
set search_path = public, private
as $$
  select ids.member_id, count(m.id)::bigint as messages_count
  from unnest(coalesce(p_member_ids, '{}'::uuid[])) as ids(member_id)
  join public.profiles p on p.id = ids.member_id
  left join public.contact_messages m
    on m.user_id = ids.member_id
    or lower(trim(m.email)) = lower(trim(p.email))
  where private.is_admin()
  group by ids.member_id;
$$;

revoke all on function public.admin_member_contact_message_counts(uuid[]) from public, anon;
grant execute on function public.admin_member_contact_message_counts(uuid[]) to authenticated, service_role;

create or replace function public.admin_member_contact_messages(
  p_member_id uuid,
  p_page integer default 1,
  p_page_size integer default 10
)
returns table(
  id uuid,
  user_id uuid,
  email text,
  name text,
  subject text,
  message text,
  admin_response text,
  status text,
  created_at timestamptz,
  total_count bigint
)
language sql
security definer
set search_path = public, private
as $$
  select m.id, m.user_id, m.email, m.name, m.subject, m.message,
         m.admin_response, m.status, m.created_at,
         count(*) over()::bigint as total_count
  from public.profiles p
  join public.contact_messages m
    on m.user_id = p.id
    or lower(trim(m.email)) = lower(trim(p.email))
  where p.id = p_member_id
    and private.is_admin()
  order by m.created_at desc, m.id desc
  limit greatest(1, least(coalesce(p_page_size, 10), 100))
  offset (greatest(coalesce(p_page, 1), 1) - 1) * greatest(1, least(coalesce(p_page_size, 10), 100));
$$;

revoke all on function public.admin_member_contact_messages(uuid, integer, integer) from public, anon;
grant execute on function public.admin_member_contact_messages(uuid, integer, integer) to authenticated, service_role;
