-- Page-scoped SKU photos are canonical in
-- inventory_skus.source_metadata.product_pages.<product_id>.image_url.
-- Keep the retired product_option_values.image_url column inert so legacy
-- editor rebuilds cannot create a second source of truth.
CREATE OR REPLACE FUNCTION public.prevent_legacy_product_option_image()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.image_url := NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS product_option_values_no_legacy_image
  ON public.product_option_values;

CREATE TRIGGER product_option_values_no_legacy_image
BEFORE INSERT OR UPDATE OF image_url ON public.product_option_values
FOR EACH ROW
EXECUTE FUNCTION public.prevent_legacy_product_option_image();

UPDATE public.product_option_values
SET image_url = NULL
WHERE image_url IS NOT NULL;
