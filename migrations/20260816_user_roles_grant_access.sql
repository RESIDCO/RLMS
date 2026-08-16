-- Microsoft-only access: allow a user_roles row before any auth.users exists.
-- Existing rows (with real user_id) are unchanged.

ALTER TABLE public.user_roles
  ALTER COLUMN user_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS user_roles_email_unique_idx
  ON public.user_roles (lower(email));
