/**
 * Pure bid-sheet parsing. Excel and CSV bytes are turned into grids by the
 * server; this module does not read files and does not set bid prices.
 */

export const BID_IMPORT_MAX_BYTES = 20 * 1024 * 1024;
export const BID_IMPORT_MAX_SHEETS = 50;
export const BID_IMPORT_MAX_COLUMNS = 200;
export const BID_IMPORT_MAX_LINES = 2000;
export const BID_IMPORT_MAX_CELL = 1000;
export const BID_IMPORT_MAX_UNCOMPRESSED = 100 * 1024 * 1024;
export const BID_IMPORT_MAX_ZIP_RATIO = 100;
export const BID_IMPORT_BUILD_YEAR_MIN = 1950;

export const BID_IMPORT_FIELDS = [
  "seller_deal_ref",
  "lessee_desc",
  "company_desc",
  "lessee_rating",
  "lessee_country",
  "car_count",
  "equipment_desc",
  "car_type",
  "aar_code",
  "avg_build_year",
  "commodity",
  "lease_rate",
  "lease_expiry",
  "purchase_option",
  "notes",
  "page",
] as const;

export type BidImportField = (typeof BID_IMPORT_FIELDS)[number];

export const BID_IMPORT_FIELD_LABEL: Record<BidImportField, string> = {
  seller_deal_ref: "Deal",
  lessee_desc: "Lessee",
  company_desc: "Company description",
  lessee_rating: "Rating",
  lessee_country: "Country",
  car_count: "Cars",
  equipment_desc: "Equipment",
  car_type: "Car type",
  aar_code: "AAR",
  avg_build_year: "Build year",
  commodity: "Commodity",
  lease_rate: "Lease rate",
  lease_expiry: "Expiry",
  purchase_option: "Purchase option",
  notes: "Notes",
  page: "Page",
};

const SYNONYMS: Record<BidImportField, readonly string[]> = {
  seller_deal_ref: ["deal", "deal #", "deal no", "deal number", "deal num", "ref", "reference", "seller deal", "seller deal ref"],
  lessee_desc: ["lessee", "lessee name", "lessee description", "lessee desc", "customer"],
  company_desc: ["company description", "company desc", "description of company"],
  lessee_rating: ["rating", "ratings", "lessee rating", "credit rating", "s p moody s ratings", "sp moody s ratings"],
  lessee_country: ["country", "lessee country", "domicile"],
  car_count: ["cars", "car count", "# cars", "units", "qty", "quantity", "no of cars", "number of cars"],
  equipment_desc: ["equipment", "equipment description", "equipment desc", "car description"],
  car_type: ["car type", "equipment type", "car_type"],
  aar_code: ["aar", "aar code", "aar car type"],
  avg_build_year: ["build year", "average build year", "avg build year", "year built", "built"],
  commodity: ["commodity", "product", "lading"],
  lease_rate: ["lease rate", "rent", "monthly rate", "monthly rent", "rate"],
  lease_expiry: ["expiry", "expiration", "lease expiry", "lease expiration", "exp", "maturity", "lease end", "end date"],
  purchase_option: ["purchase option", "fixed option", "buyout", "purchase opt"],
  notes: ["notes", "note", "comments", "comment"],
  page: ["page", "om page"],
};

const HEADER_LABELS: Record<string, keyof BidHeaderFields> = {
  title: "offering_name",
  offering: "offering_name",
  "offering name": "offering_name",
  name: "offering_name",
  seller: "seller",
  manager: "seller",
  "seller manager": "seller",
  received: "received_date",
  "received date": "received_date",
  "date received": "received_date",
  "preliminary deadline": "bid_due_prelim",
  prelim: "bid_due_prelim",
  "bid due prelim": "bid_due_prelim",
  "preliminary due": "bid_due_prelim",
  "final deadline": "bid_due_final",
  "final due": "bid_due_final",
  "bid due final": "bid_due_final",
  award: "award_date",
  "award date": "award_date",
};

export type ImportCell = string | number | boolean | Date | null;

export type ImportGrid = {
  name: string;
  rows: ImportCell[][];
};

export type CellConfidence = "high" | "medium" | "low";

export type ProposedLine = {
  seller_deal_ref: string;
  lessee_desc: string | null;
  lessee_rating: string | null;
  lessee_country: string | null;
  car_count: number;
  equipment_desc: string | null;
  car_type: string | null;
  aar_code: string | null;
  avg_build_year: number | null;
  commodity: string | null;
  lease_rate: number | null;
  lease_expiry: string | null;
  purchase_option: boolean | null;
  notes: string | null;
  sort_order: number;
  group_label: string | null;
  confidence: Partial<Record<string, CellConfidence>>;
  sources: Partial<Record<string, string>>;
};

export type BidHeaderFields = {
  offering_name: string | null;
  seller: string | null;
  received_date: string | null;
  bid_due_prelim: string | null;
  bid_due_final: string | null;
  award_date: string | null;
  title: string | null;
};

export type ImportFlag = {
  id: string;
  severity: "block" | "warn";
  message: string;
  line_indexes?: number[];
};

export type MappedColumn = {
  index: number;
  header: string;
  field: BidImportField | null;
  confidence: "high" | "medium";
};

export type BidColumnMapping = Partial<Record<BidImportField, number>>;

export type BidImportProposal = {
  sheet: string;
  sheets: { name: string; matches: number }[];
  header_row: number;
  header_signature_material: string;
  columns: MappedColumn[];
  mapping: BidColumnMapping;
  header_fields: BidHeaderFields;
  lines: ProposedLine[];
  flags: ImportFlag[];
  price_columns: { index: number; header: string }[];
  stated_car_total: number | null;
  car_total: number;
  truncated_cells: string[];
};

export class BidImportError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "BidImportError";
    this.status = status;
  }
}

export function normalizeHeader(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_/]+/g, " ")
    .replace(/[^a-z0-9#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function headerSignatureMaterial(headers: readonly string[]): string {
  const norm = headers.map((header) => normalizeHeader(header)).filter(Boolean);
  return [...norm].sort().join("\n");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array<number>(b.length + 1);
  const cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = cur[j];
  }
  return prev[b.length];
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const dist = levenshtein(a, b);
  const lev = 1 - dist / Math.max(a.length, b.length);
  const ta = new Set(a.split(" ").filter(Boolean));
  const tb = new Set(b.split(" ").filter(Boolean));
  let inter = 0;
  for (const token of ta) if (tb.has(token)) inter += 1;
  const token = inter / (ta.size + tb.size - inter);
  return Math.max(lev, token);
}

function scoreHeader(header: string, field: BidImportField): { score: number; exact: boolean } {
  const norm = normalizeHeader(header);
  const stripped = norm.replace(/\s+\d+$/, "");
  const forms = stripped === norm ? [norm] : [norm, stripped];
  let best = 0;
  for (const synonym of SYNONYMS[field]) {
    for (const form of forms) {
      if (form === synonym) return { score: 1, exact: true };
      const score = similarity(form, synonym);
      if (score > best) best = score;
    }
  }
  return { score: best, exact: false };
}

type ColumnPick = { field: BidImportField; confidence: "high" | "medium"; score: number };

function pickField(header: string): ColumnPick | null {
  let best: ColumnPick | null = null;
  for (const field of BID_IMPORT_FIELDS) {
    const scored = scoreHeader(header, field);
    if (scored.score < 0.8) continue;
    const confidence: "high" | "medium" = scored.exact ? "high" : "medium";
    if (!best || scored.score > best.score) best = { field, confidence, score: scored.score };
  }
  return best;
}

function columnLetter(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function cellRef(sheet: string, row: number, col: number): string {
  return `${sheet}!${columnLetter(col)}${row}`;
}

function textOf(cell: ImportCell | undefined): string {
  if (cell == null) return "";
  if (cell instanceof Date) return Number.isNaN(cell.getTime()) ? "" : cell.toISOString().slice(0, 10);
  if (typeof cell === "boolean") return cell ? "Yes" : "No";
  if (typeof cell === "number") return Number.isFinite(cell) ? String(cell) : "";
  return String(cell).replace(/\s+/g, " ").trim();
}

function emptyHeaderFields(): BidHeaderFields {
  return {
    offering_name: null,
    seller: null,
    received_date: null,
    bid_due_prelim: null,
    bid_due_final: null,
    award_date: null,
    title: null,
  };
}

function parseLooseDate(cell: ImportCell | undefined): string | null {
  const parsed = asDate(cell);
  return parsed.ok ? parsed.value : null;
}

function readHeaderPairs(rows: ImportCell[][], limit: number): BidHeaderFields {
  const fields = emptyHeaderFields();
  for (let r = 0; r < limit; r += 1) {
    const row = rows[r] ?? [];
    for (let c = 0; c < row.length; c += 1) {
      const label = normalizeHeader(textOf(row[c])).replace(/\s+\d+$/, "");
      const key = HEADER_LABELS[label];
      if (!key) continue;
      const valueCell = row[c + 1];
      if (key.endsWith("_date") || key === "received_date" || key === "award_date" || key === "bid_due_prelim" || key === "bid_due_final") {
        const date = parseLooseDate(valueCell);
        if (date) fields[key] = date;
        continue;
      }
      const text = textOf(valueCell);
      if (text) fields[key] = text;
    }
  }
  if (fields.offering_name && !fields.title) fields.title = fields.offering_name;
  return fields;
}

function mergeHeaders(base: BidHeaderFields, extra: BidHeaderFields): BidHeaderFields {
  const out = { ...base };
  for (const key of Object.keys(extra) as (keyof BidHeaderFields)[]) {
    if (extra[key] && !out[key]) out[key] = extra[key];
  }
  if (out.offering_name && !out.title) out.title = out.offering_name;
  return out;
}

type ParsedNumber = { ok: true; value: number; coerced: boolean } | { ok: false };
type ParsedDate = { ok: true; value: string; coerced: boolean } | { ok: false };
type ParsedBool = { ok: true; value: boolean; coerced: boolean } | { ok: false };

function asNumber(cell: ImportCell | undefined): ParsedNumber {
  if (typeof cell === "number" && Number.isFinite(cell)) return { ok: true, value: cell, coerced: false };
  if (typeof cell === "string") {
    const cleaned = cell.replace(/[$,]/g, "").trim();
    if (!cleaned) return { ok: false };
    const value = Number(cleaned);
    if (!Number.isFinite(value)) return { ok: false };
    return { ok: true, value, coerced: true };
  }
  return { ok: false };
}

function excelSerial(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 20000 || serial > 80000) return null;
  const utc = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000);
  const year = utc.getUTCFullYear();
  const month = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const day = String(utc.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function asDate(cell: ImportCell | undefined): ParsedDate {
  if (cell instanceof Date && !Number.isNaN(cell.getTime())) {
    return { ok: true, value: cell.toISOString().slice(0, 10), coerced: false };
  }
  if (typeof cell === "number") {
    const iso = excelSerial(cell);
    if (iso) return { ok: true, value: iso, coerced: true };
    return { ok: false };
  }
  if (typeof cell === "string") {
    const text = cell.trim();
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
    if (iso) return { ok: true, value: `${iso[1]}-${iso[2]}-${iso[3]}`, coerced: false };
    const us = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
    if (us) {
      const month = us[1].padStart(2, "0");
      const day = us[2].padStart(2, "0");
      return { ok: true, value: `${us[3]}-${month}-${day}`, coerced: true };
    }
  }
  return { ok: false };
}

function asBool(cell: ImportCell | undefined): ParsedBool {
  if (typeof cell === "boolean") return { ok: true, value: cell, coerced: false };
  if (typeof cell === "number") {
    if (cell === 1) return { ok: true, value: true, coerced: true };
    if (cell === 0) return { ok: true, value: false, coerced: true };
    return { ok: false };
  }
  if (typeof cell === "string") {
    const text = cell.trim().toLowerCase();
    if (text === "yes" || text === "y" || text === "true") return { ok: true, value: true, coerced: false };
    if (text === "no" || text === "n" || text === "false") return { ok: true, value: false, coerced: false };
  }
  return { ok: false };
}

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

function isPriceHeader(header: string): boolean {
  const norm = normalizeHeader(header).replace(/\s+\d+$/, "");
  if (/lease rate|monthly rate|\brent\b/.test(norm)) return false;
  if (/\b(price|bid|offer) per car\b/.test(norm) || norm === "price per car") return true;
  if (["price", "bid price", "offer price", "prelim price", "final price", "market price", "unit price"].includes(norm)) {
    return true;
  }
  return /\b(price|bid|offer)\b/.test(norm) && /\bper\b/.test(norm);
}

type Footnote = { n: number; text: string };

function footnoteDefs(rows: ImportCell[][], start: number): Footnote[] {
  const found: Footnote[] = [];
  for (let r = start; r < rows.length; r += 1) {
    const row = rows[r] ?? [];
    const texts = row.map((cell) => textOf(cell)).filter(Boolean);
    if (texts.length !== 1) continue;
    const match = /^(\d+)\s+(\S[\s\S]*)$/.exec(texts[0]);
    if (!match || texts[0].length < 12) continue;
    found.push({ n: Number(match[1]), text: match[2] });
  }
  return found;
}

function splitMarker(text: string, notes: ReadonlySet<number>): { text: string; marker: number | null } {
  const match = /^(.*\S)\s+(\d+)$/.exec(text.trim());
  if (!match) return { text: text.trim(), marker: null };
  const n = Number(match[2]);
  if (!notes.has(n)) return { text: text.trim(), marker: null };
  return { text: match[1].trim(), marker: n };
}

function sheetMatchCount(grid: ImportGrid): { matches: number; headerRow: number; headers: string[]; picks: (ColumnPick | null)[] } {
  let best = { matches: 0, headerRow: 0, headers: [] as string[], picks: [] as (ColumnPick | null)[] };
  const limit = Math.min(grid.rows.length, 40);
  for (let r = 0; r < limit; r += 1) {
    const row = grid.rows[r] ?? [];
    if (row.length > BID_IMPORT_MAX_COLUMNS) {
      throw new BidImportError(400, `A sheet has more than ${BID_IMPORT_MAX_COLUMNS} columns`);
    }
    const picks: (ColumnPick | null)[] = [];
    const headers: string[] = [];
    let matches = 0;
    for (let c = 0; c < row.length; c += 1) {
      const header = textOf(row[c]);
      headers.push(header);
      if (!header) {
        picks.push(null);
        continue;
      }
      const pick = pickField(header);
      picks.push(pick);
      if (pick) matches += 1;
    }
    if (matches > best.matches) best = { matches, headerRow: r, headers, picks };
  }
  return best;
}

function applyMapping(picks: (ColumnPick | null)[], mapping: BidColumnMapping | null | undefined, headers: string[]): (ColumnPick | null)[] {
  if (!mapping) return picks;
  const next = picks.map((pick) => pick);
  for (const field of BID_IMPORT_FIELDS) {
    const index = mapping[field];
    if (index == null || !Number.isInteger(index) || index < 0 || index >= headers.length) continue;
    for (let c = 0; c < next.length; c += 1) {
      if (next[c]?.field === field) next[c] = null;
    }
    const auto = scoreHeader(headers[index] ?? "", field);
    next[index] = {
      field,
      confidence: auto.exact ? "high" : "medium",
      score: auto.exact ? 1 : 0.8,
    };
  }
  return next;
}

function dealStem(ref: string): string | null {
  const match = /^(\d+)([a-z])$/i.exec(ref.trim());
  return match ? match[1] : null;
}

function todayYear(today: string): number {
  const year = Number(today.slice(0, 4));
  return Number.isFinite(year) ? year : new Date().getUTCFullYear();
}

function blankLine(sort: number): ProposedLine {
  return {
    seller_deal_ref: "",
    lessee_desc: null,
    lessee_rating: null,
    lessee_country: null,
    car_count: 0,
    equipment_desc: null,
    car_type: null,
    aar_code: null,
    avg_build_year: null,
    commodity: null,
    lease_rate: null,
    lease_expiry: null,
    purchase_option: null,
    notes: null,
    sort_order: sort,
    group_label: null,
    confidence: {},
    sources: {},
  };
}

type MarkerBag = { field: string; marker: number };

function footnoteSentence(note: Footnote, refsForStem: Map<string, string[]>): string | null {
  const text = note.text;
  if (/country-specific taxes/i.test(text)) return "Country-specific taxes may apply";
  if (/indivisible|car groups/i.test(text)) {
    const deal = /deal\s+(\d+)/i.exec(text)?.[1];
    if (!deal) return null;
    const refs = refsForStem.get(deal) ?? [];
    const list = refs.length ? refs.join("/") : deal;
    return `Deal ${deal} is one indivisible rider (${list})`;
  }
  const named = /lessees\s+([A-Za-z])\s+and\s+([A-Za-z])/i.exec(text);
  if (named && /parent/i.test(text) && /preferred/i.test(text)) {
    return `Lessees ${named[1].toUpperCase()} & ${named[2].toUpperCase()} share parent/guarantor; bids for all five deals preferred`;
  }
  return null;
}

export function parseBidWorkbook(
  sheets: ImportGrid[],
  opts: {
    sheet?: string | null;
    mapping?: BidColumnMapping | null;
    existing?: readonly { seller_deal_ref: string; car_type: string | null }[];
    mode?: "append" | "replace";
    today?: string;
  } = {},
): BidImportProposal {
  if (sheets.length > BID_IMPORT_MAX_SHEETS) {
    throw new BidImportError(400, `Workbooks are limited to ${BID_IMPORT_MAX_SHEETS} sheets`);
  }
  if (!sheets.length) throw new BidImportError(400, "The file has no sheets");
  const scored = sheets.map((grid) => ({ grid, ...sheetMatchCount(grid) }));
  const offering = sheets.find((grid) => normalizeHeader(grid.name) === "offering");
  let headerFields = offering ? readHeaderPairs(offering.rows, offering.rows.length) : emptyHeaderFields();

  const ranked = [...scored].sort((a, b) => b.matches - a.matches || a.grid.name.localeCompare(b.grid.name));
  const requested = opts.sheet?.trim();
  const chosen = requested
    ? scored.find((row) => row.grid.name === requested)
    : ranked[0];
  if (!chosen) throw new BidImportError(400, "That sheet is not in the workbook");
  if (chosen.matches < 3) throw new BidImportError(400, "No sheet has a recognisable header row");

  const above = readHeaderPairs(chosen.grid.rows, chosen.headerRow);
  headerFields = mergeHeaders(headerFields, above);

  const picks = applyMapping(chosen.picks, opts.mapping, chosen.headers);
  const used = new Set<BidImportField>();
  const columns: MappedColumn[] = chosen.headers.map((header, index) => {
    const pick = picks[index];
    if (!header) return { index, header, field: null, confidence: "medium" };
    if (!pick || used.has(pick.field)) return { index, header, field: null, confidence: pick?.confidence ?? "medium" };
    used.add(pick.field);
    return { index, header, field: pick.field, confidence: pick.confidence };
  });
  const col = (field: BidImportField): number | null => columns.find((row) => row.field === field)?.index ?? null;
  const mapping: BidColumnMapping = {};
  for (const row of columns) {
    if (row.field) mapping[row.field] = row.index;
  }

  const price_columns = columns
    .filter((row) => row.header && row.field !== "lease_rate" && isPriceHeader(row.header))
    .map((row) => ({ index: row.index, header: row.header }));

  const footnotes = footnoteDefs(chosen.grid.rows, chosen.headerRow + 1);
  const footnoteIds = new Set(footnotes.map((note) => note.n));
  const dealCol = col("seller_deal_ref");
  const lesseeCol = col("lessee_desc");
  const companyCol = col("company_desc");
  const carsCol = col("car_count");

  const truncated_cells: string[] = [];
  const rawLines: { line: ProposedLine; markers: MarkerBag[]; page: string | null }[] = [];
  let stated: number | null = null;
  let previousRef = "";

  const takeText = (row: ImportCell[], index: number | null, r: number, field: string, line: ProposedLine, markers: MarkerBag[]): string => {
    if (index == null) return "";
    let text = textOf(row[index]);
    if (text.length > BID_IMPORT_MAX_CELL) {
      truncated_cells.push(cellRef(chosen.grid.name, r + 1, index));
      text = text.slice(0, BID_IMPORT_MAX_CELL);
    }
    const split = splitMarker(text, footnoteIds);
    if (split.marker != null) markers.push({ field, marker: split.marker });
    const source = columns.find((item) => item.field === field);
    const exact = source?.confidence === "high";
    line.sources[field] = cellRef(chosen.grid.name, r + 1, index);
    line.confidence[field] = exact ? "high" : "medium";
    return split.text;
  };

  for (let r = chosen.headerRow + 1; r < chosen.grid.rows.length; r += 1) {
    const row = chosen.grid.rows[r] ?? [];
    if (row.length > BID_IMPORT_MAX_COLUMNS) {
      throw new BidImportError(400, `A sheet has more than ${BID_IMPORT_MAX_COLUMNS} columns`);
    }
    const head = row.slice(0, 4).map((cell) => textOf(cell)).join(" ");
    const filled = row.map((cell) => textOf(cell)).filter(Boolean);
    const dealRaw = dealCol == null ? "" : textOf(row[dealCol]);
    const lesseeRaw = lesseeCol == null ? "" : textOf(row[lesseeCol]);
    const carsRaw = carsCol == null ? undefined : row[carsCol];
    const carsNum = asNumber(carsRaw);
    const blankDeal = !dealRaw;
    const blankLessee = !lesseeRaw;
    if (/\bsub\s*total\b|\btotal\b/i.test(head)) {
      if (carsNum.ok) stated = carsNum.value;
      continue;
    }
    if (filled.length === 1 && /^\d+\s+\S/.test(filled[0]) && filled[0].length > 20) continue;
    if (blankDeal && blankLessee) {
      if (carsNum.ok) stated = carsNum.value;
      continue;
    }
    if (rawLines.length >= BID_IMPORT_MAX_LINES) {
      throw new BidImportError(400, `Bid sheets are limited to ${BID_IMPORT_MAX_LINES} lines`);
    }
    const line = blankLine(rawLines.length + 1);
    const markers: MarkerBag[] = [];
    let ref = takeText(row, dealCol, r, "seller_deal_ref", line, markers);
    const inherited = !ref && !!previousRef;
    if (inherited) ref = previousRef;
    if (ref) previousRef = ref;
    line.seller_deal_ref = ref;
    const code = takeText(row, lesseeCol, r, "lessee_desc", line, markers);
    const company = takeText(row, companyCol, r, "company_desc", line, markers);
    if (company && /^[A-Za-z]{1,3}$/.test(code)) {
      line.lessee_desc = `Lessee ${code} \u2013 ${company}`;
      line.confidence.lessee_desc = columns.find((item) => item.field === "lessee_desc")?.confidence === "high" ? "medium" : "medium";
    } else {
      line.lessee_desc = code || company || null;
    }
    line.lessee_rating = takeText(row, col("lessee_rating"), r, "lessee_rating", line, markers) || null;
    line.lessee_country = takeText(row, col("lessee_country"), r, "lessee_country", line, markers) || null;
    line.equipment_desc = takeText(row, col("equipment_desc"), r, "equipment_desc", line, markers) || null;
    line.car_type = takeText(row, col("car_type"), r, "car_type", line, markers) || null;
    line.aar_code = takeText(row, col("aar_code"), r, "aar_code", line, markers) || null;
    line.commodity = takeText(row, col("commodity"), r, "commodity", line, markers) || null;
    const noteText = takeText(row, col("notes"), r, "notes", line, markers);
    line.notes = noteText || null;
    const page = takeText(row, col("page"), r, "page", line, markers) || null;

    const carsIndex = col("car_count");
    if (carsIndex != null && textOf(row[carsIndex])) {
      const parsed = asNumber(row[carsIndex]);
      line.sources.car_count = cellRef(chosen.grid.name, r + 1, carsIndex);
      if (!parsed.ok) line.confidence.car_count = "low";
      else {
        line.car_count = Math.trunc(parsed.value);
        const exact = columns.find((item) => item.field === "car_count")?.confidence === "high";
        line.confidence.car_count = exact && !parsed.coerced ? "high" : "medium";
      }
    }
    const yearIndex = col("avg_build_year");
    if (yearIndex != null && textOf(row[yearIndex])) {
      const parsed = asNumber(row[yearIndex]);
      line.sources.avg_build_year = cellRef(chosen.grid.name, r + 1, yearIndex);
      if (!parsed.ok) line.confidence.avg_build_year = "low";
      else {
        line.avg_build_year = Math.trunc(parsed.value);
        const exact = columns.find((item) => item.field === "avg_build_year")?.confidence === "high";
        line.confidence.avg_build_year = exact && !parsed.coerced ? "high" : "medium";
      }
    }
    const rateIndex = col("lease_rate");
    if (rateIndex != null && textOf(row[rateIndex])) {
      const parsed = asNumber(row[rateIndex]);
      line.sources.lease_rate = cellRef(chosen.grid.name, r + 1, rateIndex);
      if (!parsed.ok) line.confidence.lease_rate = "low";
      else {
        line.lease_rate = money(parsed.value);
        const exact = columns.find((item) => item.field === "lease_rate")?.confidence === "high";
        line.confidence.lease_rate = exact && !parsed.coerced ? "high" : "medium";
      }
    }
    const expIndex = col("lease_expiry");
    if (expIndex != null && textOf(row[expIndex])) {
      const parsed = asDate(row[expIndex]);
      line.sources.lease_expiry = cellRef(chosen.grid.name, r + 1, expIndex);
      if (!parsed.ok) line.confidence.lease_expiry = "low";
      else {
        line.lease_expiry = parsed.value;
        const exact = columns.find((item) => item.field === "lease_expiry")?.confidence === "high";
        line.confidence.lease_expiry = exact && !parsed.coerced ? "high" : "medium";
      }
    }
    const poIndex = col("purchase_option");
    if (poIndex != null && textOf(row[poIndex])) {
      const parsed = asBool(row[poIndex]);
      line.sources.purchase_option = cellRef(chosen.grid.name, r + 1, poIndex);
      if (!parsed.ok) line.confidence.purchase_option = "low";
      else {
        line.purchase_option = parsed.value;
        const exact = columns.find((item) => item.field === "purchase_option")?.confidence === "high";
        line.confidence.purchase_option = exact && !parsed.coerced ? "high" : "medium";
      }
    }
    if (inherited) line.confidence.seller_deal_ref = "medium";
    rawLines.push({ line, markers, page });
  }

  if (rawLines.length > BID_IMPORT_MAX_LINES) {
    throw new BidImportError(400, `Bid sheets are limited to ${BID_IMPORT_MAX_LINES} lines`);
  }

  const refsForStem = new Map<string, string[]>();
  for (const row of rawLines) {
    const stem = dealStem(row.line.seller_deal_ref);
    if (!stem) continue;
    const list = refsForStem.get(stem) ?? [];
    list.push(row.line.seller_deal_ref);
    refsForStem.set(stem, list);
  }
  const footnoteText = new Map(footnotes.map((note) => [note.n, footnoteSentence(note, refsForStem)]));
  const parentRating = footnotes.some((note) => /credit rating of parent/i.test(note.text))
    ? footnotes.filter((note) => /credit rating of parent/i.test(note.text)).map((note) => note.n)
    : [];

  for (const row of rawLines) {
    const extra: string[] = [];
    if (row.page && /^\d+$/.test(row.page)) extra.push(`OM p.${row.page}`);
    for (const mark of row.markers) {
      if (parentRating.includes(mark.marker) && mark.field === "lessee_rating" && row.line.lessee_rating) {
        if (!row.line.lessee_rating.endsWith("(parent)")) row.line.lessee_rating = `${row.line.lessee_rating} (parent)`;
        continue;
      }
      const sentence = footnoteText.get(mark.marker);
      if (sentence && !extra.includes(sentence)) extra.push(sentence);
    }
    const parts = [...extra];
    if (row.line.notes) parts.push(row.line.notes);
    row.line.notes = parts.length ? parts.join("; ") : null;
  }

  const lines = rawLines.map((row) => row.line);
  const flags: ImportFlag[] = [];
  const car_total = lines.reduce((sum, line) => sum + (Number.isFinite(line.car_count) ? line.car_count : 0), 0);
  if (stated != null && stated !== car_total) {
    flags.push({
      id: "car_total",
      severity: "block",
      message: `Car total ${car_total} does not match the stated total ${stated}`,
    });
  }

  const byRef = new Map<string, number[]>();
  lines.forEach((line, index) => {
    const key = line.seller_deal_ref.toLowerCase();
    const list = byRef.get(key) ?? [];
    list.push(index);
    byRef.set(key, list);
  });
  for (const [, indexes] of byRef) {
    if (indexes.length < 2) continue;
    const ref = lines[indexes[0]].seller_deal_ref;
    const label = `Deal ${ref} (${indexes.length} groups)`;
    for (const index of indexes) lines[index].group_label = label;
    flags.push({
      id: `subgroups:${ref.toLowerCase()}`,
      severity: "warn",
      message: label,
      line_indexes: indexes,
    });
    flags.push({
      id: `duplicate_ref:${ref.toLowerCase()}`,
      severity: "warn",
      message: `Deal ${ref} is listed ${indexes.length} times`,
      line_indexes: indexes,
    });
  }
  for (const [stem, refs] of refsForStem) {
    if (refs.length < 2) continue;
    const indexes = lines
      .map((line, index) => (dealStem(line.seller_deal_ref) === stem ? index : -1))
      .filter((index) => index >= 0);
    const label = `Deal ${stem} (${indexes.length} groups)`;
    for (const index of indexes) lines[index].group_label = label;
    flags.push({
      id: `subgroups:${stem}`,
      severity: "warn",
      message: label,
      line_indexes: indexes,
    });
  }

  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const yearCap = todayYear(today);
  lines.forEach((line, index) => {
    if (!line.lessee_desc) {
      flags.push({ id: `missing_lessee:${index}`, severity: "warn", message: `Line ${index + 1} has no lessee`, line_indexes: [index] });
    }
    if (!line.car_count) {
      flags.push({ id: `missing_cars:${index}`, severity: "warn", message: `Line ${index + 1} has no car count`, line_indexes: [index] });
    }
    if (line.confidence.car_count === "low" || line.confidence.lease_rate === "low" || line.confidence.avg_build_year === "low") {
      flags.push({ id: `non_numeric:${index}`, severity: "warn", message: `Line ${index + 1} has a non-numeric value`, line_indexes: [index] });
    }
    if (line.avg_build_year != null && (line.avg_build_year < BID_IMPORT_BUILD_YEAR_MIN || line.avg_build_year > yearCap)) {
      flags.push({
        id: `build_year:${index}`,
        severity: "warn",
        message: `Line ${index + 1} build year ${line.avg_build_year} is outside ${BID_IMPORT_BUILD_YEAR_MIN}–${yearCap}`,
        line_indexes: [index],
      });
    }
    if (line.lease_expiry && line.lease_expiry < today) {
      flags.push({
        id: `past_expiry:${index}`,
        severity: "warn",
        message: `Line ${index + 1} expiry ${line.lease_expiry} is in the past`,
        line_indexes: [index],
      });
    }
  });

  if ((opts.mode ?? "append") === "append") {
    const existing = opts.existing ?? [];
    lines.forEach((line, index) => {
      const hit = existing.find((row) =>
        row.seller_deal_ref.toLowerCase() === line.seller_deal_ref.toLowerCase()
        && (row.car_type ?? "") === (line.car_type ?? ""));
      if (!hit) return;
      flags.push({
        id: `duplicate_existing:${index}`,
        severity: "warn",
        message: `Line ${index + 1} matches an existing line ${line.seller_deal_ref}`,
        line_indexes: [index],
      });
    });
  }

  for (const price of price_columns) {
    flags.push({
      id: `price_column:${price.index}`,
      severity: "warn",
      message: `Price column detected: ${price.header}`,
    });
  }
  if (truncated_cells.length) {
    flags.push({
      id: "truncated",
      severity: "warn",
      message: `${truncated_cells.length} cell${truncated_cells.length === 1 ? "" : "s"} truncated to ${BID_IMPORT_MAX_CELL} characters`,
    });
  }

  return {
    sheet: chosen.grid.name,
    sheets: scored.map((row) => ({ name: row.grid.name, matches: row.matches })),
    header_row: chosen.headerRow + 1,
    header_signature_material: headerSignatureMaterial(chosen.headers),
    columns,
    mapping,
    header_fields: headerFields,
    lines,
    flags,
    price_columns,
    stated_car_total: stated,
    car_total,
    truncated_cells,
  };
}

export function blockingFlags(flags: readonly ImportFlag[]): ImportFlag[] {
  return flags.filter((flag) => flag.severity === "block");
}

export function unacknowledgedBlocks(flags: readonly ImportFlag[], acknowledged: readonly string[]): ImportFlag[] {
  const ack = new Set(acknowledged);
  return blockingFlags(flags).filter((flag) => !ack.has(flag.id));
}

export function replaceNeedsConfirm(lines: readonly {
  prelim_price_per_car?: number | null;
  final_price_per_car?: number | null;
  market_price_per_car?: number | null;
  outcome?: string | null;
}[]): boolean {
  return lines.some((line) =>
    line.prelim_price_per_car != null
    || line.final_price_per_car != null
    || line.market_price_per_car != null
    || (line.outcome != null && line.outcome !== ""));
}

export function bidImportRoleAllowed(role: string | null | undefined): boolean {
  return role === "admin" || role === "editor";
}

export function bidImportOpportunityError(row: {
  flavor?: string | null;
  stage?: string | null;
  deleted_at?: string | null;
} | null): { status: number; message: string } | null {
  if (!row) return { status: 404, message: "Opportunity not found" };
  if (row.deleted_at) return { status: 400, message: "This opportunity was deleted" };
  if (row.flavor !== "portfolio_bid") return { status: 400, message: "Bid import is only for portfolio bids" };
  const stage = row.stage ?? "";
  if (stage === "won" || stage === "lost" || stage === "closed") {
    return { status: 400, message: "Bid import is closed for this opportunity" };
  }
  return null;
}

export function rejectBidFileName(name: string): string | null {
  const lower = name.trim().toLowerCase();
  if (lower.endsWith(".xlsm")) return "Macro workbooks (.xlsm) are not accepted";
  if (lower.endsWith(".xls") && !lower.endsWith(".xlsx")) return "Excel 97 .xls files are not accepted";
  if (!lower.endsWith(".xlsx") && !lower.endsWith(".csv")) return "Upload an .xlsx or .csv file";
  return null;
}

function u16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function u32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

/** Declared zip sizes, checked before a workbook parser runs. */
export function inspectXlsxZip(bytes: Uint8Array): { ok: true } | { ok: false; error: string } {
  const sig = 0x06054b50;
  const start = Math.max(0, bytes.length - 22 - 65535);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= start; i -= 1) {
    if (u32(bytes, i) === sig) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return { ok: false, error: "Not a valid .xlsx file" };
  const count = u16(bytes, eocd + 10);
  const cdSize = u32(bytes, eocd + 12);
  const cdOffset = u32(bytes, eocd + 16);
  if (cdOffset + cdSize > bytes.length) return { ok: false, error: "Truncated .xlsx file" };
  let pos = cdOffset;
  let uncompressed = 0;
  let compressed = 0;
  for (let n = 0; n < count; n += 1) {
    if (pos + 46 > bytes.length || u32(bytes, pos) !== 0x02014b50) return { ok: false, error: "Invalid .xlsx directory" };
    const comp = u32(bytes, pos + 20);
    const uncomp = u32(bytes, pos + 24);
    const nameLen = u16(bytes, pos + 28);
    const extraLen = u16(bytes, pos + 30);
    const commentLen = u16(bytes, pos + 32);
    const nameStart = pos + 46;
    if (nameStart + nameLen > bytes.length) return { ok: false, error: "Invalid .xlsx directory" };
    const name = new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLen)).replace(/\\/g, "/");
    if (name.toLowerCase().split("/").pop() === "vbaproject.bin") {
      return { ok: false, error: "Macro workbooks are not accepted" };
    }
    uncompressed += uncomp;
    compressed += comp;
    pos = nameStart + nameLen + extraLen + commentLen;
  }
  if (uncompressed > BID_IMPORT_MAX_UNCOMPRESSED) return { ok: false, error: "Workbook expands past 100 MB" };
  if (compressed === 0 ? uncompressed > 1024 * 1024 : uncompressed / compressed > BID_IMPORT_MAX_ZIP_RATIO) {
    return { ok: false, error: "Workbook looks like a zip bomb" };
  }
  return { ok: true };
}

export function assertBidUpload(file: { filename: string; byteLength: number; bytes?: Uint8Array }): void {
  const nameError = rejectBidFileName(file.filename);
  if (nameError) throw new BidImportError(400, nameError);
  if (file.byteLength > BID_IMPORT_MAX_BYTES || (file.bytes && file.bytes.byteLength > BID_IMPORT_MAX_BYTES)) {
    throw new BidImportError(413, "Bid sheets are limited to 20 MB");
  }
  if (file.filename.toLowerCase().endsWith(".xlsx")) {
    if (!file.bytes) throw new BidImportError(400, "Missing file bytes");
    const zip = inspectXlsxZip(file.bytes);
    if (!zip.ok) throw new BidImportError(400, zip.error);
  }
}

/** Fields a commit is allowed to write. Prices are never accepted from the client. */
export function sanitizeImportedLine(raw: unknown, sortOrder: number): ProposedLine {
  if (!raw || typeof raw !== "object") throw new BidImportError(400, "Each line must be an object");
  const row = raw as Record<string, unknown>;
  const text = (key: string): string | null => {
    const value = row[key];
    if (value == null) return null;
    const trimmed = String(value).trim();
    return trimmed ? trimmed.slice(0, BID_IMPORT_MAX_CELL) : null;
  };
  const ref = text("seller_deal_ref");
  if (!ref) throw new BidImportError(400, "Deal number is required");
  const cars = Number(row.car_count ?? 0);
  const year = row.avg_build_year == null || row.avg_build_year === "" ? null : Number(row.avg_build_year);
  const rate = row.lease_rate == null || row.lease_rate === "" ? null : Number(row.lease_rate);
  const po = row.purchase_option;
  return {
    seller_deal_ref: ref,
    lessee_desc: text("lessee_desc"),
    lessee_rating: text("lessee_rating"),
    lessee_country: text("lessee_country"),
    car_count: Number.isFinite(cars) ? Math.max(0, Math.trunc(cars)) : 0,
    equipment_desc: text("equipment_desc"),
    car_type: text("car_type"),
    aar_code: text("aar_code"),
    avg_build_year: year != null && Number.isFinite(year) ? Math.trunc(year) : null,
    commodity: text("commodity"),
    lease_rate: rate != null && Number.isFinite(rate) ? money(rate) : null,
    lease_expiry: text("lease_expiry") && /^\d{4}-\d{2}-\d{2}/.test(String(row.lease_expiry))
      ? String(row.lease_expiry).slice(0, 10)
      : null,
    purchase_option: po == null || po === "" ? null : po === true || po === "true" || po === "yes" || po === "Y",
    notes: text("notes"),
    sort_order: Number.isFinite(Number(row.sort_order)) ? Math.trunc(Number(row.sort_order)) : sortOrder,
    group_label: text("group_label"),
    confidence: {},
    sources: {},
  };
}

export function importActivityMessage(lines: number, cars: number, fileName: string): string {
  return `Imported ${lines} lines / ${cars} cars from ${fileName}`;
}
