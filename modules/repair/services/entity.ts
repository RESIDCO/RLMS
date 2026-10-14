/**
 * Owner entity tags (MAIN / COAL / RPS for RESIDCO).
 * Snapshot onto BO/estimate at create; carry to invoice / lines / CRIP / rebill.
 * Admin may correct with reason + append-only audit.
 */
import { DEFAULT_TENANT_ID, q } from "../db";
import { writeAudit } from "./audit";

export type OwnerEntityTag = {
  id: string;
  code: string;
  display_name: string;
  source_value: string | null;
  sort_order: number;
  active: boolean;
};

export type EntitySnapshot = {
  code: string | null;
  sourceValue: string | null;
  /** True when current railcars.entity maps to a different tag than the snapshot */
  currentDiffers: boolean;
  currentCode: string | null;
  currentSourceValue: string | null;
};

/** Zero-pad numeric car number for matching (e.g. 528313 → 528313, 313 → 000313). */
export function zeroPadCarNumber(carNumber: string, width = 6): string {
  const digits = String(carNumber ?? "").replace(/\D/g, "");
  if (!digits) return String(carNumber ?? "").trim();
  return digits.padStart(width, "0");
}

function mapSourceToCode(
  source: string | null | undefined,
  tags: OwnerEntityTag[],
): string | null {
  if (!source) return null;
  const s = source.trim();
  const bySource = tags.find(
    (t) =>
      t.active &&
      t.source_value &&
      t.source_value.toLowerCase() === s.toLowerCase(),
  );
  if (bySource) return bySource.code;
  const byCode = tags.find(
    (t) => t.active && t.code.toLowerCase() === s.toLowerCase(),
  );
  if (byCode) return byCode.code;
  // Built-in aliases when tags not yet seeded
  const lower = s.toLowerCase();
  if (lower === "main") return "MAIN";
  if (lower === "coal") return "COAL";
  if (lower === "rail partners select" || lower === "rps") return "RPS";
  return s.toUpperCase().slice(0, 16) || null;
}

export async function listOwnerEntityTags(
  tenantId = DEFAULT_TENANT_ID,
  opts?: { includeInactive?: boolean },
): Promise<OwnerEntityTag[]> {
  const { rows } = await q(
    `SELECT id, code, display_name, source_value, sort_order, active
     FROM repair.owner_entity_tags
     WHERE tenant_id = $1 AND deleted_at IS NULL
       AND ($2::boolean = true OR active = true)
     ORDER BY sort_order, code`,
    [tenantId, opts?.includeInactive ?? false],
  );
  return rows.map((r) => ({
    id: String(r.id),
    code: String(r.code),
    display_name: String(r.display_name),
    source_value: r.source_value != null ? String(r.source_value) : null,
    sort_order: Number(r.sort_order),
    active: Boolean(r.active),
  }));
}

/**
 * Resolve entity tag from railcars.entity via cars_ref, matching
 * car_initial + zero-padded car_number. Demo/local mode uses stub column.
 */
export async function lookupCarEntity(opts: {
  carMark: string;
  carNumber: string;
  tenantId?: string;
}): Promise<{
  code: string | null;
  sourceValue: string | null;
  rlmsRailcarId: number | null;
}> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const mark = opts.carMark.trim().toUpperCase();
  const padded = zeroPadCarNumber(opts.carNumber);
  const raw = opts.carNumber.trim();

  const { rows } = await q(
    `SELECT rlms_railcar_id, entity_source, car_number, car_mark
     FROM repair.cars_ref
     WHERE upper(car_mark) = $1
       AND (
         car_number = $2
         OR lpad(regexp_replace(COALESCE(car_number, ''), '[^0-9]', '', 'g'), 6, '0') = $3
         OR regexp_replace(COALESCE(car_number, ''), '^0+', '') = regexp_replace($2, '^0+', '')
       )
     ORDER BY
       CASE WHEN car_number = $2 THEN 0
            WHEN lpad(regexp_replace(COALESCE(car_number, ''), '[^0-9]', '', 'g'), 6, '0') = $3 THEN 1
            ELSE 2 END
     LIMIT 1`,
    [mark, raw, padded],
  );

  const tags = await listOwnerEntityTags(tenantId);
  const source =
    rows[0]?.entity_source != null ? String(rows[0].entity_source) : null;
  return {
    code: mapSourceToCode(source, tags),
    sourceValue: source,
    rlmsRailcarId:
      rows[0]?.rlms_railcar_id != null ? Number(rows[0].rlms_railcar_id) : null,
  };
}

/** Snapshot current car entity for BO / estimate create. */
export async function resolveEntitySnapshot(opts: {
  carMark: string;
  carNumber: string;
  tenantId?: string;
}): Promise<{ code: string | null; sourceValue: string | null }> {
  const hit = await lookupCarEntity(opts);
  return { code: hit.code, sourceValue: hit.sourceValue };
}

export async function getEventEntitySnapshot(
  eventId: string,
  tenantId = DEFAULT_TENANT_ID,
): Promise<EntitySnapshot | null> {
  const { rows } = await q(
    `SELECT entity_code, entity_source_value, car_mark, car_number
     FROM repair.events
     WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [eventId, tenantId],
  );
  if (!rows[0]) return null;
  const current = await lookupCarEntity({
    carMark: String(rows[0].car_mark),
    carNumber: String(rows[0].car_number),
    tenantId,
  });
  const snapCode =
    rows[0].entity_code != null ? String(rows[0].entity_code) : null;
  return {
    code: snapCode,
    sourceValue:
      rows[0].entity_source_value != null
        ? String(rows[0].entity_source_value)
        : null,
    currentDiffers: Boolean(
      snapCode && current.code && snapCode !== current.code,
    ),
    currentCode: current.code,
    currentSourceValue: current.sourceValue,
  };
}

export async function correctEventEntity(opts: {
  eventId: string;
  newCode: string;
  reason: string;
  actor: string;
  tenantId?: string;
  estimateId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const reason = opts.reason.trim();
  const newCode = opts.newCode.trim().toUpperCase();
  if (!reason) {
    return { ok: false as const, status: 400, error: "Correction reason required" };
  }
  if (!newCode) {
    return { ok: false as const, status: 400, error: "Entity code required" };
  }

  const tags = await listOwnerEntityTags(tenantId, { includeInactive: true });
  const tag = tags.find((t) => t.code === newCode);
  if (!tag || !tag.active) {
    return {
      ok: false as const,
      status: 400,
      error: `Unknown or inactive entity tag: ${newCode}`,
    };
  }

  const { rows: ev } = await q(
    `SELECT id, entity_code FROM repair.events
     WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [opts.eventId, tenantId],
  );
  if (!ev[0]) return { ok: false as const, status: 404, error: "Event not found" };
  const oldCode =
    ev[0].entity_code != null ? String(ev[0].entity_code) : null;

  await q(
    `UPDATE repair.events
     SET entity_code = $1,
         entity_source_value = $2,
         entity_corrected_at = now(),
         entity_corrected_by = $3,
         entity_correction_reason = $4
     WHERE id = $5 AND tenant_id = $6`,
    [newCode, tag.source_value, opts.actor, reason, opts.eventId, tenantId],
  );

  await q(
    `UPDATE repair.estimates
     SET entity_code = $1, entity_source_value = $2
     WHERE event_id = $3 AND tenant_id = $4 AND deleted_at IS NULL`,
    [newCode, tag.source_value, opts.eventId, tenantId],
  );

  await q(
    `UPDATE repair.invoices
     SET entity_code = $1
     WHERE event_id = $2 AND tenant_id = $3 AND deleted_at IS NULL`,
    [newCode, opts.eventId, tenantId],
  );

  await q(
    `UPDATE repair.estimate_lines el
     SET entity_code = $1
     FROM repair.estimate_revisions r
     JOIN repair.estimates e ON e.id = r.estimate_id
     WHERE el.revision_id = r.id AND e.event_id = $2 AND e.tenant_id = $3`,
    [newCode, opts.eventId, tenantId],
  ).catch(() => undefined);

  const { rows: corr } = await q(
    `INSERT INTO repair.entity_corrections
       (tenant_id, event_id, estimate_id, old_code, new_code, reason, actor, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
     RETURNING *`,
    [
      tenantId,
      opts.eventId,
      opts.estimateId ?? null,
      oldCode,
      newCode,
      reason,
      opts.actor,
    ],
  );

  await writeAudit({
    tenantId,
    entity: "event",
    entityId: opts.eventId,
    action: "ENTITY_CORRECTED",
    before: { entity_code: oldCode },
    after: { entity_code: newCode, reason },
    actor: opts.actor,
    via: "UI",
  });

  return { ok: true as const, correction: corr[0], oldCode, newCode };
}

export async function workspaceTitle(
  tenantId = DEFAULT_TENANT_ID,
): Promise<string> {
  const { rows } = await q(`SELECT settings FROM repair.tenants WHERE id = $1`, [
    tenantId,
  ]);
  const settings = (rows[0]?.settings as Record<string, unknown>) ?? {};
  const title = String(settings.workspaceTitle ?? "RESIDCO").trim();
  return title || "RESIDCO";
}

/** Aggregate cents by entity_code (null → UNASSIGNED). */
export function subtotalByEntity(
  rows: Array<{ entity_code?: string | null; cents: number }>,
): Array<{ entityCode: string; totalCents: number }> {
  const map = new Map<string, number>();
  for (const r of rows) {
    const key = (r.entity_code || "UNASSIGNED").toUpperCase();
    map.set(key, (map.get(key) ?? 0) + r.cents);
  }
  return [...map.entries()]
    .map(([entityCode, totalCents]) => ({ entityCode, totalCents }))
    .sort((a, b) => a.entityCode.localeCompare(b.entityCode));
}
