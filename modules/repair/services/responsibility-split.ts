/**
 * Responsibility splits: % or fixed $, child lines 1a/1b, tax prorate,
 * unsplit/undo before approval. Integer cents; remainder to owner line.
 */
import { randomUUID } from "crypto";
import { dollarsToCents } from "./money";

export type SplitSpec = {
  lineId: string;
  /** Percent 1–99 (mutually exclusive with fixedCents / fixedDollars). */
  percent?: number;
  /** Fixed share in integer cents for the first (new-resp) child. */
  fixedCents?: number;
  fixedDollars?: number | string;
  /** Responsibility for the split-off child (1a). Remainder keeps current resp (1b / owner). */
  respCode: string;
  /** Optional second resp for remainder; default = original line resp. */
  remainderRespCode?: string;
};

export type OutSplitLine = {
  src: Record<string, unknown>;
  resp: string;
  laborC: number;
  matC: number;
  parentLineNo: number | null;
  splitLabel: string | null;
  splitGroupId: string | null;
  splitKind: string | null;
  displayLineNo: string;
  sourceFingerprint: string;
  priorRespCode: string | null;
  isTaxLine: boolean;
};

export function lineFingerprintLite(line: Record<string, unknown>): string {
  return [
    String(line.aar_job_code ?? "").trim(),
    String(line.qualifier ?? "").trim(),
    String(line.why_made ?? "").trim(),
    String(line.condition_code ?? "").trim(),
    String(line.location_on_car ?? "").trim(),
    String(line.quantity ?? "").trim(),
    String(line.description ?? "").trim().toUpperCase(),
  ].join("|");
}

function resolveSplitCents(
  totalCents: number,
  split: SplitSpec,
): { childA: number; childB: number } {
  let a = 0;
  if (split.fixedCents != null && Number.isFinite(split.fixedCents)) {
    a = Math.trunc(split.fixedCents);
  } else if (split.fixedDollars != null && split.fixedDollars !== "") {
    a = dollarsToCents(split.fixedDollars);
  } else if (split.percent != null) {
    const pct = Math.min(99, Math.max(1, Math.round(Number(split.percent))));
    a = Math.trunc((totalCents * pct) / 100);
  }
  a = Math.max(0, Math.min(totalCents, a));
  return { childA: a, childB: totalCents - a };
}

/**
 * Expand lines with optional splits. Remainder cents go to owner/original resp (child B).
 * Exact sum preserved.
 */
export function expandLinesWithSplits(opts: {
  lines: Record<string, unknown>[];
  lineUpdates: Map<string, string>;
  splits: SplitSpec[];
  laborCentsOf: (line: Record<string, unknown>) => number;
  materialCentsOf: (line: Record<string, unknown>) => number;
}): OutSplitLine[] {
  const splitMap = new Map(opts.splits.map((s) => [s.lineId, s] as const));
  const outgoing: OutSplitLine[] = [];
  let outLineNo = 0;

  for (const line of opts.lines) {
    const id = String(line.id);
    const laborC = opts.laborCentsOf(line);
    const matC = opts.materialCentsOf(line);
    const totalC = laborC + matC;
    const origResp = String(line.resp_code ?? "");
    const newResp = opts.lineUpdates.get(id);
    const split = splitMap.get(id);
    const parentNo = Number(line.line_no);
    const fp =
      (line.source_fingerprint as string) || lineFingerprintLite(line);
    const isTax = Boolean(line.is_tax_line);

    if (split && totalC > 0) {
      const laborSplit = resolveSplitCents(laborC, split);
      const matSplit = resolveSplitCents(matC, split);
      // Prefer allocating from combined total then proportionally if mixed modes —
      // when percent: both use same pct; when fixed: apply fixed to total then split L/M.
      let laborA = laborSplit.childA;
      let matA = matSplit.childA;
      if (split.fixedCents != null || split.fixedDollars != null) {
        const fixed = resolveSplitCents(totalC, split).childA;
        // Proportional labor/material from fixed share of total
        if (totalC > 0) {
          laborA = Math.trunc((laborC * fixed) / totalC);
          matA = fixed - laborA;
          // Clamp
          if (matA < 0) {
            laborA = fixed;
            matA = 0;
          }
          if (matA > matC) {
            matA = matC;
            laborA = fixed - matA;
          }
          if (laborA > laborC) {
            laborA = laborC;
            matA = fixed - laborA;
          }
        }
      }
      const laborB = laborC - laborA;
      const matB = matC - matA;
      const groupId = randomUUID();
      const respA = (split.respCode || newResp || origResp).trim();
      const respB = (split.remainderRespCode || origResp).trim();
      const baseLabel = String(line.display_line_no || parentNo);

      outLineNo += 1;
      outgoing.push({
        src: line,
        resp: respA,
        laborC: laborA,
        matC: matA,
        parentLineNo: parentNo,
        splitLabel: `${baseLabel}a`,
        splitGroupId: groupId,
        splitKind:
          split.percent != null
            ? `percent:${split.percent}`
            : `fixed:${laborA + matA}`,
        displayLineNo: `${baseLabel}a`,
        sourceFingerprint: fp,
        priorRespCode: origResp || null,
        isTaxLine: isTax,
      });
      outLineNo += 1;
      outgoing.push({
        src: line,
        resp: respB,
        laborC: laborB,
        matC: matB,
        parentLineNo: parentNo,
        splitLabel: `${baseLabel}b`,
        splitGroupId: groupId,
        splitKind:
          split.percent != null
            ? `percent:${100 - Number(split.percent)}`
            : `fixed_remainder`,
        displayLineNo: `${baseLabel}b`,
        sourceFingerprint: fp,
        priorRespCode: origResp || null,
        isTaxLine: isTax,
      });
    } else {
      outLineNo += 1;
      const display =
        line.display_line_no != null
          ? String(line.display_line_no)
          : String(outLineNo);
      outgoing.push({
        src: line,
        resp: (newResp ?? origResp).trim(),
        laborC,
        matC,
        parentLineNo: line.parent_line_no != null ? Number(line.parent_line_no) : null,
        splitLabel: line.split_label != null ? String(line.split_label) : null,
        splitGroupId: line.split_group_id != null ? String(line.split_group_id) : null,
        splitKind: line.split_kind != null ? String(line.split_kind) : null,
        displayLineNo: display,
        sourceFingerprint: fp,
        priorRespCode: origResp || null,
        isTaxLine: isTax,
      });
    }
  }

  // Re-number display for non-split sequential when display was raw outLineNo
  // Keep split labels; assign sequential integers for unsplit display_line_no if numeric.
  let seq = 0;
  for (const o of outgoing) {
    seq += 1;
    if (!o.splitLabel) {
      o.displayLineNo = String(seq);
    }
  }
  return outgoing;
}

export type TaxProrateShare = {
  respCode: string;
  basisCents: number;
  taxCents: number;
  taxDisplay: string;
};

/**
 * Prorate a tax amount (integer cents) across responsibility shares.
 * Remainder cent(s) go to the largest basis (owner-preferring when tied: code "1").
 */
export function previewTaxProrate(opts: {
  /** Non-tax lines with resp + amount cents (labor+material). */
  lines: Array<{ respCode: string; amountCents: number; isTaxLine?: boolean }>;
  taxCents: number;
}): { shares: TaxProrateShare[]; totalTaxCents: number; exact: boolean } {
  const basis = new Map<string, number>();
  for (const l of opts.lines) {
    if (l.isTaxLine) continue;
    const code = String(l.respCode || "").trim() || "?";
    basis.set(code, (basis.get(code) ?? 0) + Math.max(0, Math.trunc(l.amountCents)));
  }
  const totalBasis = [...basis.values()].reduce((s, n) => s + n, 0);
  const tax = Math.trunc(opts.taxCents);
  if (tax === 0 || totalBasis === 0 || basis.size === 0) {
    return { shares: [], totalTaxCents: 0, exact: true };
  }

  const codes = [...basis.keys()].sort((a, b) => {
    // Prefer owner "1" last for remainder (largest first, then owner)
    const ba = basis.get(a)!;
    const bb = basis.get(b)!;
    if (bb !== ba) return bb - ba;
    if (a === "1") return -1;
    if (b === "1") return 1;
    return a.localeCompare(b);
  });

  const raw = codes.map((code) => {
    const b = basis.get(code)!;
    return { code, basis: b, tax: Math.trunc((tax * b) / totalBasis) };
  });
  let allocated = raw.reduce((s, r) => s + r.tax, 0);
  let rem = tax - allocated;
  // Distribute remainder cents to largest basis (first in sorted = largest)
  let i = 0;
  while (rem !== 0 && raw.length) {
    const step = rem > 0 ? 1 : -1;
    raw[i % raw.length]!.tax += step;
    rem -= step;
    i += 1;
  }
  allocated = raw.reduce((s, r) => s + r.tax, 0);

  return {
    shares: raw.map((r) => ({
      respCode: r.code,
      basisCents: r.basis,
      taxCents: r.tax,
      taxDisplay: (r.tax / 100).toFixed(2),
    })),
    totalTaxCents: allocated,
    exact: allocated === tax,
  };
}

/** Detect if current lines are a split group that can be unsplit (same group_id). */
export function findUnsplitGroups(lines: Record<string, unknown>[]): Array<{
  splitGroupId: string;
  lineIds: string[];
  parentLineNo: number | null;
}> {
  const map = new Map<string, Record<string, unknown>[]>();
  for (const l of lines) {
    const g = l.split_group_id != null ? String(l.split_group_id) : "";
    if (!g) continue;
    const arr = map.get(g) ?? [];
    arr.push(l);
    map.set(g, arr);
  }
  const out: Array<{
    splitGroupId: string;
    lineIds: string[];
    parentLineNo: number | null;
  }> = [];
  for (const [id, arr] of map) {
    if (arr.length < 2) continue;
    out.push({
      splitGroupId: id,
      lineIds: arr.map((l) => String(l.id)),
      parentLineNo: arr[0]?.parent_line_no != null ? Number(arr[0].parent_line_no) : null,
    });
  }
  return out;
}

/**
 * Collapse split groups back into single lines (sum cents, restore parent display).
 * Used for unsplit/undo before approval.
 */
export function collapseUnsplit(
  lines: Record<string, unknown>[],
  groupIds: string[],
  laborCentsOf: (l: Record<string, unknown>) => number,
  materialCentsOf: (l: Record<string, unknown>) => number,
): OutSplitLine[] {
  const want = new Set(groupIds);
  const skipped = new Set<string>();
  const outgoing: OutSplitLine[] = [];
  const groups = new Map<string, Record<string, unknown>[]>();

  for (const l of lines) {
    const g = l.split_group_id != null ? String(l.split_group_id) : "";
    if (g && want.has(g)) {
      const arr = groups.get(g) ?? [];
      arr.push(l);
      groups.set(g, arr);
      skipped.add(String(l.id));
    }
  }

  const emittedGroups = new Set<string>();
  for (const line of lines) {
    const id = String(line.id);
    const g = line.split_group_id != null ? String(line.split_group_id) : "";
    if (g && want.has(g)) {
      if (emittedGroups.has(g)) continue;
      emittedGroups.add(g);
      const members = groups.get(g) ?? [];
      const laborC = members.reduce((s, m) => s + laborCentsOf(m), 0);
      const matC = members.reduce((s, m) => s + materialCentsOf(m), 0);
      // Owner/original resp: prefer prior_resp_code or 'b' child / code 1
      const ownerish =
        members.find((m) => String(m.split_label ?? "").endsWith("b")) ??
        members.find((m) => String(m.resp_code) === "1") ??
        members[members.length - 1]!;
      const parentNo =
        members[0]?.parent_line_no != null
          ? Number(members[0].parent_line_no)
          : Number(ownerish.line_no);
      const fp =
        (ownerish.source_fingerprint as string) || lineFingerprintLite(ownerish);
      outgoing.push({
        src: ownerish,
        resp: String(ownerish.prior_resp_code ?? ownerish.resp_code ?? ""),
        laborC,
        matC,
        parentLineNo: null,
        splitLabel: null,
        splitGroupId: null,
        splitKind: null,
        displayLineNo: String(parentNo),
        sourceFingerprint: fp,
        priorRespCode: null,
        isTaxLine: Boolean(ownerish.is_tax_line),
      });
      continue;
    }
    if (skipped.has(id)) continue;
    outgoing.push({
      src: line,
      resp: String(line.resp_code ?? ""),
      laborC: laborCentsOf(line),
      matC: materialCentsOf(line),
      parentLineNo: line.parent_line_no != null ? Number(line.parent_line_no) : null,
      splitLabel: line.split_label != null ? String(line.split_label) : null,
      splitGroupId: line.split_group_id != null ? String(line.split_group_id) : null,
      splitKind: line.split_kind != null ? String(line.split_kind) : null,
      displayLineNo: String(line.display_line_no ?? line.line_no ?? ""),
      sourceFingerprint:
        (line.source_fingerprint as string) || lineFingerprintLite(line),
      priorRespCode: line.prior_resp_code != null ? String(line.prior_resp_code) : null,
      isTaxLine: Boolean(line.is_tax_line),
    });
  }
  return outgoing;
}
