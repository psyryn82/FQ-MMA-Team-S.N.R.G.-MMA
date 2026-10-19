-- Add covering indexes for foreign-key columns flagged by Supabase's performance advisor.
create index if not exists media_download_permissions_granted_by_idx on public.media_download_permissions (granted_by);
create index if not exists media_download_permissions_revoked_by_idx on public.media_download_permissions (revoked_by);
create index if not exists media_download_tokens_sent_by_idx on public.media_download_tokens (sent_by);
create index if not exists promotion_redemptions_event_id_idx on public.promotion_redemptions (event_id);
create index if not exists promotions_created_by_idx on public.promotions (created_by);
create index if not exists promotions_event_id_idx on public.promotions (event_id);
create index if not exists site_assets_created_by_idx on public.site_assets (created_by);
