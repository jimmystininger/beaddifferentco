-- A reserve buffer is a sellable-quantity threshold, not physical stock.
-- Allow admins to save buffers above on-hand stock; computed availability
-- floors at zero, so the SKU remains out of stock until stock covers the buffer.
drop trigger if exists prevent_new_inventory_overreservation on public.inventory_skus;
drop function if exists private.prevent_new_inventory_overreservation();
