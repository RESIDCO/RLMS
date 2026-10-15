/**
 * Billing Repair Card (BRC) PDF — portrait letter, same template for
 * owner / lessee / shop; only the line filter changes.
 *
 * Audience filters:
 *   owner  — all lines (incl. internal / DV)
 *   lessee — granted Resp 6 lines only
 *   shop   — exclude internal (8000-series) and DV settlement lines
 */
import { jsPDF } from "jspdf";
import autoTableImport from "jspdf-autotable";
import { DEFAULT_TENANT_ID, q } from "../db";
import { enrichLineFromRaw } from "./estimate-review";
import { workspaceTitle } from "./entity";
import {
  formatCentsAsMoney,
  formatCentsWithCommas,
  lineLaborCents,
  lineMaterialCents,
} from "./money";

const autoTable =
  typeof autoTableImport === "function"
    ? autoTableImport
    : (autoTableImport as { default: typeof autoTableImport }).default;

export type BrcAudience = "owner" | "lessee" | "shop";

export type BrcLine = {
  lineNo: string;
  loc: string;
  qty: string;
  condition: string;
  ajob: string;
  qa: string;
  description: string;
  wm: string;
  rjob: string;
  qr: string;
  resp: string;
  amountCents: number;
  componentId: string;
  isInternal: boolean;
  isDv: boolean;
};

export type BrcHeader = {
  workspace: string;
  entityCode: string | null;
  shopName: string;
  shopCityState: string;
  estimateId: string;
  estimateIdShort: string;
  status: string;
  invoice: string;
  assignment: string;
  carInitial: string;
  carNumber: string;
  carType: string;
  kindOfCar: string;
  road: string;
  dcRoad: string;
  dcDate: string;
  splc: string;
  created: string;
  accountDate: string;
  dispositionRequest: string;
  approved: string;
  repairDate: string;
  yardArrival: string;
  targetDate: string;
  outboundDate: string;
  revNo: number;
  createdDateForFooter: string;
};

export type BrcDocument = {
  audience: BrcAudience;
  header: BrcHeader;
  lines: BrcLine[];
  totalCents: number;
  showComponentId: boolean;
  carCompact: string;
  /** Embedded for cent reconciliation smokes */
  totalMarker: string;
  /** §G r2 shop BRC — owner reject/adjust comments by line # */
  decisionComments?: Array<{
    lineNo: number | null;
    jobCode: string | null;
    body: string;
  }>;
};

const HEADER_LABELS = [
  "Estimate ID",
  "Status",
  "Invoice",
  "Assignment",
  "Car Initial",
  "Car Number",
  "Car Type",
  "Kind of Car",
  "Road",
  "DC Road",
  "DC Date",
  "SPLC",
  "Created",
  "Account Date",
  "Disposition Request",
  "Approved",
  "Repair Date",
  "Yard Arrival",
  "Target Date",
  "Outbound Date",
] as const;

export const BRC_HEADER_LABELS = HEADER_LABELS;

function fmtDate(v: unknown): string {
  if (v == null || v === "") return "";
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function fmtDateTimeEt(d = new Date()): string {
  return d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

function str(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

/** Car number for subject lines — drop leading zeros (AEX 022881 → 22881). */
export function displayCarNumber(carNumber: string): string {
  const t = String(carNumber ?? "").trim();
  if (!t) return "";
  const stripped = t.replace(/^0+(?=\d)/, "");
  return stripped || "0";
}

/** Compact car token for attachment names: AEX022881 */
export function compactCarLabel(carInitial: string, carNumber: string): string {
  const mark = String(carInitial ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  const num = String(carNumber ?? "")
    .trim()
    .replace(/\s+/g, "");
  return `${mark}${num}`;
}

export function brcAttachmentBaseName(
  carInitial: string,
  carNumber: string,
  estimateNo: string,
): string {
  const car = compactCarLabel(carInitial, carNumber);
  const est = String(estimateNo ?? "")
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, "");
  return `${car}${est}`;
}

function isInternalLine(line: Record<string, unknown>): boolean {
  const job = str(line.aar_job_code);
  if (/^8\d{3}/.test(job)) return true;
  const cat = str(line.repair_category).toLowerCase();
  if (cat.includes("internal")) return true;
  const desc = str(line.description).toLowerCase();
  if (desc.includes("internal only") || desc.includes("(internal)")) return true;
  return false;
}

function isDvLine(line: Record<string, unknown>): boolean {
  const cat = str(line.repair_category).toLowerCase();
  const desc = str(line.description).toLowerCase();
  const job = str(line.aar_job_code).toUpperCase();
  if (cat.includes("dv") || cat.includes("damage valuation")) return true;
  if (desc.includes("dv settlement") || desc.includes("damage valuation")) return true;
  if (job.startsWith("DV")) return true;
  return false;
}

function descriptionWithSplit(line: Record<string, unknown>): string {
  let desc = str(line.description) || str(line.repair_category);
  const splitLabel = str(line.split_label);
  const splitKind = str(line.split_kind).toLowerCase();
  if (splitLabel || splitKind.includes("percent") || splitKind.includes("%")) {
    const note =
      splitLabel ||
      (splitKind.match(/(\d+)\s*%/)?.[0]
        ? `Split ${splitKind.match(/(\d+)\s*%/)?.[0]}`
        : "Split");
    if (!desc.toLowerCase().includes("split")) {
      desc = desc ? `${desc} (${note})` : note;
    }
  }
  return desc;
}

function filterLinesForAudience(
  lines: BrcLine[],
  audience: BrcAudience,
): BrcLine[] {
  if (audience === "owner") return lines;
  if (audience === "lessee") {
    return lines.filter((l) => l.resp === "6");
  }
  // shop — no internal / DV
  return lines.filter((l) => !l.isInternal && !l.isDv);
}

export async function loadBrcDocument(opts: {
  estimateId: string;
  audience: BrcAudience;
  revisionId?: string;
  tenantId?: string;
}): Promise<
  | { ok: true; doc: BrcDocument }
  | { ok: false; status: number; error: string }
> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows: estRows } = await q(
    `SELECT e.id, e.current_revision, e.created_at, e.entity_code,
            ev.id AS event_id, ev.car_mark, ev.car_number, ev.car_type,
            ev.billing_road, ev.damaging_road, ev.yard_arrived_at,
            ev.target_outbound_at, ev.actual_outbound_at, ev.dispo_requested_at,
            s.name AS shop_name, s.city AS shop_city, s.state AS shop_state,
            s.shop_mark, s.reporting_mark, s.splc AS shop_splc,
            st.display_name AS status_name, st.code AS status_code,
            cr.current_assignment AS assignment, cr.lessee_name,
            bo.dc_road, bo.dc_date, bo.reporting_road,
            appr.action_at AS approved_at,
            inv.invoice_no
     FROM repair.estimates e
     JOIN repair.events ev ON ev.id = e.event_id
     JOIN repair.statuses st ON st.id = e.status_id
     LEFT JOIN repair.shops s ON s.id = ev.shop_id
     LEFT JOIN repair.cars_ref cr
       ON upper(cr.car_mark) = upper(ev.car_mark) AND cr.car_number = ev.car_number
     LEFT JOIN LATERAL (
       SELECT dc_road, incident_date AS dc_date, reporting_road
       FROM repair.bad_orders
       WHERE event_id = e.event_id AND deleted_at IS NULL
       ORDER BY received_at DESC LIMIT 1
     ) bo ON true
     LEFT JOIN LATERAL (
       SELECT action_at FROM repair.estimate_revisions
       WHERE estimate_id = e.id AND new_status = 'APPROVED'
       ORDER BY rev_no DESC LIMIT 1
     ) appr ON true
     LEFT JOIN LATERAL (
       SELECT invoice_no FROM repair.invoices
       WHERE event_id = e.event_id AND deleted_at IS NULL
       ORDER BY created_at DESC LIMIT 1
     ) inv ON true
     WHERE e.id = $1 AND e.tenant_id = $2 AND e.deleted_at IS NULL`,
    [opts.estimateId, tenantId],
  );
  if (!estRows[0]) {
    return { ok: false, status: 404, error: "Estimate not found" };
  }
  const est = estRows[0];

  let revisionId = opts.revisionId;
  let revNo = Number(est.current_revision ?? 0);
  if (!revisionId) {
    const { rows: revRows } = await q(
      `SELECT id, rev_no, header
       FROM repair.estimate_revisions er
       WHERE er.estimate_id = $1
         AND EXISTS (
           SELECT 1 FROM repair.estimate_lines el WHERE el.revision_id = er.id
         )
       ORDER BY
         CASE WHEN er.rev_no = $2 THEN 0 ELSE 1 END,
         er.rev_no DESC
       LIMIT 1`,
      [opts.estimateId, est.current_revision],
    );
    if (!revRows[0]) {
      return { ok: false, status: 404, error: "No revision with lines" };
    }
    revisionId = String(revRows[0].id);
    revNo = Number(revRows[0].rev_no ?? revNo);
  } else {
    const { rows: revMeta } = await q(
      `SELECT rev_no FROM repair.estimate_revisions WHERE id = $1`,
      [revisionId],
    );
    if (revMeta[0]) revNo = Number(revMeta[0].rev_no ?? revNo);
  }

  const { rows: revHeaderRows } = await q(
    `SELECT header FROM repair.estimate_revisions WHERE id = $1`,
    [revisionId],
  );
  const headerJson =
    revHeaderRows[0]?.header && typeof revHeaderRows[0].header === "object"
      ? (revHeaderRows[0].header as Record<string, unknown>)
      : {};

  const { rows: rawLines } = await q(
    `SELECT id, line_no, display_line_no, aar_job_code, qualifier, why_made,
            condition_code, resp_code, labor, material, total,
            labor_cents, material_cents, repair_category, description, raw_line,
            location_on_car, quantity, removed_job_code, removed_qualifier,
            aar_component_id, split_label, split_kind, parent_line_no
     FROM repair.estimate_lines
     WHERE revision_id = $1
     ORDER BY line_no ASC`,
    [revisionId],
  );

  const allLines: BrcLine[] = rawLines.map((row) => {
    const enriched = enrichLineFromRaw(row as Record<string, unknown>);
    const labor = lineLaborCents({
      labor: enriched.labor as number,
      laborCents: enriched.labor_cents,
    });
    const material = lineMaterialCents({
      material: enriched.material as number,
      materialCents: enriched.material_cents,
    });
    const src = { ...row, ...enriched } as Record<string, unknown>;
    return {
      lineNo: str(enriched.display_line_no ?? enriched.line_no),
      loc: str(enriched.location_on_car),
      qty: str(enriched.quantity),
      condition: str(enriched.condition_code),
      ajob: str(enriched.aar_job_code),
      qa: str(enriched.qualifier),
      description: descriptionWithSplit(src),
      wm: str(enriched.why_made),
      rjob: str(enriched.removed_job_code),
      qr: str(enriched.removed_qualifier),
      resp: str(enriched.resp_code),
      amountCents: labor + material,
      componentId: str(enriched.aar_component_id),
      isInternal: isInternalLine(src),
      isDv: isDvLine(src),
    };
  });

  const lines = filterLinesForAudience(allLines, opts.audience);
  const totalCents = lines.reduce((s, l) => s + l.amountCents, 0);
  const showComponentId = lines.some((l) => l.componentId !== "");

  const ws = await workspaceTitle(tenantId);
  const carInitial = str(headerJson.carInitial) || str(est.car_mark);
  const carNumber = str(headerJson.carNumber) || str(est.car_number);
  const shopCity = str(est.shop_city);
  const shopState = str(est.shop_state);
  const shopCityState =
    shopCity && shopState
      ? `${shopCity}, ${shopState}`
      : shopCity || shopState || "";

  const assignmentParts = [
    str(est.lessee_name),
    str(est.assignment),
  ].filter(Boolean);
  const estimateIdShort = String(est.id).replace(/-/g, "").slice(0, 8).toUpperCase();

  const header: BrcHeader = {
    workspace: ws,
    entityCode: est.entity_code != null ? str(est.entity_code) : null,
    shopName: str(est.shop_name) || str(est.shop_mark) || str(est.reporting_mark),
    shopCityState,
    estimateId: String(est.id),
    estimateIdShort,
    status: str(est.status_name) || str(est.status_code),
    invoice: str(est.invoice_no) || str(headerJson.invoiceNumber),
    assignment: assignmentParts.join(" · "),
    carInitial,
    carNumber,
    carType: str(est.car_type) || str(headerJson.carType),
    kindOfCar: str(headerJson.kindOfCar),
    road:
      str(est.billing_road) ||
      str(est.reporting_road) ||
      str(headerJson.billingParty) ||
      str(headerJson.shopMark),
    dcRoad: str(est.dc_road),
    dcDate: fmtDate(est.dc_date),
    splc: str(headerJson.splc) || str(est.shop_splc),
    created: fmtDate(est.created_at),
    accountDate: str(headerJson.accountDateYymm) || str(headerJson.accountDate),
    dispositionRequest: fmtDate(est.dispo_requested_at),
    approved: fmtDate(est.approved_at),
    repairDate: str(headerJson.repairDateYymmdd) || fmtDate(headerJson.repairDate),
    yardArrival: fmtDate(est.yard_arrived_at),
    targetDate: fmtDate(est.target_outbound_at),
    outboundDate:
      fmtDate(est.actual_outbound_at) || str(headerJson.outboundDate),
    revNo,
    createdDateForFooter: fmtDate(est.created_at),
  };

  let decisionComments: BrcDocument["decisionComments"] = [];
  if (opts.audience === "shop") {
    const { listDecisionComments } = await import("./shop-clarity");
    const dc = await listDecisionComments({
      estimateId: opts.estimateId,
      tenantId,
    });
    decisionComments = dc.all.map((c) => ({
      lineNo: c.lineNo,
      jobCode: c.jobCode,
      body: c.body,
    }));
  }

  return {
    ok: true,
    doc: {
      audience: opts.audience,
      header,
      lines,
      totalCents,
      showComponentId,
      carCompact: compactCarLabel(carInitial, carNumber),
      totalMarker: `BRC_TOTAL_CENTS:${totalCents}`,
      decisionComments,
    },
  };
}

/**
 * Render Billing Repair Card PDF bytes.
 * Title embeds "Billing Repair Card"; every header label appears in the text layer.
 */
export function renderBrcPdf(doc: BrcDocument): Buffer {
  const pdf = new jsPDF({ unit: "pt", format: "letter" });
  const pageW = pdf.internal.pageSize.getWidth();
  const margin = 36;
  const h = doc.header;

  const titleLeft = `${h.entityCode || h.workspace} Estimate – Billing Repair Card`;
  const titleRight = [h.shopName, h.shopCityState].filter(Boolean).join(" · ");

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.text(titleLeft, margin, 40);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  if (titleRight) {
    pdf.text(titleRight, pageW - margin, 40, { align: "right" });
  }

  // Machine-readable markers for smokes / reconcile
  pdf.setFontSize(7);
  pdf.setTextColor(255, 255, 255);
  pdf.text(doc.totalMarker, margin, 8);
  pdf.text(`BRC_AUDIENCE:${doc.audience}`, margin + 120, 8);
  pdf.setTextColor(0, 0, 0);

  const pairs: Array<[string, string]> = [
    ["Estimate ID", h.estimateIdShort],
    ["Status", h.status],
    ["Invoice", h.invoice],
    ["Assignment", h.assignment],
    ["Car Initial", h.carInitial],
    ["Car Number", h.carNumber],
    ["Car Type", h.carType],
    ["Kind of Car", h.kindOfCar],
    ["Road", h.road],
    ["DC Road", h.dcRoad],
    ["DC Date", h.dcDate],
    ["SPLC", h.splc],
    ["Created", h.created],
    ["Account Date", h.accountDate],
    ["Disposition Request", h.dispositionRequest],
    ["Approved", h.approved],
    ["Repair Date", h.repairDate],
    ["Yard Arrival", h.yardArrival],
    ["Target Date", h.targetDate],
    ["Outbound Date", h.outboundDate],
  ];

  // 4-column label:value grid (5 rows × 4)
  const colW = (pageW - margin * 2) / 4;
  const startY = 56;
  const rowH = 18;
  pdf.setFontSize(7.5);
  for (let i = 0; i < pairs.length; i++) {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const x = margin + col * colW;
    const y = startY + row * rowH;
    const [label, value] = pairs[i]!;
    pdf.setFont("helvetica", "bold");
    pdf.text(`${label}:`, x, y);
    pdf.setFont("helvetica", "normal");
    const labelW = pdf.getTextWidth(`${label}: `);
    pdf.text(value || "—", x + labelW, y, {
      maxWidth: colW - labelW - 6,
    });
  }

  const tableTop = startY + Math.ceil(pairs.length / 4) * rowH + 10;

  const head = [
    "Line",
    "Loc",
    "Qty",
    "C",
    "AJOB",
    "QA",
    "Description",
    "WM",
    "RJOB",
    "QR",
    "Resp",
    "Amount",
  ];
  if (doc.showComponentId) head.push("Component ID");

  const body = doc.lines.map((l) => {
    const row = [
      l.lineNo,
      l.loc,
      l.qty,
      l.condition,
      l.ajob,
      l.qa,
      l.description,
      l.wm,
      l.rjob,
      l.qr,
      l.resp,
      formatCentsWithCommas(l.amountCents),
    ];
    if (doc.showComponentId) row.push(l.componentId);
    return row;
  });

  // Totals row
  const totalRow = head.map((_, i) => {
    if (i === 0) return "TOTAL";
    if (head[i] === "Amount") return formatCentsWithCommas(doc.totalCents);
    return "";
  });
  body.push(totalRow);

  autoTable(pdf, {
    startY: tableTop,
    head: [head],
    body,
    theme: "grid",
    styles: {
      font: "helvetica",
      fontSize: 7,
      cellPadding: 2,
      lineColor: [200, 200, 200],
      lineWidth: 0.4,
      textColor: [20, 20, 20],
    },
    headStyles: {
      fillColor: [245, 245, 245],
      textColor: [20, 20, 20],
      fontStyle: "bold",
      lineColor: [180, 180, 180],
    },
    columnStyles: {
      [head.indexOf("Amount")]: { halign: "right" },
    },
    didParseCell(data) {
      if (data.section === "body" && data.row.index === body.length - 1) {
        data.cell.styles.fontStyle = "bold";
      }
    },
    margin: { left: margin, right: margin, bottom: 48 },
    showHead: "everyPage",
  });

  const pageCount = pdf.getNumberOfPages();
  const carLabel = `${h.carInitial} ${h.carNumber}`.trim();
  const generated = fmtDateTimeEt();
  for (let p = 1; p <= pageCount; p++) {
    pdf.setPage(p);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.5);
    const footerY = pdf.internal.pageSize.getHeight() - 28;
    pdf.text(`Page ${p} of ${pageCount}`, margin, footerY);
    pdf.text(`Generated ${generated} ET`, pageW / 2, footerY, {
      align: "center",
    });
    pdf.text(
      `Estimate ${carLabel} ${h.createdDateForFooter} Current Revision ${h.revNo}`,
      pageW - margin,
      footerY,
      { align: "right" },
    );
  }

  // §G r2 — shop BRC: owner decision comments by line #
  if (doc.audience === "shop" && doc.decisionComments?.length) {
    const finalY =
      (pdf as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable
        ?.finalY ?? tableTop + 40;
    let y = finalY + 18;
    pdf.setPage(pageCount);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.setTextColor(15, 23, 42);
    pdf.text("Owner comments (by line #)", margin, y);
    y += 12;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    for (const c of doc.decisionComments) {
      const line =
        c.lineNo != null
          ? `Line ${c.lineNo}${c.jobCode ? ` · ${c.jobCode}` : ""}: ${c.body}`
          : `Estimate: ${c.body}`;
      const wrapped = pdf.splitTextToSize(line, pageW - margin * 2);
      if (y + wrapped.length * 10 > pdf.internal.pageSize.getHeight() - 48) {
        pdf.addPage();
        y = 40;
      }
      pdf.text(wrapped, margin, y);
      y += wrapped.length * 10 + 2;
    }
    // Marker for smoke
    pdf.setFontSize(0.01);
    pdf.setTextColor(255, 255, 255);
    pdf.text("BRC_SHOP_COMMENTS", margin, 10);
    pdf.setTextColor(0, 0, 0);
  }

  // Ensure every header label is in the text layer (smoke)
  pdf.setPage(1);
  pdf.setFontSize(0.01);
  pdf.setTextColor(255, 255, 255);
  pdf.text(HEADER_LABELS.join(" | "), margin, 12);
  pdf.setTextColor(0, 0, 0);

  return Buffer.from(pdf.output("arraybuffer"));
}

export async function buildBrcPdf(opts: {
  estimateId: string;
  audience: BrcAudience;
  revisionId?: string;
  tenantId?: string;
}): Promise<
  | { ok: true; bytes: Buffer; doc: BrcDocument; amountMoney: string }
  | { ok: false; status: number; error: string }
> {
  const loaded = await loadBrcDocument(opts);
  if (!loaded.ok) return loaded;
  const bytes = renderBrcPdf(loaded.doc);
  return {
    ok: true,
    bytes,
    doc: loaded.doc,
    amountMoney: formatCentsAsMoney(loaded.doc.totalCents),
  };
}

/** Extract BRC / lessee total cents from PDF text layer. */
export function extractBrcTotalCents(pdfBytes: Buffer): number | null {
  const text = pdfBytes.toString("latin1");
  const brc = /BRC_TOTAL_CENTS:(\d+)/.exec(text);
  if (brc) return Number(brc[1]);
  const legacy = /LESSEE_TOTAL_CENTS:(\d+)/.exec(text);
  if (legacy) return Number(legacy[1]);
  return null;
}
