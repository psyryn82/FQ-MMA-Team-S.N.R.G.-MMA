-- Public event visibility must respect the explicit publication flag.
-- Ticket options for unpublished events must not be publicly discoverable.
-- Admins retain access through separate admin policies.
begin;

drop policy if exists "Public can read public events" on public.events;

create policy "Public can read public events"
on public.events
for select
to anon, authenticated
using (
  is_published = true
  and status = any (array['upcoming'::text, 'live'::text, 'completed'::text])
);

drop policy if exists "Public can read available event ticket options" on public.event_ticket_options;

create policy "Public can read available event ticket options"
on public.event_ticket_options
for select
to anon, authenticated
using (
  is_available = true
  and event_id is not null
  and exists (
    select 1
    from public.events e
    where e.id = event_ticket_options.event_id
      and e.is_published = true
      and e.status = any (array['upcoming'::text, 'live'::text])
  )
);

commit;
