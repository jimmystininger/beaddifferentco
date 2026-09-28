create or replace function private.merge_store_settings_value()
returns trigger
language plpgsql
set search_path = public, private
as $$
begin
  if new.key = 'store' and tg_op = 'UPDATE' then
    new.value :=
      (coalesce(old.value, '{}'::jsonb) || coalesce(new.value, '{}'::jsonb))
      || jsonb_build_object(
        'config', coalesce(old.value->'config', '{}'::jsonb) || coalesce(new.value->'config', '{}'::jsonb),
        'admin', coalesce(old.value->'admin', '{}'::jsonb) || coalesce(new.value->'admin', '{}'::jsonb)
      );
  end if;
  return new;
end;
$$;

drop trigger if exists merge_store_settings_value on public.site_settings;
create trigger merge_store_settings_value
before update of value on public.site_settings
for each row
when (new.key = 'store')
execute function private.merge_store_settings_value();

revoke all on function private.merge_store_settings_value() from public, anon, authenticated;
