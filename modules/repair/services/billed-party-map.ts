/**
 * Billed-party mark mapping (Q14–Q16).
 * Shops don't know lessee/railroad marks — resolve from repair-schema map
 * keyed by car and/or lease_rider. Admin-editable with append-only history.
 * Block CRB export when a required mark is missing.
 */

import { DEFAULT_TENANT_ID, q } from "../db";
import { writeAudit } from "./audit";
import { getCarsRef } from "../integration/rlms";

export type PartyRole = "LESSEE" | "RAILROAD";

export type BilledPartyMapping = {
  id: string;
  tenant_id: string;
  car_mark: string | null;
  car_number: string | null;
  lease_rider: string | null;
  party_role: PartyRole;
  billed_party_mark: string;
  payment_terms_days: number | null;
  notes: string | null;
  active: boolean;
};

export type ResolvedBilledParty = {
  mark: string;
  partyRole: PartyRole;
  paymentTermsDays: number | null;
  mappingId: string;
  matchedBy: "car" | "lease_rider";
  leaseRider: string | null;
};

export type MissingBilledParty = {
  carMark: string;
  carNumber: string;
  leaseRider: string | null;
  partyRole: PartyRole;
  reason: string;
};

function normalizeMark(mark: string): string {
  return mark.trim().toUpperCase().slice(0, 4);
}

async function tenantSettings(tenantId: string): Promise<Record<string, unknown>> {
  const { rows } = await q(`SELECT settings FROM repair.tenants WHERE id = $1`, [tenantId]);
  return (rows[0]?.settings as Record<string, unknown>) ?? {};
}

/** Outbound rebuttal billing party = car owner / fleet mark (tenant setting). */
export async function getCarOwnerMark(tenantId = DEFAULT_TENANT_ID): Promise<{
  ok: true;
  mark: string;
} | {
  ok: false;
  error: string;
}> {
  const settings = await tenantSettings(tenantId);
  const mark = normalizeMark(
    String(settings.carOwnerMark ?? settings.crbBillingPartyMark ?? ""),
  );
  if (!mark) {
    return {
      ok: false,
      error:
        "Tenant setting carOwnerMark is required for outbound CRB rebuttal (do not hard-code a fleet mark).",
    };
  }
  return { ok: true, mark };
}

export async function getDefaultPaymentTermsDays(
  tenantId = DEFAULT_TENANT_ID,
): Promise<number> {
  const settings = await tenantSettings(tenantId);
  const fromDays = Number(settings.crbPaymentTermsDays);
  if (Number.isFinite(fromDays) && fromDays > 0) return Math.trunc(fromDays);
  const fromLegacy = Number(
    String(settings.crbPaymentTerms ?? "").replace(/\D/g, ""),
  );
  if (Number.isFinite(fromLegacy) && fromLegacy > 0) return Math.trunc(fromLegacy);
  return 30;
}

export async function getTaxpayerId(tenantId = DEFAULT_TENANT_ID): Promise<string> {
  const settings = await tenantSettings(tenantId);
  return String(settings.crbTaxpayerId ?? "");
}

/**
 * Inbound shop invoice marks (Q14): from the shop’s 500-byte detail line.
 * billing party = cols 2–5 (shop); billed party = cols 6–9 (car owner).
 */
export function resolveInboundShopMarks(rawFormat1Line: string): {
  billingParty: string;
  billedParty: string;
} | null {
  if (!rawFormat1Line || rawFormat1Line.length < 9 || rawFormat1Line[0] !== "1") {
    return null;
  }
  return {
    billingParty: normalizeMark(rawFormat1Line.slice(1, 5)),
    billedParty: normalizeMark(rawFormat1Line.slice(5, 9)),
  };
}

export async function listBilledPartyMappings(opts?: {
  tenantId?: string;
  partyRole?: PartyRole;
  includeInactive?: boolean;
}) {
  const tenantId = opts?.tenantId ?? DEFAULT_TENANT_ID;
  const params: unknown[] = [tenantId];
  let sql = `
    SELECT * FROM repair.billed_party_mappings
    WHERE tenant_id = $1 AND deleted_at IS NULL`;
  if (!opts?.includeInactive) sql += ` AND active`;
  if (opts?.partyRole) {
    params.push(opts.partyRole);
    sql += ` AND party_role = $${params.length}`;
  }
  sql += ` ORDER BY party_role, car_mark NULLS LAST, car_number NULLS LAST, lease_rider NULLS LAST`;
  const { rows } = await q<BilledPartyMapping>(sql, params);
  return rows;
}

export async function listBilledPartyMappingHistory(mappingId: string) {
  const { rows } = await q(
    `SELECT * FROM repair.billed_party_mapping_history
     WHERE mapping_id = $1
     ORDER BY at DESC`,
    [mappingId],
  );
  return rows;
}

async function writeMappingHistory(opts: {
  tenantId: string;
  mappingId: string;
  action: "CREATE" | "UPDATE" | "DEACTIVATE" | "REACTIVATE";
  before: unknown;
  after: unknown;
  actor: string;
}) {
  await q(
    `INSERT INTO repair.billed_party_mapping_history
       (tenant_id, mapping_id, action, before_json, after_json, actor, created_by)
     VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$6)`,
    [
      opts.tenantId,
      opts.mappingId,
      opts.action,
      opts.before ? JSON.stringify(opts.before) : null,
      opts.after ? JSON.stringify(opts.after) : null,
      opts.actor,
    ],
  );
}

export async function upsertBilledPartyMapping(opts: {
  id?: string;
  tenantId?: string;
  carMark?: string | null;
  carNumber?: string | null;
  leaseRider?: string | null;
  partyRole: PartyRole;
  billedPartyMark: string;
  paymentTermsDays?: number | null;
  notes?: string | null;
  active?: boolean;
  actor: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const mark = normalizeMark(opts.billedPartyMark);
  if (!mark) {
    return { ok: false as const, status: 400, error: "billedPartyMark required (1–4 chars)" };
  }
  if (opts.partyRole !== "LESSEE" && opts.partyRole !== "RAILROAD") {
    return { ok: false as const, status: 400, error: "partyRole must be LESSEE or RAILROAD" };
  }
  const carMark = opts.carMark?.trim() ? opts.carMark.trim().toUpperCase() : null;
  const carNumber = opts.carNumber?.trim() ? opts.carNumber.trim() : null;
  const leaseRider = opts.leaseRider?.trim() ? opts.leaseRider.trim() : null;
  if (!(carMark && carNumber) && !leaseRider) {
    return {
      ok: false as const,
      status: 400,
      error: "Provide carMark+carNumber and/or leaseRider",
    };
  }

  if (opts.id) {
    const { rows: existing } = await q(
      `SELECT * FROM repair.billed_party_mappings
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [opts.id, tenantId],
    );
    if (!existing[0]) {
      return { ok: false as const, status: 404, error: "Mapping not found" };
    }
    const { rows } = await q(
      `UPDATE repair.billed_party_mappings
       SET car_mark = $3, car_number = $4, lease_rider = $5, party_role = $6,
           billed_party_mark = $7, payment_terms_days = $8, notes = $9,
           active = COALESCE($10, active), updated_at = now(), updated_by = $11
       WHERE id = $1 AND tenant_id = $2
       RETURNING *`,
      [
        opts.id,
        tenantId,
        carMark,
        carNumber,
        leaseRider,
        opts.partyRole,
        mark,
        opts.paymentTermsDays ?? null,
        opts.notes ?? null,
        opts.active,
        opts.actor,
      ],
    );
    const action =
      existing[0].active && opts.active === false
        ? "DEACTIVATE"
        : !existing[0].active && opts.active === true
          ? "REACTIVATE"
          : "UPDATE";
    await writeMappingHistory({
      tenantId,
      mappingId: rows[0].id,
      action,
      before: existing[0],
      after: rows[0],
      actor: opts.actor,
    });
    await writeAudit({
      tenantId,
      entity: "billed_party_mapping",
      entityId: rows[0].id,
      action: `BILLED_PARTY_MAP_${action}`,
      before: existing[0],
      after: rows[0],
      actor: opts.actor,
      via: "UI",
    });
    return { ok: true as const, mapping: rows[0] };
  }

  const { rows } = await q(
    `INSERT INTO repair.billed_party_mappings
       (tenant_id, car_mark, car_number, lease_rider, party_role, billed_party_mark,
        payment_terms_days, notes, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
     RETURNING *`,
    [
      tenantId,
      carMark,
      carNumber,
      leaseRider,
      opts.partyRole,
      mark,
      opts.paymentTermsDays ?? null,
      opts.notes ?? null,
      opts.actor,
    ],
  );
  await writeMappingHistory({
    tenantId,
    mappingId: rows[0].id,
    action: "CREATE",
    before: null,
    after: rows[0],
    actor: opts.actor,
  });
  await writeAudit({
    tenantId,
    entity: "billed_party_mapping",
    entityId: rows[0].id,
    action: "BILLED_PARTY_MAP_CREATE",
    after: rows[0],
    actor: opts.actor,
    via: "UI",
  });
  return { ok: true as const, mapping: rows[0] };
}

export async function softDeleteBilledPartyMapping(opts: {
  id: string;
  actor: string;
  reason?: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows: existing } = await q(
    `SELECT * FROM repair.billed_party_mappings
     WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [opts.id, tenantId],
  );
  if (!existing[0]) {
    return { ok: false as const, status: 404, error: "Mapping not found" };
  }
  const { rows } = await q(
    `UPDATE repair.billed_party_mappings
     SET deleted_at = now(), deleted_by = $3, delete_reason = $4,
         active = false, updated_at = now(), updated_by = $3
     WHERE id = $1 AND tenant_id = $2
     RETURNING *`,
    [opts.id, tenantId, opts.actor, opts.reason ?? null],
  );
  await writeMappingHistory({
    tenantId,
    mappingId: rows[0].id,
    action: "DEACTIVATE",
    before: existing[0],
    after: rows[0],
    actor: opts.actor,
  });
  return { ok: true as const, mapping: rows[0] };
}

/**
 * Resolve billed-party mark for a car (and optional lease from cars_ref).
 * Prefer car match, then lease_rider match.
 */
export async function resolveBilledParty(opts: {
  carMark: string;
  carNumber: string;
  partyRole: PartyRole;
  tenantId?: string;
  leaseRider?: string | null;
}): Promise<
  | { ok: true; resolved: ResolvedBilledParty }
  | { ok: false; missing: MissingBilledParty }
> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const carMark = opts.carMark.trim().toUpperCase();
  const carNumber = opts.carNumber.trim();

  let leaseRider = opts.leaseRider?.trim() || null;
  if (!leaseRider) {
    const car = await getCarsRef(carMark, carNumber);
    leaseRider = car?.lease_rider ? String(car.lease_rider) : null;
  }

  const { rows: byCar } = await q<BilledPartyMapping>(
    `SELECT * FROM repair.billed_party_mappings
     WHERE tenant_id = $1 AND deleted_at IS NULL AND active
       AND party_role = $2
       AND upper(car_mark) = $3 AND car_number = $4
     ORDER BY updated_at DESC
     LIMIT 1`,
    [tenantId, opts.partyRole, carMark, carNumber],
  );
  if (byCar[0]) {
    return {
      ok: true,
      resolved: {
        mark: normalizeMark(byCar[0].billed_party_mark),
        partyRole: opts.partyRole,
        paymentTermsDays: byCar[0].payment_terms_days,
        mappingId: byCar[0].id,
        matchedBy: "car",
        leaseRider,
      },
    };
  }

  if (leaseRider) {
    const { rows: byLease } = await q<BilledPartyMapping>(
      `SELECT * FROM repair.billed_party_mappings
       WHERE tenant_id = $1 AND deleted_at IS NULL AND active
         AND party_role = $2
         AND lease_rider = $3
       ORDER BY updated_at DESC
       LIMIT 1`,
      [tenantId, opts.partyRole, leaseRider],
    );
    if (byLease[0]) {
      return {
        ok: true,
        resolved: {
          mark: normalizeMark(byLease[0].billed_party_mark),
          partyRole: opts.partyRole,
          paymentTermsDays: byLease[0].payment_terms_days,
          mappingId: byLease[0].id,
          matchedBy: "lease_rider",
          leaseRider,
        },
      };
    }
  }

  return {
    ok: false,
    missing: {
      carMark,
      carNumber,
      leaseRider,
      partyRole: opts.partyRole,
      reason: leaseRider
        ? `No active ${opts.partyRole} billed-party mapping for car ${carMark} ${carNumber} or lease ${leaseRider}`
        : `No active ${opts.partyRole} billed-party mapping for car ${carMark} ${carNumber} (no lease_rider on cars_ref)`,
    },
  };
}

/** Party role for a responsibility code (RESIDCO): 6=lessee, 3=railroad/defect. */
export function partyRoleForRespCode(respCode: string): PartyRole | null {
  const c = String(respCode ?? "").trim();
  if (c === "6") return "LESSEE";
  if (c === "3") return "RAILROAD";
  return null;
}
