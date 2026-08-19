-- Per-car complete flag on a program (independent of fleet status / exited).
ALTER TABLE public.program_cars
  ADD COLUMN IF NOT EXISTS completed boolean NOT NULL DEFAULT false;

ALTER TABLE public.program_cars
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_program_cars_completed
  ON public.program_cars (program_id, completed)
  WHERE exited_date IS NULL;
