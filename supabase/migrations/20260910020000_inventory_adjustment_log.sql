create table if not exists public.inventory_adjustments (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  quantity_delta integer not null check (quantity_delta <> 0),
  quantity_after integer not null check (quantity_after >= 0),
  note text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists inventory_adjustments_product_idx
  on public.inventory_adjustments(product_id, created_at desc);

alter table public.inventory_adjustments enable row level security;

drop policy if exists inventory_adjustments_admin_all on public.inventory_adjustments;
create policy inventory_adjustments_admin_all on public.inventory_adjustments
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));
