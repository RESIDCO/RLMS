/**
 * Source-file vs CRIP export totals helpers for the local Phase 1 demo.
 *
 * Full sample (OFOX2609) = Resp 6 + Resp 7. Monthly CRIP exports only
 * rebillable Resp 6/3; Resp 7 Never Rebill is excluded by design
 * ($3,083.79 on the sample — not a parser miss).
 */
import { parseAarFile, signedMaterialCents } from "../services/aar-parser";
import { q } from "../db";

/** Rebillable responsibility codes in monthly CRIP export (Resp 6 lessee, 3 railroad). */
export const REBILL_RESP_CODES = ["6", "3"] as const;

export type SourceFileTotals = {
  lineCount: number;
  allLabor: number;
  allMaterial: number;
  allTotal: number;
  rebillLabor: number;
  rebillMaterial: number;
  rebillTotal: number;
  rebillLines: number;
  neverRebillLabor: number;
  neverRebillMaterial: number;
  neverRebillTotal: number;
  neverRebillLines: number;
};

/** Source-file labor/material totals and rebillable (export) subset. */
export function sourceFileTotals(bytes: Buffer): SourceFileTotals {
  const parsed = parseAarFile(bytes);
  const rebillSet = new Set<string>(REBILL_RESP_CODES);
  let allLabor = 0;
  let allMaterial = 0;
  let rebillLabor = 0;
  let rebillMaterial = 0;
  let rebillLines = 0;
  let neverRebillLabor = 0;
  let neverRebillMaterial = 0;
  let neverRebillLines = 0;
  let lineCount = 0;
  for (const line of parsed.lines) {
    if (line.recordFormat !== "1") continue;
    lineCount++;
    const labor = line.laborCents ?? 0;
    const material = signedMaterialCents(line);
    allLabor += labor;
    allMaterial += material;
    const resp = (line.respCode ?? "").trim();
    if (rebillSet.has(resp)) {
      rebillLabor += labor;
      rebillMaterial += material;
      rebillLines++;
    } else if (resp === "7") {
      neverRebillLabor += labor;
      neverRebillMaterial += material;
      neverRebillLines++;
    }
  }
  return {
    lineCount,
    allLabor,
    allMaterial,
    allTotal: allLabor + allMaterial,
    rebillLabor,
    rebillMaterial,
    rebillTotal: rebillLabor + rebillMaterial,
    rebillLines,
    neverRebillLabor,
    neverRebillMaterial,
    neverRebillTotal: neverRebillLabor + neverRebillMaterial,
    neverRebillLines,
  };
}

/**
 * Assert approved estimate = full source total, and CRIP export =
 * source Resp 6/3 = estimate lines on the latest content revision.
 */
export async function assertDemoTotals(opts: {
  estimateId: string;
  estimateTotalDollars: number;
  source: SourceFileTotals;
  exportLaborCents: number;
  exportMaterialCents: number;
}): Promise<{
  contentRevisionId: string;
  approvedCents: number;
  exportTotalCents: number;
}> {
  const approvedCents = Math.round(opts.estimateTotalDollars * 100);
  if (approvedCents !== opts.source.allTotal) {
    throw new Error(
      `Approved estimate total ${approvedCents}¢ != source file total ${opts.source.allTotal}¢ ` +
        `(labor ${opts.source.allLabor} + material ${opts.source.allMaterial})`,
    );
  }

  // Status-change revisions (Approve, Resp 6, …) copy header totals but not
  // lines. Match monthly-close: latest revision that still has line rows.
  const { rows: contentRevRows } = await q(
    `SELECT r.id
     FROM repair.estimate_revisions r
     WHERE r.estimate_id = $1
       AND EXISTS (
         SELECT 1 FROM repair.estimate_lines el
         WHERE el.revision_id = r.id AND el.resp_code = ANY($2::text[])
       )
     ORDER BY r.rev_no DESC
     LIMIT 1`,
    [opts.estimateId, Array.from(REBILL_RESP_CODES)],
  );
  const contentRevisionId = String(contentRevRows[0]?.id ?? "");
  if (!contentRevisionId) {
    throw new Error("No approved estimate revision with rebillable lines");
  }

  const { rows: rebillLineRows } = await q(
    `SELECT
       COALESCE(SUM(COALESCE(labor_cents, ROUND(labor * 100)::bigint)), 0)::bigint AS labor_cents,
       COALESCE(SUM(COALESCE(material_cents, ROUND(material * 100)::bigint)), 0)::bigint AS material_cents
     FROM repair.estimate_lines
     WHERE revision_id = $1 AND resp_code = ANY($2::text[])`,
    [contentRevisionId, Array.from(REBILL_RESP_CODES)],
  );
  const estRebillLabor = Number(rebillLineRows[0]?.labor_cents ?? 0);
  const estRebillMaterial = Number(rebillLineRows[0]?.material_cents ?? 0);
  const exportLabor = Number(opts.exportLaborCents ?? 0);
  const exportMaterial = Number(opts.exportMaterialCents ?? 0);

  if (
    exportLabor !== opts.source.rebillLabor ||
    exportMaterial !== opts.source.rebillMaterial
  ) {
    throw new Error(
      `CRIP export ${exportLabor}+${exportMaterial}¢ != source rebillable (Resp 6/3) ` +
        `${opts.source.rebillLabor}+${opts.source.rebillMaterial}¢`,
    );
  }
  if (exportLabor !== estRebillLabor || exportMaterial !== estRebillMaterial) {
    throw new Error(
      `CRIP export ${exportLabor}+${exportMaterial}¢ != approved estimate rebillable lines ` +
        `${estRebillLabor}+${estRebillMaterial}¢`,
    );
  }

  return {
    contentRevisionId,
    approvedCents,
    exportTotalCents: exportLabor + exportMaterial,
  };
}
