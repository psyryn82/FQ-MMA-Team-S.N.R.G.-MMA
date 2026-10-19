-- Public event visibility must respect the explicit publication flag.
-- Admins retain access through the separate "Admins manage events" policy.
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

commit;
