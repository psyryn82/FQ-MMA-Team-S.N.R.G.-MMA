-- The public catalog is a read-only presentation layer, never a write path.
-- Explicitly remove inherited/default DML privileges from public client roles.
revoke all privileges on table public.public_media_catalog from anon, authenticated;
grant select on table public.public_media_catalog to anon, authenticated;
