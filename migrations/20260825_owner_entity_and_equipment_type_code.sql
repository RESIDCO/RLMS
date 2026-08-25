-- One-time OL owner_entity + railcar equipment_type_code columns.
-- owner_entity is populated here from the latest Asset Report snapshot plus
-- strong-consistent-lessee backfill. equipment_type_code is loaded separately
-- from simpleEquipmentQueryResult.csv (script/load_equipment_type_code.ts).

ALTER TABLE public.riders
  ADD COLUMN IF NOT EXISTS owner_entity text;

COMMENT ON COLUMN public.riders.owner_entity IS
  'Legal owning entity for this OL (e.g. ALF P-I, RPS LLC, RLH1), sourced once from the Asset Report (rider_financial_summary.legal_owner). One-time load — never written by any import, including future Financial Data Refresh / Asset Report loads. Edit manually if it ever needs correcting.';

ALTER TABLE public.railcars
  ADD COLUMN IF NOT EXISTS equipment_type_code text;

COMMENT ON COLUMN public.railcars.equipment_type_code IS
  'Mechanical equipment type code (e.g. C112, C214), one-time load from an external equipment query. Never written by any import (Valid Car File, Master Car List, or Financial Data Refresh) — edit manually if it needs correcting.';

WITH latest_owner AS (
  SELECT DISTINCT ON (rider_id) rider_id, legal_owner
  FROM public.rider_financial_summary
  ORDER BY rider_id, snapshot_month DESC
)
UPDATE public.riders r
SET owner_entity = lo.legal_owner
FROM latest_owner lo
WHERE lo.rider_id = r.schedule_number
  AND lo.legal_owner IS NOT NULL
  AND r.owner_entity IS NULL;

WITH latest_owner AS (
  SELECT DISTINCT ON (rider_id) rider_id, legal_owner
  FROM public.rider_financial_summary
  ORDER BY rider_id, snapshot_month DESC
),
rider_owner AS (
  SELECT r.id AS rider_id, r.master_lease_id, ml.lessee, lo.legal_owner
  FROM public.riders r
  JOIN public.master_leases ml ON ml.id = r.master_lease_id
  LEFT JOIN latest_owner lo ON lo.rider_id = r.schedule_number
),
strong_consistent_lessees AS (
  SELECT lessee, min(legal_owner) AS the_owner
  FROM rider_owner
  WHERE legal_owner IS NOT NULL
  GROUP BY lessee
  HAVING count(*) >= 2 AND count(DISTINCT legal_owner) = 1
)
UPDATE public.riders r
SET owner_entity = scl.the_owner
FROM public.master_leases ml, strong_consistent_lessees scl
WHERE r.master_lease_id = ml.id
  AND ml.lessee = scl.lessee
  AND r.owner_entity IS NULL;
