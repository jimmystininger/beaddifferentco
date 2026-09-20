begin;

create or replace function public.save_product_page_sku_answers(
  p_product_id uuid,
  p_definitions jsonb,
  p_answers jsonb
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  definition_labels jsonb;
  answer jsonb;
  inventory_record record;
  answer_options jsonb;
begin
  if not private.is_admin() then
    raise exception 'Admin access required.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('label', label) order by position), '[]'::jsonb)
    into definition_labels
  from (
    select distinct on (lower(trim(value->>'label')))
      trim(value->>'label') as label,
      position
    from jsonb_array_elements(coalesce(p_definitions, '[]'::jsonb)) with ordinality as definitions(value, position)
    where nullif(trim(value->>'label'), '') is not null
      and position <= 3
    order by lower(trim(value->>'label')), position
  ) labels;

  update public.products
  set sku_filter_definitions = definition_labels,
      updated_at = timezone('utc', now())
  where id = p_product_id;

  if not found then
    raise exception 'Product page not found.';
  end if;

  for answer in
    select value
    from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb)) values(value)
  loop
    if nullif(trim(answer->>'sku'), '') is null then
      continue;
    end if;

    answer_options := case
      when jsonb_typeof(answer->'options') = 'array' then answer->'options'
      else '[]'::jsonb
    end;

    update public.inventory_skus inventory
    set source_metadata = jsonb_set(
          coalesce(inventory.source_metadata, '{}'::jsonb),
          array['product_pages', p_product_id::text],
          jsonb_build_object('options', answer_options),
          true
        ),
        updated_at = timezone('utc', now())
    where lower(trim(inventory.sku)) = lower(trim(answer->>'sku'));

    if not found then
      raise exception 'Canonical inventory SKU not found: %', answer->>'sku';
    end if;
  end loop;
end;
$$;

revoke all on function public.save_product_page_sku_answers(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_product_page_sku_answers(uuid, jsonb, jsonb) to authenticated;

commit;
