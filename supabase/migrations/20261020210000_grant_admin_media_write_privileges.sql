-- Authenticated users still require an explicit SQL grant in addition to RLS policies.
-- These grants enable dashboard CRUD requests; existing admin-only RLS policies
-- continue to restrict media writes to approved FQ MMA administrators.
GRANT INSERT, UPDATE, DELETE ON TABLE public.media TO authenticated;
