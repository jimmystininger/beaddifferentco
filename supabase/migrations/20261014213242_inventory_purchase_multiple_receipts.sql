create table if not exists public.inventory_purchase_receipts (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.inventory_purchases(id) on delete cascade,
  receipt_path text not null unique,
  receipt_name text not null,
  content_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists inventory_purchase_receipts_purchase_idx
  on public.inventory_purchase_receipts(purchase_id, created_at, id);

alter table public.inventory_purchase_receipts enable row level security;

revoke all on public.inventory_purchase_receipts from public, anon, authenticated;
grant select on public.inventory_purchase_receipts to authenticated;

drop policy if exists inventory_purchase_receipts_admin_select
  on public.inventory_purchase_receipts;
create policy inventory_purchase_receipts_admin_select
  on public.inventory_purchase_receipts
  for select
  to authenticated
  using ((select private.is_admin()));

create or replace function public.import_inventory_purchase_with_receipts(purchase_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  import_result jsonb;
  purchase_id_value uuid;
  receipt_value jsonb;
  receipt_files jsonb := coalesce(purchase_payload->'receipt_files', '[]'::jsonb);
  receipt_path_value text;
  receipt_name_value text;
  content_type_value text;
  size_bytes_value bigint;
  receipt_count integer := 0;
begin
  if not private.is_admin() then
    raise exception 'Admin access required.';
  end if;
  if jsonb_typeof(receipt_files) <> 'array' then
    raise exception 'Receipt copies must be provided as a list.';
  end if;

  import_result := public.import_inventory_purchase(purchase_payload);
  purchase_id_value := nullif(import_result->>'id', '')::uuid;
  if purchase_id_value is null then
    raise exception 'The inventory purchase could not be confirmed.';
  end if;

  for receipt_value in select value from jsonb_array_elements(receipt_files) as entries(value)
  loop
    receipt_path_value := nullif(trim(receipt_value->>'receipt_path'), '');
    receipt_name_value := nullif(trim(receipt_value->>'receipt_name'), '');
    content_type_value := nullif(trim(receipt_value->>'content_type'), '');
    size_bytes_value := nullif(trim(receipt_value->>'size_bytes'), '')::bigint;
    if receipt_path_value is null or receipt_name_value is null then
      raise exception 'Every receipt copy needs a stored file and file name.';
    end if;
    if auth.uid() is null or split_part(receipt_path_value, '/', 1) <> auth.uid()::text then
      raise exception 'Receipt files must belong to the signed-in admin.';
    end if;
    if size_bytes_value is not null and size_bytes_value < 0 then
      raise exception 'Receipt file size cannot be negative.';
    end if;

    insert into public.inventory_purchase_receipts (
      purchase_id, receipt_path, receipt_name, content_type, size_bytes
    ) values (
      purchase_id_value, receipt_path_value, receipt_name_value,
      content_type_value, size_bytes_value
    );
    receipt_count := receipt_count + 1;
  end loop;

  return import_result || jsonb_build_object('receipt_count', receipt_count);
end;
$$;

revoke all on function public.import_inventory_purchase_with_receipts(jsonb)
  from public, anon, authenticated;
grant execute on function public.import_inventory_purchase_with_receipts(jsonb)
  to authenticated;
