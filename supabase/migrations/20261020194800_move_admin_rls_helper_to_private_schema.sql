-- Keep the RLS helper callable by policies, but move its privileged lookup
-- into a non-exposed schema so it is not a SECURITY DEFINER RPC in public.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create or replace function private.is_fqmma_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.admin_users
    where user_id = (select auth.uid())
      and role = 'admin'
  );
$function$;

revoke all on function private.is_fqmma_admin() from public, anon, authenticated;
grant execute on function private.is_fqmma_admin() to authenticated;

create or replace function public.is_fqmma_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  select private.is_fqmma_admin();
$function$;

revoke all on function public.is_fqmma_admin() from public, anon, authenticated;
grant execute on function public.is_fqmma_admin() to authenticated;
