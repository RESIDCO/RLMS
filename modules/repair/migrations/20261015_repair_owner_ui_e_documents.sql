-- 20261015_repair_owner_ui_e_documents.sql
--
-- OWNER_UI §E Document Viewer:
--   owner_only / source tags / doc revision / SDS gate on BO reasons /
--   download audit / expanded attachment categories.
-- Local Postgres only. Schema "repair" only. Append-only / VOIDED.

BEGIN;

-- Owner-only docs (DV / settlement / internal) — never to shop or lessee
ALTER TABLE repair.documents
  ADD COLUMN IF NOT EXISTS owner_only boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN repair.documents.owner_only IS
  'When true, document is owner/system-manager only (DV, settlement, internal). Never visible to shop or lessee.';

-- Linked-from provenance for template / shared BO↔ estimate copies
ALTER TABLE repair.documents
  ADD COLUMN IF NOT EXISTS source_document_id uuid REFERENCES repair.documents(id),
  ADD COLUMN IF NOT EXISTS source_event_id uuid REFERENCES repair.events(id),
  ADD COLUMN IF NOT EXISTS source_tag text,
  ADD COLUMN IF NOT EXISTS doc_revision int NOT NULL DEFAULT 1;

COMMENT ON COLUMN repair.documents.source_tag IS
  'Human provenance label, e.g. "From BO OFAX 085011 2026-10-07".';
COMMENT ON COLUMN repair.documents.doc_revision IS
  'Attachment revision counter (1 = first upload; increments on replace).';

-- BO reasons may require SDS
ALTER TABLE repair.bo_rules
  ADD COLUMN IF NOT EXISTS requires_sds boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN repair.bo_rules.requires_sds IS
  'When true, required-docs checklist flags missing SDS on the Bad Order / estimate.';

-- Expand categories for §E left-rail groups
INSERT INTO repair.attachment_categories (tenant_id, code, display_name, sort_order, created_by)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'photograph', 'Photos', 10, 'migration:20261015_e_documents'),
  ('00000000-0000-4000-8000-000000000001', 'photo', 'Photos', 11, 'migration:20261015_e_documents'),
  ('00000000-0000-4000-8000-000000000001', 'estimate_pdf', 'Estimate PDF', 20, 'migration:20261015_e_documents'),
  ('00000000-0000-4000-8000-000000000001', 'aar_500byte', 'Data files (500-byte)', 30, 'migration:20261015_e_documents'),
  ('00000000-0000-4000-8000-000000000001', 'data_file', 'Data files (500-byte)', 31, 'migration:20261015_e_documents'),
  ('00000000-0000-4000-8000-000000000001', 'invoice', 'Invoice', 40, 'migration:20261015_e_documents'),
  ('00000000-0000-4000-8000-000000000001', 'sds', 'SDS', 50, 'migration:20261015_e_documents'),
  ('00000000-0000-4000-8000-000000000001', 'scope_of_work', 'Scope of work', 60, 'migration:20261015_e_documents'),
  ('00000000-0000-4000-8000-000000000001', 'jic', 'JIC', 70, 'migration:20261015_e_documents'),
  ('00000000-0000-4000-8000-000000000001', 'ddct', 'DDCT', 80, 'migration:20261015_e_documents'),
  ('00000000-0000-4000-8000-000000000001', 'other', 'Other', 90, 'migration:20261015_e_documents')
ON CONFLICT (tenant_id, code) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  sort_order = EXCLUDED.sort_order,
  active = true,
  deleted_at = NULL;

-- Audited downloads (bulk zip + single)
CREATE TABLE IF NOT EXISTS repair.document_download_audit (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  document_ids    uuid[] NOT NULL,
  event_id        uuid REFERENCES repair.events(id),
  estimate_id     uuid REFERENCES repair.estimates(id),
  mode            text NOT NULL, -- single | zip | send_lessee_attach
  actor           text NOT NULL,
  actor_role      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS document_download_audit_event_idx
  ON repair.document_download_audit (event_id, created_at DESC);

COMMIT;
