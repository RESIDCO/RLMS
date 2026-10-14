-- 20261014_repair_railroads.sql
-- OWNER_UI §B round 3 parts 1+2: operating railroads reference (NARN/BTS)
-- for delivering lines — separate from billing_roads (billing validation only).
-- APPLY ONLY to local Postgres. Schema "repair" only. No hard deletes.

BEGIN;

CREATE TABLE IF NOT EXISTS repair.railroads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  mark            text NOT NULL,
  name            text,
  railroad_class  text NOT NULL DEFAULT 'short_line'
                  CHECK (railroad_class IN ('I', 'regional', 'short_line', 'other')),
  source          text NOT NULL DEFAULT 'narn_bts',
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  deleted_at      timestamptz,
  deleted_by      text,
  delete_reason   text,
  UNIQUE (tenant_id, mark)
);

COMMENT ON TABLE repair.railroads IS
  'Operating railroad marks (Class I / regional / short line) for delivering-line '
  'type-ahead. Seeded from public-domain USDOT/BTS NARN owner/trackage-rights marks. '
  'NOT the billing-road validation table.';

CREATE INDEX IF NOT EXISTS railroads_tenant_active_mark_idx
  ON repair.railroads (tenant_id, mark)
  WHERE deleted_at IS NULL AND active = true;

CREATE INDEX IF NOT EXISTS railroads_tenant_name_idx
  ON repair.railroads (tenant_id, name)
  WHERE deleted_at IS NULL AND active = true AND name IS NOT NULL;

-- Delivering-line membership: flag manual / needs-review entries
ALTER TABLE repair.shop_delivering_lines
  ADD COLUMN IF NOT EXISTS manual_entry boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS display_name text;

COMMENT ON TABLE repair.shop_delivering_lines IS
  'Serving / delivering railroad marks for a shop. Validated vs repair.railroads '
  'when known; unknown marks allowed as manual_entry + needs_review.';

COMMENT ON COLUMN repair.shop_delivering_lines.manual_entry IS
  'True when mark was keyed manually (not picked from railroads type-ahead).';
COMMENT ON COLUMN repair.shop_delivering_lines.needs_review IS
  'True when mark is not in repair.railroads (or was flagged for review).';

COMMIT;
