-- Keep outside-sales avenues canonical across CRUD, sale records, and metrics.

alter table public.manual_sales_channels
  add column if not exists id uuid default gen_random_uuid();

update public.manual_sales_channels
set id = gen_random_uuid()
where id is null;

alter table public.manual_sales_channels
  alter column id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.manual_sales_channels'::regclass and contype = 'p'
  ) then
    alter table public.manual_sales_channels
      add constraint manual_sales_channels_pkey primary key (id);
  end if;
end;
$$;

alter table public.manual_sales
  add column if not exists sales_channel_id uuid;

-- The original constraint only allowed cash/facebook/other and rejected
-- legitimate saved avenue names such as Facebook Marketplace.
alter table public.manual_sales
  drop constraint if exists manual_sales_sales_channel_check;

alter table public.manual_sales
  add constraint manual_sales_sales_channel_name_check
  check (length(btrim(sales_channel)) between 1 and 80);

update public.manual_sales sale
set sales_channel_id = channel.id,
    sales_channel = channel.name
from public.manual_sales_channels channel
where sale.sales_channel_id is null
  and channel.normalized_name = lower(btrim(sale.sales_channel));

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.manual_sales'::regclass
      and conname = 'manual_sales_sales_channel_id_fkey'
  ) then
    alter table public.manual_sales
      add constraint manual_sales_sales_channel_id_fkey
      foreign key (sales_channel_id)
      references public.manual_sales_channels(id)
      on delete restrict;
  end if;
end;
$$;

create index if not exists manual_sales_sales_channel_id_idx
  on public.manual_sales(sales_channel_id);

-- The existing sale-recording RPC accepts the selected avenue name. Resolve
-- it once at the database boundary and persist the stable relationship.
create or replace function public.sync_manual_sales_channel_reference()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  channel_id_value uuid;
  channel_name_value text;
begin
  select channel.id, channel.name
  into channel_id_value, channel_name_value
  from public.manual_sales_channels channel
  where channel.active
    and (
      channel.id::text = lower(trim(coalesce(new.sales_channel, '')))
      or channel.normalized_name = lower(trim(coalesce(new.sales_channel, '')))
    );
  if channel_id_value is null then
    raise exception 'Choose a saved sales avenue.';
  end if;
  new.sales_channel_id := channel_id_value;
  new.sales_channel := channel_name_value;
  return new;
end;
$$;

drop trigger if exists manual_sales_sync_channel_reference on public.manual_sales;
create trigger manual_sales_sync_channel_reference
before insert on public.manual_sales
for each row execute function public.sync_manual_sales_channel_reference();

revoke all on function public.sync_manual_sales_channel_reference() from public, anon, authenticated;

-- Keep the management RPC backward compatible while making edits/removals use
-- the stable avenue id from the admin UI. Renames update the saved display
-- value so every existing metric and detail report follows the current name.
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
  channel_key text := nullif(btrim(coalesce(p_channel_name, '')), '');
  new_name text := nullif(btrim(coalesce(p_name, '')), '');
  channel_id_value uuid;
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
  elsif p_action in ('rename', 'delete') then
    if channel_key is null then
      raise exception 'Sales avenue is required.';
    end if;
    select channel.id into channel_id_value
    from public.manual_sales_channels channel
    where channel.id::text = lower(channel_key)
       or channel.normalized_name = lower(channel_key);
    if channel_id_value is null then
      raise exception 'Sales avenue not found.';
    end if;
    if p_action = 'rename' then
      if new_name is null then
        raise exception 'Sales avenue name is required.';
      end if;
      update public.manual_sales_channels
      set name = new_name
      where id = channel_id_value;
      update public.manual_sales
      set sales_channel = new_name
      where sales_channel_id = channel_id_value;
    else
      update public.manual_sales_channels
      set active = false
      where id = channel_id_value and active;
      if not found then
        raise exception 'Active sales avenue not found.';
      end if;
    end if;
  else
    raise exception 'Unsupported sales avenue action.';
  end if;
end;
$$;

revoke all on function public.admin_manage_manual_sales_channel(text, text, text) from public, anon;
grant execute on function public.admin_manage_manual_sales_channel(text, text, text) to authenticated, service_role;
