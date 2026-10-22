-- Per-event lifetime for signed Livepeer playback tokens.
-- Shorter tokens reduce the window in which a copied playback URL can be reused.
begin;

alter table public.event_streams
  add column if not exists playback_token_ttl_seconds integer not null default 600;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='event_streams_playback_token_ttl_range' and conrelid='public.event_streams'::regclass) then
    alter table public.event_streams
      add constraint event_streams_playback_token_ttl_range
      check (playback_token_ttl_seconds between 60 and 600);
  end if;
end $$;

comment on column public.event_streams.playback_token_ttl_seconds is
  'Lifetime in seconds for signed Livepeer playback tokens. Server-side functions clamp to 60–600 seconds; default is 600.';

notify pgrst, 'reload schema';
commit;
