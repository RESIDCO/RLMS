/**
 * Lessee (Resp 6) totals — integer cents only.
 * Shared by Send Lessee preview, PDF, data file, email, and lessee view.
 */
import { DEFAULT_TENANT_ID, q } from "../db";
import { formatCentsAsMoney, formatCentsWithCommas } from "./money";
import { previewTaxProrate } from "./responsibility-split";

export type LesseeLineCents = {
  id: string;
  line_no: number;
  display_line_no?: string | null;
  aar_job_code: string | null;
  qualifier: string | null;
  why_made: string | null;
  condition_code: string | null;
  resp_code: string | null;
  location_on_car: string | null;
  quantity: string | null;
  removed_job_code: string | null;
  removed_qualifier: string | null;
  description: string | null;
  repair_category: string | null;
  aar_component_id: string | null;
  labor_cents: number;
  material_cents: number;
  amount_cents: number;
  labor_money: string;
  material_money: string;
  amount_money: string;
  raw_line?: string | null;
};

export type LesseeTotalsBundle = {
  revisionId: string;
  estimateId: string;
  eventId: string;
  lines: LesseeLineCents[];
  laborCents: number;
  materialCents: number;
  linesTotalCents: number;
  taxCents: number;
  /** lines + prorated tax for resp 6 */
  totalCents: number;
  amountMoney: string;
  amountDisplay: string;
  header: Record<string, unknown>;
  carLabel: string;
  shopDisplay: string;
};

function lineCents(row: {
  labor_cents?: unknown;
  material_cents?: unknown;
  labor?: unknown;
  material?: unknown;
}): { labor: number; material: number } {
  const labor =
    row.labor_cents != null
      ? Math.trunc(Number(row.labor_cents))
      : Math.round(Number(row.labor ?? 0) * 100);
  const material =
    row.material_cents != null
      ? Math.trunc(Number(row.material_cents))
      : Math.round(Number(row.material ?? 0) * 100);
  return { labor, material };
}

/**
 * Sum Resp 6 lines (incl. split children) + prorated tax share for resp 6.
 */
export async function computeLesseeTotals(opts: {
  estimateId: string;
  revisionId?: string;
  tenantId?: string;
  /** Optional tax cents on the estimate to prorate; default from revision.tax_cents if any */
  taxCents?: number;
}): Promise<
  | { ok: true; bundle: LesseeTotalsBundle }
  | { ok: false; status: number; error: string }
> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows: est } = await q(
    `SELECT e.*, ev.car_mark, ev.car_number, ev.id AS event_id,
            s.name AS shop_name, s.shop_mark, s.reporting_mark
     FROM repair.estimates e
     JOIN repair.events ev ON ev.id = e.event_id
     LEFT JOIN repair.shops s ON s.id = ev.shop_id
     WHERE e.id = $1 AND e.tenant_id = $2 AND e.deleted_at IS NULL`,
    [opts.estimateId, tenantId],
  );
  if (!est[0]) {
    return { ok: false, status: 404, error: "Estimate not found" };
  }
  const estimate = est[0];
  let revisionId = opts.revisionId;
  if (!revisionId) {
    // Prefer current_revision when it has lines; otherwise the latest revision
    // that actually carries billing lines (Approve / Request-revision rows often
    // have no lines — that produced the $0.00 Send Lessee preview bug).
    const { rows: revRows } = await q(
      `SELECT er.id
       FROM repair.estimate_revisions er
       WHERE er.estimate_id = $1
         AND EXISTS (
           SELECT 1 FROM repair.estimate_lines el WHERE el.revision_id = er.id
         )
       ORDER BY
         CASE WHEN er.rev_no = $2 THEN 0 ELSE 1 END,
         er.rev_no DESC
       LIMIT 1`,
      [opts.estimateId, estimate.current_revision],
    );
    revisionId = revRows[0]?.id ? String(revRows[0].id) : undefined;
  }
  if (!revisionId) {
    return { ok: false, status: 404, error: "No revision with lines" };
  }

  const { rows: revMeta } = await q(
    `SELECT header FROM repair.estimate_revisions WHERE id = $1`,
    [revisionId],
  );
  const header =
    revMeta[0]?.header && typeof revMeta[0].header === "object"
      ? { ...(revMeta[0].header as Record<string, unknown>) }
      : {};
  // Prefer shop master mark
  if (estimate.shop_mark || estimate.reporting_mark) {
    header.shopMark = estimate.shop_mark || estimate.reporting_mark;
    header.repairingParty = header.shopMark;
  }
  delete header.locationOnCar;

  const { rows: allLines } = await q(
    `SELECT id, line_no, display_line_no, aar_job_code, qualifier, why_made,
            condition_code, resp_code, labor, material, total,
            labor_cents, material_cents, repair_category, description, raw_line,
            location_on_car, quantity, removed_job_code, removed_qualifier,
            aar_component_id
     FROM repair.estimate_lines
     WHERE revision_id = $1
     ORDER BY line_no ASC`,
    [revisionId],
  );

  const lesseeRaw = allLines.filter((l) => String(l.resp_code ?? "") === "6");
  const lines: LesseeLineCents[] = lesseeRaw.map((l) => {
    const { labor, material } = lineCents(l);
    const amount = labor + material;
    return {
      id: String(l.id),
      line_no: Number(l.line_no),
      display_line_no: l.display_line_no != null ? String(l.display_line_no) : null,
      aar_job_code: l.aar_job_code != null ? String(l.aar_job_code) : null,
      qualifier: l.qualifier != null ? String(l.qualifier) : null,
      why_made: l.why_made != null ? String(l.why_made) : null,
      condition_code: l.condition_code != null ? String(l.condition_code) : null,
      resp_code: "6",
      location_on_car: l.location_on_car != null ? String(l.location_on_car) : null,
      quantity: l.quantity != null ? String(l.quantity) : null,
      removed_job_code: l.removed_job_code != null ? String(l.removed_job_code) : null,
      removed_qualifier: l.removed_qualifier != null ? String(l.removed_qualifier) : null,
      description: l.description != null ? String(l.description) : null,
      repair_category: l.repair_category != null ? String(l.repair_category) : null,
      aar_component_id: l.aar_component_id != null ? String(l.aar_component_id) : null,
      labor_cents: labor,
      material_cents: material,
      amount_cents: amount,
      labor_money: formatCentsAsMoney(labor),
      material_money: formatCentsAsMoney(material),
      amount_money: formatCentsAsMoney(amount),
      raw_line: l.raw_line != null ? String(l.raw_line) : null,
    };
  });

  let laborCents = 0;
  let materialCents = 0;
  for (const l of lines) {
    laborCents += l.labor_cents;
    materialCents += l.material_cents;
  }
  const linesTotalCents = laborCents + materialCents;

  const taxAll = opts.taxCents != null ? Math.trunc(opts.taxCents) : 0;

  let taxCents = 0;
  if (taxAll > 0 && allLines.length) {
    const prorate = previewTaxProrate({
      lines: allLines.map((l) => {
        const c = lineCents(l);
        return {
          respCode: String(l.resp_code ?? ""),
          amountCents: c.labor + c.material,
        };
      }),
      taxCents: taxAll,
    });
    taxCents = prorate.shares.find((s) => s.respCode === "6")?.taxCents ?? 0;
  }

  const totalCents = linesTotalCents + taxCents;
  const carLabel = `${estimate.car_mark} ${estimate.car_number}`.trim();
  const shopDisplay =
    estimate.shop_name || estimate.shop_mark || estimate.reporting_mark || "";

  return {
    ok: true,
    bundle: {
      revisionId: String(revisionId),
      estimateId: opts.estimateId,
      eventId: String(estimate.event_id),
      lines,
      laborCents,
      materialCents,
      linesTotalCents,
      taxCents,
      totalCents,
      amountMoney: formatCentsAsMoney(totalCents),
      amountDisplay: formatCentsWithCommas(totalCents),
      header,
      carLabel,
      shopDisplay,
    },
  };
}

/** Reconcile four channels to the same integer cent total. */
export function reconcileLesseeOutputs(opts: {
  previewCents: number;
  pdfCents: number;
  dataFileCents: number;
  emailCents: number;
}): { ok: boolean; totalCents: number; mismatch?: string } {
  const { previewCents, pdfCents, dataFileCents, emailCents } = opts;
  if (
    previewCents === pdfCents &&
    previewCents === dataFileCents &&
    previewCents === emailCents
  ) {
    return { ok: true, totalCents: previewCents };
  }
  return {
    ok: false,
    totalCents: previewCents,
    mismatch: `preview=${previewCents} pdf=${pdfCents} data=${dataFileCents} email=${emailCents}`,
  };
}

export function blockSendReason(totalCents: number, reconcileOk: boolean, mismatch?: string): string | null {
  if (totalCents <= 0) {
    return "Lessee total is $0.00 — cannot send. Assign Resp 6 lines (or splits) with non-zero amounts.";
  }
  if (!reconcileOk) {
    return `Lessee totals do not agree across preview/PDF/data file/email (${mismatch}). Fix before send.`;
  }
  return null;
}
