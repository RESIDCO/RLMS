-- Phase 1 undo capture: before/after + change_group on activity_log.
-- Inserts stay service_role-only (RLS SELECT for authenticated).

ALTER TABLE public.activity_log
  ADD COLUMN IF NOT EXISTS change_group uuid,
  ADD COLUMN IF NOT EXISTS table_name text,
  ADD COLUMN IF NOT EXISTS row_pk bigint,
  ADD COLUMN IF NOT EXISTS before jsonb,
  ADD COLUMN IF NOT EXISTS after jsonb,
  ADD COLUMN IF NOT EXISTS undoable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS undo_of bigint,
  ADD COLUMN IF NOT EXISTS undone_at timestamptz,
  ADD COLUMN IF NOT EXISTS undone_by text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'activity_log_undo_of_fkey'
      AND conrelid = 'public.activity_log'::regclass
  ) THEN
    ALTER TABLE public.activity_log
      ADD CONSTRAINT activity_log_undo_of_fkey
      FOREIGN KEY (undo_of) REFERENCES public.activity_log (id);
  END IF;
END $$;

ALTER TABLE public.activity_log DROP CONSTRAINT IF EXISTS activity_log_entity_type_check;
ALTER TABLE public.activity_log
  ADD CONSTRAINT activity_log_entity_type_check
  CHECK (entity_type = ANY (ARRAY['railcar'::text, 'rider'::text, 'program'::text, 'program_car'::text]));

CREATE INDEX IF NOT EXISTS idx_activity_log_change_group
  ON public.activity_log (change_group)
  WHERE change_group IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_activity_log_railcar_occurred
  ON public.activity_log (railcar_id, occurred_at DESC)
  WHERE railcar_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_activity_log_entity
  ON public.activity_log (entity_type, entity_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_log_actor_occurred
  ON public.activity_log (actor, occurred_at DESC)
  WHERE actor IS NOT NULL;

ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.activity_log FROM PUBLIC, anon;
GRANT SELECT ON public.activity_log TO authenticated;
GRANT ALL ON public.activity_log TO service_role;
DO $$
BEGIN
  GRANT USAGE, SELECT ON SEQUENCE public.activity_log_id_seq TO service_role;
EXCEPTION WHEN undefined_table THEN
  NULL;
END $$;

DROP POLICY IF EXISTS activity_log_select_authenticated ON public.activity_log;
CREATE POLICY activity_log_select_authenticated ON public.activity_log
  FOR SELECT TO authenticated
  USING (true);

COMMENT ON COLUMN public.activity_log.change_group IS
  'One uuid per UI save or bulk apply. Undo (PR U2) reverts every row in the group.';
COMMENT ON COLUMN public.activity_log.undoable IS
  'false for remarks, imports, and other non-reversible paths.';
