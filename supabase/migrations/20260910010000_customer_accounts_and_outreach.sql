create table public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  label text not null,
  recipient_name text not null,
  address_line1 text not null,
  address_line2 text,
  city text not null,
  state text not null,
  postal_code text not null,
  country text not null default 'US',
  is_default boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.customer_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  marketing_opt_in boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.customer_favorites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, product_id)
);

create table public.customer_carts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.customer_cart_items (
  cart_user_id uuid not null references public.customer_carts(user_id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity integer not null check (quantity > 0),
  selected_options jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (cart_user_id, product_id)
);

create table public.email_campaigns (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete restrict,
  subject text not null,
  body text not null,
  audience text not null default 'marketing_opted_in' check (audience in ('marketing_opted_in', 'waitlist_product')),
  product_id uuid references public.products(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'queued', 'sent', 'cancelled')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index customer_addresses_user_idx on public.customer_addresses(user_id, is_default desc, updated_at desc);
create index customer_favorites_product_idx on public.customer_favorites(product_id);
create index email_campaigns_status_idx on public.email_campaigns(status, created_at desc);

alter table public.customer_addresses enable row level security;
alter table public.customer_preferences enable row level security;
alter table public.customer_favorites enable row level security;
alter table public.customer_carts enable row level security;
alter table public.customer_cart_items enable row level security;
alter table public.email_campaigns enable row level security;

create policy customer_addresses_self_read on public.customer_addresses for select to authenticated using ((select auth.uid()) = user_id or (select private.is_admin()));
create policy customer_addresses_self_insert on public.customer_addresses for insert to authenticated with check ((select auth.uid()) = user_id);
create policy customer_addresses_self_update on public.customer_addresses for update to authenticated using ((select auth.uid()) = user_id or (select private.is_admin())) with check ((select auth.uid()) = user_id or (select private.is_admin()));
create policy customer_addresses_self_delete on public.customer_addresses for delete to authenticated using ((select auth.uid()) = user_id or (select private.is_admin()));

create policy customer_preferences_self_read on public.customer_preferences for select to authenticated using ((select auth.uid()) = user_id or (select private.is_admin()));
create policy customer_preferences_self_insert on public.customer_preferences for insert to authenticated with check ((select auth.uid()) = user_id);
create policy customer_preferences_self_update on public.customer_preferences for update to authenticated using ((select auth.uid()) = user_id or (select private.is_admin())) with check ((select auth.uid()) = user_id or (select private.is_admin()));

create policy customer_favorites_self_all on public.customer_favorites for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy customer_carts_self_all on public.customer_carts for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy customer_cart_items_self_all on public.customer_cart_items for all to authenticated using ((select auth.uid()) = cart_user_id) with check ((select auth.uid()) = cart_user_id);

create policy email_campaigns_admin_all on public.email_campaigns for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated using ((select auth.uid()) = id or (select private.is_admin())) with check ((select private.is_admin()) or ((select auth.uid()) = id and role = 'customer' and status = 'active'));

drop policy if exists reviews_self_insert on public.reviews;
create policy reviews_self_insert on public.reviews for insert to authenticated with check (
  (select auth.uid()) = user_id
  and (
    review_type = 'website'
    or (
      review_type = 'item'
      and product_id is not null
      and exists (
        select 1
        from public.order_items oi
        join public.orders o on o.id = oi.order_id
        where o.user_id = (select auth.uid())
          and oi.product_id = reviews.product_id
          and o.status in ('paid', 'processing', 'shipped', 'completed')
      )
    )
  )
);
