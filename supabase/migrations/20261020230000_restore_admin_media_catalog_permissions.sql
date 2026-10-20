-- Restore authenticated admin dashboard reads without exposing private paths to public visitors.
-- Anonymous users can read only the public catalog fields for published listings.
drop policy if exists "Public can view published media catalog fields" on public.media;
create policy "Public can view published media catalog fields"
on public.media for select to anon
using (is_published = true);

-- Keep the authenticated read path restricted to approved FQ MMA admins.
drop policy if exists "Admins can read media" on public.media;
create policy "Admins can read media"
on public.media for select to authenticated
using (is_fqmma_admin());

revoke all privileges on table public.media from anon, authenticated;
grant select (
  id, title, category, description, file_url, price, price_confirmed,
  is_published, collection, media_destination, event_id, created_at
) on table public.media to anon;
grant select on table public.media to authenticated;
