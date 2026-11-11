-- A reserve buffer is a sellable-quantity threshold, not physical stock.
-- It may exceed physical stock; in that case computed availability is zero.
-- Keep the existing trigger in place while removing its over-reservation block.
create or replace function private.prevent_new_inventory_overreservation()
returns trigger
language plpgsql
set search_path to 'public', 'private'
as $function$
begin
  return new;
end;
$function$;
