/**
 * Owner Estimate Review (§D) — enrich review payload, parse line display
 * fields from raw 500-byte, compare any two revisions, billing category.
 */
import { DEFAULT_TENANT_ID, q } from "../db";
import { listResponsibilityCodes } from "./categories";
import { compareRevisions, listComments } from "./comments";
import { listRevisions, getRevisionLines } from "./estimates";

/** Latest revision may be status-only (Submit/Approve); content lines live on prior rev. */
export async function getContentLinesForEstimate(
  estimateId: string,
  tenantId = DEFAULT_TENANT_ID,
): Promise<{ revision: Record<string, unknown>; lines: Record<string, unknown>[] }> {
  const revs = await listRevisions(estimateId, tenantId);
  for (let i = revs.length - 1; i >= 0; i--) {
    const lines = await getRevisionLines(String(revs[i].id));
    if (lines.length) {
      return {
        revision: revs[i] as Record<string, unknown>,
        lines: lines as Record<string, unknown>[],
      };
    }
  }
  const latest = revs[revs.length - 1];
  return {
    revision: (latest ?? {}) as Record<string, unknown>,
    lines: [],
  };
}
import {
  centsToDollars,
  dollarsToCents,
  formatCentsAsDollars,
  formatCentsAsMoney,
  formatCentsWithCommas,
  formatMoneyParts,
  lineLaborCents,
  lineMaterialCents,
  lineTotalCents,
  sumLineMoney,
} from "./money";
import { listEventDocuments } from "./ops-grid";
import { formatShopLabel } from "./shops";
import { DATA_FILE_HEADER_FIELDS, listHeaderEdits } from "./header-edits";
import { getCorrectionEditorPayload } from "./gap-lifecycle-06";
import { writeAudit } from "./audit";
import {
  collapseUnsplit,
  expandLinesWithSplits,
  lineFingerprintLite,
  previewTaxProrate,
  type SplitSpec,
} from "./responsibility-split";
import { validateComponentIds } from "./component-id-rules";

/** Owner-settable codes on Update Responsibilities (shot 05). */
export const OWNER_RESP_CODES = ["1", "2", "4", "5", "6", "7", "8", "9"] as const;

/** 1-based App. G Format-1 slices used for grid display columns. */
const RAW_SLICES: Record<string, { start: number; length: number }> = {
  location_on_car: { start: 109, length: 2 },
  quantity: { start: 113, length: 4 },
  removed_job_code: { start: 131, length: 4 },
  removed_qualifier: { start: 135, length: 3 },
  description: { start: 167, length: 50 },
  machine_priceable: { start: 165, length: 1 },
  aar_component_id: { start: 327, length: 14 },
};

function sliceRaw(
  raw: string | null | undefined,
  start: number,
  length: number,
): string {
  if (!raw) return "";
  const s = String(raw);
  if (s.length < start) return "";
  return s.slice(start - 1, start - 1 + length).trim();
}

export type EnrichedLine = Record<string, unknown> & {
  id: string;
  line_no: number;
  location_on_car: string | null;
  quantity: string | null;
  removed_job_code: string | null;
  removed_qualifier: string | null;
  description: string | null;
  machine_priceable: string | null;
  aar_component_id: string | null;
  labor_cents: number;
  material_cents: number;
  total_cents: number;
  labor_display: string;
  material_display: string;
  amount_display: string;
  labor_money: string;
  material_money: string;
  amount_money: string;
  labor_cents_label: string;
  material_cents_label: string;
  amount_cents_label: string;
  display_line_no: string;
  component_id_flag: boolean;
  has_comment: boolean;
};

export function enrichLineFromRaw(
  line: Record<string, unknown>,
  commentLineIds?: Set<string>,
  componentIdFlagged?: Set<number>,
): EnrichedLine {
  const raw = line.raw_line != null ? String(line.raw_line) : null;
  const pick = (col: keyof typeof RAW_SLICES, stored?: unknown) => {
    const fromDb = stored != null && String(stored).trim() ? String(stored).trim() : "";
    if (fromDb) return fromDb;
    const spec = RAW_SLICES[col];
    return sliceRaw(raw, spec.start, spec.length) || null;
  };
  const laborCents = lineLaborCents({
    labor: line.labor as number | string | null,
    laborCents:
      line.labor_cents != null ? Number(line.labor_cents) : (line.laborCents as number | null),
  });
  const materialCents = lineMaterialCents({
    material: line.material as number | string | null,
    materialCents:
      line.material_cents != null
        ? Number(line.material_cents)
        : (line.materialCents as number | null),
  });
  const totalCents = laborCents + materialCents;
  const id = String(line.id ?? "");
  const lineNo = Number(line.line_no);
  const laborParts = formatMoneyParts(laborCents);
  const matParts = formatMoneyParts(materialCents);
  const amtParts = formatMoneyParts(totalCents);
  const displayLineNo =
    line.display_line_no != null
      ? String(line.display_line_no)
      : line.split_label != null
        ? String(line.split_label)
        : String(lineNo);
  return {
    ...line,
    id,
    line_no: lineNo,
    display_line_no: displayLineNo,
    location_on_car: pick("location_on_car", line.location_on_car),
    quantity: pick("quantity", line.quantity),
    removed_job_code: pick("removed_job_code", line.removed_job_code),
    removed_qualifier: pick("removed_qualifier", line.removed_qualifier),
    description: pick("description", line.description),
    machine_priceable: pick("machine_priceable", line.machine_priceable),
    aar_component_id: pick("aar_component_id", line.aar_component_id),
    labor_cents: laborCents,
    material_cents: materialCents,
    total_cents: totalCents,
    labor_display: formatCentsAsDollars(laborCents),
    material_display: formatCentsAsDollars(materialCents),
    amount_display: formatCentsAsDollars(totalCents),
    labor_money: laborParts.dollars,
    material_money: matParts.dollars,
    amount_money: amtParts.dollars,
    labor_cents_label: laborParts.centsLabel,
    material_cents_label: matParts.centsLabel,
    amount_cents_label: amtParts.centsLabel,
    component_id_flag: Boolean(componentIdFlagged?.has(lineNo)),
    has_comment: id ? Boolean(commentLineIds?.has(id)) : false,
  };
}

function fmtDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString("en-US");
}

function yymmddToDisplay(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (/^\d{6}$/.test(s)) {
    const yy = Number(s.slice(0, 2));
    const mm = s.slice(2, 4);
    const dd = s.slice(4, 6);
    const year = yy >= 70 ? 1900 + yy : 2000 + yy;
    return `${mm}/${dd}/${year}`;
  }
  if (/^\d{4}$/.test(s)) {
    // YYMM account date
    const yy = Number(s.slice(0, 2));
    const mm = s.slice(2, 4);
    const year = yy >= 70 ? 1900 + yy : 2000 + yy;
    return `${mm}/01/${year}`;
  }
  return s || null;
}

export async function getEstimateReviewContext(opts: {
  estimateId: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q(
    `SELECT e.id AS estimate_id, e.event_id, e.current_revision, e.locked,
            e.completed_at, e.created_at, e.billing_category, e.current_header,
            s.code AS status_code, s.display_name AS status_name,
            ev.car_mark, ev.car_number, ev.shop_id, ev.is_wreck, ev.is_tank_car,
            ev.yard_arrived_at, ev.target_outbound_at, ev.actual_outbound_at,
            ev.billing_road, ev.damaging_road, ev.car_type, ev.entity_code AS event_entity,
            COALESCE(e.entity_code, ev.entity_code) AS entity_code,
            sh.reporting_mark AS shop_mark, sh.name AS shop_name,
            sh.city AS shop_city, sh.state AS shop_state, sh.shop_mark AS shop_mark_code,
            sh.splc AS shop_splc,
            bo.id AS bad_order_id, bo.shopping_reason AS bad_order_reason,
            bo.lifecycle_status AS bo_lifecycle_status,
            cr.current_assignment AS assignment, cr.lessee_name,
            appr_req.action_at AS approval_requested_at,
            appr.action_at AS approved_at
     FROM repair.estimates e
     JOIN repair.statuses s ON s.id = e.status_id
     JOIN repair.events ev ON ev.id = e.event_id
     LEFT JOIN repair.shops sh ON sh.id = ev.shop_id
     LEFT JOIN LATERAL (
       SELECT id, shopping_reason, lifecycle_status FROM repair.bad_orders
       WHERE event_id = e.event_id AND deleted_at IS NULL
       ORDER BY received_at DESC LIMIT 1
     ) bo ON true
     LEFT JOIN repair.cars_ref cr
       ON upper(cr.car_mark) = upper(ev.car_mark) AND cr.car_number = ev.car_number
     LEFT JOIN LATERAL (
       SELECT action_at FROM repair.estimate_revisions
       WHERE estimate_id = e.id AND new_status = 'AWAITING_APPROVAL'
       ORDER BY rev_no ASC LIMIT 1
     ) appr_req ON true
     LEFT JOIN LATERAL (
       SELECT action_at FROM repair.estimate_revisions
       WHERE estimate_id = e.id AND new_status = 'APPROVED'
       ORDER BY rev_no DESC LIMIT 1
     ) appr ON true
     WHERE e.id = $1 AND e.tenant_id = $2 AND e.deleted_at IS NULL`,
    [opts.estimateId, tenantId],
  );
  const row = rows[0];
  if (!row) return null;

  const shopLabel = formatShopLabel({
    name: row.shop_name,
    city: row.shop_city,
    state: row.shop_state,
    reporting_mark: row.shop_mark,
    shop_mark: row.shop_mark_code,
  });

  const header = (row.current_header ?? {}) as Record<string, unknown>;
  const carInitial =
    String(header.carInitial ?? header.car_initial ?? row.car_mark ?? "").trim();
  const carNumber = String(
    header.carNumber ?? header.car_number ?? row.car_number ?? "",
  ).trim();
  const repairDate = yymmddToDisplay(
    header.repairDateYymmdd ?? header.repair_date_yymmdd ?? header.repairDate,
  );
  const docRef = String(header.documentReference ?? header.document_reference ?? "").trim();
  const estimateIdDisplay =
    docRef ||
    `${carInitial}${carNumber.padStart(6, "0")}${(
      String(header.repairDateYymmdd ?? header.repair_date_yymmdd ?? "") || ""
    ).trim()}`.trim() ||
    String(row.estimate_id).slice(0, 8);

  const splcRaw = String(header.splc ?? header.expandedSplc ?? row.shop_splc ?? "").trim();
  const assignment =
    row.assignment ||
    (row.lessee_name ? String(row.lessee_name) : null) ||
    null;

  return {
    estimateId: String(row.estimate_id),
    eventId: String(row.event_id),
    statusCode: String(row.status_code),
    statusName: String(row.status_name),
    locked: Boolean(row.locked),
    billingCategory: String(row.billing_category || "Bad Order"),
    shopDisplay: shopLabel,
    shopMark: row.shop_mark_code || row.shop_mark || null,
    carInitial,
    carNumber,
    estimateIdDisplay,
    entityCode: row.entity_code ? String(row.entity_code).toUpperCase() : null,
    splc: splcRaw || null,
    assignment,
    road: String(header.billingParty ?? row.billing_road ?? "").trim() || null,
    dcRoad: String(row.damaging_road ?? "").trim() || null,
    carType: row.car_type ? String(row.car_type) : null,
    kindOfCar: String(header.kindOfCar ?? header.kind_of_car ?? "").trim() || null,
    detailSource: String(header.detailSource ?? header.detail_source ?? "").trim() || null,
    invoiceNumber: String(header.invoiceNumber ?? header.invoice_number ?? "").trim() || null,
    createdAt: fmtDate(row.created_at),
    accountDate: yymmddToDisplay(header.accountDateYymm ?? header.account_date_yymm),
    approvalRequiredAt: fmtDate(row.approval_requested_at),
    approvedAt: fmtDate(row.approved_at),
    repairDate,
    yardArrival: fmtDate(row.yard_arrived_at),
    targetDate: fmtDate(row.target_outbound_at),
    outboundDate: fmtDate(row.actual_outbound_at ?? row.completed_at),
    badOrderId: row.bad_order_id ? String(row.bad_order_id) : null,
    badOrderReason: row.bad_order_reason ? String(row.bad_order_reason) : null,
    boLifecycleStatus: row.bo_lifecycle_status
      ? String(row.bo_lifecycle_status)
      : null,
    currentRevision: Number(row.current_revision),
    header,
  };
}

export async function buildEstimateReviewPayload(opts: {
  estimateId: string;
  tenantId?: string;
  compareFromRev?: number;
  compareToRev?: number;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const ctx = await getEstimateReviewContext({
    estimateId: opts.estimateId,
    tenantId,
  });
  if (!ctx) return { ok: false as const, status: 404, error: "Estimate not found" };

  const revisions = await listRevisions(opts.estimateId, tenantId);
  const comments = await listComments({
    estimateId: opts.estimateId,
    tenantId,
  });
  const commentLineIds = new Set(
    comments
      .filter((c) => c.line_id)
      .map((c) => String(c.line_id)),
  );

  const withLines = [];
  let lastContentLines: Record<string, unknown>[] = [];
  let componentIdErrors: Awaited<ReturnType<typeof validateComponentIds>> | null =
    null;
  for (const rev of revisions) {
    const rawLines = await getRevisionLines(String(rev.id));
    const lines = rawLines.length
      ? (rawLines as Record<string, unknown>[])
      : lastContentLines;
    if (rawLines.length) lastContentLines = rawLines as Record<string, unknown>[];
    const cidCheck = await validateComponentIds({
      lines: lines.map((l) => ({
        id: String(l.id ?? ""),
        line_no: Number(l.line_no),
        aar_job_code: l.aar_job_code as string | null,
        qualifier: l.qualifier as string | null,
        aar_component_id: l.aar_component_id as string | null,
      })),
      stage: "REVIEW",
      tenantId,
    });
    if (rawLines.length) componentIdErrors = cidCheck;
    const flagged = new Set(cidCheck.flaggedLineNos);
    const enriched = lines.map((l) =>
      enrichLineFromRaw(l, commentLineIds, flagged),
    );
    const byResp: Record<string, typeof enriched> = {};
    for (const line of enriched) {
      const key = String(line.resp_code ?? "(none)");
      (byResp[key] ??= []).push(line);
    }
    const totals = sumLineMoney(
      enriched.map((l) => ({
        laborCents: l.labor_cents,
        materialCents: l.material_cents,
      })),
    );
    withLines.push({
      revision: {
        ...rev,
        labor_cents: totals.laborCents,
        material_cents: totals.materialCents,
        total_cents: totals.totalCents,
        labor_display: formatCentsAsDollars(totals.laborCents),
        material_display: formatCentsAsDollars(totals.materialCents),
        total_display: formatCentsAsDollars(totals.totalCents),
        labor_money: formatCentsAsMoney(totals.laborCents),
        material_money: formatCentsAsMoney(totals.materialCents),
        total_money: formatCentsAsMoney(totals.totalCents),
      },
      lines: enriched,
      byResp,
      totals,
    });
  }

  let compare: Awaited<ReturnType<typeof compareRevisions>> | null = null;
  let compareMeta: {
    from: number;
    to: number;
    added: number;
    removed: number;
    changed: number;
    totalsDeltaCents: number;
  } | null = null;

  const fromRevNo =
    opts.compareFromRev ??
    (withLines.length >= 2
      ? Number(withLines[withLines.length - 2].revision.rev_no)
      : null);
  const toRevNo =
    opts.compareToRev ??
    (withLines.length >= 1
      ? Number(withLines[withLines.length - 1].revision.rev_no)
      : null);

  if (fromRevNo != null && toRevNo != null && fromRevNo !== toRevNo) {
    const left = withLines.find((b) => Number(b.revision.rev_no) === fromRevNo);
    const right = withLines.find((b) => Number(b.revision.rev_no) === toRevNo);
    if (left && right) {
      compare = await compareRevisions({
        leftRevisionId: String(left.revision.id),
        rightRevisionId: String(right.revision.id),
      });
      compareMeta = {
        from: fromRevNo,
        to: toRevNo,
        added: compare.added.length,
        removed: compare.removed.length,
        changed: compare.changed.length,
        totalsDeltaCents: right.totals.totalCents - left.totals.totalCents,
      };
    }
  }

  const editor = await getCorrectionEditorPayload({
    estimateId: opts.estimateId,
    tenantId,
  });
  const headerEdits = await listHeaderEdits({
    estimateId: opts.estimateId,
    tenantId,
  });
  const documents = await listEventDocuments({ eventId: ctx.eventId, tenantId });
  const respCodes = await listResponsibilityCodes(tenantId);
  const ownerRespCodes = respCodes.filter((c) =>
    (OWNER_RESP_CODES as readonly string[]).includes(String(c.code)),
  );

  const latest = withLines[withLines.length - 1];
  const header = ctx.header ?? {};

  return {
    ok: true as const,
    estimateId: opts.estimateId,
    context: ctx,
    revisions: withLines,
    compare: compareMeta,
    compareDetail: compare,
    header,
    headerFields: DATA_FILE_HEADER_FIELDS,
    headerEdits,
    canPencilEdit: editor.ok ? editor.canCorrect || editor.needsAdjustment : false,
    needsAdjustment: editor.ok ? editor.needsAdjustment : false,
    estimate: editor.ok ? editor.estimate : null,
    documents,
    comments,
    respCodes,
    ownerRespCodes,
    documentCount: documents.filter(
      (d) =>
        !d.deleted_at &&
        String(d.lifecycle_status ?? "ACTIVE").toUpperCase() !== "VOIDED",
    ).length,
    latestTotals: latest?.totals ?? null,
    componentIdErrors: componentIdErrors?.errors ?? [],
    componentIdFlagged: componentIdErrors?.flaggedLineNos ?? [],
  };
}

export async function setBillingCategory(opts: {
  estimateId: string;
  billingCategory: string;
  actor: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const cat = opts.billingCategory.trim() || "Bad Order";
  const { rows } = await q(
    `UPDATE repair.estimates
     SET billing_category = $1
     WHERE id = $2 AND tenant_id = $3 AND deleted_at IS NULL
     RETURNING id, billing_category`,
    [cat, opts.estimateId, tenantId],
  );
  if (!rows[0]) return { ok: false as const, status: 404, error: "Estimate not found" };
  await writeAudit({
    tenantId,
    entity: "estimate",
    entityId: opts.estimateId,
    action: "BILLING_CATEGORY_SET",
    after: { billingCategory: cat },
    actor: opts.actor,
    via: "UI",
  });
  return { ok: true as const, billingCategory: cat };
}

/** Summary totals by responsibility code (integer cents). */
export function summarizeByResp(
  lines: Array<{
    resp_code?: string | null;
    labor?: number | string | null;
    material?: number | string | null;
    labor_cents?: number | null;
    material_cents?: number | null;
    /** Pending new code override for UI recalculate */
    resp_new?: string | null;
  }>,
): Array<{
  code: string;
  totalCents: number;
  totalDisplay: string;
  totalMoney: string;
}> {
  const map = new Map<string, number>();
  for (const l of lines) {
    const code = String(l.resp_new || l.resp_code || "(none)");
    const cents =
      lineLaborCents({
        labor: l.labor,
        laborCents: l.labor_cents != null ? Number(l.labor_cents) : null,
      }) +
      lineMaterialCents({
        material: l.material,
        materialCents: l.material_cents != null ? Number(l.material_cents) : null,
      });
    map.set(code, (map.get(code) ?? 0) + cents);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, totalCents]) => ({
      code,
      totalCents,
      totalDisplay: formatCentsWithCommas(totalCents),
      totalMoney: formatCentsAsMoney(totalCents),
    }));
}

/**
 * Apply pending R(New) + optional splits → append-only revision.
 * Split by % or fixed $ → child lines (1a/1b) linked; remainder cents on owner/original.
 * Unsplit via unsplitGroupIds collapses prior split groups before approval.
 */
export async function submitResponsibilityUpdates(opts: {
  estimateId: string;
  lineUpdates: Array<{ lineId: string; respCode: string }>;
  splits?: SplitSpec[];
  unsplitGroupIds?: string[];
  responsibleParty?: string;
  actor: string;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await q(
    `SELECT e.*, s.code AS status_code FROM repair.estimates e
     JOIN repair.statuses s ON s.id = e.status_id
     WHERE e.id = $1 AND e.tenant_id = $2 AND e.deleted_at IS NULL`,
    [opts.estimateId, tenantId],
  );
  const est = rows[0];
  if (!est) return { ok: false as const, status: 404, error: "Estimate not found" };
  if (est.locked) {
    return { ok: false as const, status: 409, error: "Estimate locked" };
  }
  // Unsplit only before approval / while still Awaiting or Revision Requested / Adjustment
  const statusCode = String(est.status_code);
  if (
    opts.unsplitGroupIds?.length &&
    !["AWAITING_APPROVAL", "REVISION_REQUESTED", "ADJUSTMENT_FOR_APPROVAL", "QUEUED"].includes(
      statusCode,
    )
  ) {
    return {
      ok: false as const,
      status: 409,
      error: "Unsplit only allowed before approval",
    };
  }

  const content = await getContentLinesForEstimate(opts.estimateId, tenantId);
  let lines = content.lines;
  if (!lines.length) return { ok: false as const, status: 404, error: "No revision lines" };
  const updates = new Map(opts.lineUpdates.map((u) => [u.lineId, u.respCode]));

  const laborOf = (line: Record<string, unknown>) =>
    lineLaborCents({
      labor: line.labor as number,
      laborCents: line.labor_cents != null ? Number(line.labor_cents) : null,
    });
  const matOf = (line: Record<string, unknown>) =>
    lineMaterialCents({
      material: line.material as number,
      materialCents: line.material_cents != null ? Number(line.material_cents) : null,
    });

  // Optional unsplit first (collapse groups into working set)
  if (opts.unsplitGroupIds?.length) {
    const collapsed = collapseUnsplit(lines, opts.unsplitGroupIds, laborOf, matOf);
    lines = collapsed.map((o, idx) => ({
      ...o.src,
      id: `unsplit-${idx}`,
      line_no: idx + 1,
      resp_code: o.resp,
      labor: centsToDollars(o.laborC),
      material: centsToDollars(o.matC),
      labor_cents: o.laborC,
      material_cents: o.matC,
      parent_line_no: o.parentLineNo,
      split_label: o.splitLabel,
      split_group_id: o.splitGroupId,
      split_kind: o.splitKind,
      display_line_no: o.displayLineNo,
      source_fingerprint: o.sourceFingerprint,
      prior_resp_code: o.priorRespCode,
      is_tax_line: o.isTaxLine,
    }));
  }

  const { getStatusByCode } = await import("./status-machine");
  const { withTransaction } = await import("../db");
  const { notify } = await import("./notifications");

  const revNo = Number(est.current_revision) + 1;
  const awaitStatus = await getStatusByCode(tenantId, "ESTIMATE", "AWAITING_APPROVAL");
  if (!awaitStatus) return { ok: false as const, status: 500, error: "status missing" };

  const outgoing = expandLinesWithSplits({
    lines,
    lineUpdates: updates,
    splits: opts.splits ?? [],
    laborCentsOf: laborOf,
    materialCentsOf: matOf,
  });

  const laborCentsSum = outgoing.reduce((s, o) => s + o.laborC, 0);
  const materialCentsSum = outgoing.reduce((s, o) => s + o.matC, 0);
  const inLabor = lines.reduce((s, l) => s + laborOf(l), 0);
  const inMat = lines.reduce((s, l) => s + matOf(l), 0);
  if (laborCentsSum !== inLabor || materialCentsSum !== inMat) {
    return {
      ok: false as const,
      status: 500,
      error: `Split sum mismatch (labor ${laborCentsSum}≠${inLabor}, mat ${materialCentsSum}≠${inMat})`,
    };
  }
  const labor = centsToDollars(laborCentsSum);
  const material = centsToDollars(materialCentsSum);
  const total = centsToDollars(laborCentsSum + materialCentsSum);

  const packed = await withTransaction(async (client) => {
    const commentParts = [
      `Updated ${opts.lineUpdates.length} line(s)`,
      opts.splits?.length ? `split ${opts.splits.length}` : null,
      opts.unsplitGroupIds?.length
        ? `unsplit ${opts.unsplitGroupIds.length}`
        : null,
      opts.responsibleParty ? `party=${opts.responsibleParty}` : null,
    ].filter(Boolean);
    const rev = await client.query(
      `INSERT INTO repair.estimate_revisions
         (tenant_id, estimate_id, rev_no, action, actor_name, labor, material, total,
          new_status, old_status, comment, created_by, header)
       VALUES ($1,$2,$3,'Update Responsibility',$4,$5,$6,$7,'AWAITING_APPROVAL',$8,$9,$4,$10::jsonb)
       RETURNING *`,
      [
        tenantId,
        opts.estimateId,
        revNo,
        opts.actor,
        labor,
        material,
        total,
        est.status_code,
        commentParts.join("; "),
        JSON.stringify(est.current_header ?? content.revision.header ?? {}),
      ],
    );

    let outLineNo = 0;
    for (const o of outgoing) {
      outLineNo += 1;
      const src = o.src;
      await client.query(
        `INSERT INTO repair.estimate_lines
           (tenant_id, revision_id, line_no, aar_job_code, qualifier, why_made,
            condition_code, resp_code, labor, material, total,
            repair_category, sub_category, labor_cents, material_cents,
            aar_component_id, ddct_incident_id, raw_line, created_by,
            location_on_car, quantity, removed_job_code, removed_qualifier,
            description, machine_priceable,
            parent_line_no, split_label, split_group_id, split_kind,
            source_fingerprint, prior_resp_code, is_tax_line, display_line_no)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
                 $20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33)`,
        [
          tenantId,
          rev.rows[0].id,
          outLineNo,
          src.aar_job_code,
          src.qualifier,
          src.why_made,
          src.condition_code,
          o.resp,
          centsToDollars(o.laborC),
          centsToDollars(o.matC),
          centsToDollars(o.laborC + o.matC),
          src.repair_category,
          src.sub_category,
          o.laborC,
          o.matC,
          src.aar_component_id,
          src.ddct_incident_id,
          src.raw_line,
          opts.actor,
          src.location_on_car ?? null,
          src.quantity ?? null,
          src.removed_job_code ?? null,
          src.removed_qualifier ?? null,
          src.description ?? null,
          src.machine_priceable ?? null,
          o.parentLineNo,
          o.splitLabel,
          o.splitGroupId,
          o.splitKind,
          o.sourceFingerprint || lineFingerprintLite(src),
          o.priorRespCode,
          o.isTaxLine,
          o.displayLineNo,
        ],
      );
    }

    await client.query(
      `UPDATE repair.estimates SET current_revision=$1, status_id=$2 WHERE id=$3`,
      [revNo, awaitStatus.id, opts.estimateId],
    );
    return { revision: rev.rows[0], labor, material, total };
  });

  await notify({
    tenantId,
    eventId: String(est.event_id),
    type: "RESPONSIBILITY_UPDATED",
    bodyText: `Responsibility updated on estimate by ${opts.actor}; back to Awaiting Approval.`,
    actor: opts.actor,
  }).catch(() => undefined);

  await writeAudit({
    tenantId,
    entity: "estimate",
    entityId: opts.estimateId,
    action: "UPDATE_RESPONSIBILITY",
    after: {
      revNo,
      lineUpdates: opts.lineUpdates.length,
      splits: opts.splits?.length ?? 0,
      unsplitGroups: opts.unsplitGroupIds?.length ?? 0,
      responsibleParty: opts.responsibleParty ?? null,
      totalCents: laborCentsSum + materialCentsSum,
    },
    actor: opts.actor,
    via: "UI",
  });

  // New revision invalidates prior lessee access tokens
  const { revokeLesseeLinksForEstimate } = await import("./event-links");
  await revokeLesseeLinksForEstimate({
    estimateId: opts.estimateId,
    actor: opts.actor,
    tenantId,
  });

  return {
    ok: true as const,
    revision: packed.revision,
    total: packed.total,
    totalCents: laborCentsSum + materialCentsSum,
    totalDisplay: formatCentsAsDollars(laborCentsSum + materialCentsSum),
    totalMoney: formatCentsAsMoney(laborCentsSum + materialCentsSum),
  };
}

export { previewTaxProrate };
export { dollarsToCents, formatCentsAsDollars, formatCentsAsMoney, centsToDollars };
