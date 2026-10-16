-- Add optional public flyer artwork to event records.
-- Apply before deploying the admin/public-page code that reads this column.
alter table public.events
  add column if not exists flyer_image_url text not null default '';
