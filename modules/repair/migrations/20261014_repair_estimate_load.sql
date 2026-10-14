-- 20261014_repair_estimate_load.sql
--
-- Estimate 500-byte intake: ERRORS block / WARNINGS owner accept-reject,
-- multi-car split, Resp 3 wreck separate-file rule, Revision vs Adjustment.
-- Local Postgres only. Schema "repair" only.

BEGIN;

-- Staging load runs (shop link or inbound email)
CREATE TABLE IF NOT EXISTS repair.estimate_load_runs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES repair.tenants(id),
  source            text NOT NULL CHECK (source IN ('SHOP_LINK', 'INBOUND_EMAIL', 'UI')),
  event_link_token_hash text,
  source_document_id uuid REFERENCES repair.documents(id),
  sha256            text NOT NULL,
  original_filename text,
  status            text NOT NULL CHECK (status IN (
                      'BLOCKED_ERRORS',
                      'PENDING_WARNINGS',
                      'LOADED',
                      'REJECTED_WARNINGS',
                      'FAILED'
                    )),
  car_count         int NOT NULL DEFAULT 0,
  actor             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        text
);

CREATE INDEX IF NOT EXISTS estimate_load_runs_tenant_created_idx
  ON repair.estimate_load_runs (tenant_id, created_at DESC);

-- Append-only ERROR / WARNING findings for a load run
CREATE TABLE IF NOT EXISTS repair.estimate_load_findings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  load_run_id     uuid NOT NULL REFERENCES repair.estimate_load_runs(id),
  severity        text NOT NULL CHECK (severity IN ('ERROR', 'WARNING')),
  code            text NOT NULL,
  message         text NOT NULL,
  car_mark        text,
  car_number      text,
  line_no         int,
  detail          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text
);

DROP TRIGGER IF EXISTS estimate_load_findings_no_update ON repair.estimate_load_findings;
CREATE TRIGGER estimate_load_findings_no_update
  BEFORE UPDATE ON repair.estimate_load_findings
  FOR EACH ROW EXECUTE FUNCTION repair.reject_mutation();

DROP TRIGGER IF EXISTS estimate_load_findings_no_delete ON repair.estimate_load_findings;
CREATE TRIGGER estimate_load_findings_no_delete
  BEFORE DELETE ON repair.estimate_load_findings
  FOR EACH ROW EXECUTE FUNCTION repair.reject_mutation();

CREATE INDEX IF NOT EXISTS estimate_load_findings_run_idx
  ON repair.estimate_load_findings (load_run_id, severity);

-- Owner accept/reject of WARNING-only loads (append-only decisions)
CREATE TABLE IF NOT EXISTS repair.estimate_load_decisions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  load_run_id     uuid NOT NULL REFERENCES repair.estimate_load_runs(id),
  decision        text NOT NULL CHECK (decision IN ('ACCEPT_WARNINGS', 'REJECT_WARNINGS')),
  reason          text,
  actor           text NOT NULL,
  decided_at      timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text
);

DROP TRIGGER IF EXISTS estimate_load_decisions_no_update ON repair.estimate_load_decisions;
CREATE TRIGGER estimate_load_decisions_no_update
  BEFORE UPDATE ON repair.estimate_load_decisions
  FOR EACH ROW EXECUTE FUNCTION repair.reject_mutation();

DROP TRIGGER IF EXISTS estimate_load_decisions_no_delete ON repair.estimate_load_decisions;
CREATE TRIGGER estimate_load_decisions_no_delete
  BEFORE DELETE ON repair.estimate_load_decisions
  FOR EACH ROW EXECUTE FUNCTION repair.reject_mutation();

-- Per-car outcomes of a load (one estimate per car)
CREATE TABLE IF NOT EXISTS repair.estimate_load_cars (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  load_run_id     uuid NOT NULL REFERENCES repair.estimate_load_runs(id),
  car_mark        text NOT NULL,
  car_number      text NOT NULL,
  event_id        uuid REFERENCES repair.events(id),
  estimate_id     uuid REFERENCES repair.estimates(id),
  revision_id     uuid REFERENCES repair.estimate_revisions(id),
  load_kind       text CHECK (load_kind IN ('REVISION', 'ADJUSTMENT', 'NEW')),
  line_count      int NOT NULL DEFAULT 0,
  labor           numeric(14,2) NOT NULL DEFAULT 0,
  material        numeric(14,2) NOT NULL DEFAULT 0,
  total           numeric(14,2) NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  UNIQUE (load_run_id, car_mark, car_number)
);

-- Display-name polish: Adjustment For Approval → Adjustment for Approval
UPDATE repair.statuses
SET display_name = 'Adjustment for Approval'
WHERE entity = 'ESTIMATE' AND code = 'ADJUSTMENT_FOR_APPROVAL'
  AND display_name <> 'Adjustment for Approval';

COMMIT;
