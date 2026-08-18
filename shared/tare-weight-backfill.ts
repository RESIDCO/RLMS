/**
 * One-time Equipment Id / Tare Weight CSV helpers.
 * Writes never happen here — parse and match only.
 */
import { matchKey, parseEquipmentId } from "./build-year-backfill.ts";

export { matchKey, parseEquipmentId };

export type ParsedTareRow = {
  mark: string;
  car_number: string;
  tare_weight_lbs: number;
  rawId: string;
};

export type TareCsvParseResult = {
  rows: ParsedTareRow[];
  blankTare: number;
  blankTareIds: string[];
  skippedMalformedId: number;
  skippedNonNumericTare: number;
  totalDataRows: number;
  duplicateKeys: string[];
};

export function parseTareWeight(raw: string): number | null {
  const s = String(raw ?? "").trim().replace(/,/g, "");
  if (!s) return null;
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

export function parseTareWeightCsv(text: string): TareCsvParseResult {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const rows: ParsedTareRow[] = [];
  const blankTareIds: string[] = [];
  const seen = new Map<string, string>();
  const duplicateKeys: string[] = [];
  let skippedMalformedId = 0;
  let skippedNonNumericTare = 0;
  let totalDataRows = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = splitCsvLine(line);
    const id = (cols[0] ?? "").trim();
    const tareRaw = (cols[1] ?? "").trim();
    if (i === 0 && /equipment\s*id/i.test(id)) continue;
    totalDataRows += 1;
    const eq = parseEquipmentId(id);
    if (!eq) {
      skippedMalformedId += 1;
      continue;
    }
    const tare = parseTareWeight(tareRaw);
    if (tare == null) {
      if (!tareRaw) blankTareIds.push(id);
      else skippedNonNumericTare += 1;
      continue;
    }
    const k = matchKey(eq.mark, eq.car_number);
    if (seen.has(k)) duplicateKeys.push(`${k} (${id})`);
    else seen.set(k, id);
    rows.push({
      mark: eq.mark,
      car_number: eq.car_number,
      tare_weight_lbs: tare,
      rawId: id,
    });
  }

  return {
    rows,
    blankTare: blankTareIds.length,
    blankTareIds,
    skippedMalformedId,
    skippedNonNumericTare,
    totalDataRows,
    duplicateKeys,
  };
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQ = !inQ;
      }
    } else if (ch === "," && !inQ) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}
