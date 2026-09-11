alter table public.inventory_adjustments
  add column if not exists inventory_sku_id uuid references public.inventory_skus(id) on delete restrict;

create index if not exists inventory_adjustments_inventory_sku_idx
  on public.inventory_adjustments(inventory_sku_id, created_at desc);

update public.inventory_adjustments a
set inventory_sku_id = i.id
from public.inventory_skus i
where a.inventory_sku_id is null
  and i.sku = a.inventory_sku;
