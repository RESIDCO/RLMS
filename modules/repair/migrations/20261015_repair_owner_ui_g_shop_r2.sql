-- Owner UI §G r2 — Shop clarity: BO lifecycle dates, missed POD reasons,
-- decision comments (resolve), POD reason codes. Integer cents. Repair schema only.

BEGIN;

-- ── Missed POD / POD-change reason codes (Reference Data admin) ──────────
CREATE TABLE IF NOT EXISTS repair.missed_pod_reason_codes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  code            text NOT NULL,
  label           text NOT NULL,
  description     text,
  active          boolean NOT NULL DEFAULT true,
  sort_order      int NOT NULL DEFAULT 100,
  effective_to    date,
  owner_override  boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  deleted_at      timestamptz,
  deleted_by      text,
  UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS repair_missed_pod_reason_active_idx
  ON repair.missed_pod_reason_codes (tenant_id, active, sort_order)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE repair.missed_pod_reason_codes IS
  '§G r2 editable reason codes for missed POD and POD date changes.';

INSERT INTO repair.missed_pod_reason_codes
  (tenant_id, code, label, description, sort_order, created_by)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'AWAITING_PARTS',
   'Awaiting parts', 'Waiting on parts delivery', 10, 'migration:g_shop_r2'),
  ('00000000-0000-4000-8000-000000000001', 'AWAITING_OWNER',
   'Awaiting owner approval', 'Owner decision pending', 20, 'migration:g_shop_r2'),
  ('00000000-0000-4000-8000-000000000001', 'AWAITING_LESSEE',
   'Awaiting lessee', 'Lessee response pending', 30, 'migration:g_shop_r2'),
  ('00000000-0000-4000-8000-000000000001', 'LABOR',
   'Labor', 'Labor capacity / crew delay', 40, 'migration:g_shop_r2'),
  ('00000000-0000-4000-8000-000000000001', 'WRECK_JIC_HOLD',
   'Wreck / JIC hold', 'Wreck settlement or JIC endorsement hold', 50, 'migration:g_shop_r2'),
  ('00000000-0000-4000-8000-000000000001', 'OTHER',
   'Other', 'Other — see note', 90, 'migration:g_shop_r2')
ON CONFLICT (tenant_id, code) DO UPDATE
  SET label = EXCLUDED.label,
      description = EXCLUDED.description,
      active = true,
      deleted_at = NULL;

-- ── BO lifecycle dates (shop-visible) ────────────────────────────────────
ALTER TABLE repair.bad_orders
  ADD COLUMN IF NOT EXISTS inspected_at date,
  ADD COLUMN IF NOT EXISTS estimate_submitted_at date,
  ADD COLUMN IF NOT EXISTS owner_approved_at date,
  ADD COLUMN IF NOT EXISTS repair_started_at date,
  ADD COLUMN IF NOT EXISTS completed_date date,
  ADD COLUMN IF NOT EXISTS released_at date,
  ADD COLUMN IF NOT EXISTS missed_pod_reason_code text,
  ADD COLUMN IF NOT EXISTS missed_pod_reason_note text,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_reason text;

COMMENT ON COLUMN repair.bad_orders.inspected_at IS '§G r2 Inspected date (owner editable; shop view).';
COMMENT ON COLUMN repair.bad_orders.estimate_submitted_at IS '§G r2 Estimate submitted date.';
COMMENT ON COLUMN repair.bad_orders.owner_approved_at IS '§G r2 Owner approval date.';
COMMENT ON COLUMN repair.bad_orders.repair_started_at IS '§G r2 Repair start date.';
COMMENT ON COLUMN repair.bad_orders.completed_date IS '§G r2 Completed date (shop editable).';
COMMENT ON COLUMN repair.bad_orders.released_at IS '§G r2 Released / outbound date (shop editable).';
COMMENT ON COLUMN repair.bad_orders.missed_pod_reason_code IS
  'Required when today > current POD and not yet released.';
COMMENT ON COLUMN repair.bad_orders.closed_reason IS
  'Why/when Closed (Invoiced) — shown on status timeline.';

-- POD history: structured reason code (append-only rows already have reason text)
ALTER TABLE repair.pod_dates
  ADD COLUMN IF NOT EXISTS reason_code text,
  ADD COLUMN IF NOT EXISTS prior_date date;

COMMENT ON COLUMN repair.pod_dates.reason_code IS
  '§G r2 reason code when POD changes (from missed_pod_reason_codes).';
COMMENT ON COLUMN repair.pod_dates.prior_date IS
  'Prior POD date when this row is a revision (old → new).';

-- ── Decision comments: resolve + line anchoring ──────────────────────────
ALTER TABLE repair.comments
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by text,
  ADD COLUMN IF NOT EXISTS line_no int,
  ADD COLUMN IF NOT EXISTS job_code text,
  ADD COLUMN IF NOT EXISTS decision_kind text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'comments_decision_kind_check'
  ) THEN
    ALTER TABLE repair.comments
      ADD CONSTRAINT comments_decision_kind_check
      CHECK (
        decision_kind IS NULL
        OR decision_kind IN ('REJECT', 'ADJUST', 'GENERAL')
      );
  END IF;
END $$;

COMMENT ON COLUMN repair.comments.decision_kind IS
  '§G r2 REJECT / ADJUST owner comments visible on shop reject/adjust views.';
COMMENT ON COLUMN repair.comments.resolved_at IS
  'Owner marks comment resolved after shop resubmit addresses it.';

-- Soft-retire support already via deleted_at on missed_pod_reason_codes

COMMIT;
