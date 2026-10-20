-- Public booking requests may be submitted, but only authorized staff may read or manage them.
-- Keep authenticated admin CRUD privileges behind the existing is_fqmma_admin() RLS policy.
begin;

revoke all privileges on table public.booking_requests from anon;
grant insert on table public.booking_requests to anon;

revoke truncate, references, trigger on table public.booking_requests from authenticated;
grant select, insert, update, delete on table public.booking_requests to authenticated;

commit;
