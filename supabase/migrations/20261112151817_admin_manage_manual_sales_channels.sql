-- Manage outside-sales avenues by their canonical normalized name.
create or replace function public.admin_manage_manual_sales_channel(
  p_action text,
  p_channel_name text default null,
  p_name text default null
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  old_name text := nullif(btrim(coalesce(p_channel_name, '')), '');
  new_name text := nullif(btrim(coalesce(p_name, '')), '');
begin
  if not private.is_admin() then
    raise exception 'Admin access required.';
  end if;

  if p_action = 'create' then
    if new_name is null then
      raise exception 'Sales avenue name is required.';
    end if;
    insert into public.manual_sales_channels (name)
    values (new_name)
    on conflict (normalized_name) do update set active = true;
  elsif p_action = 'rename' then
    if old_name is null or new_name is null then
      raise exception 'Both the existing and new sales avenue names are required.';
    end if;
    update public.manual_sales_channels
    set name = new_name
    where normalized_name = lower(old_name);
    if not found then
      raise exception 'Sales avenue not found.';
    end if;
  elsif p_action = 'delete' then
    if old_name is null then
      raise exception 'Sales avenue name is required.';
    end if;
    update public.manual_sales_channels
    set active = false
    where normalized_name = lower(old_name)
      and active;
    if not found then
      raise exception 'Active sales avenue not found.';
    end if;
  else
    raise exception 'Unsupported sales avenue action.';
  end if;
end;
$$;

revoke all on function public.admin_manage_manual_sales_channel(text, text, text) from public, anon;
grant execute on function public.admin_manage_manual_sales_channel(text, text, text) to authenticated, service_role;
