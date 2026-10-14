-- Replace the old stream-provider field with Livepeer and discard obsolete provider IDs.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'event_streams' AND column_name = 'mux_playback_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'event_streams' AND column_name = 'livepeer_playback_id'
  ) THEN
    ALTER TABLE public.event_streams RENAME COLUMN mux_playback_id TO livepeer_playback_id;
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'event_streams' AND column_name = 'mux_playback_id'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'event_streams' AND column_name = 'livepeer_playback_id'
  ) THEN
    UPDATE public.event_streams
      SET livepeer_playback_id = COALESCE(livepeer_playback_id, mux_playback_id);
    ALTER TABLE public.event_streams DROP COLUMN mux_playback_id;
  END IF;
END $$;

-- Existing values were created for the retired stream provider, not verified Livepeer playback IDs.
UPDATE public.event_streams
SET livepeer_playback_id = NULL
WHERE livepeer_playback_id IS NOT NULL;
