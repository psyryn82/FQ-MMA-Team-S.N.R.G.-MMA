-- The public catalog is a read-only presentation layer, never a write path.
-- Explicitly remove inherited/default DML privileges from public client roles.
revoke all privileges on table public.public_media_catalog from anon, authenticated;
grant select on table public.public_media_catalog to anon, authenticated;

-- These promotion ledgers are admin/server-side only; clients have no public use for them.
revoke all privileges on table public.promotions from anon;
revoke all privileges on table public.promotion_redemptions from anon;
