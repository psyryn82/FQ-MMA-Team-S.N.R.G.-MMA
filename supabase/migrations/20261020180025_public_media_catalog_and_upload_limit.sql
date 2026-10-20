-- Public catalog metadata is intentionally separate from the private media ledger.
-- The view exposes only display fields for published listings. It omits original object paths,
-- storage bucket names, purchase/session IDs, and Livepeer asset/playback metadata.
create or replace view public.public_media_catalog as
select
  id,
  title,
  category,
  description,
  file_url,
  price,
  price_confirmed,
  is_published,
  collection,
  media_destination,
  event_id,
  created_at
from public.media
where is_published = true;

comment on view public.public_media_catalog is
  'Public display-only catalog of published fight and portfolio media. Private originals and payment metadata are excluded.';

revoke all on public.public_media_catalog from public;
grant select on public.public_media_catalog to anon, authenticated;

-- The admin uploader is designed for originals up to 5 GiB. Align the private bucket limit
-- with the UI and the Supabase Pro upload flow. This does not make the bucket public.
update storage.buckets
set file_size_limit = 5368709120
where id = 'fqmma-private';
