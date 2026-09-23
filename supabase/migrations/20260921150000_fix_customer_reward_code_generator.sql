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
    reward_code := 'BD-REWARD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
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
