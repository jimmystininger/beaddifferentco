alter table public.reviews
  add column if not exists admin_response text,
  add column if not exists admin_response_at timestamptz;

comment on column public.reviews.admin_response is 'Optional public response written by an administrator.';
