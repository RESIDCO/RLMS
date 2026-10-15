-- 20261014_repair_ready_to_close.sql
--
-- Bruce decisions (Q3 / Q12 / Q13):
--   • Invoice OTP: off by default; configurable PER SHOP
--     (invoice_submit; optional completed_date via shop link)
--   • No auto-close: MATCHED invoice + dispo → READY_TO_CLOSE + notify
--     reviewer; reviewer closes with one click (audited)
--   • POD recipients (defaults; still editable via notification_rules):
--       POD_DUE → shop only (+ event link in body)
--       POD_MISSED → shop + internal reviewers/fleet managers
--       POD_REVISED → internal only
--
-- APPLY ONLY to local Postgres via: npm run repair:migrate:local
-- Path: modules/repair/migrations/ (not host migrations/).
-- Creates/alters objects in schema "repair" only — never public/auth.

BEGIN;

-- Per-shop settings (otpSteps etc.). Default empty → OTP off.
ALTER TABLE repair.shops
  ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE repair.shops
SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object(
  'otpSteps', jsonb_build_object(
    'invoice_submit', false,
    'completed_date', false
  )
)
WHERE settings->'otpSteps' IS NULL;

-- Keep tenant-level otpSteps as legacy default-off (shops are source of truth now)
UPDATE repair.tenants
SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object(
  'otpSteps', jsonb_build_object(
    'invoice_submit', false,
    'completed_date', false
  ),
  'podDueDays', COALESCE((settings->>'podDueDays')::int, 5)
)
WHERE id = '00000000-0000-4000-8000-000000000001';

-- Status: Ready to Close (between Complete and Closed)
DO $$
DECLARE
  t uuid := '00000000-0000-4000-8000-000000000001';
  e_complete uuid;
  e_ready uuid;
  e_closed uuid;
  e_inrepair uuid;
BEGIN
  SELECT id INTO e_complete FROM repair.statuses
   WHERE tenant_id = t AND entity = 'EVENT' AND code = 'COMPLETE';
  SELECT id INTO e_closed FROM repair.statuses
   WHERE tenant_id = t AND entity = 'EVENT' AND code = 'CLOSED';
  SELECT id INTO e_inrepair FROM repair.statuses
   WHERE tenant_id = t AND entity = 'EVENT' AND code = 'IN_REPAIR';

  -- Upsert READY_TO_CLOSE
  INSERT INTO repair.statuses
    (tenant_id, entity, code, display_name, sort_order, is_terminal, is_locking, created_by)
  VALUES
    (t, 'EVENT', 'READY_TO_CLOSE', 'Ready to Close', 65, false, true, 'migration:20261014_rtc')
  ON CONFLICT (tenant_id, entity, code) DO UPDATE
    SET display_name = EXCLUDED.display_name,
        sort_order = EXCLUDED.sort_order,
        is_terminal = EXCLUDED.is_terminal,
        is_locking = EXCLUDED.is_locking
  RETURNING id INTO e_ready;

  IF e_ready IS NULL THEN
    SELECT id INTO e_ready FROM repair.statuses
     WHERE tenant_id = t AND entity = 'EVENT' AND code = 'READY_TO_CLOSE';
  END IF;

  -- Remove prior auto-close transition (Complete → Closed on invoice_match)
  DELETE FROM repair.status_transitions
   WHERE tenant_id = t
     AND entity = 'EVENT'
     AND from_status_id = e_complete
     AND to_status_id = e_closed
     AND created_by IN ('migration:20261013', 'migration:20261014_rtc');

  -- Clear prior RTC transitions for idempotent re-run
  DELETE FROM repair.status_transitions
   WHERE tenant_id = t AND created_by = 'migration:20261014_rtc';

  INSERT INTO repair.status_transitions
    (tenant_id, entity, from_status_id, to_status_id, action_name, allowed_actors, requires, created_by)
  VALUES
    -- MATCHED invoice + dispo entered → Ready to Close (system or reviewer)
    (t, 'EVENT', e_complete, e_ready,
     'Invoice matched AND dispo entered',
     '["system","reviewer","admin","fleet_manager"]',
     '["invoice_match","dispo"]',
     'migration:20261014_rtc'),
    -- Also allow from IN_REPAIR if complete was skipped somehow but both conditions met
    (t, 'EVENT', e_inrepair, e_ready,
     'Invoice matched AND dispo entered',
     '["system","reviewer","admin","fleet_manager"]',
     '["invoice_match","dispo"]',
     'migration:20261014_rtc'),
    -- Reviewer one-click close (audited)
    (t, 'EVENT', e_ready, e_closed,
     'Close event',
     '["reviewer","admin","fleet_manager","mech_manager"]',
     '[]',
     'migration:20261014_rtc');
END $$;

-- POD recipient defaults (Q13) + Ready-to-Close / Closed notify
INSERT INTO repair.notification_rules
  (tenant_id, notification_type, include_roles, exclude_roles, template_subject, template_body, created_by)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'POD_DUE',
   '["shop_contact"]', '[]',
   'POD coming due — {Equipment}',
   'Promised outbound date is due soon for {Equipment}. Open your shop event link to enter or revise POD/ERD: {EventLink}',
   'migration:20261014_rtc'),
  ('00000000-0000-4000-8000-000000000001', 'POD_MISSED',
   '["shop_contact","reviewers"]', '[]',
   'POD missed — {Equipment}',
   'Promised outbound date was missed for {Equipment}. Shop and internal reviewers have been notified.',
   'migration:20261014_rtc'),
  ('00000000-0000-4000-8000-000000000001', 'POD_REVISED',
   '["reviewers"]', '["shop","shop_contact"]',
   'POD/ERD revised — {Equipment}',
   'POD/ERD was revised for {Equipment} (internal notice).',
   'migration:20261014_rtc'),
  ('00000000-0000-4000-8000-000000000001', 'READY_TO_CLOSE',
   '["reviewers"]', '[]',
   'Ready to close — {Equipment}',
   'Invoice matches the approved final estimate and dispo is on file for {Equipment}. Review and close with one click.',
   'migration:20261014_rtc'),
  ('00000000-0000-4000-8000-000000000001', 'EVENT_CLOSED',
   '["reviewers","owner_users","ad_hoc"]', '[]',
   'Event closed — {Equipment}',
   'Repair event for {Equipment} was closed.',
   'migration:20261014_rtc')
ON CONFLICT (tenant_id, notification_type) DO UPDATE
  SET include_roles = EXCLUDED.include_roles,
      exclude_roles = EXCLUDED.exclude_roles,
      template_subject = EXCLUDED.template_subject,
      template_body = EXCLUDED.template_body,
      active = true,
      deleted_at = NULL;

COMMIT;
