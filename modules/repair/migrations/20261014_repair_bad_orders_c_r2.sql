-- 20261014_repair_bad_orders_c_r2.sql
--
-- OWNER_UI §C Bad Orders round 2:
--   bo_rules short_name + optional rule-based flag;
--   document comment; BO attachment categories (SDS / Scope / Photograph / Other).
-- Local Postgres only. Schema "repair" only. No hard deletes.

BEGIN;

-- ── Bad Order Reasons: Short name (optional) + rule-based flag ───────
ALTER TABLE repair.bo_rules
  ADD COLUMN IF NOT EXISTS short_name text,
  ADD COLUMN IF NOT EXISTS is_rule_based boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN repair.bo_rules.short_name IS
  'Optional short name for Bad Order Reason (UX). Code remains stable internal key.';
COMMENT ON COLUMN repair.bo_rules.is_rule_based IS
  'When true, event_rule (Rule 1 / Rule 107 / Other) drives track behavior; otherwise RULE_1 default.';

-- Expand event_rule to allow OTHER (optional rule-based pick)
ALTER TABLE repair.bo_rules DROP CONSTRAINT IF EXISTS bo_rules_event_rule_check;
ALTER TABLE repair.bo_rules
  ADD CONSTRAINT bo_rules_event_rule_check
  CHECK (event_rule IN ('RULE_1', 'RULE_107', 'OTHER'));

UPDATE repair.bo_rules
SET is_rule_based = true,
    short_name = COALESCE(NULLIF(short_name, ''), code)
WHERE code IN ('RULE_1', 'RULE_107', 'OTHER')
  AND deleted_at IS NULL;

COMMENT ON TABLE repair.bo_rules IS
  'Owner-managed Bad Order Reasons: name (description) + optional short name + active + sort order. Optional rule-based flag with Rule 1 / Rule 107 / Other. Do not invent unmarked AAR shopping-reason lists.';

-- ── Document comment (per attachment on BO) ──────────────────────────
ALTER TABLE repair.documents
  ADD COLUMN IF NOT EXISTS comment text;

COMMENT ON COLUMN repair.documents.comment IS
  'Optional comment entered with Documents & Photos on Bad Order (and other uploads).';

-- ── BO attachment categories ─────────────────────────────────────────
INSERT INTO repair.attachment_categories (tenant_id, code, display_name, sort_order, created_by)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'sds', 'SDS', 50, 'migration:20261014_bad_orders_c_r2'),
  ('00000000-0000-4000-8000-000000000001', 'scope_of_work', 'Scope of Work', 55, 'migration:20261014_bad_orders_c_r2'),
  ('00000000-0000-4000-8000-000000000001', 'photograph', 'Photograph', 25, 'migration:20261014_bad_orders_c_r2'),
  ('00000000-0000-4000-8000-000000000001', 'photo', 'Photograph', 20, 'migration:20261014_bad_orders_c_r2'),
  ('00000000-0000-4000-8000-000000000001', 'other', 'Other', 90, 'migration:20261014_bad_orders_c_r2')
ON CONFLICT (tenant_id, code) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  active = true,
  deleted_at = NULL;

COMMIT;
