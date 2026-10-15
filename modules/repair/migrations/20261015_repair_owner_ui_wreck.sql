-- Owner UI — Wreck dual-track (Rule 107 / Resp 3)
-- APPLY ONLY to local Postgres. Schema "repair" only.
-- Append-only / soft-delete; integer cents for money.

BEGIN;

-- ── Quarterly AAR labor rates (price master companion) ────────────────
CREATE TABLE IF NOT EXISTS repair.ref_aar_labor_rates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES repair.tenants(id),
  effective_quarter text NOT NULL,
  edition           text,
  labor_rate_cents  bigint NOT NULL,
  currency          text NOT NULL DEFAULT 'U',
  source            text,
  rule_page         text,
  active            boolean NOT NULL DEFAULT true,
  owner_override    boolean NOT NULL DEFAULT false,
  effective_to      date,
  retired_at        timestamptz,
  retired_by        text,
  retire_reason     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        text,
  updated_at        timestamptz,
  updated_by        text,
  deleted_at        timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS repair_ref_aar_labor_rates_uq
  ON repair.ref_aar_labor_rates (tenant_id, effective_quarter)
  WHERE deleted_at IS NULL AND active AND retired_at IS NULL;

COMMENT ON TABLE repair.ref_aar_labor_rates IS
  'AAR quarterly labor rate from Reference Data price master (current edition). Used for unpriced wreck-track hours×rate (OWNER_UI_WRECK §4 / §11 #4).';

-- Seed a current-edition placeholder rate (cents/hour) for local review.
INSERT INTO repair.ref_aar_labor_rates
  (tenant_id, effective_quarter, edition, labor_rate_cents, source, created_by)
VALUES
  ('00000000-0000-4000-8000-000000000001', '2026Q3', 'AAR-OM-2026Q3', 18500, 'AAR', 'seed:wreck')
ON CONFLICT DO NOTHING;

-- ── Wreck event (dual-track control surface) ──────────────────────────
CREATE TABLE IF NOT EXISTS repair.wreck_events (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL REFERENCES repair.tenants(id),
  event_id                uuid NOT NULL REFERENCES repair.events(id),
  bad_order_id            uuid REFERENCES repair.bad_orders(id),
  car_mark                text NOT NULL,
  car_number              text NOT NULL,
  shop_id                 uuid REFERENCES repair.shops(id),
  ddct_incident_id        text NOT NULL,
  incident_date           date,
  splc                    text,
  damaging_road           text,
  handling_road           text,
  rule_basis              text NOT NULL DEFAULT '107',
  fm_95a_condition        text,
  last_commodity          text,
  stcc                    text,
  disposition             text,
  status                  text NOT NULL DEFAULT 'OPEN',
  -- JIC clock zero
  shop_arrival_date       date,
  -- Informational timeline
  notified_at             date,
  owner_reply_at          date,
  inspection_at           date,
  jic_type                text CHECK (jic_type IS NULL OR jic_type IN ('STANDARD', 'ALTERNATE')),
  jic_prepared_at         date,
  jic_sent_to_owner_at    date,
  jic_forwarded_to_rr_at  date,
  jic_endorsed_at         date,
  jic_auto_endorsed       boolean NOT NULL DEFAULT false,
  jic_endorsing_road      text,
  jic_decline_reason      text,
  jic_amount_cents        bigint,
  repair_complete_at      date,
  billed_at               date,
  -- Track estimate links (also mirrored on event_tracks.estimate_id)
  owner_estimate_id       uuid REFERENCES repair.estimates(id),
  wreck_estimate_id       uuid REFERENCES repair.estimates(id),
  settlement_calc_id      uuid,
  -- Owner DV worksheet inputs (Umler fields; manual; inconsistent-tolerant)
  original_cost_cents     bigint,
  build_date              date,
  rebuilt_ils_date        date,
  car_type_class          text,
  ab_items_json           jsonb NOT NULL DEFAULT '[]'::jsonb,
  lightweight_lb          int,
  non_metallic_lb         int,
  aluminum_lb             int,
  stainless_lb            int,
  ddct_estimated_dv_cents bigint,
  ddct_actual_dv_cents    bigint,
  exhibit_edition         text,
  notes                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              text,
  updated_at              timestamptz,
  updated_by              text,
  deleted_at              timestamptz,
  deleted_by              text,
  delete_reason           text,
  UNIQUE (event_id)
);

CREATE INDEX IF NOT EXISTS repair_wreck_events_car_idx
  ON repair.wreck_events (tenant_id, car_mark, car_number)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS repair_wreck_events_ddct_idx
  ON repair.wreck_events (tenant_id, ddct_incident_id)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE repair.wreck_events IS
  'Owner dual-track wreck control surface: BO + DDCT + owner/Resp3 estimates + JIC clocks + owner-only DV.';
COMMENT ON COLUMN repair.wreck_events.original_cost_cents IS
  'Umler field; optional/blank OK; inconsistent-tolerant with future RLMS Umler read (§11 #1).';
COMMENT ON COLUMN repair.wreck_events.shop_arrival_date IS
  'JIC clock zero (calendar days).';

-- ── Owner-only settlement worksheet (append-friendly; soft updates) ───
CREATE TABLE IF NOT EXISTS repair.wreck_settlement_calcs (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL REFERENCES repair.tenants(id),
  wreck_event_id          uuid NOT NULL REFERENCES repair.wreck_events(id),
  exhibit_edition         text,
  original_cost_cents     bigint,
  reproduction_cents      bigint,
  depreciated_value_cents bigint,
  salvage_cents           bigint,
  settlement_basis        text,
  settlement_cap_cents    bigint,
  over_dv                 boolean NOT NULL DEFAULT false,
  inputs_json             jsonb NOT NULL DEFAULT '{}'::jsonb,
  outputs_json            jsonb NOT NULL DEFAULT '{}'::jsonb,
  override_reason         text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              text,
  updated_at              timestamptz,
  updated_by              text,
  deleted_at              timestamptz
);

ALTER TABLE repair.wreck_events
  DROP CONSTRAINT IF EXISTS wreck_events_settlement_fk;
ALTER TABLE repair.wreck_events
  ADD CONSTRAINT wreck_events_settlement_fk
  FOREIGN KEY (settlement_calc_id) REFERENCES repair.wreck_settlement_calcs(id);

-- ── Estimate stamps + wreck flags ─────────────────────────────────────
ALTER TABLE repair.estimates
  ADD COLUMN IF NOT EXISTS priced_quarter text,
  ADD COLUMN IF NOT EXISTS wreck_track_type text
    CHECK (wreck_track_type IS NULL OR wreck_track_type IN ('OWNER_CONTRACT', 'R107_RESP3')),
  ADD COLUMN IF NOT EXISTS wreck_flags_block boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN repair.estimates.priced_quarter IS
  'Quarter stamped on Resp 3 estimate for H1 price-master validation.';
COMMENT ON COLUMN repair.estimates.wreck_flags_block IS
  'When true, completed date + invoicing blocked until owner/MP clears all flags.';

CREATE TABLE IF NOT EXISTS repair.wreck_flags (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  wreck_event_id  uuid NOT NULL REFERENCES repair.wreck_events(id),
  estimate_id     uuid REFERENCES repair.estimates(id),
  load_run_id     uuid,
  severity        text NOT NULL CHECK (severity IN ('FLAG', 'WARNING', 'ERROR')),
  code            text NOT NULL,
  message         text NOT NULL,
  line_no         int,
  detail          jsonb NOT NULL DEFAULT '{}'::jsonb,
  cleared_at      timestamptz,
  cleared_by      text,
  clear_reason    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text
);

CREATE INDEX IF NOT EXISTS repair_wreck_flags_open_idx
  ON repair.wreck_flags (tenant_id, estimate_id)
  WHERE cleared_at IS NULL;

COMMENT ON TABLE repair.wreck_flags IS
  'Resp 3 ACCEPT+FLAG findings; cleared by car owner / managing partner only (audited).';

-- Shared wreck documents (event-scoped; JIC photo set marker)
ALTER TABLE repair.documents
  ADD COLUMN IF NOT EXISTS wreck_event_id uuid REFERENCES repair.wreck_events(id),
  ADD COLUMN IF NOT EXISTS jic_photo boolean NOT NULL DEFAULT false;

-- Detail sources ref (OM 112.A.4) — soft seed for H2 validation
CREATE TABLE IF NOT EXISTS repair.ref_detail_sources (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES repair.tenants(id),
  code              text NOT NULL,
  description       text,
  source            text,
  rule_page         text,
  effective_quarter text,
  edition           text,
  active            boolean NOT NULL DEFAULT true,
  owner_override    boolean NOT NULL DEFAULT false,
  effective_to      date,
  retired_at        timestamptz,
  retired_by        text,
  retire_reason     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        text,
  deleted_at        timestamptz,
  UNIQUE (tenant_id, code)
);

INSERT INTO repair.ref_detail_sources (tenant_id, code, description, source, created_by)
SELECT '00000000-0000-4000-8000-000000000001', c.code, c.description, 'OM 112.A.4', 'seed:wreck'
FROM (VALUES
  ('BR', 'Billing repair'),
  ('CB', 'Car billing'),
  ('DC', 'Defect card'),
  ('DE', 'Destroyed / settlement'),
  ('DM', 'Dismantle'),
  ('DR', 'Defect card rebuttal'),
  ('GB', 'Group bill'),
  ('GT', 'GST tax'),
  ('HT', 'HST tax'),
  ('IV', 'Invoice tax'),
  ('JD', 'JIC dismantle/retire'),
  ('JI', 'JIC endorsed'),
  ('JR', 'JIC rebuttal'),
  ('MA', 'Miscellaneous'),
  ('OT', 'Other'),
  ('PT', 'PST tax'),
  ('QT', 'QST tax'),
  ('RE', 'Rebill'),
  ('SH', 'Shop')
) AS c(code, description)
ON CONFLICT (tenant_id, code) DO NOTHING;

COMMIT;
