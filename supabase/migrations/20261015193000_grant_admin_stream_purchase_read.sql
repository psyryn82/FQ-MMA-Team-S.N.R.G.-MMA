-- Allow signed-in FQ MMA administrators to read stream purchase history.
-- Row-level security and the existing "Admins can read stream purchase history"
-- policy remain the authorization boundary. Do not grant access to anon.

BEGIN;

GRANT SELECT ON TABLE public.stream_purchases TO authenticated;

COMMIT;
