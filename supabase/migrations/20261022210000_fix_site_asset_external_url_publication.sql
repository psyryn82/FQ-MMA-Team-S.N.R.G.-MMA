-- Allow HTTPS external URLs to be explicitly published in the Site Media library.
-- External URLs are references to third-party hosting, not private copies.
-- Private originals and uploaded public copies retain their existing protection rules.

begin;

alter table public.site_assets
  drop constraint if exists site_assets_public_fields_consistent;

alter table public.site_assets
  add constraint site_assets_public_fields_consistent
  check (
    (
      is_public = true
      and public_url is not null
      and (
        public_path is not null
        or (
          external_url is not null
          and public_path is null
          and public_url = external_url
        )
      )
    )
    or (
      is_public = false
      and public_path is null
      and public_url is null
    )
  );

comment on constraint site_assets_public_fields_consistent on public.site_assets is
  'Public assets require a public URL and either a stored public copy or an explicitly published external URL. Private assets have no public path or URL.';

notify pgrst, 'reload schema';

commit;
