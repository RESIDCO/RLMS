-- Persist V_Valid (and future) export job status so a process crash/restart
-- reports failed instead of a silent 404 from an in-memory Map.
-- Safe to re-run. Does not change v_valid_export_rows.

CREATE TABLE IF NOT EXISTS public.export_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL DEFAULT 'v_valid_cars',
  status text NOT NULL CHECK (status IN ('running', 'ready', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  error_message text,
  row_count integer,
  storage_path text,
  filename text
);

CREATE INDEX IF NOT EXISTS export_jobs_status_created_at
  ON public.export_jobs (status, created_at DESC);

-- At most one in-flight export at a time (any kind).
CREATE UNIQUE INDEX IF NOT EXISTS export_jobs_one_running
  ON public.export_jobs (status)
  WHERE status = 'running';

ALTER TABLE public.export_jobs ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.export_jobs TO service_role;
