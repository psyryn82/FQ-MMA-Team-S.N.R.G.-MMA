-- FQ MMA Supabase application schema
-- Run the entire file in Supabase Dashboard > SQL Editor.
-- Safe to re-run. Public keys belong in browser code; NEVER use service_role keys in HTML.

create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  created_at timestamptz not null default now()
);
create table if not exists public.site_content (
  content_key text primary key,
  content_value text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
create table if not exists public.fighters (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  nickname text not null default '',
  record text not null default '',
  bio text not null default '',
  image_url text not null default '',
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  event_date timestamptz,
  venue text not null default '',
  main_event text not null default '',
  description text not null default '',
  status text not null default 'upcoming' check (status in ('draft','upcoming','live','completed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.training_schedule (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  discipline text not null default '',
  day_of_week smallint not null default 1 check(day_of_week between 0 and 6),
  start_time time not null default '18:00',
  end_time time,
  coach text not null default '',
  location text not null default '',
  notes text not null default '',
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  image_url text not null default '',
  price_cents integer not null default 0 check(price_cents >= 0),
  currency text not null default 'USD',
  inventory integer check(inventory is null or inventory >= 0),
  product_url text not null default '',
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.membership_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  price_cents integer not null default 0 check(price_cents >= 0),
  currency text not null default 'USD',
  billing_interval text not null default 'month' check(billing_interval in ('month','year','one_time')),
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  email text not null,
  plan_id uuid references public.membership_plans(id) on delete set null,
  status text not null default 'pending' check(status in ('pending','active','cancelled','expired','refunded')),
  payment_provider text not null default '',
  external_payment_id text not null default '',
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Stripe checkout/webhook references. Existing rows remain valid.
alter table public.memberships add column if not exists stripe_customer_id text not null default '';
alter table public.memberships add column if not exists stripe_subscription_id text not null default '';
alter table public.memberships add column if not exists stripe_checkout_session_id text not null default '';
create index if not exists memberships_stripe_subscription_idx on public.memberships (stripe_subscription_id);
create index if not exists memberships_stripe_checkout_session_idx on public.memberships (stripe_checkout_session_id);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  sender_name text not null default '',
  sender_email text not null default '',
  message text not null check(length(message) between 1 and 5000),
  is_admin_reply boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace function public.is_fqmma_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.admin_users where user_id = (select auth.uid())); $$;
revoke all on function public.is_fqmma_admin() from public;
grant execute on function public.is_fqmma_admin() to authenticated;

alter table public.admin_users enable row level security;
alter table public.site_content enable row level security;
alter table public.fighters enable row level security;
alter table public.events enable row level security;
alter table public.training_schedule enable row level security;
alter table public.products enable row level security;
alter table public.membership_plans enable row level security;
alter table public.memberships enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists "Admins can read their own admin record" on public.admin_users;
create policy "Admins can read their own admin record" on public.admin_users for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "Public can read site content" on public.site_content;
create policy "Public can read site content" on public.site_content for select to anon, authenticated using (true);
drop policy if exists "Admins manage site content" on public.site_content;
create policy "Admins manage site content" on public.site_content for all to authenticated using (public.is_fqmma_admin()) with check (public.is_fqmma_admin());

drop policy if exists "Public can read published fighters" on public.fighters;
create policy "Public can read published fighters" on public.fighters for select to anon, authenticated using (is_published = true);
drop policy if exists "Admins manage fighters" on public.fighters;
create policy "Admins manage fighters" on public.fighters for all to authenticated using (public.is_fqmma_admin()) with check (public.is_fqmma_admin());

drop policy if exists "Public can read public events" on public.events;
create policy "Public can read public events" on public.events for select to anon, authenticated using (status in ('upcoming','live','completed'));
drop policy if exists "Admins manage events" on public.events;
create policy "Admins manage events" on public.events for all to authenticated using (public.is_fqmma_admin()) with check (public.is_fqmma_admin());

drop policy if exists "Public can read published schedule" on public.training_schedule;
create policy "Public can read published schedule" on public.training_schedule for select to anon, authenticated using (is_published = true);
drop policy if exists "Admins manage schedule" on public.training_schedule;
create policy "Admins manage schedule" on public.training_schedule for all to authenticated using (public.is_fqmma_admin()) with check (public.is_fqmma_admin());

drop policy if exists "Public can read published products" on public.products;
create policy "Public can read published products" on public.products for select to anon, authenticated using (is_published = true);
drop policy if exists "Admins manage products" on public.products;
create policy "Admins manage products" on public.products for all to authenticated using (public.is_fqmma_admin()) with check (public.is_fqmma_admin());

drop policy if exists "Public can read published plans" on public.membership_plans;
create policy "Public can read published plans" on public.membership_plans for select to anon, authenticated using (is_published = true);
drop policy if exists "Admins manage plans" on public.membership_plans;
create policy "Admins manage plans" on public.membership_plans for all to authenticated using (public.is_fqmma_admin()) with check (public.is_fqmma_admin());

drop policy if exists "Members read own membership" on public.memberships;
create policy "Members read own membership" on public.memberships for select to authenticated using (user_id = (select auth.uid()) or public.is_fqmma_admin());
drop policy if exists "Admins manage memberships" on public.memberships;
create policy "Admins manage memberships" on public.memberships for all to authenticated using (public.is_fqmma_admin()) with check (public.is_fqmma_admin());

drop policy if exists "Users read own chat and admins read all" on public.chat_messages;
create policy "Users read own chat and admins read all" on public.chat_messages for select to authenticated using (user_id = (select auth.uid()) or public.is_fqmma_admin());
drop policy if exists "Authenticated users send chat" on public.chat_messages;
create policy "Authenticated users send chat" on public.chat_messages for insert to authenticated with check (user_id = (select auth.uid()) and is_admin_reply = false);
drop policy if exists "Admins reply to chat" on public.chat_messages;
create policy "Admins reply to chat" on public.chat_messages for insert to authenticated with check (public.is_fqmma_admin() and is_admin_reply = true);
drop policy if exists "Admins delete chat" on public.chat_messages;
create policy "Admins delete chat" on public.chat_messages for delete to authenticated using (public.is_fqmma_admin());

grant select on public.site_content,public.fighters,public.events,public.training_schedule,public.products,public.membership_plans to anon,authenticated;
grant insert,update,delete on public.site_content,public.fighters,public.events,public.training_schedule,public.products,public.membership_plans to authenticated;
grant select on public.admin_users,public.memberships,public.chat_messages to authenticated;
grant insert,update,delete on public.memberships to authenticated;
grant insert,delete on public.chat_messages to authenticated;

-- MEDIA STORAGE
-- This creates a public-read bucket for public team images/videos. Admins alone may upload, update, or delete.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('fqmma-media','fqmma-media',true,52428800,array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm'])
on conflict (id) do update set public=true,file_size_limit=52428800,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists "Public read FQ MMA media" on storage.objects;
create policy "Public read FQ MMA media" on storage.objects for select to anon,authenticated using (bucket_id='fqmma-media');
drop policy if exists "Admins upload FQ MMA media" on storage.objects;
create policy "Admins upload FQ MMA media" on storage.objects for insert to authenticated with check (bucket_id='fqmma-media' and public.is_fqmma_admin());
drop policy if exists "Admins update FQ MMA media" on storage.objects;
create policy "Admins update FQ MMA media" on storage.objects for update to authenticated using (bucket_id='fqmma-media' and public.is_fqmma_admin()) with check (bucket_id='fqmma-media' and public.is_fqmma_admin());
drop policy if exists "Admins delete FQ MMA media" on storage.objects;
create policy "Admins delete FQ MMA media" on storage.objects for delete to authenticated using (bucket_id='fqmma-media' and public.is_fqmma_admin());

-- FIRST ADMIN BOOTSTRAP:
-- First create/sign in to an Auth user with the desired email. Then run:
-- insert into public.admin_users (user_id,email)
-- select id,email from auth.users where lower(email)=lower('fqsnrg.info@gmail.com')
-- on conflict (user_id) do update set email=excluded.email;
--
-- IMPORTANT: This schema creates membership records, but it does NOT verify payments.
-- Never mark memberships active based only on a browser redirect or user-submitted claim.
-- Connect a payment provider webhook/server-side function before selling paid access.
-- Live chat currently requires signed-in users; anonymous website visitor chat needs a server-side
-- rate-limited endpoint to avoid exposing an unauthenticated message-writing policy.
