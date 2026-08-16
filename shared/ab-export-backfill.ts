/**
 * Parse UMLER-style A&B / Original Cost CSV (Equipment Id + Original Cost + packed A&B columns).
 * Matching helpers reuse build-year-backfill equipment-id rules.
 */

import { matchKey, padCarNumber, parseEquipmentId } from "./build-year-backfill.ts";

export { matchKey, padCarNumber, parseEquipmentId };

/** UMLER field codes in this export: A317 amount, A318 type, A319 date, A316 P/N. */
const FIELD_AMOUNT = "317";
const FIELD_TYPE = "318";
const FIELD_DATE = "319";
const FIELD_SIGN = "316";

const TOKEN_RE = /ABIND:AB(\d+)-A(\d+):(.*?)(?=ABIND:AB\d+-A\d+:|$)/g;

export type AbItemParsed = {
  seq: number;
  amount: number;
  code: string;
  sign: "P" | "N";
  application_date: string; // YYYY-MM-DD
};

export type AbCsvRow = {
  mark: string;
  car_number: string;
  rawId: string;
  railinc_oec: number | null;
  abItems: AbItemParsed[];
  confidential: boolean;
};

export type AbCsvParseResult = {
  rows: AbCsvRow[];
  totalDataRows: number;
  confidentialRows: number;
  skippedMalformedId: number;
  oecPopulated: number;
  carsWithAb: number;
  abItemCount: number;
  unknownCodes: string[];
  parseWarnings: string[];
};

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseYyyymmdd(raw: string): string | null {
  const s = String(raw ?? "").trim();
  if (!/^\d{8}$/.test(s)) return null;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(4, 6));
  const d = Number(s.slice(6, 8));
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1800 || y > 2100) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parsePackedField(cell: string): Map<number, Map<string, string>> {
  const bySeq = new Map<number, Map<string, string>>();
  const text = String(cell ?? "").trim();
  if (!text || text.toUpperCase() === "CONFIDENTIAL") return bySeq;
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    const seq = Number(m[1]);
    const field = m[2];
    const value = m[3];
    if (!Number.isFinite(seq)) continue;
    let fields = bySeq.get(seq);
    if (!fields) {
      fields = new Map();
      bySeq.set(seq, fields);
    }
    fields.set(field, value);
  }
  return bySeq;
}

function mergeAbColumns(
  amountCell: string,
  dateCell: string,
  typeCell: string,
  signCell: string,
  rawId: string,
  warnings: string[],
): AbItemParsed[] {
  const amounts = parsePackedField(amountCell);
  const dates = parsePackedField(dateCell);
  const types = parsePackedField(typeCell);
  const signs = parsePackedField(signCell);
  const seqs = new Set<number>([
    ...amounts.keys(),
    ...dates.keys(),
    ...types.keys(),
    ...signs.keys(),
  ]);
  const items: AbItemParsed[] = [];
  for (const seq of [...seqs].sort((a, b) => a - b)) {
    const amountRaw = amounts.get(seq)?.get(FIELD_AMOUNT);
    const dateRaw = dates.get(seq)?.get(FIELD_DATE);
    const codeRaw = types.get(seq)?.get(FIELD_TYPE);
    const signRaw = (signs.get(seq)?.get(FIELD_SIGN) ?? "").trim().toUpperCase();
    const amount = amountRaw != null && amountRaw !== "" ? Number(amountRaw) : NaN;
    const application_date = dateRaw ? parseYyyymmdd(dateRaw) : null;
    const code = (codeRaw ?? "").trim().toUpperCase();
    if (!Number.isFinite(amount) || amount < 0 || !application_date || !code || (signRaw !== "P" && signRaw !== "N")) {
      warnings.push(`${rawId}: incomplete A&B seq ${seq}`);
      continue;
    }
    items.push({
      seq,
      amount,
      code,
      sign: signRaw as "P" | "N",
      application_date,
    });
  }
  return items;
}

export function parseAbExportCsv(text: string): AbCsvParseResult {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const rows: AbCsvRow[] = [];
  const parseWarnings: string[] = [];
  const unknownCodeSet = new Set<string>();
  let totalDataRows = 0;
  let confidentialRows = 0;
  let skippedMalformedId = 0;
  let oecPopulated = 0;
  let carsWithAb = 0;
  let abItemCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = splitCsvLine(line);
    const id = (cols[0] ?? "").trim();
    if (i === 0 && /equipment\s*id/i.test(id)) continue;
    totalDataRows += 1;

    const costRaw = (cols[1] ?? "").trim();
    const amountCell = (cols[2] ?? "").trim();
    const dateCell = (cols[3] ?? "").trim();
    const typeCell = (cols[4] ?? "").trim();
    const signCell = (cols[5] ?? "").trim();

    const allConf =
      [costRaw, amountCell, dateCell, typeCell, signCell].every(
        (c) => !c || c.toUpperCase() === "CONFIDENTIAL",
      ) &&
      [costRaw, amountCell, dateCell, typeCell, signCell].some((c) => c.toUpperCase() === "CONFIDENTIAL");

    const eq = parseEquipmentId(id);
    if (!eq) {
      skippedMalformedId += 1;
      continue;
    }

    if (allConf) {
      confidentialRows += 1;
      rows.push({
        mark: eq.mark,
        car_number: eq.car_number,
        rawId: id,
        railinc_oec: null,
        abItems: [],
        confidential: true,
      });
      continue;
    }

    let railinc_oec: number | null = null;
    if (costRaw && costRaw.toUpperCase() !== "CONFIDENTIAL") {
      const n = Number(costRaw.replace(/,/g, ""));
      if (Number.isFinite(n)) {
        railinc_oec = n;
        oecPopulated += 1;
      } else {
        parseWarnings.push(`${id}: bad Original Cost "${costRaw}"`);
      }
    }

    const abItems =
      amountCell.toUpperCase() === "CONFIDENTIAL"
        ? []
        : mergeAbColumns(amountCell, dateCell, typeCell, signCell, id, parseWarnings);

    if (abItems.length) {
      carsWithAb += 1;
      abItemCount += abItems.length;
      for (const it of abItems) unknownCodeSet.add(it.code);
    }

    rows.push({
      mark: eq.mark,
      car_number: eq.car_number,
      rawId: id,
      railinc_oec,
      abItems,
      confidential: false,
    });
  }

  return {
    rows,
    totalDataRows,
    confidentialRows,
    skippedMalformedId,
    oecPopulated,
    carsWithAb,
    abItemCount,
    unknownCodes: [...unknownCodeSet].sort(),
    parseWarnings,
  };
}
