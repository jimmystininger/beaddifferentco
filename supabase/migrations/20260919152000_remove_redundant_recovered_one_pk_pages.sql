begin;

with new_exact as (
  select
    p.id,
    regexp_replace(lower(p.external_id), '-1pk$', '') as family
  from public.products p
  where lower(p.external_id) like '%-1pk'
    and p.created_at >= '2026-09-19T14:48:00Z'
), prior_page_families as (
  select
    p.id,
    regexp_replace(lower(value.inventory_sku), '-(1|2|5|10|20|25)pk$', '') as family
  from public.products p
  join public.product_options option_row on option_row.product_id = p.id
  join public.product_option_values value on value.option_id = option_row.id
  where p.created_at < '2026-09-19T14:48:00Z'
    and value.inventory_sku is not null
  group by p.id, regexp_replace(lower(value.inventory_sku), '-(1|2|5|10|20|25)pk$', '')
), pure_prior_pages as (
  select id, min(family) as family
  from prior_page_families
  group by id
  having count(*) = 1
), redundant_pages as (
  select new_page.id
  from new_exact new_page
  join pure_prior_pages prior_page on prior_page.family = new_page.family
)
delete from public.products product
using redundant_pages redundant
where product.id = redundant.id;

commit;
