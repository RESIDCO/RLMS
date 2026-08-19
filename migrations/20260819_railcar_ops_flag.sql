-- Watch / exception flag on a railcar (independent of fleet_status / active).
ALTER TABLE public.railcars
  ADD COLUMN IF NOT EXISTS ops_flag text;

ALTER TABLE public.railcars
  ADD COLUMN IF NOT EXISTS ops_flag_set_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_railcars_ops_flag
  ON public.railcars (ops_flag)
  WHERE ops_flag IS NOT NULL;
