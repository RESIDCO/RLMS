-- 20261014_repair_ui_review_feedback.sql
-- Bruce Phase 1 UI review (2026-10-14):
--   bo_rules lookup, shop city/state + billing_road, BO attachments retention,
--   distribution list, estimate header field audit (pencil editor).
-- APPLY ONLY to local Postgres. Schema "repair" only.

BEGIN;

-- ── Bad-order rule lookup (admins can add; active filter) ─────────────
CREATE TABLE IF NOT EXISTS repair.bo_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  code            text NOT NULL,
  description     text NOT NULL,
  -- Maps to repair.events.rule track behavior (RULE_1 vs RULE_107 two-track)
  event_rule      text NOT NULL DEFAULT 'RULE_1'
                    CHECK (event_rule IN ('RULE_1', 'RULE_107')),
  requires_other_text boolean NOT NULL DEFAULT false,
  active          boolean NOT NULL DEFAULT true,
  sort_order      int NOT NULL DEFAULT 100,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  deleted_at      timestamptz,
  deleted_by      text,
  delete_reason   text,
  UNIQUE (tenant_id, code)
);

COMMENT ON TABLE repair.bo_rules IS
  'Bad-order reason/rule lookup (code + description + active). Seeded from known AAR Rule 1 / Rule 107 labels; full repairSMART list not in store captures — admins may add.';

-- Seed known AAR rules referenced in Manual_Gap / Railinc reference / prior UI.
-- Do NOT invent unmarked shopping-reason codes — document gap in HANDOFF.
INSERT INTO repair.bo_rules
  (tenant_id, code, description, event_rule, requires_other_text, active, sort_order, created_by)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'RULE_1',
   'Rule 1 — Interchange / shopping', 'RULE_1', false, true, 10, 'migration:ui_review'),
  ('00000000-0000-4000-8000-000000000001', 'RULE_107',
   'Rule 107 — Damaged & Defective Car Tracking (DDCT)', 'RULE_107', false, true, 20, 'migration:ui_review'),
  ('00000000-0000-4000-8000-000000000001', 'OTHER',
   'Other (manual text required)', 'RULE_1', true, true, 900, 'migration:ui_review')
ON CONFLICT (tenant_id, code) DO UPDATE SET
  description = EXCLUDED.description,
  event_rule = EXCLUDED.event_rule,
  requires_other_text = EXCLUDED.requires_other_text,
  active = EXCLUDED.active,
  sort_order = EXCLUDED.sort_order
  WHERE repair.bo_rules.deleted_at IS NULL;

-- ── Shops: city, state, billing road ──────────────────────────────────
ALTER TABLE repair.shops
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS billing_road text;

COMMENT ON COLUMN repair.shops.billing_road IS
  'Default billing road / billing party mark for BO auto-fill. Override on event requires reason.';

-- Backfill billing_road default = reporting mark; city/state from remit "City, ST |"
UPDATE repair.shops
SET billing_road = COALESCE(NULLIF(btrim(billing_road), ''), reporting_mark)
WHERE deleted_at IS NULL;

UPDATE repair.shops
SET
  city = COALESCE(
    NULLIF(btrim(city), ''),
    NULLIF(btrim((regexp_match(remit_address, '([A-Za-z .''\-]+),\s*([A-Z]{2})\s*\|'))[1]), '')
  ),
  state = COALESCE(
    NULLIF(btrim(state), ''),
    NULLIF(btrim((regexp_match(remit_address, '([A-Za-z .''\-]+),\s*([A-Z]{2})\s*\|'))[2]), '')
  )
WHERE deleted_at IS NULL AND remit_address IS NOT NULL;

-- APA demo shop: Snowflake, AZ (from seed remit)
UPDATE repair.shops
SET city = COALESCE(NULLIF(btrim(city), ''), 'Snowflake'),
    state = COALESCE(NULLIF(btrim(state), ''), 'AZ'),
    billing_road = COALESCE(NULLIF(btrim(billing_road), ''), reporting_mark)
WHERE reporting_mark = 'APA' AND deleted_at IS NULL;

UPDATE repair.shops
SET city = COALESCE(NULLIF(btrim(city), ''), 'Demo City'),
    state = COALESCE(NULLIF(btrim(state), ''), 'TX'),
    billing_road = COALESCE(NULLIF(btrim(billing_road), ''), reporting_mark)
WHERE reporting_mark = 'DEMO' AND deleted_at IS NULL;

-- ── Events / bad_orders: rule lookup + billing road override ──────────
ALTER TABLE repair.events
  ADD COLUMN IF NOT EXISTS bo_rule_code text,
  ADD COLUMN IF NOT EXISTS bo_rule_other_text text,
  ADD COLUMN IF NOT EXISTS billing_road text,
  ADD COLUMN IF NOT EXISTS billing_road_override_reason text;

ALTER TABLE repair.bad_orders
  ADD COLUMN IF NOT EXISTS bo_rule_code text,
  ADD COLUMN IF NOT EXISTS bo_rule_other_text text;

-- Backfill bo_rule_code from legacy events.rule
UPDATE repair.events
SET bo_rule_code = COALESCE(NULLIF(btrim(bo_rule_code), ''), rule)
WHERE deleted_at IS NULL AND bo_rule_code IS NULL;

UPDATE repair.bad_orders bo
SET bo_rule_code = e.bo_rule_code
FROM repair.events e
WHERE bo.event_id = e.id AND bo.bo_rule_code IS NULL;

-- ── Documents: explicit VOIDED lifecycle (never purge) ────────────────
ALTER TABLE repair.documents
  ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (lifecycle_status IN ('ACTIVE', 'VOIDED'));

UPDATE repair.documents
SET lifecycle_status = 'VOIDED'
WHERE deleted_at IS NOT NULL AND lifecycle_status = 'ACTIVE';

COMMENT ON COLUMN repair.documents.lifecycle_status IS
  'ACTIVE or VOIDED. Soft-delete sets VOIDED; nothing is purged (MG2).';

-- ── Distribution list (plain email recipients for BO notifications) ───
CREATE TABLE IF NOT EXISTS repair.distribution_list_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  email           text NOT NULL,
  name            text,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  deleted_at      timestamptz,
  deleted_by      text,
  delete_reason   text,
  UNIQUE (tenant_id, email)
);

COMMENT ON TABLE repair.distribution_list_entries IS
  'Plain email distribution list for BO notifications. Anyone can be added; not Resp-6-specific.';

-- ── Estimate header field edits (pencil editor audit) ─────────────────
CREATE TABLE IF NOT EXISTS repair.estimate_header_edits (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  estimate_id     uuid NOT NULL REFERENCES repair.estimates(id),
  field_key       text NOT NULL,
  old_value       text,
  new_value       text,
  reason          text NOT NULL,
  actor           text NOT NULL,
  edited_at       timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text
);

CREATE INDEX IF NOT EXISTS estimate_header_edits_estimate_idx
  ON repair.estimate_header_edits (estimate_id, edited_at DESC);

-- Append-only
DROP TRIGGER IF EXISTS estimate_header_edits_no_update ON repair.estimate_header_edits;
CREATE TRIGGER estimate_header_edits_no_update
  BEFORE UPDATE ON repair.estimate_header_edits
  FOR EACH ROW EXECUTE FUNCTION repair.reject_mutation();

DROP TRIGGER IF EXISTS estimate_header_edits_no_delete ON repair.estimate_header_edits;
CREATE TRIGGER estimate_header_edits_no_delete
  BEFORE DELETE ON repair.estimate_header_edits
  FOR EACH ROW EXECUTE FUNCTION repair.reject_mutation();

COMMIT;
