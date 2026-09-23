alter table public.order_support_requests
  add column if not exists order_id uuid references public.orders(id) on delete set null,
  add column if not exists admin_response text,
  add column if not exists responded_at timestamptz;

create index if not exists order_support_requests_order_id_idx
  on public.order_support_requests(order_id);

update public.order_support_requests request
set order_id = orders.id
from public.orders
where request.order_id is null
  and nullif(regexp_replace(request.order_number, '[^0-9]', '', 'g'), '')::bigint = orders.order_number;
