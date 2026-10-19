-- Keep public booking submissions separate from staff read/manage permissions.
-- This removes overlapping authenticated INSERT policies while preserving admin workflows.
begin;

drop policy if exists "FQ MMA admins manage booking requests" on public.booking_requests;

create policy "FQ MMA admins read booking requests"
  on public.booking_requests for select to authenticated
  using (public.is_fqmma_admin());

create policy "FQ MMA admins update booking requests"
  on public.booking_requests for update to authenticated
  using (public.is_fqmma_admin())
  with check (public.is_fqmma_admin());

create policy "FQ MMA admins delete booking requests"
  on public.booking_requests for delete to authenticated
  using (public.is_fqmma_admin());

commit;
