-- 20261013_repair_schema_events.sql
--
-- Repair module — events / BO / estimates / shop links (Phase 1 next slice).
-- APPLY ONLY to local Postgres. Creates objects in schema "repair" only.
-- Does NOT alter existing RLMS public tables, views, or auth.

BEGIN;

-- Shops (bank fields intentionally empty — open item Q2)
CREATE TABLE IF NOT EXISTS repair.shops (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  reporting_mark  text NOT NULL,
  name            text NOT NULL,
  remit_address   text,
  default_inbox   text,
  routing_number  text,  -- leave null until secure handling decided
  account_number  text,  -- leave null until secure handling decided
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  deleted_at      timestamptz,
  deleted_by      text,
  delete_reason   text,
  UNIQUE (tenant_id, reporting_mark)
);

CREATE TABLE IF NOT EXISTS repair.contacts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  party_type      text NOT NULL CHECK (party_type IN ('shop', 'lessee', 'other')),
  party_ref       text,
  name            text NOT NULL,
  email           text,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  deleted_at      timestamptz,
  deleted_by      text,
  delete_reason   text
);

CREATE TABLE IF NOT EXISTS repair.events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES repair.tenants(id),
  car_mark          text NOT NULL,
  car_number        text NOT NULL,
  rlms_railcar_id   bigint,
  shop_id           uuid REFERENCES repair.shops(id),
  rule              text NOT NULL CHECK (rule IN ('RULE_1', 'RULE_107')),
  damaging_road     text,
  ddct_event_id     text,
  ddct_incident_id  text,
  origin            text NOT NULL CHECK (origin IN ('BO', 'NO_BO_UPLOAD')),
  status_id         uuid NOT NULL REFERENCES repair.statuses(id),
  is_wreck          boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        text,
  deleted_at        timestamptz,
  deleted_by        text,
  delete_reason     text
);

CREATE INDEX IF NOT EXISTS events_tenant_car_idx
  ON repair.events (tenant_id, car_mark, car_number)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS repair.event_tracks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  event_id        uuid NOT NULL REFERENCES repair.events(id),
  track_type      text NOT NULL CHECK (track_type IN ('OWNER_CONTRACT', 'R107_RESP3')),
  status_id       uuid REFERENCES repair.statuses(id),
  estimate_id     uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  deleted_at      timestamptz,
  deleted_by      text,
  delete_reason   text,
  UNIQUE (event_id, track_type)
);

CREATE TABLE IF NOT EXISTS repair.bad_orders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES repair.tenants(id),
  event_id          uuid NOT NULL REFERENCES repair.events(id),
  source            text NOT NULL CHECK (source IN ('DDCT', 'EMAIL_DOC', 'INTERNAL')),
  shopping_reason   text,
  received_at       timestamptz NOT NULL DEFAULT now(),
  raw_source_doc_id uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        text,
  deleted_at        timestamptz,
  deleted_by        text,
  delete_reason     text
);

CREATE TABLE IF NOT EXISTS repair.estimates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES repair.tenants(id),
  event_id          uuid NOT NULL REFERENCES repair.events(id),
  track_id          uuid REFERENCES repair.event_tracks(id),
  current_revision  int NOT NULL DEFAULT 0,
  status_id         uuid NOT NULL REFERENCES repair.statuses(id),
  completed_at      timestamptz,
  locked            boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        text,
  deleted_at        timestamptz,
  deleted_by        text,
  delete_reason     text
);

ALTER TABLE repair.event_tracks
  DROP CONSTRAINT IF EXISTS event_tracks_estimate_fk;
ALTER TABLE repair.event_tracks
  ADD CONSTRAINT event_tracks_estimate_fk
  FOREIGN KEY (estimate_id) REFERENCES repair.estimates(id);

-- Append-only revision history
CREATE TABLE IF NOT EXISTS repair.estimate_revisions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  estimate_id     uuid NOT NULL REFERENCES repair.estimates(id),
  rev_no          int NOT NULL,
  action          text NOT NULL,
  action_at       timestamptz NOT NULL DEFAULT now(),
  actor_name      text,
  actor_user      text,
  actor_email     text,
  labor           numeric(14,2) NOT NULL DEFAULT 0,
  material        numeric(14,2) NOT NULL DEFAULT 0,
  total           numeric(14,2) NOT NULL DEFAULT 0,
  new_status      text,
  old_status      text,
  comment         text,
  source_file_id  uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  UNIQUE (estimate_id, rev_no)
);

DROP TRIGGER IF EXISTS estimate_revisions_no_update ON repair.estimate_revisions;
CREATE TRIGGER estimate_revisions_no_update
  BEFORE UPDATE ON repair.estimate_revisions
  FOR EACH ROW EXECUTE FUNCTION repair.reject_mutation();

DROP TRIGGER IF EXISTS estimate_revisions_no_delete ON repair.estimate_revisions;
CREATE TRIGGER estimate_revisions_no_delete
  BEFORE DELETE ON repair.estimate_revisions
  FOR EACH ROW EXECUTE FUNCTION repair.reject_mutation();

CREATE TABLE IF NOT EXISTS repair.estimate_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES repair.tenants(id),
  revision_id       uuid NOT NULL REFERENCES repair.estimate_revisions(id),
  line_no           int NOT NULL,
  aar_job_code      text,
  qualifier         text,
  why_made          text,
  condition_code    text,
  resp_code         text,
  labor             numeric(14,2) NOT NULL DEFAULT 0,
  material          numeric(14,2) NOT NULL DEFAULT 0,
  total             numeric(14,2) NOT NULL DEFAULT 0,
  repair_category   text,
  sub_category      text,
  raw_line          text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        text
);

CREATE TABLE IF NOT EXISTS repair.event_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  event_id        uuid NOT NULL REFERENCES repair.events(id),
  scope           text NOT NULL CHECK (scope IN ('SHOP', 'LESSEE')),
  party_ref       text,
  token_hash      text NOT NULL UNIQUE,
  issued_at       timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz,
  revoked_at      timestamptz,
  revoked_by      text,
  reissued_from   uuid REFERENCES repair.event_links(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text
);

CREATE INDEX IF NOT EXISTS event_links_event_scope_idx
  ON repair.event_links (event_id, scope)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS repair.documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  event_id        uuid REFERENCES repair.events(id),
  revision_id     uuid REFERENCES repair.estimate_revisions(id),
  kind            text NOT NULL,
  storage_key     text NOT NULL,
  sha256          text NOT NULL,
  size            bigint NOT NULL,
  mime            text,
  uploaded_by     text,
  uploaded_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  deleted_at      timestamptz,
  deleted_by      text,
  delete_reason   text
);

-- Demo shop for local / empty seed (not the 538-payee list)
INSERT INTO repair.shops (tenant_id, reporting_mark, name, default_inbox, created_by)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'DEMO',
  'Demo Repair Shop',
  'demo-shop@example.invalid',
  'migration:20261013_events'
)
ON CONFLICT (tenant_id, reporting_mark) DO NOTHING;

COMMIT;
