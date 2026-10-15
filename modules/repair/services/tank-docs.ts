/**
 * Tank car document gate — per-tenant (RESIDCO default OFF, MG3).
 * Optional per-car-type override via settings.tankCarDocGateByCarType.
 * Shop marks complete → owner verifies/rejects.
 * Outbound blocked until verified. Pending queue for owner.
 */
import { DEFAULT_TENANT_ID, q } from "../db";
import { writeAudit } from "./audit";
import { resolveActiveLink } from "./event-links";
import { notify } from "./notifications";

async function gateEnabled(tenantId: string, eventId?: string): Promise<boolean> {
  const { rows } = await q(
    `SELECT settings FROM repair.tenants WHERE id = $1`,
    [tenantId],
  );
  const settings = (rows[0]?.settings ?? {}) as Record<string, unknown>;
  // MG3: RESIDCO default is OFF; missing key → false (was previously default-on)
  const tenantOn = settings.tankCarDocGateEnabled === true;
  if (!tenantOn) return false;

  // Optional per-car-type override (future clients); if map has entries, require match
  const byType = settings.tankCarDocGateByCarType as Record<string, boolean> | undefined;
  if (byType && eventId && Object.keys(byType).length > 0) {
    const { rows: ev } = await q(
      `SELECT car_type, is_tank_car FROM repair.events WHERE id = $1`,
      [eventId],
    );
    const carType = String(ev[0]?.car_type ?? (ev[0]?.is_tank_car ? "TANK" : "")).toUpperCase();
    if (carType && byType[carType] === false) return false;
    if (carType && byType[carType] === true) return true;
    // If map present but no match, fall through to tenant flag (already true)
  }
  return true;
}

/** Manual_Gap #11: gate applies to tank cars only (is_tank_car on event). */
async function eventIsTankCar(eventId: string): Promise<boolean> {
  const { rows } = await q(
    `SELECT is_tank_car FROM repair.events WHERE id = $1`,
    [eventId],
  );
  return Boolean(rows[0]?.is_tank_car);
}

export async function setTankCarDocGate(opts: {
  tenantId?: string;
  enabled: boolean;
  actor: string;
  /** Optional per car-type map, e.g. { TANK: true, BOX: false } */
  byCarType?: Record<string, boolean>;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const patch: Record<string, unknown> = {
    tankCarDocGateEnabled: opts.enabled,
  };
  if (opts.byCarType) {
    patch.tankCarDocGateByCarType = opts.byCarType;
  }
  await q(
    `UPDATE repair.tenants
     SET settings = COALESCE(settings, '{}'::jsonb) || $2::jsonb
     WHERE id = $1`,
    [tenantId, JSON.stringify(patch)],
  );
  await writeAudit({
    tenantId,
    entity: "tenant",
    entityId: tenantId,
    action: "TANK_DOC_GATE_SETTING",
    after: { enabled: opts.enabled, byCarType: opts.byCarType ?? null },
    actor: opts.actor,
    via: "UI",
  });
  return { ok: true as const, enabled: opts.enabled, byCarType: opts.byCarType ?? null };
}

export async function getTankCarDocGate(tenantId = DEFAULT_TENANT_ID) {
  const { rows } = await q(`SELECT settings FROM repair.tenants WHERE id = $1`, [tenantId]);
  const settings = (rows[0]?.settings ?? {}) as Record<string, unknown>;
  return {
    enabled: settings.tankCarDocGateEnabled === true,
    byCarType: (settings.tankCarDocGateByCarType as Record<string, boolean>) ?? {},
  };
}

export async function ensureTankPacket(opts: {
  eventId: string;
  estimateId?: string;
  tenantId?: string;
  actor: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  if (!(await gateEnabled(tenantId, opts.eventId))) {
    return { ok: true as const, skipped: true as const, reason: "gate_disabled" };
  }
  if (!(await eventIsTankCar(opts.eventId))) {
    return { ok: true as const, skipped: true as const, reason: "not_tank_car" };
  }
  const { rows } = await q(
    `INSERT INTO repair.tank_doc_packets
       (tenant_id, event_id, estimate_id, status, created_by)
     VALUES ($1,$2,$3,'PENDING_SHOP',$4)
     ON CONFLICT (event_id) DO UPDATE
       SET estimate_id = COALESCE(EXCLUDED.estimate_id, repair.tank_doc_packets.estimate_id)
     RETURNING *`,
    [tenantId, opts.eventId, opts.estimateId ?? null, opts.actor],
  );
  return { ok: true as const, packet: rows[0], skipped: false as const };
}

export async function shopMarkTankDocsComplete(opts: {
  rawToken?: string;
  eventId?: string;
  documentIds?: string[];
  actor: string;
  tenantId?: string;
}) {
  let eventId = opts.eventId;
  let tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  if (opts.rawToken) {
    const resolved = await resolveActiveLink(opts.rawToken, "SHOP");
    if (!resolved) return { ok: false as const, status: 401, error: "Invalid or revoked link" };
    eventId = String(resolved.event.id);
    tenantId = String(resolved.event.tenant_id ?? DEFAULT_TENANT_ID);
  }
  if (!eventId) return { ok: false as const, status: 400, error: "eventId required" };
  if (!(await gateEnabled(tenantId, eventId))) {
    return { ok: true as const, skipped: true as const, reason: "gate_disabled" };
  }
  if (!(await eventIsTankCar(eventId))) {
    return { ok: true as const, skipped: true as const, reason: "not_tank_car" };
  }

  const ensured = await ensureTankPacket({ eventId, tenantId, actor: opts.actor });
  if (!ensured.ok || ensured.skipped || !("packet" in ensured)) {
    return {
      ok: false as const,
      status: 500,
      error: "Could not ensure tank packet",
    };
  }
  const packet = ensured.packet;

  for (const docId of opts.documentIds ?? []) {
    await q(
      `INSERT INTO repair.tank_doc_packet_files
         (tenant_id, packet_id, document_id, doc_type, created_by)
       VALUES ($1,$2,$3,'tank_required',$4)
       ON CONFLICT (packet_id, document_id) DO NOTHING`,
      [tenantId, packet.id, docId, opts.actor],
    );
  }

  const { rows } = await q(
    `UPDATE repair.tank_doc_packets
     SET status = 'PENDING_OWNER',
         shop_completed_at = now(),
         shop_completed_by = $1
     WHERE id = $2
     RETURNING *`,
    [opts.actor, packet.id],
  );
  await q(
    `INSERT INTO repair.tank_doc_decisions
       (tenant_id, packet_id, action, actor, created_by)
     VALUES ($1,$2,'SHOP_COMPLETE',$3,$3)`,
    [tenantId, packet.id, opts.actor],
  );
  await notify({
    tenantId,
    eventId,
    type: "TANK_DOC_PENDING_OWNER",
    bodyText: `Tank car documents marked complete by shop (${opts.actor}); owner verification required.`,
    actor: opts.actor,
  }).catch(() => undefined);

  await writeAudit({
    tenantId,
    entity: "tank_doc_packet",
    entityId: packet.id,
    action: "TANK_DOC_SHOP_COMPLETE",
    after: { status: "PENDING_OWNER" },
    actor: opts.actor,
    via: opts.rawToken ? "event_link" : "UI",
  });

  return { ok: true as const, packet: rows[0] };
}

export async function ownerDecideTankDocs(opts: {
  packetId: string;
  decision: "VERIFY" | "REJECT";
  actor: string;
  reason?: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  if (opts.decision === "REJECT" && !(opts.reason ?? "").trim()) {
    return { ok: false as const, status: 400, error: "Reject reason required" };
  }
  const status = opts.decision === "VERIFY" ? "VERIFIED" : "REJECTED";
  // Owner may verify first (PENDING_SHOP) or after shop complete (PENDING_OWNER)
  const { rows } = await q(
    `UPDATE repair.tank_doc_packets
     SET status = $1,
         owner_decided_at = now(),
         owner_decided_by = $2,
         owner_decision = $3,
         owner_reason = $4
     WHERE id = $5 AND tenant_id = $6
       AND status IN ('PENDING_OWNER', 'PENDING_SHOP')
       AND deleted_at IS NULL
     RETURNING *`,
    [status, opts.actor, opts.decision, opts.reason ?? null, opts.packetId, tenantId],
  );
  if (!rows[0]) {
    return { ok: false as const, status: 409, error: "Packet not pending owner/shop" };
  }
  await q(
    `INSERT INTO repair.tank_doc_decisions
       (tenant_id, packet_id, action, actor, reason, created_by)
     VALUES ($1,$2,$3,$4,$5,$4)`,
    [tenantId, opts.packetId, opts.decision, opts.actor, opts.reason ?? null],
  );
  await writeAudit({
    tenantId,
    entity: "tank_doc_packet",
    entityId: opts.packetId,
    action: `TANK_DOC_OWNER_${opts.decision}`,
    after: { status, reason: opts.reason ?? null },
    actor: opts.actor,
    via: "UI",
  });
  return { ok: true as const, packet: rows[0] };
}

export async function listTankDocPendingQueue(tenantId = DEFAULT_TENANT_ID) {
  const { rows } = await q(
    `SELECT p.*, e.car_mark, e.car_number, e.shop_id
     FROM repair.tank_doc_packets p
     JOIN repair.events e ON e.id = p.event_id
     WHERE p.tenant_id = $1 AND p.status = 'PENDING_OWNER' AND p.deleted_at IS NULL
     ORDER BY p.shop_completed_at ASC NULLS LAST`,
    [tenantId],
  );
  return rows;
}

/** Block outbound (actual outbound date) until tank docs verified when gate on. */
export async function assertOutboundAllowed(opts: {
  eventId: string;
  tenantId?: string;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  if (!(await gateEnabled(tenantId, opts.eventId))) return { ok: true };
  // Manual_Gap #11: only tank cars
  if (!(await eventIsTankCar(opts.eventId))) return { ok: true };
  const { rows } = await q(
    `SELECT status FROM repair.tank_doc_packets
     WHERE event_id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [opts.eventId, tenantId],
  );
  if (!rows[0]) {
    return {
      ok: false,
      status: 409,
      error: "Tank car document gate: packet not verified (outbound blocked)",
    };
  }
  if (rows[0].status !== "VERIFIED") {
    return {
      ok: false,
      status: 409,
      error: `Tank car document gate: status ${rows[0].status} (outbound blocked until VERIFIED)`,
    };
  }
  return { ok: true };
}

/** Owner may verify first (before shop marks complete) — Manual_Gap #11 */
export async function ownerVerifyTankDocsFirst(opts: {
  eventId: string;
  actor: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  if (!(await gateEnabled(tenantId, opts.eventId))) {
    return { ok: true as const, skipped: true as const };
  }
  if (!(await eventIsTankCar(opts.eventId))) {
    return { ok: true as const, skipped: true as const, reason: "not_tank_car" };
  }
  const ensured = await ensureTankPacket({
    eventId: opts.eventId,
    tenantId,
    actor: opts.actor,
  });
  if (!ensured.ok || ensured.skipped || !("packet" in ensured)) {
    return { ok: false as const, status: 500, error: "Could not ensure packet" };
  }
  return ownerDecideTankDocs({
    packetId: String(ensured.packet.id),
    decision: "VERIFY",
    actor: opts.actor,
    tenantId,
  });
}
