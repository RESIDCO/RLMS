-- 20261014_repair_statuses_bo.sql
--
-- Status seed polish: VOIDED, Queued shop-only flags, yard arrival gate,
-- bad-order acknowledge / decline+reason / arrival date, bulk BO support.
-- Local Postgres only. Schema "repair" only.

BEGIN;

-- Status visibility / behavior flags (editable defaults; data-driven)
ALTER TABLE repair.statuses
  ADD COLUMN IF NOT EXISTS owner_visible boolean NOT NULL DEFAULT true;
ALTER TABLE repair.statuses
  ADD COLUMN IF NOT EXISTS sends_email boolean NOT NULL DEFAULT true;
ALTER TABLE repair.statuses
  ADD COLUMN IF NOT EXISTS shop_draft_only boolean NOT NULL DEFAULT false;
ALTER TABLE repair.statuses
  ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;
ALTER TABLE repair.statuses
  ADD COLUMN IF NOT EXISTS never_purge boolean NOT NULL DEFAULT false;

-- Queued: shop-only draft — owner can't see, no emails
UPDATE repair.statuses
SET owner_visible = false,
    sends_email = false,
    shop_draft_only = true,
    display_name = 'Queued'
WHERE entity = 'ESTIMATE' AND code = 'QUEUED';

-- Ensure display names match Bruce list
UPDATE repair.statuses SET display_name = 'Awaiting Approval'
WHERE entity = 'ESTIMATE' AND code = 'AWAITING_APPROVAL';
UPDATE repair.statuses SET display_name = 'Revision Requested'
WHERE entity = 'ESTIMATE' AND code = 'REVISION_REQUESTED';
UPDATE repair.statuses SET display_name = 'Adjustment for Approval'
WHERE entity = 'ESTIMATE' AND code = 'ADJUSTMENT_FOR_APPROVAL';
UPDATE repair.statuses SET display_name = 'Approved'
WHERE entity = 'ESTIMATE' AND code = 'APPROVED';
UPDATE repair.statuses SET display_name = 'Completed'
WHERE entity = 'ESTIMATE' AND code = 'COMPLETED';
UPDATE repair.statuses SET display_name = 'Awaiting Terminate'
WHERE entity = 'ESTIMATE' AND code = 'AWAITING_TERMINATE';
UPDATE repair.statuses SET display_name = 'Terminated'
WHERE entity = 'ESTIMATE' AND code = 'TERMINATED';

-- VOIDED (was "Awaiting Delete" → Void): hidden, never purged, audited
INSERT INTO repair.statuses
  (tenant_id, entity, code, display_name, sort_order, is_terminal, is_locking,
   owner_visible, sends_email, shop_draft_only, hidden, never_purge, created_by)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'ESTIMATE', 'VOIDED', 'Voided', 90, true, false,
  false, false, false, true, true, 'migration:20261014_statuses_bo'
)
ON CONFLICT (tenant_id, entity, code) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      is_terminal = true,
      hidden = true,
      never_purge = true,
      owner_visible = false,
      sends_email = false;

-- Also EVENT-level VOIDED for voided BOs/events
INSERT INTO repair.statuses
  (tenant_id, entity, code, display_name, sort_order, is_terminal, is_locking,
   owner_visible, sends_email, shop_draft_only, hidden, never_purge, created_by)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'EVENT', 'VOIDED', 'Voided', 90, true, false,
  false, false, false, true, true, 'migration:20261014_statuses_bo'
)
ON CONFLICT (tenant_id, entity, code) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      is_terminal = true,
      hidden = true,
      never_purge = true,
      owner_visible = false,
      sends_email = false;

-- Transitions into VOIDED from common pre-approve states (Awaiting Delete → Void)
DO $$
DECLARE
  t uuid := '00000000-0000-4000-8000-000000000001';
  s_void uuid;
  s_queued uuid; s_await uuid; s_rev uuid; s_adj uuid; s_await_term uuid;
  s_approved uuid; s_completed uuid;
BEGIN
  SELECT id INTO s_void FROM repair.statuses WHERE tenant_id=t AND entity='ESTIMATE' AND code='VOIDED';
  SELECT id INTO s_queued FROM repair.statuses WHERE tenant_id=t AND entity='ESTIMATE' AND code='QUEUED';
  SELECT id INTO s_await FROM repair.statuses WHERE tenant_id=t AND entity='ESTIMATE' AND code='AWAITING_APPROVAL';
  SELECT id INTO s_rev FROM repair.statuses WHERE tenant_id=t AND entity='ESTIMATE' AND code='REVISION_REQUESTED';
  SELECT id INTO s_adj FROM repair.statuses WHERE tenant_id=t AND entity='ESTIMATE' AND code='ADJUSTMENT_FOR_APPROVAL';
  SELECT id INTO s_await_term FROM repair.statuses WHERE tenant_id=t AND entity='ESTIMATE' AND code='AWAITING_TERMINATE';
  SELECT id INTO s_approved FROM repair.statuses WHERE tenant_id=t AND entity='ESTIMATE' AND code='APPROVED';
  SELECT id INTO s_completed FROM repair.statuses WHERE tenant_id=t AND entity='ESTIMATE' AND code='COMPLETED';

  -- Idempotent: delete prior seed rows for this migration tag
  DELETE FROM repair.status_transitions
  WHERE tenant_id = t AND created_by = 'migration:20261014_statuses_bo';

  INSERT INTO repair.status_transitions
    (tenant_id, entity, from_status_id, to_status_id, action_name, allowed_actors, requires, created_by)
  VALUES
    (t, 'ESTIMATE', s_queued, s_void, 'Void', '["admin","fleet_manager","reviewer"]', '[]', 'migration:20261014_statuses_bo'),
    (t, 'ESTIMATE', s_await, s_void, 'Void', '["admin","fleet_manager","reviewer"]', '[]', 'migration:20261014_statuses_bo'),
    (t, 'ESTIMATE', s_rev, s_void, 'Void', '["admin","fleet_manager","reviewer"]', '[]', 'migration:20261014_statuses_bo'),
    (t, 'ESTIMATE', s_adj, s_void, 'Void', '["admin","fleet_manager","reviewer"]', '[]', 'migration:20261014_statuses_bo'),
    (t, 'ESTIMATE', s_await_term, s_void, 'Void', '["admin","fleet_manager"]', '[]', 'migration:20261014_statuses_bo'),
    -- Re-upload after approval / completed → Adjustment for Approval (shop re-upload only)
    (t, 'ESTIMATE', s_approved, s_adj, 'Adjustment (re-upload)', '["shop_link","system","reviewer"]', '[]', 'migration:20261014_statuses_bo'),
    (t, 'ESTIMATE', s_completed, s_adj, 'Adjustment (re-upload)', '["shop_link","system","reviewer","admin"]', '[]', 'migration:20261014_statuses_bo'),
    (t, 'ESTIMATE', s_adj, s_adj, 'Adjustment (re-upload)', '["shop_link","system"]', '[]', 'migration:20261014_statuses_bo');
END $$;

-- Yard arrival required to leave Queued
ALTER TABLE repair.events
  ADD COLUMN IF NOT EXISTS yard_arrived_at timestamptz;
ALTER TABLE repair.events
  ADD COLUMN IF NOT EXISTS yard_arrived_by text;
ALTER TABLE repair.events
  ADD COLUMN IF NOT EXISTS decline_reason text;
ALTER TABLE repair.events
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz;
ALTER TABLE repair.events
  ADD COLUMN IF NOT EXISTS acknowledged_by text;
ALTER TABLE repair.events
  ADD COLUMN IF NOT EXISTS declined_at timestamptz;
ALTER TABLE repair.events
  ADD COLUMN IF NOT EXISTS declined_by text;

-- Phase 2 design hooks only (no carMARQS/CROP build)
ALTER TABLE repair.tenants
  ADD COLUMN IF NOT EXISTS phase2_hooks jsonb NOT NULL DEFAULT jsonb_build_object(
    'carMarqs', jsonb_build_object('enabled', false, 'note', 'Phase 2 — design hook only'),
    'crop', jsonb_build_object('enabled', false, 'note', 'Phase 2 — design hook only')
  );

COMMENT ON COLUMN repair.tenants.phase2_hooks IS
  'Phase 2 design hooks only — do not build carMARQS/CROP in Phase 1.';

COMMIT;
