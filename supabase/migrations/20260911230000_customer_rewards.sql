create table public.customer_reward_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reward_number integer not null check (reward_number > 0),
  threshold_amount numeric not null check (threshold_amount > 0),
  discount_percent numeric not null check (discount_percent > 0 and discount_percent <= 100),
  code text not null unique,
  claimed_at timestamptz not null default timezone('utc', now()),
  redeemed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  unique (user_id, reward_number)
);

create index customer_reward_codes_user_status_idx
  on public.customer_reward_codes(user_id, redeemed_at, reward_number desc);

alter table public.customer_reward_codes enable row level security;

create policy customer_reward_codes_self_read
  on public.customer_reward_codes
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy customer_reward_codes_admin_read
  on public.customer_reward_codes
  for select
  to authenticated
  using ((select private.is_admin()));

grant select on public.customer_reward_codes to authenticated;

alter table public.promo_codes
  add column if not exists reward_code_id uuid references public.customer_reward_codes(id) on delete cascade;

create unique index if not exists promo_codes_reward_code_idx
  on public.promo_codes(reward_code_id)
  where reward_code_id is not null;

create or replace function private.redeem_customer_reward_promo()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  reward_user_id uuid;
  reward_redeemed_at timestamptz;
begin
  if new.promo_code is null or nullif(trim(new.promo_code), '') is null then
    return new;
  end if;

  select reward.user_id, reward.redeemed_at
    into reward_user_id, reward_redeemed_at
  from public.promo_codes promo
  join public.customer_reward_codes reward on reward.id = promo.reward_code_id
  where upper(promo.code) = upper(trim(new.promo_code))
    and promo.active
  for update of reward;

  if reward_user_id is null then
    return new;
  end if;
  if reward_user_id <> new.user_id then
    raise exception 'That reward code belongs to another account.';
  end if;
  if reward_redeemed_at is not null then
    raise exception 'That reward code has already been used.';
  end if;

  update public.customer_reward_codes
  set redeemed_at = timezone('utc', now())
  where id = (
    select promo.reward_code_id
    from public.promo_codes promo
    where upper(promo.code) = upper(trim(new.promo_code))
      and promo.active
    limit 1
  );

  return new;
end;
$$;

drop trigger if exists orders_redeem_customer_reward on public.orders;
create trigger orders_redeem_customer_reward
  before insert on public.orders
  for each row execute function private.redeem_customer_reward_promo();

create or replace function public.get_storefront_reward_settings()
returns jsonb
language sql
security definer
set search_path = public, private
as $$
  select jsonb_build_object(
    'threshold', greatest(0.01, coalesce((value->'config'->>'rewardThreshold')::numeric, 35)),
    'discountPercent', least(100, greatest(0.01, coalesce((value->'config'->>'rewardDiscountPercent')::numeric, 5)))
  )
  from public.site_settings
  where key = 'store'
  union all
  select jsonb_build_object('threshold', 35, 'discountPercent', 5)
  where not exists (select 1 from public.site_settings where key = 'store')
  limit 1;
$$;

revoke all on function public.get_storefront_reward_settings() from public, anon, authenticated;
grant execute on function public.get_storefront_reward_settings() to anon, authenticated;

create or replace function public.get_my_reward_status()
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  current_user_id uuid := (select auth.uid());
  reward_threshold numeric := 35;
  reward_discount numeric := 5;
  qualifying_spend numeric := 0;
  current_reward_number integer := 0;
  reward record;
begin
  if current_user_id is null then
    raise exception 'Please sign in to view your rewards.';
  end if;

  select greatest(0.01, coalesce((value->'config'->>'rewardThreshold')::numeric, 35)),
         least(100, greatest(0.01, coalesce((value->'config'->>'rewardDiscountPercent')::numeric, 5)))
    into reward_threshold, reward_discount
  from public.site_settings
  where key = 'store';

  select coalesce(sum(subtotal), 0)
    into qualifying_spend
  from public.orders
  where user_id = current_user_id
    and status in ('paid', 'processing', 'shipped', 'completed');

  current_reward_number := floor(qualifying_spend / reward_threshold)::integer;

  select code, reward_number, redeemed_at
    into reward
  from public.customer_reward_codes
  where user_id = current_user_id
    and reward_number = current_reward_number
  order by reward_number desc
  limit 1;

  return jsonb_build_object(
    'spend', qualifying_spend,
    'threshold', reward_threshold,
    'discountPercent', reward_discount,
    'progress', case when reward.redeemed_at is not null
      then greatest(0, qualifying_spend - (current_reward_number * reward_threshold))
      else least(reward_threshold, greatest(0, qualifying_spend - (greatest(current_reward_number - 1, 0) * reward_threshold)))
    end,
    'available', current_reward_number > 0 and (reward.code is null or reward.redeemed_at is null),
    'code', reward.code,
    'rewardNumber', coalesce(reward.reward_number, current_reward_number)
  );
end;
$$;

revoke all on function public.get_my_reward_status() from public, anon, authenticated;
grant execute on function public.get_my_reward_status() to authenticated;

create or replace function public.claim_my_reward()
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  current_user_id uuid := (select auth.uid());
  reward_threshold numeric := 35;
  reward_discount numeric := 5;
  qualifying_spend numeric := 0;
  current_reward_number integer := 0;
  reward public.customer_reward_codes;
  reward_code text;
begin
  if current_user_id is null then
    raise exception 'Please sign in to claim your reward.';
  end if;

  select greatest(0.01, coalesce((value->'config'->>'rewardThreshold')::numeric, 35)),
         least(100, greatest(0.01, coalesce((value->'config'->>'rewardDiscountPercent')::numeric, 5)))
    into reward_threshold, reward_discount
  from public.site_settings
  where key = 'store';

  select coalesce(sum(subtotal), 0)
    into qualifying_spend
  from public.orders
  where user_id = current_user_id
    and status in ('paid', 'processing', 'shipped', 'completed');
  current_reward_number := floor(qualifying_spend / reward_threshold)::integer;
  if current_reward_number < 1 then
    raise exception 'Spend $% more before claiming this reward.', to_char(reward_threshold - qualifying_spend, 'FM999999990.00');
  end if;

  select * into reward
  from public.customer_reward_codes
  where user_id = current_user_id
    and reward_number = current_reward_number
    and redeemed_at is null
  for update;
  if reward.id is null then
    reward_code := 'BD-REWARD-' || upper(encode(gen_random_bytes(6), 'hex'));
    insert into public.customer_reward_codes (user_id, reward_number, threshold_amount, discount_percent, code)
    values (current_user_id, current_reward_number, reward_threshold, reward_discount, reward_code)
    returning * into reward;

    insert into public.promo_codes (code, mode, discount_type, value, active, reward_code_id)
    values (reward.code, 'manual', 'percent', reward.discount_percent, true, reward.id);
  end if;

  return jsonb_build_object(
    'code', reward.code,
    'threshold', reward.threshold_amount,
    'discountPercent', reward.discount_percent,
    'rewardNumber', reward.reward_number
  );
end;
$$;

revoke all on function public.claim_my_reward() from public, anon, authenticated;
grant execute on function public.claim_my_reward() to authenticated;
