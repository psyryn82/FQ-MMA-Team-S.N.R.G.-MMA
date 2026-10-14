-- FQ MMA: remove the legacy SECURITY DEFINER media helper from RLS policies.
-- Keep media admin CRUD while using the canonical helper with SECURITY INVOKER.
-- This migration is safe to reapply: policies are dropped if present and recreated.

begin;

drop policy if exists "Admins can delete media" on public.media;
drop policy if exists "Admins can insert media" on public.media;
drop policy if exists "Admins can update media" on public.media;
drop policy if exists "Public can view published media" on public.media;

create policy "Admins can delete media"
  on public.media for delete to authenticated
  using ((select public.is_fqmma_admin()));

create policy "Admins can insert media"
  on public.media for insert to authenticated
  with check ((select public.is_fqmma_admin()));

create policy "Admins can update media"
  on public.media for update to authenticated
  using ((select public.is_fqmma_admin()))
  with check ((select public.is_fqmma_admin()));

create policy "Public can view published media"
  on public.media for select to anon, authenticated
  using (
    is_published = true
    or (
      (select auth.uid()) is not null
      and (select public.is_fqmma_admin())
    )
  );

create or replace function public.is_fqmma_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  select exists (
    select 1
    from public.admin_users
    where user_id = (select auth.uid())
  );
$function$;

-- No RLS policy should depend on this legacy helper after the changes above.
revoke execute on function public.is_admin() from authenticated;

commit;
