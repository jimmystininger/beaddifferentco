alter table public.customer_reward_codes
  add column if not exists redeemed_qualifying_spend numeric;

create or replace function private.redeem_customer_reward_promo()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  reward_user_id uuid;
  reward_redeemed_at timestamptz;
  qualifying_before_order numeric := 0;
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

  if reward_user_id is null then return new; end if;
  if reward_user_id <> new.user_id then raise exception 'That reward code belongs to another account.'; end if;
  if reward_redeemed_at is not null then raise exception 'That reward code has already been used.'; end if;

  select coalesce(sum(subtotal), 0)
    into qualifying_before_order
  from public.orders
  where user_id = new.user_id
    and status in ('paid', 'processing', 'shipped', 'completed');

  update public.customer_reward_codes
  set redeemed_at = timezone('utc', now()),
      redeemed_qualifying_spend = qualifying_before_order + greatest(0, coalesce(new.subtotal, 0))
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
  cycle_spend numeric := 0;
  redeemed_spend numeric := 0;
  redeemed_reward_number integer := 0;
  current_reward_number integer := 0;
  reward record;
  progress numeric := 0;
begin
  if current_user_id is null then raise exception 'Please sign in to view your rewards.'; end if;

  select greatest(0.01, coalesce((value->'config'->>'rewardThreshold')::numeric, 35)),
         least(100, greatest(0.01, coalesce((value->'config'->>'rewardDiscountPercent')::numeric, 5)))
    into reward_threshold, reward_discount
  from public.site_settings where key = 'store';

  select coalesce(sum(subtotal), 0) into qualifying_spend
  from public.orders
  where user_id = current_user_id and status in ('paid', 'processing', 'shipped', 'completed');

  select reward_number, coalesce(redeemed_qualifying_spend, 0)
    into redeemed_reward_number, redeemed_spend
  from public.customer_reward_codes
  where user_id = current_user_id and redeemed_at is not null
  order by redeemed_at desc limit 1;

  redeemed_reward_number := coalesce(redeemed_reward_number, 0);
  redeemed_spend := coalesce(redeemed_spend, 0);

  cycle_spend := greatest(0, qualifying_spend - redeemed_spend);
  current_reward_number := redeemed_reward_number + floor(cycle_spend / reward_threshold)::integer;

  select code, reward_number, redeemed_at into reward
  from public.customer_reward_codes
  where user_id = current_user_id and reward_number = current_reward_number
  order by reward_number desc limit 1;

  if reward.redeemed_at is not null then
    progress := cycle_spend;
  else
    progress := least(reward_threshold, greatest(0, cycle_spend - greatest(current_reward_number - redeemed_reward_number - 1, 0) * reward_threshold));
  end if;

  return jsonb_build_object(
    'spend', cycle_spend,
    'threshold', reward_threshold,
    'discountPercent', reward_discount,
    'progress', progress,
    'available', current_reward_number > redeemed_reward_number and (reward.code is null or reward.redeemed_at is null),
    'code', reward.code,
    'rewardNumber', greatest(current_reward_number, redeemed_reward_number)
  );
end;
$$;

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
  cycle_spend numeric := 0;
  redeemed_spend numeric := 0;
  redeemed_reward_number integer := 0;
  current_reward_number integer := 0;
  reward public.customer_reward_codes;
  reward_code text;
begin
  if current_user_id is null then raise exception 'Please sign in to claim your reward.'; end if;

  select greatest(0.01, coalesce((value->'config'->>'rewardThreshold')::numeric, 35)),
         least(100, greatest(0.01, coalesce((value->'config'->>'rewardDiscountPercent')::numeric, 5)))
    into reward_threshold, reward_discount
  from public.site_settings where key = 'store';

  select coalesce(sum(subtotal), 0) into qualifying_spend
  from public.orders
  where user_id = current_user_id and status in ('paid', 'processing', 'shipped', 'completed');

  select reward_number, coalesce(redeemed_qualifying_spend, 0)
    into redeemed_reward_number, redeemed_spend
  from public.customer_reward_codes
  where user_id = current_user_id and redeemed_at is not null
  order by redeemed_at desc limit 1;

  redeemed_reward_number := coalesce(redeemed_reward_number, 0);
  redeemed_spend := coalesce(redeemed_spend, 0);

  cycle_spend := greatest(0, qualifying_spend - redeemed_spend);
  current_reward_number := redeemed_reward_number + floor(cycle_spend / reward_threshold)::integer;
  if current_reward_number <= redeemed_reward_number then
    raise exception 'Spend $% more before claiming this reward.', to_char(reward_threshold - cycle_spend, 'FM999999990.00');
  end if;

  select * into reward from public.customer_reward_codes
  where user_id = current_user_id and reward_number = current_reward_number and redeemed_at is null
  for update;

  if reward.id is null then
    reward_code := 'BD-REWARD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
    insert into public.customer_reward_codes (user_id, reward_number, threshold_amount, discount_percent, code)
    values (current_user_id, current_reward_number, reward_threshold, reward_discount, reward_code)
    returning * into reward;
    insert into public.promo_codes (code, mode, discount_type, value, active, reward_code_id)
    values (reward.code, 'manual', 'percent', reward.discount_percent, true, reward.id);
  end if;

  return jsonb_build_object('code', reward.code, 'threshold', reward.threshold_amount, 'discountPercent', reward.discount_percent, 'rewardNumber', reward.reward_number);
end;
$$;
