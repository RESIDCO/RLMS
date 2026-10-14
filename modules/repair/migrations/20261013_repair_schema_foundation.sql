-- 20261013_repair_schema_foundation.sql
--
-- RLMS Repair Module — Phase 1 first slice (schema foundation).
-- APPLY ONLY to local Postgres via: npm run repair:migrate:local
-- Path: modules/repair/migrations/ (not host migrations/).
-- Do NOT apply to production Supabase (rlms-residco). No Supabase branches.
--
-- Safety:
--   - Creates schema "repair" only; does not ALTER public tables/views/auth.
--   - cars_ref is a VIEW over public (read-only SELECT; no public DDL).
--   - Append-only tables reject UPDATE/DELETE via triggers.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS repair;

-- ── Tenants ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS repair.tenants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  slug          text NOT NULL UNIQUE,
  settings      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text,
  deleted_at    timestamptz,
  deleted_by    text,
  delete_reason text
);

-- ── Module users / roles (link to Supabase auth; separate from public.user_roles) ──
CREATE TABLE IF NOT EXISTS repair.users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES repair.tenants(id),
  auth_user_id  uuid,
  email         text NOT NULL,
  display_name  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text,
  deleted_at    timestamptz,
  deleted_by    text,
  delete_reason text,
  UNIQUE (tenant_id, email)
);

CREATE TABLE IF NOT EXISTS repair.user_roles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES repair.tenants(id),
  user_id       uuid NOT NULL REFERENCES repair.users(id),
  role          text NOT NULL CHECK (role IN (
                  'admin', 'car_owner', 'mech_manager', 'reviewer', 'fleet_manager'
                )),
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text,
  deleted_at    timestamptz,
  deleted_by    text,
  delete_reason text,
  UNIQUE (tenant_id, user_id, role)
);

-- ── Data-driven statuses ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS repair.statuses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES repair.tenants(id),
  entity        text NOT NULL CHECK (entity IN ('EVENT', 'ESTIMATE')),
  code          text NOT NULL,
  display_name  text NOT NULL,
  sort_order    int NOT NULL DEFAULT 0,
  is_terminal   boolean NOT NULL DEFAULT false,
  is_locking    boolean NOT NULL DEFAULT false,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text,
  deleted_at    timestamptz,
  deleted_by    text,
  delete_reason text,
  UNIQUE (tenant_id, entity, code)
);

CREATE TABLE IF NOT EXISTS repair.status_transitions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES repair.tenants(id),
  entity           text NOT NULL CHECK (entity IN ('EVENT', 'ESTIMATE')),
  from_status_id   uuid NOT NULL REFERENCES repair.statuses(id),
  to_status_id     uuid NOT NULL REFERENCES repair.statuses(id),
  action_name      text NOT NULL,
  allowed_actors   jsonb NOT NULL DEFAULT '[]'::jsonb,
  requires         jsonb NOT NULL DEFAULT '[]'::jsonb,
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       text,
  deleted_at       timestamptz,
  deleted_by       text,
  delete_reason    text
);

CREATE INDEX IF NOT EXISTS status_transitions_tenant_entity_idx
  ON repair.status_transitions (tenant_id, entity)
  WHERE deleted_at IS NULL AND active;

-- ── Audit (append-only) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS repair.audit_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES repair.tenants(id),
  entity        text NOT NULL,
  entity_id     uuid,
  action        text NOT NULL,
  before_json   jsonb,
  after_json    jsonb,
  actor         text,
  via           text,
  ip            text,
  at            timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text
);

CREATE OR REPLACE FUNCTION repair.reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'repair.% is append-only: % not allowed', TG_TABLE_NAME, TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS audit_events_no_update ON repair.audit_events;
CREATE TRIGGER audit_events_no_update
  BEFORE UPDATE ON repair.audit_events
  FOR EACH ROW EXECUTE FUNCTION repair.reject_mutation();

DROP TRIGGER IF EXISTS audit_events_no_delete ON repair.audit_events;
CREATE TRIGGER audit_events_no_delete
  BEFORE DELETE ON repair.audit_events
  FOR EACH ROW EXECUTE FUNCTION repair.reject_mutation();

-- ── Seed RESIDCO tenant + starting status configuration ───────────────
INSERT INTO repair.tenants (id, name, slug, settings, created_by)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'RESIDCO',
  'residco',
  jsonb_build_object(
    'reminder_pod_days', 5,
    'branding', jsonb_build_object()
  ),
  'migration:20261013'
)
ON CONFLICT (slug) DO NOTHING;

-- Helper: upsert status by code
CREATE OR REPLACE FUNCTION repair._seed_status(
  p_tenant uuid, p_entity text, p_code text, p_name text,
  p_sort int, p_terminal boolean, p_locking boolean
) RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  sid uuid;
BEGIN
  INSERT INTO repair.statuses (tenant_id, entity, code, display_name, sort_order, is_terminal, is_locking, created_by)
  VALUES (p_tenant, p_entity, p_code, p_name, p_sort, p_terminal, p_locking, 'migration:20261013')
  ON CONFLICT (tenant_id, entity, code) DO UPDATE
    SET display_name = EXCLUDED.display_name,
        sort_order = EXCLUDED.sort_order,
        is_terminal = EXCLUDED.is_terminal,
        is_locking = EXCLUDED.is_locking
  RETURNING id INTO sid;
  RETURN sid;
END;
$$;

DO $$
DECLARE
  t uuid := '00000000-0000-4000-8000-000000000001';
  -- estimate
  s_queued uuid; s_await_appr uuid; s_rev_req uuid; s_approved uuid;
  s_adj uuid; s_completed uuid; s_await_term uuid; s_terminated uuid;
  -- event
  e_bo uuid; e_shop uuid; e_accepted uuid; e_onhand uuid;
  e_inrepair uuid; e_complete uuid; e_closed uuid;
BEGIN
  s_queued      := repair._seed_status(t, 'ESTIMATE', 'QUEUED', 'Queued', 10, false, false);
  s_await_appr  := repair._seed_status(t, 'ESTIMATE', 'AWAITING_APPROVAL', 'Awaiting Approval', 20, false, false);
  s_rev_req     := repair._seed_status(t, 'ESTIMATE', 'REVISION_REQUESTED', 'Revision Requested', 30, false, false);
  s_approved    := repair._seed_status(t, 'ESTIMATE', 'APPROVED', 'Approved', 40, false, false);
  s_adj         := repair._seed_status(t, 'ESTIMATE', 'ADJUSTMENT_FOR_APPROVAL', 'Adjustment For Approval', 50, false, false);
  s_completed   := repair._seed_status(t, 'ESTIMATE', 'COMPLETED', 'Completed', 60, true, true);
  s_await_term  := repair._seed_status(t, 'ESTIMATE', 'AWAITING_TERMINATE', 'Awaiting Terminate', 70, false, false);
  s_terminated  := repair._seed_status(t, 'ESTIMATE', 'TERMINATED', 'Terminated', 80, true, false);

  e_bo       := repair._seed_status(t, 'EVENT', 'BO_CREATED', 'BO Created', 10, false, false);
  e_shop     := repair._seed_status(t, 'EVENT', 'SHOP_ASSIGNED', 'Shop Assigned', 20, false, false);
  e_accepted := repair._seed_status(t, 'EVENT', 'ACCEPTED', 'Accepted', 30, false, false);
  e_onhand   := repair._seed_status(t, 'EVENT', 'ON_HAND', 'On Hand', 40, false, false);
  e_inrepair := repair._seed_status(t, 'EVENT', 'IN_REPAIR', 'In Repair', 50, false, false);
  e_complete := repair._seed_status(t, 'EVENT', 'COMPLETE', 'Complete', 60, false, true);
  e_closed   := repair._seed_status(t, 'EVENT', 'CLOSED', 'Closed', 70, true, false);

  -- Clear prior seed transitions for idempotent re-run of this block
  DELETE FROM repair.status_transitions
  WHERE tenant_id = t AND created_by = 'migration:20261013';

  INSERT INTO repair.status_transitions
    (tenant_id, entity, from_status_id, to_status_id, action_name, allowed_actors, requires, created_by)
  VALUES
    -- Estimate starting configuration (brief §8)
    (t, 'ESTIMATE', s_queued, s_await_appr, 'Submit for Approval', '["reviewer","mech_manager","admin","system"]', '[]', 'migration:20261013'),
    (t, 'ESTIMATE', s_await_appr, s_rev_req, 'Reject / Request revision', '["reviewer","mech_manager","admin"]', '[]', 'migration:20261013'),
    (t, 'ESTIMATE', s_rev_req, s_await_appr, 'Revised estimate uploaded', '["shop_link","system"]', '[]', 'migration:20261013'),
    (t, 'ESTIMATE', s_await_appr, s_approved, 'Approve', '["reviewer","mech_manager","admin"]', '["vcf"]', 'migration:20261013'),
    (t, 'ESTIMATE', s_approved, s_adj, 'Adjustment', '["reviewer","mech_manager","admin","shop_link"]', '[]', 'migration:20261013'),
    (t, 'ESTIMATE', s_adj, s_approved, 'Approve adjustment', '["reviewer","mech_manager","admin"]', '[]', 'migration:20261013'),
    (t, 'ESTIMATE', s_adj, s_rev_req, 'Reject adjustment', '["reviewer","mech_manager","admin"]', '[]', 'migration:20261013'),
    (t, 'ESTIMATE', s_approved, s_completed, 'Outbound / completed date entered', '["reviewer","mech_manager","admin","shop_link"]', '[]', 'migration:20261013'),
    (t, 'ESTIMATE', s_completed, s_approved, 'Rollback', '["reviewer","admin","fleet_manager"]', '[]', 'migration:20261013'),
    (t, 'ESTIMATE', s_queued, s_await_term, 'Terminate requested', '["reviewer","mech_manager","admin"]', '[]', 'migration:20261013'),
    (t, 'ESTIMATE', s_await_appr, s_await_term, 'Terminate requested', '["reviewer","mech_manager","admin"]', '[]', 'migration:20261013'),
    (t, 'ESTIMATE', s_approved, s_await_term, 'Terminate requested', '["reviewer","mech_manager","admin"]', '[]', 'migration:20261013'),
    (t, 'ESTIMATE', s_await_term, s_terminated, 'Terminate', '["admin","fleet_manager"]', '[]', 'migration:20261013'),
    -- Event starting configuration
    (t, 'EVENT', e_bo, e_shop, 'Shop assigned', '["admin","mech_manager","car_owner"]', '["vcf"]', 'migration:20261013'),
    (t, 'EVENT', e_shop, e_accepted, 'Shop accepts', '["shop_link"]', '[]', 'migration:20261013'),
    (t, 'EVENT', e_shop, e_shop, 'Shop rejects -> reassign', '["shop_link","admin","mech_manager"]', '[]', 'migration:20261013'),
    (t, 'EVENT', e_accepted, e_onhand, 'Arrived / on hand', '["shop_link","system"]', '[]', 'migration:20261013'),
    (t, 'EVENT', e_onhand, e_inrepair, 'Estimate approved, POD/ERD entered', '["system","reviewer"]', '["pod"]', 'migration:20261013'),
    (t, 'EVENT', e_inrepair, e_complete, 'Completed date', '["shop_link","reviewer","admin"]', '[]', 'migration:20261013'),
    (t, 'EVENT', e_complete, e_inrepair, 'Rollback', '["reviewer","admin","fleet_manager"]', '[]', 'migration:20261013'),
    (t, 'EVENT', e_complete, e_closed, 'Dispo relayed AND invoice matched', '["system","admin"]', '["invoice_match"]', 'migration:20261013');
END $$;

DROP FUNCTION IF EXISTS repair._seed_status(uuid, text, text, text, int, boolean, boolean);

-- ── cars_ref: read-only view (no FK into public) ──────────────────────
-- Current-row summary for VCF / assignment context.
-- VCF membership: appears in v_valid_export_rows with active = 1.
-- Exact active/inactive sync rule is open item Q1 — refine when brief lands.
CREATE OR REPLACE VIEW repair.cars_ref AS
SELECT
  r.id AS rlms_railcar_id,
  COALESCE(NULLIF(r.car_initial, ''), NULLIF(r.reporting_marks, ''), '') AS car_mark,
  r.car_number,
  COALESCE(r.active, false) AS active_flag,
  EXISTS (
    SELECT 1
    FROM public.v_valid_export_rows v
    WHERE v.car_number = r.car_number
      AND COALESCE(v.car_initial, '') = COALESCE(r.car_initial, '')
      AND v.active = 1
  ) AS in_vcf,
  r.rider_external_id AS lease_rider,
  r.assignment_label AS current_assignment,
  r.current_assignment_id AS current_assignment_id,
  r.lessee_name,
  r.comment_event_note AS remarks,
  r.fleet_status,
  r.managed,
  r.managed_category
FROM public.railcars r;

COMMENT ON VIEW repair.cars_ref IS
  'Read-only car reference for the repair module. Built on RLMS public tables/views. No writes.';

COMMIT;
