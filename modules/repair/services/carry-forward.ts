/**
 * Carry forward responsibility across revisions — fingerprint match.
 * Never auto-commits; returns green/amber/blue/removed for UI apply.
 */
import { DEFAULT_TENANT_ID } from "../db";
import { getContentLinesForEstimate } from "./estimate-review";
import { getRevisionLines, listRevisions } from "./estimates";
import { writeAudit } from "./audit";

export type CarryMatchStatus = "UNCHANGED" | "CHANGED" | "NEW" | "REMOVED";

export type CarryForwardItem = {
  status: CarryMatchStatus;
  fingerprint: string;
  prior?: {
    lineId: string;
    lineNo: number;
    displayLineNo: string;
    respCode: string | null;
    laborCents: number;
    materialCents: number;
    jobCode: string | null;
    qualifier: string | null;
    splitLabel?: string | null;
    splitGroupId?: string | null;
  };
  current?: {
    lineId: string;
    lineNo: number;
    displayLineNo: string;
    respCode: string | null;
    laborCents: number;
    materialCents: number;
    jobCode: string | null;
    qualifier: string | null;
  };
  /** Hover diff fields when CHANGED */
  diff?: Record<string, { from: unknown; to: unknown }>;
  suggestedResp?: string | null;
  suggestedSplits?: Array<{
    percent?: number;
    fixedCents?: number;
    respCode: string;
    splitLabel?: string;
  }>;
};

function centsOf(line: Record<string, unknown>, kind: "labor" | "material"): number {
  const cKey = kind === "labor" ? "labor_cents" : "material_cents";
  if (line[cKey] != null && Number.isFinite(Number(line[cKey]))) {
    return Math.trunc(Number(line[cKey]));
  }
  const d = Number(line[kind] ?? 0);
  return Math.round(d * 100);
}

/** Stable fingerprint for matching lines across revisions. */
export function lineFingerprint(line: Record<string, unknown>): string {
  const parts = [
    String(line.aar_job_code ?? "").trim(),
    String(line.qualifier ?? "").trim(),
    String(line.why_made ?? "").trim(),
    String(line.condition_code ?? "").trim(),
    String(line.location_on_car ?? "").trim(),
    String(line.quantity ?? "").trim(),
    String(line.removed_job_code ?? "").trim(),
    String(line.removed_qualifier ?? "").trim(),
    String(line.description ?? "").trim().toUpperCase(),
    String(line.aar_component_id ?? "").trim(),
  ];
  return parts.join("|");
}

function displayNo(line: Record<string, unknown>): string {
  if (line.display_line_no) return String(line.display_line_no);
  if (line.split_label) return String(line.split_label);
  return String(line.line_no ?? "");
}

function summarize(line: Record<string, unknown>) {
  return {
    lineId: String(line.id),
    lineNo: Number(line.line_no),
    displayLineNo: displayNo(line),
    respCode: line.resp_code != null ? String(line.resp_code) : null,
    laborCents: centsOf(line, "labor"),
    materialCents: centsOf(line, "material"),
    jobCode: line.aar_job_code != null ? String(line.aar_job_code) : null,
    qualifier: line.qualifier != null ? String(line.qualifier) : null,
    splitLabel: line.split_label != null ? String(line.split_label) : null,
    splitGroupId: line.split_group_id != null ? String(line.split_group_id) : null,
  };
}

function buildDiff(
  prior: ReturnType<typeof summarize>,
  current: ReturnType<typeof summarize>,
): Record<string, { from: unknown; to: unknown }> {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of [
    "respCode",
    "laborCents",
    "materialCents",
    "jobCode",
    "qualifier",
  ] as const) {
    if (prior[key] !== current[key]) {
      diff[key] = { from: prior[key], to: current[key] };
    }
  }
  return diff;
}

export async function previewCarryForward(opts: {
  estimateId: string;
  /** Prior revision number to restore from; default = immediate previous content rev */
  fromRevNo?: number;
  tenantId?: string;
}): Promise<{
  ok: true;
  fromRevNo: number;
  toRevNo: number;
  items: CarryForwardItem[];
  counts: { unchanged: number; changed: number; neu: number; removed: number };
}> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const revs = await listRevisions(opts.estimateId, tenantId);
  if (revs.length < 1) {
    return {
      ok: true,
      fromRevNo: 0,
      toRevNo: 0,
      items: [],
      counts: { unchanged: 0, changed: 0, neu: 0, removed: 0 },
    };
  }

  const current = await getContentLinesForEstimate(opts.estimateId, tenantId);
  const toRevNo = Number(current.revision.rev_no ?? revs[revs.length - 1]?.rev_no ?? 0);

  // Find prior content revision
  let priorRev = null as Record<string, unknown> | null;
  let priorLines: Record<string, unknown>[] = [];
  for (let i = revs.length - 1; i >= 0; i--) {
    const r = revs[i] as Record<string, unknown>;
    const rn = Number(r.rev_no);
    if (opts.fromRevNo != null) {
      if (rn !== opts.fromRevNo) continue;
    } else if (rn >= toRevNo) {
      continue;
    }
    const lines = await getRevisionLines(String(r.id));
    if (lines.length) {
      priorRev = r;
      priorLines = lines as Record<string, unknown>[];
      break;
    }
  }

  const fromRevNo = priorRev ? Number(priorRev.rev_no) : 0;
  const priorByFp = new Map<string, Record<string, unknown>[]>();
  for (const line of priorLines) {
    const fp = lineFingerprint(line);
    const arr = priorByFp.get(fp) ?? [];
    arr.push(line);
    priorByFp.set(fp, arr);
  }

  const usedPrior = new Set<string>();
  const items: CarryForwardItem[] = [];

  for (const line of current.lines) {
    const fp = lineFingerprint(line);
    const pool = priorByFp.get(fp) ?? [];
    const prior = pool.find((p) => !usedPrior.has(String(p.id)));
    const curSum = summarize(line);
    if (!prior) {
      items.push({
        status: "NEW",
        fingerprint: fp,
        current: curSum,
        suggestedResp: null,
      });
      continue;
    }
    usedPrior.add(String(prior.id));
    const priorSum = summarize(prior);
    const sameResp = priorSum.respCode === curSum.respCode;
    const sameMoney =
      priorSum.laborCents === curSum.laborCents &&
      priorSum.materialCents === curSum.materialCents;
    if (sameResp && sameMoney) {
      items.push({
        status: "UNCHANGED",
        fingerprint: fp,
        prior: priorSum,
        current: curSum,
        suggestedResp: priorSum.respCode,
      });
    } else {
      items.push({
        status: "CHANGED",
        fingerprint: fp,
        prior: priorSum,
        current: curSum,
        diff: buildDiff(priorSum, curSum),
        suggestedResp: priorSum.respCode,
      });
    }
  }

  for (const line of priorLines) {
    if (usedPrior.has(String(line.id))) continue;
    items.push({
      status: "REMOVED",
      fingerprint: lineFingerprint(line),
      prior: summarize(line),
    });
  }

  const counts = {
    unchanged: items.filter((i) => i.status === "UNCHANGED").length,
    changed: items.filter((i) => i.status === "CHANGED").length,
    neu: items.filter((i) => i.status === "NEW").length,
    removed: items.filter((i) => i.status === "REMOVED").length,
  };

  return { ok: true, fromRevNo, toRevNo, items, counts };
}

/**
 * Build lineUpdates (+ optional split hints) from a carry-forward preview.
 * Does NOT commit — caller passes to submitResponsibilityUpdates.
 */
export function applyCarryForwardSelections(opts: {
  items: CarryForwardItem[];
  /** Which statuses to apply; default UNCHANGED + CHANGED (prior resp) */
  applyStatuses?: CarryMatchStatus[];
}): {
  lineUpdates: Array<{ lineId: string; respCode: string }>;
  applied: number;
} {
  const want = new Set(
    opts.applyStatuses ?? (["UNCHANGED", "CHANGED"] as CarryMatchStatus[]),
  );
  const lineUpdates: Array<{ lineId: string; respCode: string }> = [];
  for (const item of opts.items) {
    if (!want.has(item.status)) continue;
    if (!item.current?.lineId) continue;
    const resp = item.suggestedResp ?? item.prior?.respCode;
    if (resp == null || resp === "") continue;
    lineUpdates.push({ lineId: item.current.lineId, respCode: resp });
  }
  return { lineUpdates, applied: lineUpdates.length };
}

export async function auditCarryForwardPreview(opts: {
  estimateId: string;
  actor: string;
  preview: Awaited<ReturnType<typeof previewCarryForward>>;
  applied?: number;
  tenantId?: string;
}) {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  await writeAudit({
    tenantId,
    entity: "estimate",
    entityId: opts.estimateId,
    action: "CARRY_FORWARD_PREVIEW",
    after: {
      fromRevNo: opts.preview.fromRevNo,
      toRevNo: opts.preview.toRevNo,
      counts: opts.preview.counts,
      applied: opts.applied ?? 0,
      neverAutoCommit: true,
    },
    actor: opts.actor,
    via: "UI",
  });
}
