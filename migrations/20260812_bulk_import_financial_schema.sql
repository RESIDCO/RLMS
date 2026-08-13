-- §1 Bulk Import / Financial Refresh — additive schema only
-- Spec: RLMS_Bulk_Import_and_Financial_Refresh_Instructions.md
--
-- Confirmed live (eweydhfduepaefshriar): railcars.active already exists as boolean
-- NOT NULL DEFAULT true — do not recreate or alter it.

-- ── 1.1 New columns on railcars ─────────────────────────────────────────────
ALTER TABLE public.railcars
  ADD COLUMN IF NOT EXISTS legacy_valid_car_id    text,
  ADD COLUMN IF NOT EXISTS client_id              text,
  ADD COLUMN IF NOT EXISTS cover_sheet            text,
  ADD COLUMN IF NOT EXISTS legal_owner            text,
  ADD COLUMN IF NOT EXISTS update_made            text,
  ADD COLUMN IF NOT EXISTS update_needed_next_vcf text,
  ADD COLUMN IF NOT EXISTS current_assignment_id  text;

COMMENT ON COLUMN public.railcars.legacy_valid_car_id IS
  'VALID_CAR_ID from V_Valid Car File — not unique; match cars on car_initial+car_number only.';
COMMENT ON COLUMN public.railcars.cover_sheet IS
  'COVER_SHEET passthrough — meaning TBD; opaque editable text for now.';
COMMENT ON COLUMN public.railcars.legal_owner IS
  'Owner / Owner Entity (e.g. ALF VII, RPS, LLC).';
COMMENT ON COLUMN public.railcars.update_made IS
  'UPDATE MADE — standalone editable; included in monthly V_Valid-style export.';
COMMENT ON COLUMN public.railcars.update_needed_next_vcf IS
  'UPDATE NEEDED NEXT VCF — standalone editable; included in monthly export.';
COMMENT ON COLUMN public.railcars.current_assignment_id IS
  'ASSIGNMENT_ID of the car''s current/active assignment row from VCF.';

-- ── 1.2 rider_financial_summary (Asset Report snapshots) ────────────────────
CREATE TABLE IF NOT EXISTS public.rider_financial_summary (
  id                             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  snapshot_month                 date NOT NULL,
  rider_id                       text NOT NULL,
  car_type                       text NOT NULL,
  entity                         text NOT NULL,
  count_cars                     integer NOT NULL,
  lessee                         text,
  former_deal                    text,
  legal_owner                    text,
  net_equipment_cost_total       numeric,
  net_equipment_cost_per_car     numeric,
  total_book_value               numeric,
  book_value_per_asset           numeric,
  total_monthly_depreciation     numeric,
  monthly_depreciation_per_asset numeric,
  monthly_rent_per_car           numeric,
  monthly_rent_total             numeric,
  lease_end_residual_total       numeric,
  lease_end_residual_per_asset   numeric,
  months_until_lease_exp         numeric,
  deal_resp                      text,
  lender                         text,
  liability_insurance_exp        date,
  property_insurance_exp         date,
  raw_air_rail_power             text,
  created_at                     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rider_financial_summary_uniq
    UNIQUE (snapshot_month, rider_id, car_type, entity, net_equipment_cost_per_car)
);

CREATE INDEX IF NOT EXISTS idx_rfs_rider_month
  ON public.rider_financial_summary (rider_id, snapshot_month DESC);

COMMENT ON TABLE public.rider_financial_summary IS
  'Append-only monthly Asset Report rows (Main/RPS). One row per rider+car_type+entity+cost-basis batch.';

-- ── 1.3 assignment_history — add period/assignment fields for VCF import ────
-- Existing table is move-event oriented (from/to rider, moved_at). Additive columns
-- hold one VCF assignment-period row without creating a parallel table.
ALTER TABLE public.assignment_history
  ADD COLUMN IF NOT EXISTS rider_external_id  text,
  ADD COLUMN IF NOT EXISTS assignment_label   text,
  ADD COLUMN IF NOT EXISTS start_date         date,
  ADD COLUMN IF NOT EXISTS end_date           date,
  ADD COLUMN IF NOT EXISTS active             boolean,
  ADD COLUMN IF NOT EXISTS comment            text,
  ADD COLUMN IF NOT EXISTS assignment_id_ext  text;

COMMENT ON COLUMN public.assignment_history.rider_external_id IS
  'VCF rider / Sub id (e.g. OL1229) for this assignment period.';
COMMENT ON COLUMN public.assignment_history.active IS
  'Whether this assignment period was ACTIVE in the source VCF row (-1/0 → bool).';
COMMENT ON COLUMN public.assignment_history.assignment_id_ext IS
  'Source ASSIGNMENT_ID for this period row.';

CREATE INDEX IF NOT EXISTS idx_assignment_history_railcar_period
  ON public.assignment_history (railcar_id, start_date DESC NULLS LAST);

-- ── 1.3 car_number_history — add initials (effective date already = changed_at)
ALTER TABLE public.car_number_history
  ADD COLUMN IF NOT EXISTS old_car_initial text,
  ADD COLUMN IF NOT EXISTS new_car_initial text;

COMMENT ON COLUMN public.car_number_history.old_car_initial IS
  'Prior reporting mark / car initial before renumber.';
COMMENT ON COLUMN public.car_number_history.new_car_initial IS
  'New reporting mark / car initial after renumber.';

-- Grants: match typical authenticated/service access used by the app
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rider_financial_summary TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rider_financial_summary TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
