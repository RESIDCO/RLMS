/**
 * VCF assignment-history close-out (Phase 1).
 *
 * Same open period = same railcar + rider_external_id + start_date.
 * A null assignment_id_ext and a later filled id are the same period.
 * Does not write railcar_assignments (Phase 2, not approved).
 */

import { vcfMustNotModifyCar } from "./car-lifecycle-status";
import {
  assignmentHistoryContentEqual,
  type AssignmentHistoryPeriodPayload,
} from "./vcf-import";

export type ExistingHistoryRow = AssignmentHistoryPeriodPayload & {
  id: number;
};

export type CloseoutAction =
  | { op: "unchanged"; existingId: number; payload: AssignmentHistoryPeriodPayload }
  | { op: "update"; existingId: number; payload: AssignmentHistoryPeriodPayload }
  | { op: "insert"; payload: AssignmentHistoryPeriodPayload }
  | { op: "close"; existingId: number; end_date: string | null; comment: string };

export const CLOSE_DUP =
  "VCF close-out: collapsed duplicate open period (same rider+start)";
export const CLOSE_CHANGED =
  "VCF close-out: period changed; closed at incoming start";

export function openPeriodMatchKey(
  railcarId: number,
  riderExternalId: string | null | undefined,
  startDate: string | null | undefined,
): string {
  return `${railcarId}|${String(riderExternalId ?? "").trim()}|${String(startDate ?? "").trim()}`;
}

/**
 * Skip assignment_history writes for a car VCF must not modify.
 * Pass the car already in the database. A file row that is inactive does
 * not by itself skip an active car's other periods.
 */
export function skipVcfAssignmentWrites(car: {
  active_source?: string | null;
  active?: boolean | null;
  status?: string | null;
}): boolean {
  return vcfMustNotModifyCar(car);
}

/** Skip every railcar field patch for manual or already-inactive cars. */
export function skipVcfRailcarPatch(car: {
  active_source?: string | null;
  active?: boolean | null;
  status?: string | null;
}): boolean {
  return vcfMustNotModifyCar(car);
}

export const VCF_ASSET_REPORT_LEASE_SOURCES = new Set(["asset_report", "asset_report_multi_term"]);
export const VCF_LEASE_DATE_FIELDS = ["lease_start_date", "lease_end_date", "lease_expiry"] as const;

function isBlankLeaseDate(v: unknown): boolean {
  return v == null || String(v).trim() === "";
}

/**
 * On existing cars: never overwrite Asset Report lease dates, and never clear a
 * populated lease_end_date / lease_expiry. Period dates stay on assignment_history.
 */
export function applyVcfLeaseDateGuard(
  payload: Record<string, unknown>,
  existing: {
    lease_date_source?: string | null;
    lease_end_date?: unknown;
    lease_expiry?: unknown;
  },
): Record<string, unknown> {
  const out = { ...payload };
  const src = String(existing.lease_date_source ?? "").trim();
  if (VCF_ASSET_REPORT_LEASE_SOURCES.has(src)) {
    for (const field of VCF_LEASE_DATE_FIELDS) delete out[field];
    return out;
  }
  if (!isBlankLeaseDate(existing.lease_end_date) && isBlankLeaseDate(out.lease_end_date)) {
    delete out.lease_end_date;
  }
  if (!isBlankLeaseDate(existing.lease_expiry) && isBlankLeaseDate(out.lease_expiry)) {
    delete out.lease_expiry;
  }
  return out;
}

/** Fields VCF must not write when active_source = manual. */
export const VCF_MANUAL_PROTECTED_RAILCAR_FIELDS = [
  "active",
  "active_status",
  "status",
  "active_source",
] as const;

export function stripManualProtectedRailcarFields(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...payload };
  for (const key of VCF_MANUAL_PROTECTED_RAILCAR_FIELDS) {
    delete out[key];
  }
  return out;
}

function appendComment(existing: string | null | undefined, note: string): string {
  const cur = String(existing ?? "").trim();
  if (!cur) return note;
  if (cur.includes(note)) return cur;
  return `${cur} | ${note}`;
}

function isOpen(row: { end_date?: string | null }): boolean {
  return row.end_date == null || String(row.end_date).trim() === "";
}

function trimExt(v: string | null | undefined) {
  return String(v ?? "").trim();
}

/** Open sentinel (null/blank, 4000-12-31, or any end year ≥ 3000) for matching. */
export function endDateMatchKey(end: string | null | undefined): string {
  const s = String(end ?? "").trim().slice(0, 10);
  if (!s) return "";
  const y = Number(s.slice(0, 4));
  if (Number.isFinite(y) && y >= 3000) return "";
  return s;
}

export function assignmentIdsCompatible(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const x = trimExt(a);
  const y = trimExt(b);
  if (!x || !y) return true;
  return x === y;
}

function endDateDistance(a: string | null | undefined, b: string | null | undefined): number {
  const ka = endDateMatchKey(a) || "4000-12-31";
  const kb = endDateMatchKey(b) || "4000-12-31";
  const da = Date.parse(ka);
  const db = Date.parse(kb);
  if (!Number.isFinite(da) || !Number.isFinite(db)) return Number.POSITIVE_INFINITY;
  return Math.abs(da - db);
}

function pickExactExisting(
  cands: ExistingHistoryRow[],
  hist?: AssignmentHistoryPeriodPayload,
): ExistingHistoryRow | undefined {
  if (!cands.length) return undefined;
  const ranked = [...cands].sort((a, b) => {
    if (hist) {
      const aEq = assignmentHistoryContentEqual(a, hist) ? 1 : 0;
      const bEq = assignmentHistoryContentEqual(b, hist) ? 1 : 0;
      if (aEq !== bEq) return bEq - aEq;
    }
    const aFilled = a.assignment_id_ext ? 1 : 0;
    const bFilled = b.assignment_id_ext ? 1 : 0;
    if (aFilled !== bFilled) return bFilled - aFilled;
    return (b.id ?? 0) - (a.id ?? 0);
  });
  return ranked[0];
}

/** True when pairing would null a stored end date (reopen a closed period). */
export function wouldReopenClosedPeriod(
  existing: { end_date?: string | null },
  incoming: { end_date?: string | null },
): boolean {
  return !isOpen(existing) && isOpen(incoming);
}

function pairIncomingToExisting(
  existingRows: ExistingHistoryRow[],
  incoming: AssignmentHistoryPeriodPayload[],
): CloseoutAction[] {
  const actions: CloseoutAction[] = [];
  const usedE = new Set<number>();
  const usedI = new Set<number>();

  for (let i = 0; i < incoming.length; i++) {
    const hist = incoming[i];
    const wantEnd = endDateMatchKey(hist.end_date);
    const cands = existingRows.filter(
      (e) =>
        !usedE.has(e.id) &&
        endDateMatchKey(e.end_date) === wantEnd &&
        assignmentIdsCompatible(e.assignment_id_ext, hist.assignment_id_ext),
    );
    const keep = pickExactExisting(cands, hist);
    if (!keep) continue;
    usedE.add(keep.id);
    usedI.add(i);
    const merged: AssignmentHistoryPeriodPayload = {
      ...hist,
      assignment_id_ext: hist.assignment_id_ext || keep.assignment_id_ext,
    };
    if (assignmentHistoryContentEqual(keep, merged)) {
      actions.push({ op: "unchanged", existingId: keep.id, payload: merged });
    } else {
      actions.push({ op: "update", existingId: keep.id, payload: merged });
    }
  }

  const leftI = incoming.map((h, i) => ({ h, i })).filter(({ i }) => !usedI.has(i));
  const leftE = existingRows.filter((e) => !usedE.has(e.id));

  const pairOne = (hist: AssignmentHistoryPeriodPayload, keep: ExistingHistoryRow) => {
    if (wouldReopenClosedPeriod(keep, hist)) return;
    usedE.add(keep.id);
    const merged: AssignmentHistoryPeriodPayload = {
      ...hist,
      assignment_id_ext: hist.assignment_id_ext || keep.assignment_id_ext,
    };
    if (assignmentHistoryContentEqual(keep, merged)) {
      actions.push({ op: "unchanged", existingId: keep.id, payload: merged });
    } else {
      actions.push({ op: "update", existingId: keep.id, payload: merged });
    }
  };

  const canPair = (e: ExistingHistoryRow, h: AssignmentHistoryPeriodPayload) =>
    !wouldReopenClosedPeriod(e, h);

  if (leftI.length === 1 && leftE.length === 1 && canPair(leftE[0], leftI[0].h)) {
    pairOne(leftI[0].h, leftE[0]);
    usedI.add(leftI[0].i);
  } else if (leftI.length && leftE.length) {
    const avail = [...leftE];
    for (const { h, i } of leftI) {
      const eligible = avail.filter((e) => canPair(e, h));
      if (!eligible.length) continue;
      eligible.sort((a, b) => endDateDistance(a.end_date, h.end_date) - endDateDistance(b.end_date, h.end_date));
      const keep = eligible[0];
      avail.splice(avail.indexOf(keep), 1);
      pairOne(h, keep);
      usedI.add(i);
    }
  }

  const carHasOpen = existingRows.some(isOpen);
  for (const { h, i } of incoming.map((hist, idx) => ({ h: hist, i: idx }))) {
    if (usedI.has(i)) continue;
    if (isOpen(h) && carHasOpen) {
      const key = openPeriodMatchKey(h.railcar_id, h.rider_external_id, h.start_date);
      const sameKeyClosed = existingRows.some(
        (e) =>
          !isOpen(e) &&
          openPeriodMatchKey(e.railcar_id, e.rider_external_id, e.start_date) === key,
      );
      if (sameKeyClosed) continue;
    }
    actions.push({ op: "insert", payload: h });
  }
  return actions;
}

/**
 * Plan history writes for one car. Caller applies in one transaction.
 *
 * Per (car + rider + start) group: exact end-date match first, then one-to-one
 * leftover pairing when a period's end/ACTIVE changed. Two file rows that share
 * the key but differ on end date stay two rows. Extra DB rows in the group are
 * left alone (collapse script). Unmatched existing *opens* on a different
 * rider+start still close when this car has incoming rows (period changed).
 */
export function planVcfAssignmentCloseout(args: {
  existingRows: ExistingHistoryRow[];
  incoming: AssignmentHistoryPeriodPayload[];
}): CloseoutAction[] {
  const { existingRows, incoming } = args;
  const actions: CloseoutAction[] = [];
  const incomingKeys = new Set(
    incoming.map((p) => openPeriodMatchKey(p.railcar_id, p.rider_external_id, p.start_date)),
  );
  const groups = new Map<string, { existing: ExistingHistoryRow[]; incoming: AssignmentHistoryPeriodPayload[] }>();
  for (const key of incomingKeys) {
    groups.set(key, { existing: [], incoming: [] });
  }
  for (const hist of incoming) {
    const key = openPeriodMatchKey(hist.railcar_id, hist.rider_external_id, hist.start_date);
    groups.get(key)!.incoming.push(hist);
  }
  for (const row of existingRows) {
    const key = openPeriodMatchKey(row.railcar_id, row.rider_external_id, row.start_date);
    const g = groups.get(key);
    if (g) g.existing.push(row);
  }

  const claimed = new Set<number>();
  for (const g of groups.values()) {
    const part = pairIncomingToExisting(g.existing, g.incoming);
    for (const a of part) {
      actions.push(a);
      if (a.op === "update" || a.op === "unchanged") claimed.add(a.existingId);
    }
  }

  const incomingOpen = incoming.filter(isOpen);
  if (incomingOpen.length === 0) return actions;

  const latestIncomingStart =
    [...incomingOpen]
      .map((p) => String(p.start_date ?? ""))
      .sort()
      .at(-1) || null;

  for (const row of existingRows.filter(isOpen)) {
    if (claimed.has(row.id)) continue;
    const key = openPeriodMatchKey(row.railcar_id, row.rider_external_id, row.start_date);
    if (incomingKeys.has(key)) continue;
    actions.push({
      op: "close",
      existingId: row.id,
      end_date: latestIncomingStart,
      comment: appendComment(row.comment, CLOSE_CHANGED),
    });
  }

  return actions;
}

export function closeoutStats(actions: CloseoutAction[]): {
  inserted: number;
  updated: number;
  closed: number;
  unchanged: number;
} {
  const stats = { inserted: 0, updated: 0, closed: 0, unchanged: 0 };
  for (const a of actions) {
    if (a.op === "insert") stats.inserted += 1;
    else if (a.op === "update") stats.updated += 1;
    else if (a.op === "close") stats.closed += 1;
    else stats.unchanged += 1;
  }
  return stats;
}

/** Patch written when applying a close action. Never deletes. */
export function closeoutClosePatch(
  action: Extract<CloseoutAction, { op: "close" }>,
  movedAt: string,
): { end_date: string | null; active: false; comment: string; moved_at: string } {
  return {
    end_date: action.end_date,
    active: false,
    comment: action.comment,
    moved_at: movedAt,
  };
}
