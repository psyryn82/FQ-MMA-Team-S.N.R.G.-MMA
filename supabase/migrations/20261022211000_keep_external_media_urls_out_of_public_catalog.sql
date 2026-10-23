-- Keep externally hosted media URLs as administrator references, not public file links.
-- The public media catalog exposes media.file_url for listing display. A URL-only
-- media record must not publish its source URL because that can bypass payment and
-- contact-for-pricing flows. Preserve external_url for approved staff to review.

begin;

update public.media
set file_url = null
where external_url is not null
  and file_url = external_url;

notify pgrst, 'reload schema';

commit;
