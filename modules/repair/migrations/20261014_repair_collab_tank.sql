-- 20261014_repair_collab_tank.sql
--
-- Collaboration: threaded comments (estimate or line) + per-comment notify.
-- Tank car document gate (on by default): shop complete → owner verify/reject;
-- outbound blocked until verified; pending queue.
-- Local Postgres only. Schema "repair" only.

BEGIN;

CREATE TABLE IF NOT EXISTS repair.comments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  event_id        uuid NOT NULL REFERENCES repair.events(id),
  estimate_id     uuid REFERENCES repair.estimates(id),
  revision_id     uuid REFERENCES repair.estimate_revisions(id),
  line_id         uuid REFERENCES repair.estimate_lines(id),
  parent_id       uuid REFERENCES repair.comments(id),
  body            text NOT NULL,
  notify_roles    jsonb NOT NULL DEFAULT '["reviewer","mech_manager"]'::jsonb,
  notify_emails   jsonb NOT NULL DEFAULT '[]'::jsonb,
  did_notify      boolean NOT NULL DEFAULT false,
  author          text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  deleted_at      timestamptz,
  deleted_by      text,
  delete_reason   text
);

CREATE INDEX IF NOT EXISTS comments_event_idx
  ON repair.comments (event_id, created_at)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS comments_estimate_idx
  ON repair.comments (estimate_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS comments_parent_idx
  ON repair.comments (parent_id)
  WHERE deleted_at IS NULL;

-- Tank car document gate settings (tenant default ON)
UPDATE repair.tenants
SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object(
  'tankCarDocGateEnabled', true
)
WHERE settings->>'tankCarDocGateEnabled' IS NULL;

CREATE TABLE IF NOT EXISTS repair.tank_doc_packets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES repair.tenants(id),
  event_id          uuid NOT NULL REFERENCES repair.events(id),
  estimate_id       uuid REFERENCES repair.estimates(id),
  status            text NOT NULL CHECK (status IN (
                      'PENDING_SHOP',
                      'PENDING_OWNER',
                      'VERIFIED',
                      'REJECTED'
                    )) DEFAULT 'PENDING_SHOP',
  shop_completed_at timestamptz,
  shop_completed_by text,
  owner_decided_at  timestamptz,
  owner_decided_by  text,
  owner_decision    text CHECK (owner_decision IS NULL OR owner_decision IN ('VERIFY', 'REJECT')),
  owner_reason      text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        text,
  deleted_at        timestamptz,
  deleted_by        text,
  delete_reason     text,
  UNIQUE (event_id)
);

CREATE INDEX IF NOT EXISTS tank_doc_packets_status_idx
  ON repair.tank_doc_packets (tenant_id, status)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS repair.tank_doc_packet_files (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  packet_id       uuid NOT NULL REFERENCES repair.tank_doc_packets(id),
  document_id     uuid NOT NULL REFERENCES repair.documents(id),
  doc_type        text NOT NULL DEFAULT 'tank_required',
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  UNIQUE (packet_id, document_id)
);

-- Append-only tank gate decisions
CREATE TABLE IF NOT EXISTS repair.tank_doc_decisions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  packet_id       uuid NOT NULL REFERENCES repair.tank_doc_packets(id),
  action          text NOT NULL,
  actor           text NOT NULL,
  reason          text,
  at              timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text
);

DROP TRIGGER IF EXISTS tank_doc_decisions_no_update ON repair.tank_doc_decisions;
CREATE TRIGGER tank_doc_decisions_no_update
  BEFORE UPDATE ON repair.tank_doc_decisions
  FOR EACH ROW EXECUTE FUNCTION repair.reject_mutation();

DROP TRIGGER IF EXISTS tank_doc_decisions_no_delete ON repair.tank_doc_decisions;
CREATE TRIGGER tank_doc_decisions_no_delete
  BEFORE DELETE ON repair.tank_doc_decisions
  FOR EACH ROW EXECUTE FUNCTION repair.reject_mutation();

COMMIT;
