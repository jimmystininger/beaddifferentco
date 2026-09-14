alter function public.get_storefront_category_products(text[], integer, integer, timestamptz, text, text[])
  security definer;

alter function public.get_storefront_category_products(text[], integer, integer, timestamptz, text, text[])
  set search_path = public;

alter function public.get_storefront_category_filters(text)
  security definer;

alter function public.get_storefront_category_filters(text)
  set search_path = public;
