-- Private event-stream configuration and one-time stream purchase ledger.
-- All stream purchases remain unavailable until checkout/webhook/playback functions are tested.

begin;

create table if not exists public.event_streams (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique references public.events(id) on delete cascade,
  mux_playback_id text,
  stream_price_cents integer not null default 3500 check (stream_price_cents >= 50),
  currency text not null default 'USD' check (currency = upper(currency) and currency ~ '^[A-Z]{3}$'),
  is_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists event_streams_event_id_idx on public.event_streams(event_id);

alter table public.event_streams enable row level security;
revoke all privileges on table public.event_streams from anon, authenticated;
grant select, insert, update, delete on table public.event_streams to authenticated;
grant all privileges on table public.event_streams to service_role;
drop policy if exists "Admins manage event stream settings" on public.event_streams;
create policy "Admins manage event stream settings"
  on public.event_streams for all to authenticated
  using ((select public.is_fqmma_admin()))
  with check ((select public.is_fqmma_admin()));

create table if not exists public.stream_purchases (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete restrict,
  buyer_email text not null,
  amount_cents integer not null check (amount_cents >= 50),
  currency text not null default 'USD' check (currency = upper(currency) and currency ~ '^[A-Z]{3}$'),
  status text not null default 'pending' check (status in ('pending','paid','failed','expired','refunded')),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists stream_purchases_event_status_idx
  on public.stream_purchases(event_id, status);
create index if not exists stream_purchases_buyer_email_idx
  on public.stream_purchases(lower(buyer_email));

alter table public.stream_purchases enable row level security;
revoke all privileges on table public.stream_purchases from anon, authenticated;
grant all privileges on table public.stream_purchases to service_role;

commit;
