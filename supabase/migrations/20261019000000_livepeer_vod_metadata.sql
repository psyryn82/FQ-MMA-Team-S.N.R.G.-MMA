-- Livepeer video-on-demand metadata. Existing media and purchase records remain untouched.
alter table public.media
  add column if not exists livepeer_asset_id text,
  add column if not exists livepeer_playback_id text,
  add column if not exists livepeer_status text not null default 'not_uploaded',
  add column if not exists livepeer_playback_policy text not null default 'none';

alter table public.media drop constraint if exists media_livepeer_status_check;
alter table public.media add constraint media_livepeer_status_check
  check (livepeer_status in ('not_uploaded', 'processing', 'ready', 'failed'));

alter table public.media drop constraint if exists media_livepeer_playback_policy_check;
alter table public.media add constraint media_livepeer_playback_policy_check
  check (livepeer_playback_policy in ('none', 'public', 'jwt'));
