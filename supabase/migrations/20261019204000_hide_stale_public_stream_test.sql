-- Hide expired public test-stream events without deleting their purchase history.
begin;

update public.event_streams es
set is_enabled = false
from public.events e
where es.event_id = e.id
  and e.title = 'FQ MMA Stream Test'
  and e.is_published = true
  and e.status = 'live'
  and e.event_date < now();

update public.events
set is_published = false,
    status = 'cancelled',
    updated_at = now()
where title = 'FQ MMA Stream Test'
  and is_published = true
  and status = 'live'
  and event_date < now();

commit;
