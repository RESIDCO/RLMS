-- 20261014_repair_catalog_and_aar.sql
-- Catalog tables (shops encrypted-ready cols, categories, why-made, resp codes),
-- versioned 500-byte layout, AAR file storage, lessee approval (Resp 6).
-- APPLY ONLY to local Postgres. Schema "repair" only.

BEGIN;

-- ── Shops: encrypted-ready bank/email columns (values stay NULL until Q2) ──
ALTER TABLE repair.shops
  ADD COLUMN IF NOT EXISTS routing_number_enc text,
  ADD COLUMN IF NOT EXISTS account_number_enc text,
  ADD COLUMN IF NOT EXISTS email_enc text;

COMMENT ON COLUMN repair.shops.routing_number_enc IS
  'Encrypted-ready placeholder; leave NULL until shop bank secure-handling decided (Q2).';
COMMENT ON COLUMN repair.shops.account_number_enc IS
  'Encrypted-ready placeholder; leave NULL until shop bank secure-handling decided (Q2).';
COMMENT ON COLUMN repair.shops.email_enc IS
  'Encrypted-ready placeholder; leave NULL until shop email secure-handling decided (Q2).';

-- ── Repair categories (job code / qualifier / combo → category) ────────
CREATE TABLE IF NOT EXISTS repair.repair_categories (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES repair.tenants(id),
  job_code      text NOT NULL,
  qualifier     text,
  combo_key     text NOT NULL,
  description   text,
  category      text,
  sub_category  text,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text,
  updated_at    timestamptz,
  updated_by    text,
  deleted_at    timestamptz,
  deleted_by    text,
  delete_reason text,
  UNIQUE (tenant_id, combo_key)
);

CREATE INDEX IF NOT EXISTS repair_categories_lookup_idx
  ON repair.repair_categories (tenant_id, job_code, qualifier)
  WHERE deleted_at IS NULL AND active;

-- ── Why-made codes (per tenant, admin-editable) ───────────────────────
CREATE TABLE IF NOT EXISTS repair.why_made_codes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES repair.tenants(id),
  code          text NOT NULL,
  description   text NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text,
  updated_at    timestamptz,
  updated_by    text,
  deleted_at    timestamptz,
  deleted_by    text,
  delete_reason text,
  UNIQUE (tenant_id, code)
);

-- ── Responsibility codes (RESIDCO 0–9 seed; public AAR is 1–3) ────────
CREATE TABLE IF NOT EXISTS repair.responsibility_codes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES repair.tenants(id),
  code          text NOT NULL,
  display_name  text NOT NULL,
  description   text,
  is_public_aar boolean NOT NULL DEFAULT false,
  sort_order    int NOT NULL DEFAULT 0,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text,
  deleted_at    timestamptz,
  deleted_by    text,
  delete_reason text,
  UNIQUE (tenant_id, code)
);

-- Display names are seeded here but admin-editable in repair.responsibility_codes
-- (do not hard-code these strings as the sole source of truth in app code).
INSERT INTO repair.responsibility_codes
  (tenant_id, code, display_name, description, is_public_aar, sort_order, created_by)
VALUES
  ('00000000-0000-4000-8000-000000000001', '0', 'Bad Order', 'RESIDCO responsibility code 0', false, 0, 'seed:resp-codes'),
  ('00000000-0000-4000-8000-000000000001', '1', 'Owners', 'Public AAR / RESIDCO code 1 — Owners', true, 1, 'seed:resp-codes'),
  ('00000000-0000-4000-8000-000000000001', '2', 'Handling Line', 'Public AAR / RESIDCO code 2 — Handling Line', true, 2, 'seed:resp-codes'),
  ('00000000-0000-4000-8000-000000000001', '3', 'Defect Card/JIC', 'Public AAR / RESIDCO code 3 — Defect Card/JIC', true, 3, 'seed:resp-codes'),
  ('00000000-0000-4000-8000-000000000001', '4', 'Capital Program', 'RESIDCO responsibility code 4', false, 4, 'seed:resp-codes'),
  ('00000000-0000-4000-8000-000000000001', '5', 'Lease Return', 'RESIDCO responsibility code 5', false, 5, 'seed:resp-codes'),
  ('00000000-0000-4000-8000-000000000001', '6', 'Auto Rebill', 'RESIDCO responsibility code 6 — Auto Rebill (lessee approval path)', false, 6, 'seed:resp-codes'),
  ('00000000-0000-4000-8000-000000000001', '7', 'Never Rebill', 'RESIDCO responsibility code 7', false, 7, 'seed:resp-codes'),
  ('00000000-0000-4000-8000-000000000001', '8', 'Preventive Maintenance', 'RESIDCO responsibility code 8', false, 8, 'seed:resp-codes'),
  ('00000000-0000-4000-8000-000000000001', '9', 'HM216', 'RESIDCO responsibility code 9', false, 9, 'seed:resp-codes')
ON CONFLICT (tenant_id, code) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  is_public_aar = EXCLUDED.is_public_aar,
  sort_order = EXCLUDED.sort_order;

-- ── Versioned 500-byte layout (no hard-coded positions in parser) ─────
CREATE TABLE IF NOT EXISTS repair.aar_layout_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version       text NOT NULL UNIQUE,
  source        text NOT NULL,
  notes         text,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text
);

CREATE TABLE IF NOT EXISTS repair.aar_layout_fields (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  layout_version  text NOT NULL REFERENCES repair.aar_layout_versions(version),
  record_format   text NOT NULL CHECK (record_format IN ('1', '6', '8', '9', '*')),
  field_key       text NOT NULL,
  col_start       int NOT NULL CHECK (col_start >= 1 AND col_start <= 500),
  length          int NOT NULL CHECK (length >= 1 AND col_start + length - 1 <= 500),
  data_type       text NOT NULL CHECK (data_type IN (
                    'A/N', 'N', 'A', 'cents', 'raw'
                  )),
  required        boolean NOT NULL DEFAULT false,
  preserve_raw    boolean NOT NULL DEFAULT false,
  notes           text,
  UNIQUE (layout_version, record_format, field_key)
);

INSERT INTO repair.aar_layout_versions (version, source, notes, created_by)
VALUES (
  'CRB-AppG-2024',
  'Railinc CRB Procedures Manual Appendix G (+ project Railinc_Data_File_Reference.md)',
  'Format 1 detail fields used for shop detail-only extracts and round-trip.',
  'migration:20261014'
)
ON CONFLICT (version) DO NOTHING;

-- Format 1 fields (1-based columns). Amounts stored/parsed as integer cents.
INSERT INTO repair.aar_layout_fields
  (layout_version, record_format, field_key, col_start, length, data_type, required, preserve_raw, notes)
VALUES
  ('CRB-AppG-2024', '1', 'record_format',           1,  1, 'A/N',   true,  false, NULL),
  ('CRB-AppG-2024', '1', 'billing_party',            2,  4, 'A/N',   true,  false, NULL),
  ('CRB-AppG-2024', '1', 'billed_party',             6,  4, 'A/N',   true,  false, NULL),
  ('CRB-AppG-2024', '1', 'account_date_yymm',       10,  4, 'N',     true,  false, NULL),
  ('CRB-AppG-2024', '1', 'invoice_number',          14, 16, 'A/N',   true,  false, 'May be blank on detail-only extracts'),
  ('CRB-AppG-2024', '1', 'currency',                30,  1, 'A/N',   true,  false, NULL),
  ('CRB-AppG-2024', '1', 'detail_source',           31,  2, 'A/N',   true,  false, NULL),
  ('CRB-AppG-2024', '1', 'document_reference',      33, 15, 'A/N',   false, false, NULL),
  ('CRB-AppG-2024', '1', 'car_initial',             48,  4, 'A',     true,  false, NULL),
  ('CRB-AppG-2024', '1', 'car_number',              52,  6, 'N',     true,  false, NULL),
  ('CRB-AppG-2024', '1', 'kind_of_car',             58,  1, 'A',     false, false, NULL),
  ('CRB-AppG-2024', '1', 'load_empty',              59,  1, 'A/N',   false, false, NULL),
  ('CRB-AppG-2024', '1', 'repair_date_yymmdd',      60,  6, 'N',     true,  false, NULL),
  ('CRB-AppG-2024', '1', 'splc',                    66,  6, 'N',     true,  false, NULL),
  ('CRB-AppG-2024', '1', 'repairing_party',         72,  4, 'A/N',   true,  false, NULL),
  ('CRB-AppG-2024', '1', 'repairing_party_invoice', 76, 16, 'A/N',   true,  false, NULL),
  ('CRB-AppG-2024', '1', 'repairing_party_doc_ref', 92, 15, 'A/N',   false, false, NULL),
  ('CRB-AppG-2024', '1', 'facility_type',          107,  2, 'A/N',   true,  false, NULL),
  ('CRB-AppG-2024', '1', 'location_on_car',        109,  2, 'A/N',   false, false, NULL),
  ('CRB-AppG-2024', '1', 'reserved_111',           111,  1, 'A/N',   false, true,  'Future location expansion'),
  ('CRB-AppG-2024', '1', 'reserved_112',           112,  1, 'N',     false, true,  'Future quantity expansion'),
  ('CRB-AppG-2024', '1', 'quantity',               113,  4, 'N',     true,  false, NULL),
  ('CRB-AppG-2024', '1', 'condition_code',         117,  1, 'A/N',   true,  false, NULL),
  ('CRB-AppG-2024', '1', 'reserved_118',           118,  2, 'N',     false, true,  'Future applied JC expansion'),
  ('CRB-AppG-2024', '1', 'applied_job_code',       120,  4, 'N',     true,  false, NULL),
  ('CRB-AppG-2024', '1', 'applied_qualifier',      124,  3, 'A/N',   false, false, NULL),
  ('CRB-AppG-2024', '1', 'why_made',               127,  2, 'A/N',   true,  false, NULL),
  ('CRB-AppG-2024', '1', 'reserved_129',           129,  2, 'N',     false, true,  'Future removed JC expansion'),
  ('CRB-AppG-2024', '1', 'removed_job_code',       131,  4, 'N',     true,  false, NULL),
  ('CRB-AppG-2024', '1', 'removed_qualifier',      135,  3, 'A/N',   false, false, NULL),
  ('CRB-AppG-2024', '1', 'responsibility_code',    138,  1, 'N',     true,  false, NULL),
  ('CRB-AppG-2024', '1', 'defect_card_party',      139,  4, 'A/N',   false, false, NULL),
  ('CRB-AppG-2024', '1', 'defect_card_date',       143,  6, 'N',     false, false, NULL),
  ('CRB-AppG-2024', '1', 'labor_cents',            149,  7, 'cents', true,  false, '2 implied decimals → integer cents'),
  ('CRB-AppG-2024', '1', 'material_cents',         156,  8, 'cents', true,  false, '2 implied decimals → integer cents'),
  ('CRB-AppG-2024', '1', 'material_sign',          164,  1, 'A',     true,  false, 'D/C'),
  ('CRB-AppG-2024', '1', 'machine_priceable',      165,  1, 'A',     true,  false, NULL),
  ('CRB-AppG-2024', '1', 'wrong_repair',           166,  1, 'A',     false, false, NULL),
  ('CRB-AppG-2024', '1', 'description',            167, 50, 'A/N',   true,  false, 'Non-wheel narrative (50)'),
  ('CRB-AppG-2024', '1', 'labor_rate_cents',       217,  5, 'cents', false, false, NULL),
  ('CRB-AppG-2024', '1', 'expanded_splc',          222,  9, 'N',     false, false, NULL),
  ('CRB-AppG-2024', '1', 'span_231_288',           231, 58, 'raw',   false, true,  'CIF parties + filler preserved'),
  ('CRB-AppG-2024', '1', 'line_number',            289,  5, 'N',     true,  false, NULL),
  ('CRB-AppG-2024', '1', 'railinc_inbound_stamp',  294,  6, 'N',     false, true,  NULL),
  ('CRB-AppG-2024', '1', 'railinc_outbound_stamp', 300,  6, 'N',     false, true,  NULL),
  ('CRB-AppG-2024', '1', 'resubmitted_indicator',  306,  1, 'A/N',   false, false, NULL),
  ('CRB-AppG-2024', '1', 'original_invoice',       307, 16, 'A/N',   false, false, NULL),
  ('CRB-AppG-2024', '1', 'original_account_date',  323,  4, 'N',     false, false, NULL),
  ('CRB-AppG-2024', '1', 'aar_component_id',       327, 14, 'A/N',   false, false, 'CID'),
  ('CRB-AppG-2024', '1', 'ddct_incident_id',       341, 12, 'A/N',   false, false, NULL),
  ('CRB-AppG-2024', '1', 'reserved_353',           353, 48, 'raw',   false, true,  NULL),
  ('CRB-AppG-2024', '1', 'free_user_area',         401,100, 'raw',   false, true,  NULL)
ON CONFLICT (layout_version, record_format, field_key) DO NOTHING;

-- ── Immutable AAR file + raw lines ────────────────────────────────────
CREATE TABLE IF NOT EXISTS repair.aar_files (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  event_id        uuid REFERENCES repair.events(id),
  estimate_id     uuid REFERENCES repair.estimates(id),
  revision_id     uuid REFERENCES repair.estimate_revisions(id),
  filename        text NOT NULL,
  sha256          text NOT NULL,
  byte_length     bigint NOT NULL,
  storage_key     text NOT NULL,
  layout_version  text NOT NULL REFERENCES repair.aar_layout_versions(version),
  line_ending     text NOT NULL CHECK (line_ending IN ('CRLF', 'LF', 'CR', 'NONE')),
  is_complete_crip boolean NOT NULL DEFAULT false,
  flags           jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text
);

CREATE TABLE IF NOT EXISTS repair.aar_raw_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  aar_file_id     uuid NOT NULL REFERENCES repair.aar_files(id),
  line_no         int NOT NULL,
  raw_line        char(500) NOT NULL,
  record_format   text NOT NULL,
  parsed_json     jsonb NOT NULL DEFAULT '{}'::jsonb,
  labor_cents     bigint,
  material_cents  bigint,
  material_sign   text,
  resp_code       text,
  applied_job_code text,
  applied_qualifier text,
  why_made        text,
  repair_category text,
  sub_category    text,
  aar_component_id text,
  ddct_incident_id text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (aar_file_id, line_no)
);

DROP TRIGGER IF EXISTS aar_files_no_update ON repair.aar_files;
CREATE TRIGGER aar_files_no_update
  BEFORE UPDATE ON repair.aar_files
  FOR EACH ROW EXECUTE FUNCTION repair.reject_mutation();

DROP TRIGGER IF EXISTS aar_files_no_delete ON repair.aar_files;
CREATE TRIGGER aar_files_no_delete
  BEFORE DELETE ON repair.aar_files
  FOR EACH ROW EXECUTE FUNCTION repair.reject_mutation();

DROP TRIGGER IF EXISTS aar_raw_lines_no_update ON repair.aar_raw_lines;
CREATE TRIGGER aar_raw_lines_no_update
  BEFORE UPDATE ON repair.aar_raw_lines
  FOR EACH ROW EXECUTE FUNCTION repair.reject_mutation();

DROP TRIGGER IF EXISTS aar_raw_lines_no_delete ON repair.aar_raw_lines;
CREATE TRIGGER aar_raw_lines_no_delete
  BEFORE DELETE ON repair.aar_raw_lines
  FOR EACH ROW EXECUTE FUNCTION repair.reject_mutation();

-- Stamp category columns already exist on estimate_lines; add CID/DDCT if missing
ALTER TABLE repair.estimate_lines
  ADD COLUMN IF NOT EXISTS aar_component_id text,
  ADD COLUMN IF NOT EXISTS ddct_incident_id text,
  ADD COLUMN IF NOT EXISTS labor_cents bigint,
  ADD COLUMN IF NOT EXISTS material_cents bigint;

-- ── Lessee approval (Resp 6) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS repair.lessee_approvals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES repair.tenants(id),
  event_id          uuid NOT NULL REFERENCES repair.events(id),
  estimate_id       uuid NOT NULL REFERENCES repair.estimates(id),
  revision_id       uuid NOT NULL REFERENCES repair.estimate_revisions(id),
  lessee_email      text NOT NULL,
  status            text NOT NULL CHECK (status IN (
                      'PENDING', 'APPROVED_VIA_LINK', 'REPLY_RECEIVED',
                      'REPLY_CONFIRMED', 'REPLY_REJECTED', 'EXPIRED'
                    )),
  document_ids      uuid[] NOT NULL DEFAULT '{}',
  outbound_email_id text,
  link_id           uuid REFERENCES repair.event_links(id),
  reply_inbound_id  text,
  reviewer_confirmed_by text,
  reviewer_confirmed_at timestamptz,
  decided_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        text,
  deleted_at        timestamptz,
  deleted_by        text,
  delete_reason     text
);

CREATE INDEX IF NOT EXISTS lessee_approvals_estimate_idx
  ON repair.lessee_approvals (estimate_id)
  WHERE deleted_at IS NULL;

COMMIT;
