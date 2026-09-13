drop policy if exists waitlist_self_delete on public.waitlist_entries;

create policy waitlist_self_delete
on public.waitlist_entries
for delete
to authenticated
using ((select auth.uid()) = user_id);
