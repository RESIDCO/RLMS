-- OL-level Account Management tags. Additive. Does not drop or rewrite
-- railcars, master_leases, or other Lease Management rider columns.

ALTER TABLE public.riders
  ADD COLUMN IF NOT EXISTS status_tag text;

ALTER TABLE public.riders
  DROP CONSTRAINT IF EXISTS riders_status_tag_check;

ALTER TABLE public.riders
  ADD CONSTRAINT riders_status_tag_check
  CHECK (status_tag IS NULL OR status_tag IN ('good', 'watch', 'risk'));

ALTER TABLE public.riders
  ADD COLUMN IF NOT EXISTS account_mgmt_comment text;

COMMENT ON COLUMN public.riders.status_tag IS
  'OL-level relationship status (good/watch/risk), set only from Account Management. Never written by any import.';

COMMENT ON COLUMN public.riders.account_mgmt_comment IS
  'Free-text note on this OL, set only from Account Management. Never written by any import.';
