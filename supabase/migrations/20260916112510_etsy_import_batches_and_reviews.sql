-- Etsy imports are prepared by the private Edge Function and applied by this
-- administrator-only RPC. Browser roles never receive a batch payload.
alter table public.products
  add column if not exists etsy_listing_id bigint;

create unique index if not exists products_etsy_listing_id_unique
  on public.products (etsy_listing_id)
  where etsy_listing_id is not null;

alter table public.reviews
  alter column user_id drop not null,
  add column if not exists reviewer_name text,
  add column if not exists external_source text,
  add column if not exists external_review_id text;

create unique index if not exists reviews_external_source_id_unique
  on public.reviews (external_source, external_review_id)
  where external_source is not null and external_review_id is not null;

create table if not exists public.etsy_import_batches (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('orders', 'reviews')),
  payload jsonb not null,
  expires_at timestamptz not null,
  applied_at timestamptz,
  result jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists etsy_import_batches_created_by_idx
  on public.etsy_import_batches (created_by, created_at desc);

alter table public.etsy_import_batches enable row level security;
revoke all on public.etsy_import_batches from public, anon, authenticated;
grant select, insert, update, delete on public.etsy_import_batches to service_role;

create or replace function public.apply_etsy_import_batch(batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  current_user_id uuid := (select auth.uid());
  batch public.etsy_import_batches%rowtype;
  review_row jsonb;
  was_inserted boolean;
  result_value jsonb;
  inserted_count integer := 0;
  updated_count integer := 0;
begin
  if current_user_id is null or not private.is_admin() then
    raise exception 'Only an administrator can apply an Etsy import.';
  end if;

  select * into batch
  from public.etsy_import_batches
  where id = batch_id and created_by = current_user_id
  for update;

  if batch.id is null then
    raise exception 'This import preview is unavailable. Create a new preview.';
  end if;
  if batch.applied_at is not null then
    return coalesce(batch.result, jsonb_build_object('status', 'already_applied'));
  end if;
  if batch.expires_at <= timezone('utc', now()) then
    raise exception 'This import preview expired. Create a new preview.';
  end if;

  if batch.kind = 'orders' then
    result_value := public.import_etsy_sales(batch.payload->'sales', true);
  else
    for review_row in select value from jsonb_array_elements(batch.payload->'reviews') as entries(value)
    loop
      insert into public.reviews (
        user_id, product_id, review_type, rating, body, photos, status,
        verified_purchase, reviewer_name, external_source, external_review_id,
        created_at, updated_at
      ) values (
        null,
        nullif(review_row->>'product_id', '')::uuid,
        'item',
        greatest(1, least(5, coalesce(nullif(review_row->>'rating', '')::integer, 5))),
        coalesce(review_row->>'body', ''),
        coalesce(array(select jsonb_array_elements_text(coalesce(review_row->'photos', '[]'::jsonb))), '{}'::text[]),
        'approved', true,
        nullif(left(trim(coalesce(review_row->>'reviewer_name', '')), 120), ''),
        'etsy',
        review_row->>'external_review_id',
        coalesce(nullif(review_row->>'created_at', '')::timestamptz, timezone('utc', now())),
        timezone('utc', now())
      )
      on conflict (external_source, external_review_id) where external_source is not null and external_review_id is not null
      do update set
        product_id = excluded.product_id,
        rating = excluded.rating,
        body = excluded.body,
        photos = excluded.photos,
        reviewer_name = excluded.reviewer_name,
        updated_at = timezone('utc', now())
      returning (xmax = 0) into was_inserted;
      if was_inserted then inserted_count := inserted_count + 1;
      else updated_count := updated_count + 1;
      end if;
    end loop;
    result_value := jsonb_build_object('inserted', inserted_count, 'updated', updated_count);
  end if;

  update public.etsy_import_batches
  set applied_at = timezone('utc', now()), result = result_value
  where id = batch.id;
  return result_value;
end;
$$;

revoke all on function public.apply_etsy_import_batch(uuid) from public, anon;
grant execute on function public.apply_etsy_import_batch(uuid) to authenticated;
