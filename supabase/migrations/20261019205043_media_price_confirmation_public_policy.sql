-- Public clients must not read listings whose price is awaiting confirmation.
-- Authorized admins can still review and correct all media records.
drop policy if exists "Public can view published media" on public.media;
create policy "Public can view published media"
on public.media
for select
to anon, authenticated
using (
  (is_published = true and price_confirmed = true)
  or (
    (select auth.uid()) is not null
    and (select public.is_fqmma_admin())
  )
);
