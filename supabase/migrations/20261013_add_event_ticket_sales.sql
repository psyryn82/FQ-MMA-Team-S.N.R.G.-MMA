-- One-time event ticket sales, separate from media purchase links.
create table if not exists public.event_ticket_options (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.events(id) on delete set null,
  name text not null check (length(trim(name)) between 1 and 120),
  description text not null default '',
  price_cents integer not null check (price_cents >= 50),
  currency text not null default 'USD' check (currency = upper(currency) and currency ~ '^[A-Z]{3}$'),
  quantity_limit integer null check (quantity_limit is null or quantity_limit >= 1),
  is_available boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists event_ticket_options_event_idx on public.event_ticket_options(event_id);
create index if not exists event_ticket_options_available_idx on public.event_ticket_options(is_available, event_id);

create table if not exists public.ticket_purchases (
  id uuid primary key default gen_random_uuid(),
  ticket_option_id uuid not null references public.event_ticket_options(id) on delete restrict,
  event_id uuid not null references public.events(id) on delete restrict,
  buyer_email text not null,
  quantity integer not null check (quantity between 1 and 10),
  unit_price_cents integer not null check (unit_price_cents >= 50),
  total_cents integer not null check (total_cents = unit_price_cents * quantity),
  currency text not null default 'USD' check (currency = upper(currency) and currency ~ '^[A-Z]{3}$'),
  status text not null default 'pending' check (status in ('pending','paid','failed','refunded')),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ticket_purchases_option_status_idx on public.ticket_purchases(ticket_option_id, status, expires_at);
create index if not exists ticket_purchases_event_idx on public.ticket_purchases(event_id, created_at desc);

alter table public.event_ticket_options enable row level security;
alter table public.ticket_purchases enable row level security;
revoke all on public.event_ticket_options from public, anon, authenticated;
grant select on public.event_ticket_options to anon, authenticated;
grant insert, update, delete on public.event_ticket_options to authenticated;
grant all on public.event_ticket_options to service_role;
revoke all on public.ticket_purchases from public, anon, authenticated;
grant select on public.ticket_purchases to authenticated;
grant all on public.ticket_purchases to service_role;

drop policy if exists "Admins manage event ticket options" on public.event_ticket_options;
create policy "Admins manage event ticket options" on public.event_ticket_options
for all to authenticated using (public.is_fqmma_admin()) with check (public.is_fqmma_admin());
drop policy if exists "Public can read available event ticket options" on public.event_ticket_options;
create policy "Public can read available event ticket options" on public.event_ticket_options
for select to anon, authenticated using (
  is_available = true and event_id is not null and exists (
    select 1 from public.events e where e.id = event_ticket_options.event_id and e.status in ('upcoming','live')
  )
);
drop policy if exists "Admins read ticket purchases" on public.ticket_purchases;
create policy "Admins read ticket purchases" on public.ticket_purchases
for select to authenticated using (public.is_fqmma_admin());

create or replace function public.reserve_event_ticket_purchase(
  p_ticket_option_id uuid,
  p_quantity integer,
  p_buyer_email text
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_option public.event_ticket_options%rowtype;
  v_event_status text;
  v_committed integer;
  v_reserved integer;
  v_purchase_id uuid;
begin
  if p_quantity is null or p_quantity < 1 or p_quantity > 10 then raise exception 'Quantity must be between 1 and 10'; end if;
  if p_buyer_email is null or length(trim(p_buyer_email)) < 5 or length(p_buyer_email) > 320 then raise exception 'A valid buyer email is required'; end if;
  select * into v_option from public.event_ticket_options where id = p_ticket_option_id for update;
  if not found or not v_option.is_available or v_option.event_id is null then raise exception 'Ticket option is not available'; end if;
  select status into v_event_status from public.events where id = v_option.event_id;
  if v_event_status is null or v_event_status not in ('upcoming','live') then raise exception 'Event is not available for ticket sales'; end if;
  if v_option.quantity_limit is not null then
    select coalesce(sum(quantity),0)::integer into v_committed from public.ticket_purchases where ticket_option_id = v_option.id and status = 'paid';
    select coalesce(sum(quantity),0)::integer into v_reserved from public.ticket_purchases where ticket_option_id = v_option.id and status = 'pending' and expires_at > now();
    if v_committed + v_reserved + p_quantity > v_option.quantity_limit then raise exception 'Not enough tickets remain at this price'; end if;
  end if;
  insert into public.ticket_purchases(ticket_option_id,event_id,buyer_email,quantity,unit_price_cents,total_cents,currency,status)
  values (v_option.id,v_option.event_id,lower(trim(p_buyer_email)),p_quantity,v_option.price_cents,v_option.price_cents*p_quantity,v_option.currency,'pending')
  returning id into v_purchase_id;
  return v_purchase_id;
end;
$$;
revoke all on function public.reserve_event_ticket_purchase(uuid,integer,text) from public, anon, authenticated;
grant execute on function public.reserve_event_ticket_purchase(uuid,integer,text) to service_role;
