create schema if not exists private;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'customer' check (role in ('customer', 'admin')),
  status text not null default 'active' check (status in ('active', 'blocked')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  cover_photo text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  external_id text unique,
  sku text unique,
  category_slug text not null default 'uncategorized',
  name text not null,
  seo_title text,
  search_text text,
  description text,
  item_details text,
  shipping_details text,
  price numeric not null default 0 check (price >= 0),
  quantity integer not null default 0 check (quantity >= 0),
  visible boolean not null default false,
  waitlist_enabled boolean not null default true,
  added_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  url text not null,
  alt_text text,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.product_options (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  name text not null,
  required boolean not null default false,
  sort_order integer not null default 0
);

create table public.product_option_values (
  id uuid primary key default gen_random_uuid(),
  option_id uuid not null references public.product_options(id) on delete cascade,
  label text not null,
  price_delta numeric not null default 0,
  sort_order integer not null default 0
);

create table public.waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  requested_quantity integer not null check (requested_quantity > 0),
  status text not null default 'waiting' check (status in ('waiting', 'notified', 'fulfilled', 'cancelled')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  review_type text not null check (review_type in ('item', 'website')),
  rating integer not null check (rating between 1 and 5),
  body text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'blocked')),
  verified_purchase boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.promo_codes (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  mode text not null check (mode in ('auto', 'manual')),
  discount_type text not null check (discount_type in ('percent', 'fixed')),
  value numeric not null check (value >= 0),
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'paid', 'processing', 'shipped', 'completed', 'cancelled', 'refunded')),
  subtotal numeric not null default 0 check (subtotal >= 0),
  discount numeric not null default 0 check (discount >= 0),
  total numeric not null default 0 check (total >= 0),
  shipping_name text,
  shipping_address jsonb,
  carrier text,
  tracking_number text,
  shipped_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  sku text,
  quantity integer not null check (quantity > 0),
  unit_price numeric not null check (unit_price >= 0),
  selected_options jsonb not null default '{}'::jsonb
);

create table public.member_notes (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  note text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create or replace function private.is_admin()
returns boolean language sql security definer set search_path = public, private
as $$ select exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin' and status = 'active'); $$;

revoke all on function private.is_admin() from public;
grant execute on function private.is_admin() to authenticated;

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, private
as $$ begin insert into public.profiles (id, email, full_name) values (new.id, new.email, new.raw_user_meta_data ->> 'full_name') on conflict (id) do update set email = excluded.email, full_name = coalesce(excluded.full_name, profiles.full_name), updated_at = timezone('utc', now()); return new; end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure private.handle_new_user();

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_images enable row level security;
alter table public.product_options enable row level security;
alter table public.product_option_values enable row level security;
alter table public.waitlist_entries enable row level security;
alter table public.reviews enable row level security;
alter table public.promo_codes enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.member_notes enable row level security;

