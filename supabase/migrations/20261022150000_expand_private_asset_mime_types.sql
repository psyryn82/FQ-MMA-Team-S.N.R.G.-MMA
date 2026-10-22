-- Expand private archive support for common image, video, and document formats.
-- Public media remains restricted to explicitly approved public-copy use cases.
begin;

update storage.buckets
set file_size_limit = 5368709120,
    allowed_mime_types = array[
      'image/jpeg','image/png','image/webp','image/gif','image/avif','image/bmp','image/tiff','image/heic',
      'video/mp4','video/webm','video/quicktime','video/x-msvideo','video/x-matroska','video/3gpp',
      'application/pdf','application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.oasis.opendocument.text','application/rtf','text/rtf','text/plain','text/csv',
      'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.oasis.opendocument.spreadsheet','application/vnd.oasis.opendocument.presentation'
    ]
where id = 'fqmma-private';

notify pgrst, 'reload schema';
commit;
