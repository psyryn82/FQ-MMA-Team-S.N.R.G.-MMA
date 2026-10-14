-- Clear stale playback identifiers before configuring verified Livepeer streams.
UPDATE public.event_streams
SET livepeer_playback_id = NULL
WHERE livepeer_playback_id IS NOT NULL;
