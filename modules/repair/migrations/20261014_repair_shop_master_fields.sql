-- 20261014_repair_shop_master_fields.sql
-- OWNER_UI §B additions: shop mark, delivering lines, capabilities, car types,
-- AAR certifications, website/hours, shop attachments.
-- APPLY ONLY to local Postgres. Schema "repair" only.
-- All new shop fields are OPTIONAL.

BEGIN;

-- ── Shop optional columns ─────────────────────────────────────────────
ALTER TABLE repair.shops
  ADD COLUMN IF NOT EXISTS shop_mark text,
  ADD COLUMN IF NOT EXISTS website text,
  ADD COLUMN IF NOT EXISTS hours_notes text;

COMMENT ON COLUMN repair.shops.shop_mark IS
  'Optional AAR shop code / shop mark (e.g. A084). Used in BO dropdown: Name (MARK) – City, ST.';
COMMENT ON COLUMN repair.shops.website IS 'Optional shop website URL.';
COMMENT ON COLUMN repair.shops.hours_notes IS 'Optional hours of operation / free-form notes.';

CREATE INDEX IF NOT EXISTS shops_shop_mark_idx
  ON repair.shops (tenant_id, upper(shop_mark))
  WHERE deleted_at IS NULL AND shop_mark IS NOT NULL;

-- Shop documents (reuse repair.documents; soft-delete → VOIDED)
ALTER TABLE repair.documents
  ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES repair.shops(id);

CREATE INDEX IF NOT EXISTS documents_shop_idx
  ON repair.documents (shop_id)
  WHERE shop_id IS NOT NULL AND deleted_at IS NULL;

-- ── Owner-managed catalogs (Admin gear) ───────────────────────────────
CREATE TABLE IF NOT EXISTS repair.shop_capability_codes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  code            text NOT NULL,
  display_name    text NOT NULL,
  sort_order      int NOT NULL DEFAULT 0,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  deleted_at      timestamptz,
  deleted_by      text,
  delete_reason   text,
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS repair.shop_car_type_codes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  code            text NOT NULL,
  display_name    text NOT NULL,
  sort_order      int NOT NULL DEFAULT 0,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  deleted_at      timestamptz,
  deleted_by      text,
  delete_reason   text,
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS repair.shop_cert_type_codes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  code            text NOT NULL,
  display_name    text NOT NULL,
  sort_order      int NOT NULL DEFAULT 0,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  deleted_at      timestamptz,
  deleted_by      text,
  delete_reason   text,
  UNIQUE (tenant_id, code)
);

-- Seed starter catalogs (idempotent) — owner can add more via Admin
INSERT INTO repair.shop_capability_codes (tenant_id, code, display_name, sort_order, created_by)
SELECT t.id, v.code, v.display_name, v.sort_order, 'migration:shop-fields'
FROM repair.tenants t
CROSS JOIN (VALUES
  ('TANK_CLEANING', 'Tank cleaning', 10),
  ('WHEEL_TRUCK', 'Wheel / truck', 20),
  ('LINING', 'Lining', 30),
  ('PAINTING', 'Painting', 40),
  ('WRECK', 'Wreck', 50),
  ('MOBILE', 'Mobile', 60),
  ('QUALIFICATION', 'Qualification / requalification', 70)
) AS v(code, display_name, sort_order)
WHERE t.slug = 'residco'
ON CONFLICT (tenant_id, code) DO NOTHING;

INSERT INTO repair.shop_car_type_codes (tenant_id, code, display_name, sort_order, created_by)
SELECT t.id, v.code, v.display_name, v.sort_order, 'migration:shop-fields'
FROM repair.tenants t
CROSS JOIN (VALUES
  ('COVERED_HOPPER', 'Covered hopper', 10),
  ('OPEN_HOPPER', 'Open hopper', 20),
  ('TANK', 'Tank', 30),
  ('GONDOLA', 'Gondola', 40),
  ('BOXCAR', 'Boxcar', 50),
  ('FLATCAR', 'Flatcar', 60)
) AS v(code, display_name, sort_order)
WHERE t.slug = 'residco'
ON CONFLICT (tenant_id, code) DO NOTHING;

INSERT INTO repair.shop_cert_type_codes (tenant_id, code, display_name, sort_order, created_by)
SELECT t.id, v.code, v.display_name, v.sort_order, 'migration:shop-fields'
FROM repair.tenants t
CROSS JOIN (VALUES
  ('M1003', 'M-1003', 10),
  ('M1002_TANK', 'M-1002 tank', 20)
) AS v(code, display_name, sort_order)
WHERE t.slug = 'residco'
ON CONFLICT (tenant_id, code) DO NOTHING;

-- ── Shop multi-select junctions ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS repair.shop_capabilities (
  shop_id         uuid NOT NULL REFERENCES repair.shops(id),
  capability_id   uuid NOT NULL REFERENCES repair.shop_capability_codes(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  PRIMARY KEY (shop_id, capability_id)
);

CREATE TABLE IF NOT EXISTS repair.shop_car_types (
  shop_id         uuid NOT NULL REFERENCES repair.shops(id),
  car_type_id     uuid NOT NULL REFERENCES repair.shop_car_type_codes(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  PRIMARY KEY (shop_id, car_type_id)
);

CREATE TABLE IF NOT EXISTS repair.shop_delivering_lines (
  shop_id         uuid NOT NULL REFERENCES repair.shops(id),
  mark            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  PRIMARY KEY (shop_id, mark)
);

COMMENT ON TABLE repair.shop_delivering_lines IS
  'Serving / delivering railroad marks for a shop. Validated vs repair.billing_roads.';

-- ── AAR certifications (repeatable rows) ──────────────────────────────
CREATE TABLE IF NOT EXISTS repair.shop_certifications (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES repair.tenants(id),
  shop_id             uuid NOT NULL REFERENCES repair.shops(id),
  cert_type_id        uuid REFERENCES repair.shop_cert_type_codes(id),
  cert_type_label     text,
  certificate_number  text,
  expires_on          date,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          text,
  deleted_at          timestamptz,
  deleted_by          text,
  delete_reason       text
);

CREATE INDEX IF NOT EXISTS shop_certifications_shop_idx
  ON repair.shop_certifications (shop_id)
  WHERE deleted_at IS NULL;

COMMIT;
