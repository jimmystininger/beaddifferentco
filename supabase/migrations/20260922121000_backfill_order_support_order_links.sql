update public.order_support_requests request
set order_id = orders.id
from public.orders
where request.order_id is null
  and nullif(regexp_replace(request.order_number, '[^0-9]', '', 'g'), '')::bigint = orders.order_number;
