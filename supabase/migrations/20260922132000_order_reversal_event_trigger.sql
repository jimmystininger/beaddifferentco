create or replace function public.log_order_reversal_event()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if new.status in ('cancelled','refunded') and old.status not in ('cancelled','refunded') then
    insert into public.order_financial_events(order_id,event_type,amount,reason,metadata,created_by)
    values(new.id,case when new.status='cancelled' then 'cancellation' else 'refund' end,
      greatest(0,round(coalesce(new.refunded_amount,0)-coalesce(old.refunded_amount,0),2)),
      coalesce(new.cancellation_reason,new.refund_reason),jsonb_build_object('status',new.status),coalesce(new.inventory_restored_by,(select auth.uid())));
  end if;
  return new;
end; $$;
drop trigger if exists orders_reversal_event_log on public.orders;
create trigger orders_reversal_event_log after update of status on public.orders for each row execute function public.log_order_reversal_event();
revoke all on function public.log_order_reversal_event() from public, anon, authenticated;
