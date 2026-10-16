-- One-time email links for staff-approved private media downloads.
create table if not exists public.media_download_tokens (
  id uuid primary key default gen_random_uuid(),
  permission_id uuid not null references public.media_download_permissions(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  sent_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists media_download_tokens_permission_created_idx
  on public.media_download_tokens (permission_id, created_at desc);
create index if not exists media_download_tokens_expiry_idx
  on public.media_download_tokens (expires_at);
alter table public.media_download_tokens enable row level security;
revoke all on public.media_download_tokens from anon, authenticated;
grant all on public.media_download_tokens to service_role;
