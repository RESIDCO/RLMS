/**
 * One-time Equipment Id / Built Date CSV helpers.
 * Writes never happen here — matching and year extraction only.
 */

export type ParsedBuildRow = {
  mark: string;
  car_number: string;
  year: number;
  date: string;
  rawId: string;
  rawDate: string;
};

export type BuildCsvParseResult = {
  dated: ParsedBuildRow[];
  confidential: number;
  invalidDates: Array<{ rawId: string; rawDate: string }>;
  skippedMalformedId: number;
  totalDataRows: number;
};

export function padCarNumber(raw: string): string {
  const digits = String(raw ?? "").trim();
  return digits.padStart(6, "0");
}

export function parseEquipmentId(raw: string): { mark: string; car_number: string } | null {
  const compact = String(raw ?? "")
    .replace(/\s+/g, "")
    .trim()
    .toUpperCase();
  const m = compact.match(/^([A-Z]{2,4})(\d+)$/);
  if (!m) return null;
  const last6 = m[2].slice(-6);
  return { mark: m[1], car_number: padCarNumber(last6) };
}

export function parseBuiltDate(
  raw: string
): { kind: "dated"; year: number; date: string } | { kind: "confidential" } | { kind: "invalid" } {
  const s = String(raw ?? "").trim();
  if (!s) return { kind: "invalid" };
  if (s.toUpperCase() === "CONFIDENTIAL") return { kind: "confidential" };
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return { kind: "invalid" };
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1800 || year > 2100) {
    return { kind: "invalid" };
  }
  const dt = new Date(year, month - 1, day);
  if (dt.getFullYear() !== year || dt.getMonth() !== month - 1 || dt.getDate() !== day) {
    return { kind: "invalid" };
  }
  const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { kind: "dated", year, date };
}

export function matchKey(mark: string, carNumber: string): string {
  return `${String(mark).trim()}|${String(carNumber).trim()}`;
}

/** Minimal two-column quoted CSV (Equipment Id, Built Date). */
export function parseBuildYearCsv(text: string): BuildCsvParseResult {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const dated: ParsedBuildRow[] = [];
  const invalidDates: Array<{ rawId: string; rawDate: string }> = [];
  let confidential = 0;
  let skippedMalformedId = 0;
  let totalDataRows = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = splitCsvLine(line);
    const id = (cols[0] ?? "").trim();
    const dateRaw = (cols[1] ?? "").trim();
    if (i === 0 && /equipment\s*id/i.test(id)) continue;
    totalDataRows += 1;
    const eq = parseEquipmentId(id);
    if (!eq) {
      skippedMalformedId += 1;
      continue;
    }
    const built = parseBuiltDate(dateRaw);
    if (built.kind === "confidential") {
      confidential += 1;
      continue;
    }
    if (built.kind === "invalid") {
      invalidDates.push({ rawId: id, rawDate: dateRaw });
      continue;
    }
    dated.push({
      mark: eq.mark,
      car_number: eq.car_number,
      year: built.year,
      date: built.date,
      rawId: id,
      rawDate: dateRaw,
    });
  }

  return { dated, confidential, invalidDates, skippedMalformedId, totalDataRows };
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
