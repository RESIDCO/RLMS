-- CRB billing rules (Q14–Q17): direction-dependent marks, billed-party map + history,
-- per-billed-party terms, account month stamped by close run.
-- repair schema only. Local Postgres via npm run repair:migrate:local.
BEGIN;

-- ── Tenant / fleet settings (no hard-coded OFOX in application code) ─
-- carOwnerMark = outbound rebuttal billing party (cols 2–5).
-- Migrate interim crbBillingPartyMark → carOwnerMark when present.
UPDATE repair.tenants
SET settings = COALESCE(settings, '{}'::jsonb)
  || jsonb_build_object(
    'carOwnerMark', COALESCE(
      NULLIF(settings->>'carOwnerMark', ''),
      NULLIF(settings->>'crbBillingPartyMark', ''),
      ''
    ),
    'crbPaymentTermsDays', COALESCE(
      NULLIF(settings->>'crbPaymentTermsDays', '')::int,
      NULLIF(regexp_replace(COALESCE(settings->>'crbPaymentTerms', '30'), '\D', '', 'g'), '')::int,
      30
    ),
    'crbTaxpayerId', COALESCE(settings->>'crbTaxpayerId', ''),
    'crbCurrency', COALESCE(NULLIF(settings->>'crbCurrency', ''), 'U'),
    'crbExportDir', COALESCE(
      NULLIF(settings->>'crbExportDir', ''),
      'modules/repair/dev/exports'
    )
  )
WHERE id IS NOT NULL;

COMMENT ON COLUMN repair.tenants.settings IS
  'JSON settings. CRB: carOwnerMark (outbound billing party), crbPaymentTermsDays (default net 30),
   crbTaxpayerId (blank OK for now), crbCurrency, crbExportDir. Do not hard-code fleet marks in code.';

-- ── Billed-party mapping (car/lease → lessee or railroad mark) ───────
CREATE TABLE IF NOT EXISTS repair.billed_party_mappings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES repair.tenants(id),
  -- Match keys (at least one of car pair or lease_rider required — enforced in service)
  car_mark            text,
  car_number          text,
  lease_rider         text,
  party_role          text NOT NULL CHECK (party_role IN ('LESSEE', 'RAILROAD')),
  billed_party_mark   text NOT NULL, -- 1–4 char reporting mark
  payment_terms_days  integer CHECK (payment_terms_days IS NULL OR payment_terms_days > 0),
  notes               text,
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          text,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          text,
  deleted_at          timestamptz,
  deleted_by          text,
  delete_reason       text,
  CONSTRAINT billed_party_mappings_mark_len
    CHECK (char_length(btrim(billed_party_mark)) BETWEEN 1 AND 4),
  CONSTRAINT billed_party_mappings_has_key CHECK (
    (car_mark IS NOT NULL AND car_number IS NOT NULL)
    OR (lease_rider IS NOT NULL AND btrim(lease_rider) <> '')
  )
);

CREATE INDEX IF NOT EXISTS billed_party_mappings_car_idx
  ON repair.billed_party_mappings (tenant_id, upper(car_mark), car_number)
  WHERE deleted_at IS NULL AND active AND car_mark IS NOT NULL;

CREATE INDEX IF NOT EXISTS billed_party_mappings_lease_idx
  ON repair.billed_party_mappings (tenant_id, lease_rider)
  WHERE deleted_at IS NULL AND active AND lease_rider IS NOT NULL;

CREATE INDEX IF NOT EXISTS billed_party_mappings_role_idx
  ON repair.billed_party_mappings (tenant_id, party_role)
  WHERE deleted_at IS NULL AND active;

-- Append-only history for admin edits
CREATE TABLE IF NOT EXISTS repair.billed_party_mapping_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  mapping_id      uuid NOT NULL, -- not FK-enforced on delete; soft-delete only on parent
  action          text NOT NULL CHECK (action IN ('CREATE', 'UPDATE', 'DEACTIVATE', 'REACTIVATE')),
  before_json     jsonb,
  after_json      jsonb,
  actor           text,
  at              timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text
);

DROP TRIGGER IF EXISTS billed_party_mapping_history_no_update
  ON repair.billed_party_mapping_history;
CREATE TRIGGER billed_party_mapping_history_no_update
  BEFORE UPDATE ON repair.billed_party_mapping_history
  FOR EACH ROW EXECUTE FUNCTION repair.reject_mutation();

DROP TRIGGER IF EXISTS billed_party_mapping_history_no_delete
  ON repair.billed_party_mapping_history;
CREATE TRIGGER billed_party_mapping_history_no_delete
  BEFORE DELETE ON repair.billed_party_mapping_history
  FOR EACH ROW EXECUTE FUNCTION repair.reject_mutation();

CREATE INDEX IF NOT EXISTS billed_party_mapping_history_mapping_idx
  ON repair.billed_party_mapping_history (mapping_id, at DESC);

-- Stamp account month on close-run items (Q17)
ALTER TABLE repair.close_run_events
  ADD COLUMN IF NOT EXISTS account_month text;

ALTER TABLE repair.billing_lines
  ADD COLUMN IF NOT EXISTS account_month text;

ALTER TABLE repair.rebuttal_invoices
  ADD COLUMN IF NOT EXISTS account_month text,
  ADD COLUMN IF NOT EXISTS party_role text
    CHECK (party_role IS NULL OR party_role IN ('LESSEE', 'RAILROAD')),
  ADD COLUMN IF NOT EXISTS payment_terms_days integer;

-- Seed demo mapping for local smoke (ARSX 100001 → LESSEE mark LSEE)
INSERT INTO repair.billed_party_mappings
  (tenant_id, car_mark, car_number, lease_rider, party_role, billed_party_mark,
   payment_terms_days, notes, created_by, updated_by)
SELECT
  '00000000-0000-4000-8000-000000000001',
  'ARSX', '100001', 'R1', 'LESSEE', 'LSEE',
  NULL, 'Local smoke seed (Q15)', 'migration:20261014_crb_rules', 'migration:20261014_crb_rules'
WHERE NOT EXISTS (
  SELECT 1 FROM repair.billed_party_mappings
  WHERE tenant_id = '00000000-0000-4000-8000-000000000001'
    AND upper(car_mark) = 'ARSX' AND car_number = '100001'
    AND party_role = 'LESSEE' AND deleted_at IS NULL
);

INSERT INTO repair.billed_party_mapping_history
  (tenant_id, mapping_id, action, before_json, after_json, actor, created_by)
SELECT m.tenant_id, m.id, 'CREATE', NULL,
       to_jsonb(m) - 'id',
       'migration:20261014_crb_rules', 'migration:20261014_crb_rules'
FROM repair.billed_party_mappings m
WHERE m.created_by = 'migration:20261014_crb_rules'
  AND NOT EXISTS (
    SELECT 1 FROM repair.billed_party_mapping_history h WHERE h.mapping_id = m.id
  );

COMMIT;
