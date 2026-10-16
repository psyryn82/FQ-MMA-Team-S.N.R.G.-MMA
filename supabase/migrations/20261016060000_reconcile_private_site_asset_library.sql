-- Reconcile the private Site Media library schema and enforce least-privilege grants.
-- Safe to re-run. Does not move or delete storage objects and does not publish any assets.

begin;

create table if not exists public.site_assets (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 1 and 200),
  description text not null default '',
  file_name text not null,
  content_type text not null,
  private_path text not null unique,
  public_path text unique,
  public_url text,
  is_public boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_assets_public_fields_consistent check (
    (is_public and public_path is not null and public_url is not null)
    or
    (not is_public and public_path is null and public_url is null)
  )
);

alter table public.site_assets enable row level security;

drop policy if exists "FQ MMA admins read site assets" on public.site_assets;
create policy "FQ MMA admins read site assets"
  on public.site_assets for select to authenticated
  using ((select public.is_fqmma_admin()));

drop policy if exists "FQ MMA admins insert site assets" on public.site_assets;
create policy "FQ MMA admins insert site assets"
  on public.site_assets for insert to authenticated
  with check ((select public.is_fqmma_admin()));

drop policy if exists "FQ MMA admins update site assets" on public.site_assets;
create policy "FQ MMA admins update site assets"
  on public.site_assets for update to authenticated
  using ((select public.is_fqmma_admin()))
  with check ((select public.is_fqmma_admin()));

drop policy if exists "FQ MMA admins delete site assets" on public.site_assets;
create policy "FQ MMA admins delete site assets"
  on public.site_assets for delete to authenticated
  using ((select public.is_fqmma_admin()));

-- Default privileges in this project are broad, so explicitly narrow this table.
revoke all privileges on table public.site_assets from anon, authenticated;
grant select, insert, update, delete on table public.site_assets to authenticated;

comment on table public.site_assets is
  'Private admin/staff asset library. Assets are private by default; public copies exist only when explicitly selected.';
comment on column public.site_assets.private_path is
  'Path to original file in private fqmma-private storage.';
comment on column public.site_assets.public_path is
  'Optional intentionally published copy path in public fqmma-media storage.';
comment on column public.site_assets.public_url is
  'Public URL for the intentionally published copy only; never an original-file URL.';

commit;
