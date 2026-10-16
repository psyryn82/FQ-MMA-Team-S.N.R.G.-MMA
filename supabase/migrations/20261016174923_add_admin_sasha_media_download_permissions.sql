ALTER TABLE public.admin_users
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'admin';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.admin_users'::regclass
      AND conname = 'admin_users_role_check'
  ) THEN
    ALTER TABLE public.admin_users
      ADD CONSTRAINT admin_users_role_check
      CHECK (role IN ('admin', 'content_manager', 'support', 'sasha'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.media_download_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id bigint NOT NULL REFERENCES public.media(id) ON DELETE CASCADE,
  authorized_email text NOT NULL,
  granted_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT media_download_permissions_email_check
    CHECK (authorized_email = lower(trim(authorized_email))
      AND length(authorized_email) BETWEEN 3 AND 320),
  CONSTRAINT media_download_permissions_expiry_check
    CHECK (expires_at IS NULL OR expires_at > created_at),
  CONSTRAINT media_download_permissions_revoke_check
    CHECK ((revoked_at IS NULL AND revoked_by IS NULL)
      OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS media_download_permissions_one_active_per_email
  ON public.media_download_permissions (media_id, authorized_email)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS media_download_permissions_email_lookup
  ON public.media_download_permissions (authorized_email, media_id)
  WHERE revoked_at IS NULL;

ALTER TABLE public.media_download_permissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.media_download_permissions FROM anon, authenticated;
GRANT ALL ON TABLE public.media_download_permissions TO service_role;
