-- 20261014_repair_estimate_lifecycle_06.sql
--
-- MG1–MG4 (Bruce decisions 2026-10-14):
--   MG1 Internal-only correction editor (shops remain re-upload only)
--   MG2 Retention: VOIDED/attachments/comments never hard-deleted; admin restore
--   MG3 Tank car doc gate OFF for RESIDCO; per-tenant (+ optional per car type)
--   MG4 CROP/carMARQS Phase 2 hooks only (no import build)
-- Local Postgres only. Schema "repair" only.

BEGIN;

-- ── MG1: revision header snapshot + correction reason (append-only revisions) ──
ALTER TABLE repair.estimate_revisions
  ADD COLUMN IF NOT EXISTS header jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE repair.estimate_revisions
  ADD COLUMN IF NOT EXISTS correction_reason text;
ALTER TABLE repair.estimate_revisions
  ADD COLUMN IF NOT EXISTS is_internal_correction boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN repair.estimate_revisions.header IS
  'BRC/header snapshot for this revision (shop mark, location, dates, etc.).';
COMMENT ON COLUMN repair.estimate_revisions.correction_reason IS
  'Required when is_internal_correction; who/when already on actor_* / action_at.';
COMMENT ON COLUMN repair.estimate_revisions.is_internal_correction IS
  'True when created by internal correction editor (never by shop link).';

-- Current header convenience on estimate (mutable mirror of latest revision header)
ALTER TABLE repair.estimates
  ADD COLUMN IF NOT EXISTS current_header jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ── MG2: restore transitions VOIDED → editable statuses (admin only) ──
DO $$
DECLARE
  t uuid := '00000000-0000-4000-8000-000000000001';
  s_void uuid;
  s_queued uuid; s_await uuid; s_rev uuid; s_adj uuid;
BEGIN
  SELECT id INTO s_void FROM repair.statuses WHERE tenant_id=t AND entity='ESTIMATE' AND code='VOIDED';
  SELECT id INTO s_queued FROM repair.statuses WHERE tenant_id=t AND entity='ESTIMATE' AND code='QUEUED';
  SELECT id INTO s_await FROM repair.statuses WHERE tenant_id=t AND entity='ESTIMATE' AND code='AWAITING_APPROVAL';
  SELECT id INTO s_rev FROM repair.statuses WHERE tenant_id=t AND entity='ESTIMATE' AND code='REVISION_REQUESTED';
  SELECT id INTO s_adj FROM repair.statuses WHERE tenant_id=t AND entity='ESTIMATE' AND code='ADJUSTMENT_FOR_APPROVAL';

  DELETE FROM repair.status_transitions
  WHERE tenant_id = t AND created_by = 'migration:lifecycle_06';

  INSERT INTO repair.status_transitions
    (tenant_id, entity, from_status_id, to_status_id, action_name, allowed_actors, requires, created_by)
  VALUES
    (t, 'ESTIMATE', s_void, s_queued, 'Restore from Voided', '["admin"]', '[]', 'migration:lifecycle_06'),
    (t, 'ESTIMATE', s_void, s_await, 'Restore from Voided', '["admin"]', '[]', 'migration:lifecycle_06'),
    (t, 'ESTIMATE', s_void, s_rev, 'Restore from Voided', '["admin"]', '[]', 'migration:lifecycle_06'),
    (t, 'ESTIMATE', s_void, s_adj, 'Restore from Voided', '["admin"]', '[]', 'migration:lifecycle_06');

  -- Internal correction / Adjustment path: allow admin on Approved→Adjustment
  UPDATE repair.status_transitions
  SET allowed_actors = '["shop_link","system","reviewer","admin"]'::jsonb
  WHERE tenant_id = t
    AND entity = 'ESTIMATE'
    AND from_status_id IN (
      SELECT id FROM repair.statuses WHERE tenant_id=t AND entity='ESTIMATE'
        AND code IN ('APPROVED', 'COMPLETED')
    )
    AND to_status_id = s_adj;
END $$;

-- Soft-delete already exists on documents/comments/estimates (deleted_at).
-- Ensure never_purge flag stays true on VOIDED.
UPDATE repair.statuses
SET never_purge = true, hidden = true, owner_visible = false
WHERE entity = 'ESTIMATE' AND code = 'VOIDED';

-- ── MG3: tank gate OFF for RESIDCO; optional per-car-type map ──
UPDATE repair.tenants
SET settings = COALESCE(settings, '{}'::jsonb)
  || jsonb_build_object(
       'tankCarDocGateEnabled', false,
       'tankCarDocGateByCarType', COALESCE(settings->'tankCarDocGateByCarType', '{}'::jsonb)
     )
WHERE id = '00000000-0000-4000-8000-000000000001';

COMMENT ON COLUMN repair.tenants.settings IS
  'Tenant settings. tankCarDocGateEnabled (bool); tankCarDocGateByCarType (jsonb map of car_type→bool). RESIDCO default OFF.';

-- Optional car_type on events for future per-type gate
ALTER TABLE repair.events
  ADD COLUMN IF NOT EXISTS car_type text;

-- ── MG4: Phase 2 hooks — CROP/carMARQS history import (not built) ──
UPDATE repair.tenants
SET phase2_hooks = jsonb_build_object(
  'carMarqs', jsonb_build_object(
    'enabled', false,
    'phase', 2,
    'note', 'Phase 2 — closed-repair history repository (carMARQS-style)'
  ),
  'crop', jsonb_build_object(
    'enabled', false,
    'phase', 2,
    'note', 'Phase 2 — Railinc CROP/AAR bill import into carMARQS history'
  ),
  'cropImport', jsonb_build_object(
    'enabled', false,
    'phase', 2,
    'endpointStub', '/api/repair/phase2/crop-import',
    'note', 'Phase 1 hook only — POST returns 501'
  )
)
WHERE id = '00000000-0000-4000-8000-000000000001';

-- Seed notification rule: shop notified of internal corrections
INSERT INTO repair.notification_rules
  (tenant_id, notification_type, include_roles, exclude_roles, active, created_by)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'ESTIMATE_INTERNAL_CORRECTION',
  '["shop_contact"]'::jsonb,
  '[]'::jsonb,
  true,
  'migration:lifecycle_06'
)
ON CONFLICT (tenant_id, notification_type) DO NOTHING;

COMMIT;
