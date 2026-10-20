-- Secure the public media catalog view with invoker permissions.
-- The public catalog remains readable, but only its explicit public columns are granted.
alter view public.public_media_catalog set (security_invoker = true);

drop policy if exists "Public can view published media catalog fields" on public.media;
create policy "Public can view published media catalog fields"
on public.media
for select
to anon, authenticated
using (is_published = true);

revoke all privileges on table public.media from anon, authenticated;
grant select (
  id, title, category, description, file_url, price, price_confirmed,
  is_published, collection, media_destination, event_id, created_at
) on table public.media to anon, authenticated;

revoke all privileges on table public.public_media_catalog from anon, authenticated;
grant select on table public.public_media_catalog to anon, authenticated;
