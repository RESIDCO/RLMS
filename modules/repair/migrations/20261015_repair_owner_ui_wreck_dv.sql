-- Owner UI wreck DV panel — mark seed labor rate as placeholder (not from AAR manual).
-- $185.00/hr (18500¢) was invented for local smoke/demo in 20261015_repair_owner_ui_wreck.sql;
-- it is NOT extracted from AAR Office Manual OM 111 / price master.
-- APPLY ONLY to local Postgres. Schema "repair" only.

BEGIN;

UPDATE repair.ref_aar_labor_rates
SET source = 'placeholder',
    edition = NULL,
    rule_page = NULL,
    updated_at = now(),
    updated_by = 'seed:wreck-dv-panel'
WHERE deleted_at IS NULL
  AND labor_rate_cents = 18500
  AND (
    created_by = 'seed:wreck'
    OR source IS NULL
    OR lower(source) IN ('aar', 'seed', 'demo')
  );

COMMENT ON TABLE repair.ref_aar_labor_rates IS
  'AAR quarterly labor rate from Reference Data price master (current edition). Seed $185/hr is placeholder until real OM 111 / price-master import. Used for unpriced wreck-track hours×rate (OWNER_UI_WRECK §4 / §11 #4).';

COMMIT;
