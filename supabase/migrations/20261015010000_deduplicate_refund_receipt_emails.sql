create table public.refund_receipt_email_deliveries (
  stripe_refund_id text primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  status text not null check (status in ('sending', 'sent', 'failed')),
  last_error text,
  created_at timestamptz not null default timezone('utc', now()),
  sent_at timestamptz
);

alter table public.refund_receipt_email_deliveries enable row level security;
revoke all on table public.refund_receipt_email_deliveries from public, anon, authenticated;
grant select, insert, update, delete on table public.refund_receipt_email_deliveries to service_role;

insert into public.refund_receipt_email_deliveries (stripe_refund_id, order_id, status, sent_at)
select refund.stripe_refund_id,
       refund.order_id,
       'sent',
       (select max(email.created_at)
          from public.admin_email_log email
         where email.order_id = refund.order_id
           and email.email_type = 'refund_receipt')
  from public.stripe_refunds refund
 where refund.status = 'succeeded'
   and (select count(*)
          from public.stripe_refunds other_refund
         where other_refund.order_id = refund.order_id
           and other_refund.status = 'succeeded') = 1
   and exists (select 1
                 from public.admin_email_log email
                where email.order_id = refund.order_id
                  and email.email_type = 'refund_receipt')
on conflict (stripe_refund_id) do nothing;
