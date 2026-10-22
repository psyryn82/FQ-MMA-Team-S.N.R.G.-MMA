-- Add searchable categories to the private website asset library.
-- Review and apply separately; this file is not run automatically by the website.

begin;

alter table public.site_assets
  add column if not exists category text not null default 'other';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'site_assets_category_check'
      and conrelid = 'public.site_assets'::regclass
  ) then
    alter table public.site_assets
      add constraint site_assets_category_check
      check (category in ('logo','favicon','banner','background','photo','video','document','other'));
  end if;
end $$;

create index if not exists site_assets_category_created_at_idx
  on public.site_assets (category, created_at desc);

comment on column public.site_assets.category is
  'Admin-assigned type for filtering and organizing site assets; does not change public/private access.';

notify pgrst, 'reload schema';

commit;
