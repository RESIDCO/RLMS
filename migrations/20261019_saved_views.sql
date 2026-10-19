-- Saved views: extend car_lists / car_list_members. Both tables are empty today.
-- PREVIEW ONLY. Run before merge, with Bruce's OK. Not run by this PR.
-- No rent_events, railcars, or RLS changes. No seed data.
BEGIN;
ALTER TABLE public.car_lists
  ADD COLUMN IF NOT EXISTS kind        text        NOT NULL DEFAULT 'fixed',
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS layout      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS pinned      boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pin_order   integer,
  ADD COLUMN IF NOT EXISTS updated_at  timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by  text,
  ADD COLUMN IF NOT EXISTS deleted_at  timestamptz;
ALTER TABLE public.car_lists DROP CONSTRAINT IF EXISTS car_lists_kind_check;
ALTER TABLE public.car_lists ADD CONSTRAINT car_lists_kind_check CHECK (kind IN ('fixed','query'));
ALTER TABLE public.car_lists ALTER COLUMN shared SET DEFAULT true;   -- Bruce: shared org-wide by default
CREATE UNIQUE INDEX IF NOT EXISTS car_lists_name_live_uq
  ON public.car_lists (lower(btrim(name))) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_car_lists_pinned
  ON public.car_lists (pin_order) WHERE pinned AND deleted_at IS NULL;

ALTER TABLE public.car_list_members
  ADD COLUMN IF NOT EXISTS added_at   timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS added_by   text,
  ADD COLUMN IF NOT EXISTS sort_order integer,
  ADD COLUMN IF NOT EXISTS note       text,          -- per-view note, e.g. "scrap" / "abate"
  ADD COLUMN IF NOT EXISTS removed_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_car_list_members_railcar ON public.car_list_members (railcar_id);
CREATE INDEX IF NOT EXISTS idx_car_list_members_live ON public.car_list_members (list_id) WHERE removed_at IS NULL;
COMMIT;
-- RLS stays enabled with no policies (server-only access via service role). No grant changes here.

-- Rollback (do not run with the statements above):
-- BEGIN;
-- DROP INDEX IF EXISTS public.idx_car_list_members_live, public.idx_car_list_members_railcar,
--                      public.idx_car_lists_pinned, public.car_lists_name_live_uq;
-- ALTER TABLE public.car_list_members DROP COLUMN IF EXISTS removed_at, DROP COLUMN IF EXISTS note,
--   DROP COLUMN IF EXISTS sort_order, DROP COLUMN IF EXISTS added_by, DROP COLUMN IF EXISTS added_at;
-- ALTER TABLE public.car_lists DROP CONSTRAINT IF EXISTS car_lists_kind_check;
-- ALTER TABLE public.car_lists ALTER COLUMN shared SET DEFAULT false;
-- ALTER TABLE public.car_lists DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS updated_by,
--   DROP COLUMN IF EXISTS updated_at, DROP COLUMN IF EXISTS pin_order, DROP COLUMN IF EXISTS pinned,
--   DROP COLUMN IF EXISTS layout, DROP COLUMN IF EXISTS description, DROP COLUMN IF EXISTS kind;
-- COMMIT;
