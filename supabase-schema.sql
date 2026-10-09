-- FQ MMA Supabase foundation
-- Run in Supabase Dashboard > SQL Editor > New query.
-- First create an Auth user, then follow the admin bootstrap instructions at the bottom.

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

create or replace function public.is_fqmma_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_users
    where user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_fqmma_admin() from public;
grant execute on function public.is_fqmma_admin() to authenticated;

alter table public.admin_users enable row level security;
alter table public.site_content enable row level security;
alter table public.fighters enable row level security;
alter table public.events enable row level security;

drop policy if exists "Admins can read their own admin record" on public.admin_users;
create policy "Admins can read their own admin record"
on public.admin_users for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "Public can read published site content" on public.site_content;
create policy "Public can read published site content"
on public.site_content for select to anon, authenticated using (true);
drop policy if exists "Admins manage site content" on public.site_content;
create policy "Admins manage site content"
on public.site_content for all to authenticated
using (public.is_fqmma_admin()) with check (public.is_fqmma_admin());

drop policy if exists "Public can read published fighters" on public.fighters;
create policy "Public can read published fighters"
on public.fighters for select to anon, authenticated using (is_published = true);
drop policy if exists "Admins manage fighters" on public.fighters;
create policy "Admins manage fighters"
on public.fighters for all to authenticated
using (public.is_fqmma_admin()) with check (public.is_fqmma_admin());

drop policy if exists "Public can read public events" on public.events;
create policy "Public can read public events"
on public.events for select to anon, authenticated
using (status in ('upcoming','live','completed'));
drop policy if exists "Admins manage events" on public.events;
create policy "Admins manage events"
on public.events for all to authenticated
using (public.is_fqmma_admin()) with check (public.is_fqmma_admin());

grant select on public.site_content, public.fighters, public.events to anon, authenticated;
grant insert, update, delete on public.site_content, public.fighters, public.events to authenticated;

-- FIRST ADMIN BOOTSTRAP:
-- 1. In Supabase > Authentication > Users, create your own user.
-- 2. Copy this template, replace admin@example.com with that exact email, and run it separately:
-- insert into public.admin_users (user_id, email)
-- select id, email from auth.users where lower(email) = lower('admin@example.com')
-- on conflict (user_id) do update set email = excluded.email;
-- Never put a service_role key in website code.
