-- Manual booking payment tracking for agreed total, payments received, and remaining balance.
-- Review and apply with the other pending migrations before deploying the matching admin UI.
begin;

alter table public.booking_requests
  add column if not exists booking_total_cents bigint not null default 0,
  add column if not exists booking_paid_cents bigint not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='booking_requests_total_nonnegative' and conrelid='public.booking_requests'::regclass) then
    alter table public.booking_requests add constraint booking_requests_total_nonnegative check (booking_total_cents >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='booking_requests_paid_nonnegative' and conrelid='public.booking_requests'::regclass) then
    alter table public.booking_requests add constraint booking_requests_paid_nonnegative check (booking_paid_cents >= 0);
  end if;
end $$;

comment on column public.booking_requests.booking_total_cents is 'Manually recorded agreed total for the booking, in cents.';
comment on column public.booking_requests.booking_paid_cents is 'Manually recorded total received toward the booking, in cents. This is not automatically reconciled with Stripe.';

notify pgrst, 'reload schema';
commit;
