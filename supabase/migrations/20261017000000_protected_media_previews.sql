-- FQ MMA protected media originals and watermarked public previews.
-- Additive schema change only. No storage objects are moved or deleted by this migration.
alter table public.media add column if not exists preview_path text, add column if not exists storage_bucket text;
update public.media set storage_bucket=case when coalesce(price,0)>0 then 'fqmma-private' else 'fqmma-media' end where storage_bucket is null;
alter table public.media alter column storage_bucket set default 'fqmma-private', alter column storage_bucket set not null;
alter table public.media drop constraint if exists media_storage_bucket_check;
alter table public.media add constraint media_storage_bucket_check check (storage_bucket in ('fqmma-private','fqmma-media'));
comment on column public.media.file_path is 'Path to original asset. New uploads must always be stored in private fqmma-private.';
comment on column public.media.file_url is 'Public URL for watermarked preview only. Never store an original-file URL here.';
comment on column public.media.preview_path is 'Path to watermarked preview in public fqmma-media. Null means listing needs a preview and must not appear in public catalog.';
comment on column public.media.storage_bucket is 'Bucket containing file_path. New uploads must use fqmma-private; fqmma-media identifies legacy public originals awaiting secure replacement.';
