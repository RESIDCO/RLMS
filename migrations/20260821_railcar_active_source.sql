-- Protect manually-set Inactive/Reactivate from being overwritten by VCF import.
-- Mirrors fleet_status_source. Additive only — does not change existing railcars.active values.

ALTER TABLE public.railcars
  ADD COLUMN IF NOT EXISTS active_source text;

UPDATE public.railcars
SET active_source = 'auto'
WHERE active_source IS NULL;

ALTER TABLE public.railcars
  ALTER COLUMN active_source SET DEFAULT 'auto';

ALTER TABLE public.railcars
  ALTER COLUMN active_source SET NOT NULL;

ALTER TABLE public.railcars
  DROP CONSTRAINT IF EXISTS railcars_active_source_check;

ALTER TABLE public.railcars
  ADD CONSTRAINT railcars_active_source_check
  CHECK (active_source IN ('auto', 'manual'));

COMMENT ON COLUMN public.railcars.active_source IS
  'auto = VCF/import may refresh active/status/active_status; manual = set by guarded Inactive/Reactivate and protected from import overwrite.';
