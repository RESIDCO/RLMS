-- Load history for Asset Report commits. Read-only after insert; does not
-- change what the importer writes to financials, riders, or cars.
CREATE TABLE IF NOT EXISTS public.asset_report_load_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  snapshot_month date NOT NULL,
  loaded_at timestamptz NOT NULL DEFAULT now(),
  loaded_by text,
  file_name text,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  checks jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS asset_report_load_log_loaded_at_idx
  ON public.asset_report_load_log (loaded_at DESC);

ALTER TABLE public.asset_report_load_log ENABLE ROW LEVEL SECURITY;
