-- Allow approved administrators to list uploaded public media in the admin dashboard.
-- The bucket remains public for direct asset delivery; this policy only grants
-- authenticated FQ MMA administrators permission to list/read object metadata.
CREATE POLICY "Admins read FQ MMA public media"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'fqmma-media'
  AND (SELECT public.is_fqmma_admin())
);
