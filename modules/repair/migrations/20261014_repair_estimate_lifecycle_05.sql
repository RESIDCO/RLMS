-- 20261014_repair_estimate_lifecycle_05.sql
--
-- Manual_Gap_Review reconcile (MUST-HAVE leftovers after lifecycle 01–04).
-- Phase 1 only — no carMARQS/CROP build.
-- Local Postgres only. Schema "repair" only.

BEGIN;

-- ── #5 AWAITING_DELETE (request to purge → then VOIDED, never hard-delete) ──
INSERT INTO repair.statuses
  (tenant_id, entity, code, display_name, sort_order, is_terminal, is_locking,
   owner_visible, sends_email, shop_draft_only, hidden, never_purge, created_by)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'ESTIMATE', 'AWAITING_DELETE', 'Awaiting Delete', 85, false, false,
  true, true, false, false, true, 'migration:lifecycle_05'
)
ON CONFLICT (tenant_id, entity, code) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      never_purge = true,
      owner_visible = true,
      sends_email = true;

DO $$
DECLARE
  t uuid := '00000000-0000-4000-8000-000000000001';
  s_await_del uuid; s_void uuid;
  s_queued uuid; s_await uuid; s_rev uuid; s_adj uuid;
BEGIN
  SELECT id INTO s_await_del FROM repair.statuses WHERE tenant_id=t AND entity='ESTIMATE' AND code='AWAITING_DELETE';
  SELECT id INTO s_void FROM repair.statuses WHERE tenant_id=t AND entity='ESTIMATE' AND code='VOIDED';
  SELECT id INTO s_queued FROM repair.statuses WHERE tenant_id=t AND entity='ESTIMATE' AND code='QUEUED';
  SELECT id INTO s_await FROM repair.statuses WHERE tenant_id=t AND entity='ESTIMATE' AND code='AWAITING_APPROVAL';
  SELECT id INTO s_rev FROM repair.statuses WHERE tenant_id=t AND entity='ESTIMATE' AND code='REVISION_REQUESTED';
  SELECT id INTO s_adj FROM repair.statuses WHERE tenant_id=t AND entity='ESTIMATE' AND code='ADJUSTMENT_FOR_APPROVAL';

  DELETE FROM repair.status_transitions
  WHERE tenant_id = t AND created_by = 'migration:lifecycle_05';

  INSERT INTO repair.status_transitions
    (tenant_id, entity, from_status_id, to_status_id, action_name, allowed_actors, requires, created_by)
  VALUES
    (t, 'ESTIMATE', s_queued, s_await_del, 'Request delete', '["shop_link","reviewer","admin"]', '[]', 'migration:lifecycle_05'),
    (t, 'ESTIMATE', s_await, s_await_del, 'Request delete', '["reviewer","admin","fleet_manager"]', '[]', 'migration:lifecycle_05'),
    (t, 'ESTIMATE', s_rev, s_await_del, 'Request delete', '["reviewer","admin"]', '[]', 'migration:lifecycle_05'),
    (t, 'ESTIMATE', s_adj, s_await_del, 'Request delete', '["reviewer","admin"]', '[]', 'migration:lifecycle_05'),
    (t, 'ESTIMATE', s_await_del, s_void, 'Void (approve delete)', '["admin","fleet_manager","reviewer"]', '[]', 'migration:lifecycle_05'),
    -- Shop may also request terminate
    (t, 'ESTIMATE', s_await, (SELECT id FROM repair.statuses WHERE tenant_id=t AND entity='ESTIMATE' AND code='AWAITING_TERMINATE'),
      'Terminate requested (shop)', '["shop_link","reviewer","admin"]', '[]', 'migration:lifecycle_05'),
    (t, 'ESTIMATE', (SELECT id FROM repair.statuses WHERE tenant_id=t AND entity='ESTIMATE' AND code='APPROVED'),
      (SELECT id FROM repair.statuses WHERE tenant_id=t AND entity='ESTIMATE' AND code='AWAITING_TERMINATE'),
      'Terminate requested (shop)', '["shop_link","reviewer","admin"]', '[]', 'migration:lifecycle_05');
END $$;

-- ── #6 BO required location/date fields ──
ALTER TABLE repair.bad_orders
  ADD COLUMN IF NOT EXISTS bo_date date NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE repair.bad_orders
  ADD COLUMN IF NOT EXISTS bo_city text;
ALTER TABLE repair.bad_orders
  ADD COLUMN IF NOT EXISTS bo_state text;
ALTER TABLE repair.bad_orders
  ADD COLUMN IF NOT EXISTS dest_city text;
ALTER TABLE repair.bad_orders
  ADD COLUMN IF NOT EXISTS dest_state text;

-- BO lifecycle status hints (Accepted-Pending / Working / Declined / Closed)
ALTER TABLE repair.bad_orders
  ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'QUEUED'
    CHECK (lifecycle_status IN (
      'QUEUED', 'ACCEPTED_PENDING', 'ACCEPTED_WORKING', 'CLOSED', 'DECLINED'
    ));

-- ── #8 Comment subject + issue; notify opt-in ──
ALTER TABLE repair.comments
  ADD COLUMN IF NOT EXISTS subject text;
ALTER TABLE repair.comments
  ADD COLUMN IF NOT EXISTS issue text;

-- ── #11 Tank cars only ──
ALTER TABLE repair.events
  ADD COLUMN IF NOT EXISTS is_tank_car boolean NOT NULL DEFAULT false;

-- ── #12 Attachment comment + allowlist seed ──
ALTER TABLE repair.documents
  ADD COLUMN IF NOT EXISTS category_comment text;

CREATE TABLE IF NOT EXISTS repair.attachment_allowed_types (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  extension       text NOT NULL,
  mime_hint       text,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  UNIQUE (tenant_id, extension)
);

INSERT INTO repair.attachment_allowed_types (tenant_id, extension, mime_hint, created_by)
SELECT '00000000-0000-4000-8000-000000000001', ext, mime, 'migration:lifecycle_05'
FROM (VALUES
  ('.500', 'text/plain'),
  ('.bmp', 'image/bmp'),
  ('.dat', 'application/octet-stream'),
  ('.doc', 'application/msword'),
  ('.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
  ('.edi', 'application/edi-x12'),
  ('.gif', 'image/gif'),
  ('.jpg', 'image/jpeg'),
  ('.jpeg', 'image/jpeg'),
  ('.pdf', 'application/pdf'),
  ('.txt', 'text/plain'),
  ('.xls', 'application/vnd.ms-excel'),
  ('.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
) AS t(ext, mime)
ON CONFLICT (tenant_id, extension) DO NOTHING;

-- ── #14 Dispo request tracking ──
ALTER TABLE repair.dispo
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'relay'
    CHECK (kind IN ('request', 'relay', 'lessee_request'));
ALTER TABLE repair.events
  ADD COLUMN IF NOT EXISTS dispo_requested_at timestamptz;

-- ── #15 Invoice cover sheet ──
ALTER TABLE repair.invoices
  ADD COLUMN IF NOT EXISTS cover_document_id uuid REFERENCES repair.documents(id);

-- ── #21 Bill summary Action column ──
ALTER TABLE repair.monthly_bill_exceptions
  ADD COLUMN IF NOT EXISTS action text;
ALTER TABLE repair.monthly_bill_summaries
  ADD COLUMN IF NOT EXISTS billing_road text;

COMMENT ON TABLE repair.attachment_allowed_types IS
  'Manual_Gap #12 allowed attachment extensions (RS p.22–23).';

COMMIT;
