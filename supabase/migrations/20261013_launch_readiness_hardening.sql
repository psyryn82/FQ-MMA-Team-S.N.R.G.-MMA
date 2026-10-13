-- FQ MMA launch-readiness hardening.
-- Apply only after reviewing the live schema and taking a recoverable backup.

-- Stable, unique checkout-session key for idempotent membership fulfillment.
alter table public.memberships
  add column if not exists stripe_payment_intent_id text not null default '';

update public.memberships
set stripe_checkout_session_id = null
where stripe_checkout_session_id = '';

alter table public.memberships
  alter column stripe_checkout_session_id drop not null,
  alter column stripe_checkout_session_id drop default;

create unique index if not exists memberships_stripe_checkout_session_unique
  on public.memberships (stripe_checkout_session_id);

create index if not exists memberships_stripe_payment_intent_idx
  on public.memberships (stripe_payment_intent_id)
  where stripe_payment_intent_id <> '';

-- Webhook idempotency ledger. Only the server-side service role may read/write it.
create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  status text not null check (status in ('processing', 'processed')),
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

alter table public.stripe_webhook_events enable row level security;
revoke all privileges on table public.stripe_webhook_events from public, anon, authenticated;
grant select, insert, update, delete on table public.stripe_webhook_events to service_role;

-- Payment records are server-managed only. RLS does not protect TRUNCATE, so remove
-- every direct table privilege from browser roles rather than relying on row policies.
-- These objects are present in the audited production schema but may be absent in a fresh project.
do $
begin
  if to_regclass('public.stripe_purchases') is not null then
    execute 'revoke all privileges on table public.stripe_purchases from public, anon, authenticated';
    execute 'grant select, insert, update, delete on table public.stripe_purchases to service_role';
  end if;

  -- Admin-check helpers may be needed by authenticated RLS policies, but not by anonymous callers.
  if to_regprocedure('public.is_admin()') is not null then
    execute 'revoke all on function public.is_admin() from public, anon';
    execute 'grant execute on function public.is_admin() to authenticated';
  end if;

  if to_regprocedure('public.is_fqmma_admin()') is not null then
    execute 'revoke all on function public.is_fqmma_admin() from public, anon';
    execute 'grant execute on function public.is_fqmma_admin() to authenticated';
  end if;

  -- Trigger functions are invoked by PostgreSQL triggers, not by browser clients.
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end
$;

-- Paid media must not be stored in the public bucket. Keep the existing public bucket
-- unchanged for published team/event imagery and create a separate private bucket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'fqmma-private',
  'fqmma-private',
  false,
  52428800,
  array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Admins upload private FQ MMA media" on storage.objects;
create policy "Admins upload private FQ MMA media"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'fqmma-private' and public.is_fqmma_admin());

drop policy if exists "Admins update private FQ MMA media" on storage.objects;
create policy "Admins update private FQ MMA media"
  on storage.objects for update to authenticated
  using (bucket_id = 'fqmma-private' and public.is_fqmma_admin())
  with check (bucket_id = 'fqmma-private' and public.is_fqmma_admin());

drop policy if exists "Admins delete private FQ MMA media" on storage.objects;
create policy "Admins delete private FQ MMA media"
  on storage.objects for delete to authenticated
  using (bucket_id = 'fqmma-private' and public.is_fqmma_admin());

-- Deliberately no SELECT policy for ordinary members on the private bucket.
-- Signed URL issuance must go through a server-side entitlement check.
