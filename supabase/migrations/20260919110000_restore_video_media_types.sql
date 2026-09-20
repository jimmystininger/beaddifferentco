update public.product_images
set media_type = 'video'
where lower(url) ~ '\\.(mp4|mov|webm|m4v)(\\?|$)'
  and lower(coalesce(media_type, '')) <> 'video';
