-- Keep unpublished events and their ticket options hidden from public roles.
-- Applied to the production Supabase project on 2026-10-19.

DROP POLICY IF EXISTS "Public can read public events" ON public.events;
CREATE POLICY "Public can read public events"
ON public.events
FOR SELECT
TO anon, authenticated
USING (
  is_published = true
  AND status = ANY (ARRAY['upcoming'::text, 'live'::text, 'completed'::text])
);

DROP POLICY IF EXISTS "Public can read available event ticket options" ON public.event_ticket_options;
CREATE POLICY "Public can read available event ticket options"
ON public.event_ticket_options
FOR SELECT
TO anon, authenticated
USING (
  is_available = true
  AND event_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.id = event_ticket_options.event_id
      AND e.is_published = true
      AND e.status = ANY (ARRAY['upcoming'::text, 'live'::text])
  )
);
