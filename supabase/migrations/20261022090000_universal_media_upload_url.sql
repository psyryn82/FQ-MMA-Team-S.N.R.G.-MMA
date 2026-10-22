-- Universal upload-or-URL support for the admin media libraries.
-- This migration is for review and must be applied to Supabase only after explicit approval.
alter table public.site_assets
  add column if not exists external_url text;

alter table public.site_assets
  alter column private_path drop not null;

-- URLs are references to externally hosted content, not protected copies.
-- Keep media.file_path/storage_bucket for private originals and use file_url for
-- externally hosted catalog resources. Paid/private delivery must not rely on external URLs.
alter table public.media
  add column if not exists external_url text;

comment on column public.site_assets.external_url is
  'HTTPS URL for externally hosted asset. External hosting is not private storage.';
comment on column public.media.external_url is
  'HTTPS URL for externally hosted catalog media. Do not use as paid/private delivery unless host enforces equivalent access controls.';
