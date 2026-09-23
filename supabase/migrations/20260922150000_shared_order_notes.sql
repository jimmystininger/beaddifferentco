create table if not exists public.order_notes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  note text not null check (length(trim(note)) > 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists order_notes_order_idx on public.order_notes(order_id, created_at desc);
alter table public.order_notes enable row level security;
grant select on public.order_notes to authenticated;
drop policy if exists order_notes_admin_read on public.order_notes;
create policy order_notes_admin_read on public.order_notes for select to authenticated using ((select private.is_admin()));
revoke all on public.order_notes from anon;

create or replace function public.add_order_note(order_id_value uuid, note_value text)
returns public.order_notes language plpgsql security definer set search_path = public, private as $$
declare created public.order_notes;
begin
  if not private.is_admin() then raise exception 'Admin access required.'; end if;
  if nullif(trim(note_value), '') is null then raise exception 'Enter a note before saving.'; end if;
  insert into public.order_notes(order_id, note, created_by)
  values(order_id_value, trim(note_value), auth.uid())
  returning * into created;
  return created;
end; $$;

revoke all on function public.add_order_note(uuid, text) from public, anon;
grant execute on function public.add_order_note(uuid, text) to authenticated;
