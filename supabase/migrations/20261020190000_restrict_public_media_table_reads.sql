-- Keep the public catalog on the explicitly limited public_media_catalog view.
-- Direct REST access to the media ledger must be restricted to authorized admins.
drop policy if exists "Public can view published media" on public.media;

create policy "Admins can read media"
on public.media
for select
to authenticated
using (is_fqmma_admin());

revoke select on table public.media from anon;
