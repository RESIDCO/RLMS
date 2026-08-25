-- Move Account Manager from OL (riders) to Account.
-- Additive. Does not drop riders.account_manager.
-- Does not change railcars.entity, active, car_number, or importer-owned columns.

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS account_manager text;

COMMENT ON COLUMN public.accounts.account_manager IS
  'Free-text initials (e.g. GS). Source of truth is Account Management only. Importers must never write this column.';

ALTER TABLE public.master_leases
  ADD COLUMN IF NOT EXISTS account_id bigint REFERENCES public.accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_master_leases_account_id ON public.master_leases (account_id);

COMMENT ON COLUMN public.master_leases.account_id IS
  'FK to accounts. Replaces matching master_leases.lessee to accounts.name at read time.';

UPDATE public.master_leases ml
SET account_id = a.id
FROM public.accounts a
WHERE ml.account_id IS NULL
  AND ml.lessee IS NOT NULL
  AND btrim(ml.lessee) <> ''
  AND lower(btrim(ml.lessee)) = lower(a.name);

COMMENT ON COLUMN public.riders.account_manager IS
  'DEPRECATED. Unused. Prefer accounts.account_manager via master_leases.account_id. Column kept; do not drop. Importers must still never write it.';
