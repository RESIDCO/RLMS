-- Account Management v1 shell + OL-level account_manager.
-- Additive only. Does not change railcars.entity, active, car_number,
-- lessee/assignment data, or importer-owned columns.

CREATE TABLE IF NOT EXISTS public.accounts (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text NOT NULL,
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS accounts_name_uniq ON public.accounts (lower(name));

DROP TRIGGER IF EXISTS trg_accounts_updated_at ON public.accounts;
CREATE TRIGGER trg_accounts_updated_at
  BEFORE UPDATE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMENT ON TABLE public.accounts IS
  'One row per customer/prospect. Bootstrapped from master_leases.lessee. Prospects may exist with no MLA/OL.';

INSERT INTO public.accounts (name)
SELECT DISTINCT btrim(lessee)
FROM public.master_leases
WHERE lessee IS NOT NULL AND btrim(lessee) <> ''
ON CONFLICT (lower(name)) DO NOTHING;

ALTER TABLE public.riders
  ADD COLUMN IF NOT EXISTS account_manager text;

COMMENT ON COLUMN public.riders.account_manager IS
  'Free-text initials (e.g. GS). Source of truth is Lease Management only. Importers must never write this column.';

ALTER TABLE public.programs
  ADD COLUMN IF NOT EXISTS account_id bigint REFERENCES public.accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_programs_account_id ON public.programs (account_id);

COMMENT ON COLUMN public.programs.account_id IS
  'Optional link to accounts. Independent of programs.account_manager (that free-text field stays standalone).';
