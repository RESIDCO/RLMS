-- 20260811_add_editor_role.sql
--
-- Purpose: widen user_roles.role to allow the Editor tier
-- (admin | editor | viewer). Idempotent — safe to re-run.
--
-- Do NOT apply to the live personal Supabase project until corporate
-- cutover planning; this file is checked in for the corporate apply step.

BEGIN;

ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;

ALTER TABLE user_roles
  ADD CONSTRAINT user_roles_role_check
  CHECK (role IN ('admin', 'editor', 'viewer'));

COMMIT;
