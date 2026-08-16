-- True Railinc OEC + car-level Additions & Betterments.
-- Additive: does not touch railcars.oec / nbv / oac.

ALTER TABLE public.railcars
  ADD COLUMN IF NOT EXISTS railinc_oec numeric;

COMMENT ON COLUMN public.railcars.railinc_oec IS
  'True Railinc/AAR original equipment cost, from the UMLER-style A&B export. Distinct from oec/nbv (RESIDCO internal capitalized cost basis) — this is the figure that must be used for DV calculations.';

-- FK target for railcar_ab_items.code (one current row per A&B code).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dv_ab_codes_code_key'
  ) THEN
    ALTER TABLE public.dv_ab_codes
      ADD CONSTRAINT dv_ab_codes_code_key UNIQUE (code);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.railcar_ab_items (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  railcar_id integer NOT NULL REFERENCES public.railcars(id),
  seq integer NOT NULL,
  code text NOT NULL REFERENCES public.dv_ab_codes(code),
  amount numeric NOT NULL,
  sign text NOT NULL CHECK (sign IN ('P','N')),
  signed_amount numeric GENERATED ALWAYS AS (CASE WHEN sign = 'N' THEN -amount ELSE amount END) STORED,
  application_date date NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (railcar_id, seq)
);

CREATE INDEX IF NOT EXISTS railcar_ab_items_railcar_id_idx
  ON public.railcar_ab_items (railcar_id);

ALTER TABLE public.railcar_ab_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'railcar_ab_items' AND policyname = 'service_full_access'
  ) THEN
    CREATE POLICY "service_full_access" ON public.railcar_ab_items
      AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
  END IF;
END $$;
