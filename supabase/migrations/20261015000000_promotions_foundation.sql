-- FQ MMA promotions foundation.
-- This migration creates admin-managed promotion records only.
-- Checkout redemption and complimentary-access delivery are deliberately not enabled here.
create extension if not exists pgcrypto;

create table if not exists public.promotions (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  promotion_type text not null check (promotion_type in ('discount_percent','discount_amount','free_stream','free_ticket')),
  applies_to text not null check (applies_to in ('stream','ticket','both')),
  discount_value numeric(10,2) not null default 0 check (discount_value >= 0),
  event_id uuid null references public.events(id) on delete restrict,
  starts_at timestamptz null,
  expires_at timestamptz null,
  max_redemptions integer null check (max_redemptions is null or max_redemptions > 0),
  redemption_count integer not null default 0 check (redemption_count >= 0),
  is_active boolean not null default true,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint promotions_code_format check (code = upper(code) and code ~ '^[A-Z0-9_-]{3,40}$'),
  constraint promotions_discount_value_valid check (
    (promotion_type = 'discount_percent' and discount_value > 0 and discount_value <= 100)
    or (promotion_type = 'discount_amount' and discount_value > 0)
    or (promotion_type in ('free_stream','free_ticket') and discount_value = 0)
  ),
  constraint promotions_expiration_after_start check (expires_at is null or starts_at is null or expires_at > starts_at)
);

create unique index if not exists promotions_code_unique on public.promotions (code);

create table if not exists public.promotion_redemptions (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references public.promotions(id) on delete restrict,
  customer_email text not null,
  purchase_type text not null check (purchase_type in ('stream','ticket')),
  event_id uuid null references public.events(id) on delete restrict,
  purchase_reference text null,
  status text not null default 'pending' check (status in ('pending','redeemed','released','revoked')),
  discount_amount_cents integer not null default 0 check (discount_amount_cents >= 0),
  created_at timestamptz not null default now(),
  redeemed_at timestamptz null,
  constraint promotion_redemptions_reference_unique unique (purchase_reference)
);

create index if not exists promotion_redemptions_promotion_idx on public.promotion_redemptions (promotion_id, status);
create index if not exists promotion_redemptions_email_idx on public.promotion_redemptions (lower(customer_email));

alter table public.promotions enable row level security;
alter table public.promotion_redemptions enable row level security;

drop policy if exists "Approved admins manage promotions" on public.promotions;
create policy "Approved admins manage promotions"
  on public.promotions for all to authenticated
  using (public.is_fqmma_admin())
  with check (public.is_fqmma_admin());

drop policy if exists "Approved admins read promotion redemptions" on public.promotion_redemptions;
create policy "Approved admins read promotion redemptions"
  on public.promotion_redemptions for select to authenticated
  using (public.is_fqmma_admin());

comment on table public.promotions is 'FQ MMA admin-managed promotion definitions. Checkout redemption remains disabled until server-side validation is deployed.';
comment on table public.promotion_redemptions is 'FQ MMA promotion redemption ledger reserved for server-side checkout integration; clients cannot insert or update rows.';
