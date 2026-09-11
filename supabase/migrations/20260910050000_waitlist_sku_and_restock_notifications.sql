alter table public.waitlist_entries
  add column if not exists inventory_sku_id uuid references public.inventory_skus(id) on delete set null,
  add column if not exists selected_options jsonb not null default '[]'::jsonb,
  add column if not exists requested_total_quantity integer,
  add column if not exists available_quantity_at_request integer not null default 0,
  add column if not exists request_mode text not null default 'partial';

update public.waitlist_entries
set requested_total_quantity = coalesce(requested_total_quantity, requested_quantity)
where requested_total_quantity is null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'waitlist_entries_requested_total_quantity_check') then
    alter table public.waitlist_entries
      add constraint waitlist_entries_requested_total_quantity_check check (requested_total_quantity > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'waitlist_entries_available_quantity_check') then
    alter table public.waitlist_entries
      add constraint waitlist_entries_available_quantity_check check (available_quantity_at_request >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'waitlist_entries_request_mode_check') then
    alter table public.waitlist_entries
      add constraint waitlist_entries_request_mode_check check (request_mode in ('partial', 'full'));
  end if;
end;
$$;

create index if not exists waitlist_entries_inventory_sku_status_idx
  on public.waitlist_entries(inventory_sku_id, status, created_at);

create unique index if not exists waitlist_entries_waiting_sku_unique
  on public.waitlist_entries(user_id, product_id, inventory_sku_id)
  where status = 'waiting' and inventory_sku_id is not null;

create table if not exists public.inventory_restock_events (
  id uuid primary key default gen_random_uuid(),
  inventory_sku_id uuid not null references public.inventory_skus(id) on delete cascade,
  quantity_before integer not null,
  quantity_after integer not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists inventory_restock_events_sku_created_idx
  on public.inventory_restock_events(inventory_sku_id, created_at desc);

create table if not exists public.waitlist_restock_notifications (
  id uuid primary key default gen_random_uuid(),
  waitlist_entry_id uuid not null references public.waitlist_entries(id) on delete cascade,
  restock_event_id uuid not null references public.inventory_restock_events(id) on delete cascade,
  inventory_sku_id uuid not null references public.inventory_skus(id) on delete cascade,
  available_quantity integer not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  created_at timestamptz not null default timezone('utc', now()),
  sent_at timestamptz,
  unique (waitlist_entry_id, restock_event_id)
);

create index if not exists waitlist_restock_notifications_status_idx
  on public.waitlist_restock_notifications(status, created_at);

alter table public.inventory_restock_events enable row level security;
alter table public.waitlist_restock_notifications enable row level security;

drop policy if exists inventory_restock_events_admin_all on public.inventory_restock_events;
create policy inventory_restock_events_admin_all on public.inventory_restock_events
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

drop policy if exists waitlist_restock_notifications_admin_all on public.waitlist_restock_notifications;
create policy waitlist_restock_notifications_admin_all on public.waitlist_restock_notifications
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create or replace function public.enqueue_waitlist_restock_notifications()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  restock_event uuid;
begin
  if tg_op = 'UPDATE' and new.quantity_on_hand > old.quantity_on_hand then
    insert into public.inventory_restock_events (inventory_sku_id, quantity_before, quantity_after)
    values (new.id, old.quantity_on_hand, new.quantity_on_hand)
    returning id into restock_event;

    insert into public.waitlist_restock_notifications (
      waitlist_entry_id,
      restock_event_id,
      inventory_sku_id,
      available_quantity
    )
    select entry.id, restock_event, new.id, new.quantity_on_hand
    from public.waitlist_entries entry
    where entry.inventory_sku_id = new.id
      and entry.status = 'waiting'
    on conflict (waitlist_entry_id, restock_event_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_sku_restock_waitlist_trigger on public.inventory_skus;
create trigger inventory_sku_restock_waitlist_trigger
  after update of quantity_on_hand on public.inventory_skus
  for each row
  execute function public.enqueue_waitlist_restock_notifications();

revoke all on function public.enqueue_waitlist_restock_notifications() from public;
