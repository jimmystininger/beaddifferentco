alter table public.products
  add column if not exists sku_filter_definitions jsonb not null default '[]'::jsonb;

alter table public.product_option_values
  add column if not exists sku_filter_options jsonb not null default '[]'::jsonb;

alter table public.products
  drop constraint if exists products_sku_filter_definitions_shape;

alter table public.products
  add constraint products_sku_filter_definitions_shape
  check (jsonb_typeof(sku_filter_definitions) = 'array' and jsonb_array_length(sku_filter_definitions) <= 3);

alter table public.product_option_values
  drop constraint if exists product_option_values_sku_filter_options_shape;

alter table public.product_option_values
  add constraint product_option_values_sku_filter_options_shape
  check (jsonb_typeof(sku_filter_options) = 'array' and jsonb_array_length(sku_filter_options) <= 3);
