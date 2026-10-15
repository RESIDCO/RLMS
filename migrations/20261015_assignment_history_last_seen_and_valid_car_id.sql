-- Stamp columns so export can tell Oct 13 file rows from kept history.
-- last_seen_load_id is set on insert/update/unchanged VCF matches, never leftovers.

ALTER TABLE public.assignment_history
  ADD COLUMN IF NOT EXISTS last_seen_load_id uuid REFERENCES public.vcf_load_log (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS valid_car_id_ext text;

CREATE INDEX IF NOT EXISTS idx_assignment_history_last_seen_load
  ON public.assignment_history (last_seen_load_id);

COMMENT ON COLUMN public.assignment_history.last_seen_load_id IS
  'vcf_load_log.id of the latest Valid Car File that matched this period. Null means kept history or never stamped.';
COMMENT ON COLUMN public.assignment_history.valid_car_id_ext IS
  'VALID_CAR_ID from the matching VCF row.';
