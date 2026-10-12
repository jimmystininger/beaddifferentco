create table if not exists public.etsy_sale_line_exclusions (
  external_order_id text not null,
  external_line_id text not null,
  reason text not null,
  created_at timestamptz not null default timezone('utc', now()),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  primary key (external_order_id, external_line_id),
  foreign key (external_order_id, external_line_id)
    references public.etsy_sale_lines (external_order_id, external_line_id)
    on delete cascade
);

alter table public.etsy_sale_line_exclusions enable row level security;

create policy etsy_sale_line_exclusions_admin_select
  on public.etsy_sale_line_exclusions
  for select to authenticated
  using ((select private.is_admin()));

revoke all on public.etsy_sale_line_exclusions from public, anon, authenticated;
grant select on public.etsy_sale_line_exclusions to authenticated;

insert into public.etsy_sale_line_exclusions (
  external_order_id,
  external_line_id,
  reason
)
select
  external_order_id,
  external_line_id,
  'User requested permanent hiding of this no-SKU custom order from unmatched Etsy sales.'
from public.etsy_sale_lines
where external_order_id = '4187735339'
  and external_line_id = '5235973910'
  and etsy_sku = 'listing:4585747471'
  and matched_inventory_sku is null
on conflict (external_order_id, external_line_id) do nothing;
