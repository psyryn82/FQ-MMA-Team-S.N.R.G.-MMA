-- Restore the admin-only RLS helper without exposing admin_users.
-- SECURITY DEFINER lets the helper check the caller's UID without requiring
-- client roles to read the admin_users table directly.
create or replace function public.is_fqmma_admin()
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

revoke all on function public.is_fqmma_admin() from public, anon, authenticated;
grant execute on function public.is_fqmma_admin() to authenticated;
