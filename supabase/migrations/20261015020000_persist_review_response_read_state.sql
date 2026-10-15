alter table public.profiles
  add column if not exists review_responses_viewed_at timestamptz;
