/**
 * CRB 500-byte parser (public Railinc CRB Procedures Manual, Appendix G / Y).
 * Pure: no database, no network.
 *
 * Layout corrections vs the abbreviated §I column list (verified on the public PM):
 * - Fmt 1 location is 109–110 only. Col 111 (A/N) and col 112 (N) are reserved
 *   (future 3-digit location and 5-digit quantity). Quantity stays 113–116.
 * - Wheel narrative is 28 characters at 167–194. Wheel subfields occupy 195–216
 *   (22). Non-wheel narrative is 50 characters at 167–216 and overlaps those
 *   subfields; it is an alternate view, not a second column in the 500-sum.
 * - Reserved/filler columns omitted from the abbreviated list are included so
 *   every format is contiguous and sums to 500: 118–119, 129–130, 283–288,
 *   353–400; fmt 6 492–500; fmt 8 108–400 and 401–500; fmt 9 fillers and 67–500.
 * - Downloaded DX format 9 is the output layout (billed party at 6–9, ZZZZ at
 *   2–5). Input format 9 (billing party at 2–5, ZZZZ at 6–9) is detected.
 * - Exception drafts use public Appendix Y.1.4 record format 2 (also 500).
 */
import { crc32, inflateRawSync } from "node:zlib";

export type FieldType = "A/N" | "N" | "A" | "cents";

export type FieldSpec = {
  key: string;
  /** 1-based inclusive start. */
  start: number;
  length: number;
  type: FieldType;
  /** Overlapping alternate view. Excluded from the contiguity / 500 sum. */
  alternate?: boolean;
};

function f(
  key: string,
  start: number,
  length: number,
  type: FieldType,
  alternate = false,
): FieldSpec {
  return { key, start, length, type, alternate };
}

const HEADER_1_30: FieldSpec[] = [
  f("record_format", 1, 1, "A/N"),
  f("billing_party", 2, 4, "A/N"),
  f("billed_party", 6, 4, "A/N"),
  f("account_date_yymm", 10, 4, "N"),
  f("invoice_number", 14, 16, "A/N"),
  f("currency", 30, 1, "A/N"),
];

/** Canonical format 1. Non-wheel narrative is the alternate at 167/50. */
export const FMT1: FieldSpec[] = [
  ...HEADER_1_30,
  f("detail_source", 31, 2, "A/N"),
  f("document_reference", 33, 15, "A/N"),
  f("car_initial", 48, 4, "A"),
  f("car_number", 52, 6, "N"),
  f("kind_of_car", 58, 1, "A"),
  f("load_empty", 59, 1, "A/N"),
  f("repair_date_yymmdd", 60, 6, "N"),
  f("splc", 66, 6, "N"),
  f("repairing_party", 72, 4, "A/N"),
  f("repairing_party_invoice", 76, 16, "A/N"),
  f("repairing_party_doc_ref", 92, 15, "A/N"),
  f("facility_type", 107, 2, "A/N"),
  f("location_on_car", 109, 2, "A/N"),
  f("reserved_111", 111, 1, "A/N"),
  f("reserved_112", 112, 1, "N"),
  f("quantity", 113, 4, "N"),
  f("condition_code", 117, 1, "A/N"),
  f("reserved_118", 118, 2, "N"),
  f("applied_job_code", 120, 4, "N"),
  f("applied_qualifier", 124, 3, "A/N"),
  f("why_made", 127, 2, "A/N"),
  f("reserved_129", 129, 2, "N"),
  f("removed_job_code", 131, 4, "N"),
  f("removed_qualifier", 135, 3, "A/N"),
  f("responsibility", 138, 1, "N"),
  f("dc_jic_party", 139, 4, "A/N"),
  f("dc_jic_date", 143, 6, "N"),
  f("labor_cents", 149, 7, "cents"),
  f("material_cents", 156, 8, "cents"),
  f("material_sign", 164, 1, "A"),
  f("machine_priceable", 165, 1, "A"),
  f("wrong_repair", 166, 1, "A"),
  f("narrative", 167, 28, "A/N"),
  f("narrative_non_wheel", 167, 50, "A/N", true),
  f("applied_wheel_date", 195, 4, "N"),
  f("applied_wheel_mfr", 199, 2, "A/N"),
  f("applied_wheel_class", 201, 1, "A/N"),
  f("applied_side_reading", 202, 2, "N"),
  f("applied_finger_reading", 204, 2, "N"),
  f("removed_wheel_date", 206, 4, "A/N"),
  f("removed_wheel_mfr", 210, 2, "A/N"),
  f("removed_wheel_class", 212, 1, "A/N"),
  f("removed_side_reading", 213, 2, "N"),
  f("removed_finger_reading", 215, 2, "N"),
  f("labor_rate", 217, 5, "N"),
  f("expanded_splc", 222, 9, "N"),
  f("cif_repairing_party", 231, 13, "A/N"),
  f("cif_billing_party", 244, 13, "A/N"),
  f("cif_billed_party", 257, 13, "A/N"),
  f("cif_defect_party", 270, 13, "A/N"),
  f("filler_283", 283, 6, "N"),
  f("line_number", 289, 5, "N"),
  f("railinc_inbound_date", 294, 6, "N"),
  f("railinc_outbound_date", 300, 6, "N"),
  f("resubmitted_ind", 306, 1, "A/N"),
  f("original_invoice", 307, 16, "A/N"),
  f("original_account_date", 323, 4, "N"),
  f("cid", 327, 14, "A/N"),
  f("ddct_incident", 341, 12, "A/N"),
  f("reserved_353", 353, 48, "A/N"),
  f("free_user_area", 401, 100, "A/N"),
];

export const FMT6: FieldSpec[] = [
  ...HEADER_1_30,
  f("contact_type", 31, 2, "A/N"),
  f("company", 33, 50, "A/N"),
  f("contact_name", 83, 35, "A/N"),
  f("title", 118, 35, "A/N"),
  f("phone", 153, 25, "A/N"),
  f("fax", 178, 25, "A/N"),
  f("email", 203, 60, "A/N"),
  f("address1", 263, 45, "A/N"),
  f("address2", 308, 45, "A/N"),
  f("address3", 353, 45, "A/N"),
  f("address4", 398, 45, "A/N"),
  f("city", 443, 35, "A/N"),
  f("state", 478, 2, "A"),
  f("country", 480, 2, "A/N"),
  f("zip", 482, 10, "A/N"),
  f("reserved_492", 492, 9, "A/N"),
];

export const FMT8: FieldSpec[] = [
  ...HEADER_1_30,
  f("detail_source", 31, 2, "A/N"),
  f("record_count", 33, 7, "N"),
  f("labor_cents", 40, 10, "cents"),
  f("material_cents", 50, 16, "cents"),
  f("material_sign", 66, 1, "A"),
  f("invoice_date", 67, 6, "N"),
  f("taxpayer_id", 73, 15, "A/N"),
  f("terms", 88, 2, "N"),
  f("due_date", 90, 6, "N"),
  f("railinc_inbound_date", 96, 6, "N"),
  f("railinc_outbound_date", 102, 6, "N"),
  f("reserved_108", 108, 293, "A/N"),
  f("free_user_area", 401, 100, "A/N"),
];

/** Format 9 output (DX download): billed party at 6–9, fillers of Z. */
export const FMT9_OUTPUT: FieldSpec[] = [
  f("record_format", 1, 1, "A/N"),
  f("filler_billing", 2, 4, "A"),
  f("billed_party", 6, 4, "A/N"),
  f("account_date_yymm", 10, 4, "N"),
  f("filler_invoice", 14, 16, "A"),
  f("filler_currency", 30, 1, "A"),
  f("filler_detail", 31, 2, "A"),
  f("record_count", 33, 7, "N"),
  f("labor_cents", 40, 10, "cents"),
  f("material_cents", 50, 16, "cents"),
  f("material_sign", 66, 1, "A"),
  f("reserved_67", 67, 434, "A/N"),
];

/** Format 9 input (submitter control): billing party at 2–5, ZZZZ at 6–9. */
export const FMT9_INPUT: FieldSpec[] = [
  f("record_format", 1, 1, "A/N"),
  f("billing_party", 2, 4, "A/N"),
  f("filler_billed", 6, 4, "A"),
  f("account_date_yymm", 10, 4, "N"),
  f("filler_invoice", 14, 16, "A"),
  f("filler_currency", 30, 1, "A"),
  f("filler_detail", 31, 2, "A"),
  f("record_count", 33, 7, "N"),
  f("labor_cents", 40, 10, "cents"),
  f("material_cents", 50, 16, "cents"),
  f("material_sign", 66, 1, "A"),
  f("reserved_67", 67, 434, "A/N"),
];

/** Appendix Y.1.4 record format 2 — electronic exception, 500 bytes. */
export const FMT2: FieldSpec[] = [
  f("record_format", 1, 1, "N"),
  f("billing_party", 2, 4, "A/N"),
  f("billed_party", 6, 4, "A/N"),
  f("account_date_yymm", 10, 4, "N"),
  f("total_invoice_cents", 14, 16, "cents"),
  f("invoice_number", 30, 16, "A/N"),
  f("dx_outbound_date", 46, 6, "N"),
  f("car_initial", 52, 4, "A"),
  f("car_number", 56, 6, "N"),
  f("repair_date_yymmdd", 62, 6, "N"),
  f("splc", 68, 9, "N"),
  f("repairing_party", 77, 4, "A/N"),
  f("invoice_header_exception", 81, 1, "A"),
  f("brc_header_exception", 82, 1, "A"),
  f("line_number", 83, 5, "N"),
  f("currency", 88, 1, "A"),
  f("submission_date", 89, 6, "N"),
  f("detail_source", 95, 2, "A"),
  f("letter_counter", 97, 2, "N"),
  f("description", 99, 348, "A/N"),
  f("amount_cents", 447, 16, "cents"),
  f("amount_sign", 463, 1, "A"),
  f("response_indicator", 464, 1, "A"),
  f("attachment", 465, 36, "A/N"),
];

export const LAYOUTS: Record<string, FieldSpec[]> = {
  "1": FMT1,
  "2": FMT2,
  "6": FMT6,
  "8": FMT8,
  "9": FMT9_OUTPUT,
  "9I": FMT9_INPUT,
};

export const LAYOUT_CORRECTIONS: readonly string[] = [
  "Fmt 1 cols 111–112 are reserved (public PM App G). Location is 109–110 (length 2); quantity is 113–116. The abbreviated spec skipped 111 and 112.",
  "Fmt 1 wheel narrative is 28 chars at 167–194. Wheel fields 195–216 sum to 22 (date 4, mfr 2, class 1, side 2, finger 2, and the removed set). Non-wheel narrative is 50 chars at 167–216 and overlaps those fields; stored as an alternate, not double-counted in the 500-sum.",
  "Contiguous fillers the abbreviated list omitted: 118–119, 129–130, 283–288, 353–400; format 6 reserved 492–500; format 8 reserved 108–400 plus free user 401–500; format 9 output fillers (ZZZZ at 2–5, Z at 14–32) and reserved 67–500.",
  "Format 9 in a Railinc download is the output layout (billed party at cols 6–9). Input layout (billing party at 2–5 and ZZZZ at 6–9) is detected and parsed with its own spec.",
];

export function assertLayouts(): string[] {
  const problems: string[] = [];
  for (const [name, fields] of Object.entries(LAYOUTS)) {
    const canon = fields.filter((field) => !field.alternate);
    let expect = 1;
    let sum = 0;
    const seen = new Set<string>();
    for (const field of canon) {
      if (seen.has(field.key)) problems.push(`${name} duplicate key ${field.key}`);
      seen.add(field.key);
      if (field.start !== expect) {
        problems.push(
          `${name} ${field.key} starts at ${field.start}, expected ${expect}`,
        );
      }
      if (field.length <= 0) problems.push(`${name} ${field.key} empty`);
      expect = field.start + field.length;
      sum += field.length;
    }
    if (sum !== 500 || expect !== 501) {
      problems.push(`${name} sum ${sum} end ${expect - 1} (want 500)`);
    }
  }
  const nonWheel = FMT1.find((field) => field.key === "narrative_non_wheel");
  if (!nonWheel?.alternate || nonWheel.start !== 167 || nonWheel.length !== 50) {
    problems.push("narrative_non_wheel must be alternate 167/50");
  }
  const wheelSpan =
    (FMT1.find((field) => field.key === "narrative")?.length ?? 0) +
    FMT1.filter(
      (field) =>
        !field.alternate && field.start >= 195 && field.start <= 216,
    ).reduce((s, field) => s + field.length, 0);
  if (wheelSpan !== 50) problems.push(`wheel span ${wheelSpan} want 50`);
  const loc = FMT1.find((field) => field.key === "location_on_car");
  const r111 = FMT1.find((field) => field.key === "reserved_111");
  const r112 = FMT1.find((field) => field.key === "reserved_112");
  const qty = FMT1.find((field) => field.key === "quantity");
  if (!loc || loc.start !== 109 || loc.length !== 2) problems.push("location");
  if (!r111 || r111.start !== 111 || r111.length !== 1) problems.push("col 111");
  if (!r112 || r112.start !== 112 || r112.length !== 1) problems.push("col 112");
  if (!qty || qty.start !== 113 || qty.length !== 4) problems.push("quantity");
  return problems;
}

export type ParsedRecord = {
  lineNo: number;
  recordFormat: string;
  /** 9 records: OUTPUT or INPUT. */
  format9Kind: "OUTPUT" | "INPUT" | null;
  rawLine: string;
  fields: Record<string, string>;
  cents: Record<string, number>;
  warning: string | null;
};

export type ParseFileResult = {
  records: ParsedRecord[];
  errors: string[];
  sourceName: string;
};

function padField(field: FieldSpec, value: string | number | null | undefined): string {
  if (field.type === "cents" || field.type === "N") {
    const n =
      value == null || value === ""
        ? 0
        : Math.trunc(Number(String(value).replace(/[^\d-]/g, "")));
    const neg = n < 0;
    const digits = String(Math.abs(n)).padStart(field.length, "0").slice(-field.length);
    return neg ? `-${digits.slice(1)}` : digits;
  }
  return String(value ?? "")
    .padEnd(field.length, " ")
    .slice(0, field.length);
}

export function buildRecord(
  format: "1" | "2" | "6" | "8" | "9" | "9I",
  values: Record<string, string | number | null | undefined>,
): string {
  const spec = LAYOUTS[format];
  if (!spec) throw new Error(`unknown format ${format}`);
  const chars = Array.from({ length: 500 }, () => " ");
  const write = (start: number, raw: string) => {
    for (let i = 0; i < raw.length && start - 1 + i < 500; i++) {
      chars[start - 1 + i] = raw[i] ?? " ";
    }
  };
  const merged: Record<string, string | number | null | undefined> = {
    record_format: format === "9I" ? "9" : format,
    ...values,
  };
  for (const field of spec) {
    if (field.alternate) continue;
    write(field.start, padField(field, merged[field.key]));
  }
  if (format === "1") {
    const wheelKeys = [
      "applied_wheel_date",
      "applied_wheel_mfr",
      "applied_wheel_class",
      "applied_side_reading",
      "applied_finger_reading",
      "removed_wheel_date",
      "removed_wheel_mfr",
      "removed_wheel_class",
      "removed_side_reading",
      "removed_finger_reading",
    ];
    const hasWheel = wheelKeys.some((key) => String(merged[key] ?? "").trim() !== "");
    if (!hasWheel && merged.narrative_non_wheel != null) {
      write(167, String(merged.narrative_non_wheel).padEnd(50, " ").slice(0, 50));
    }
  }
  const line = chars.join("");
  if (line.length !== 500) throw new Error(`buildRecord length ${line.length}`);
  return line;
}

function parseIntCents(raw: string): number {
  const t = raw.trim();
  if (!t || !/\d/.test(t)) return 0;
  const n = Number(t.replace(/[^\d-]/g, ""));
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

export function signedMaterial(cents: number, sign: string | undefined): number {
  const mag = Math.abs(Math.trunc(cents));
  return (sign ?? "D").trim().toUpperCase() === "C" ? -mag : mag;
}

function specFor(recordFormat: string, line: string): { spec: FieldSpec[]; kind: "OUTPUT" | "INPUT" | null } | null {
  if (recordFormat === "9") {
    const billed = line.slice(5, 9);
    if (billed === "ZZZZ") return { spec: FMT9_INPUT, kind: "INPUT" };
    return { spec: FMT9_OUTPUT, kind: "OUTPUT" };
  }
  const spec = LAYOUTS[recordFormat];
  if (!spec) return null;
  return { spec, kind: null };
}

export function parseLine(raw: string, lineNo: number): ParsedRecord {
  let warning: string | null = null;
  let body = raw.replace(/\r$/, "");
  if (body.length > 500) {
    warning = `length ${body.length} > 500`;
    body = body.slice(0, 500);
  } else if (body.length < 500) {
    body = body.padEnd(500, " ");
  }
  const recordFormat = body.slice(0, 1);
  const chosen = specFor(recordFormat, body);
  const fields: Record<string, string> = {};
  const cents: Record<string, number> = {};
  if (!chosen) {
    return {
      lineNo,
      recordFormat: recordFormat.trim() || "?",
      format9Kind: null,
      rawLine: body,
      fields: { record_format: recordFormat, raw: body },
      cents,
      warning: warning ?? `unknown record format '${recordFormat.trim() || "?"}'`,
    };
  }
  for (const field of chosen.spec) {
    const slice = body.slice(field.start - 1, field.start - 1 + field.length);
    fields[field.key] = slice;
    if (field.type === "cents" || field.key === "labor_rate" || field.key === "record_count") {
      cents[field.key] = parseIntCents(slice);
    }
  }
  if (recordFormat === "1") {
    fields.narrative_non_wheel = body.slice(166, 216);
  }
  return {
    lineNo,
    recordFormat,
    format9Kind: chosen.kind,
    rawLine: body,
    fields,
    cents,
    warning,
  };
}

export function parseText(text: string, sourceName = "upload.txt"): ParseFileResult {
  const errors: string[] = [];
  const normalized = text.replace(/^\uFEFF/, "");
  const pieces = normalized.split(/\r?\n/);
  if (pieces.length && pieces[pieces.length - 1] === "") pieces.pop();
  const records: ParsedRecord[] = [];
  let lineNo = 0;
  for (const piece of pieces) {
    if (piece.trim() === "") continue;
    lineNo += 1;
    const originalLen = piece.replace(/\r$/, "").length;
    const rec = parseLine(piece, lineNo);
    if (originalLen > 500) {
      errors.push(`line ${lineNo}: length ${originalLen} > 500`);
    }
    if (rec.warning && originalLen <= 500 && rec.warning.startsWith("unknown")) {
      errors.push(`line ${lineNo}: ${rec.warning}`);
    }
    records.push(rec);
  }
  if (!records.length) errors.push("empty file");
  return { records, errors, sourceName };
}

export function unzipSingleText(buf: Buffer): { name: string; text: string } {
  if (buf.length < 4 || buf.readUInt32LE(0) !== 0x04034b50) {
    throw new Error("not a zip file");
  }
  const files: Array<{ name: string; text: string }> = [];
  let offset = 0;
  while (offset + 30 <= buf.length) {
    const sig = buf.readUInt32LE(offset);
    if (sig === 0x02014b50 || sig === 0x06054b50) break;
    if (sig !== 0x04034b50) break;
    const flags = buf.readUInt16LE(offset + 6);
    const method = buf.readUInt16LE(offset + 8);
    const compSize = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buf.slice(nameStart, nameStart + nameLen).toString("utf8");
    const dataStart = nameStart + nameLen + extraLen;
    if (flags & 0x08) {
      throw new Error("zip data descriptor not supported");
    }
    const dataEnd = dataStart + compSize;
    if (dataEnd > buf.length) throw new Error("zip truncated");
    const compressed = buf.slice(dataStart, dataEnd);
    offset = dataEnd;
    if (name.endsWith("/")) continue;
    let bytes: Buffer;
    if (method === 0) bytes = compressed;
    else if (method === 8) bytes = inflateRawSync(compressed);
    else throw new Error(`zip method ${method} not supported`);
    files.push({ name, text: bytes.toString("latin1") });
  }
  if (files.length !== 1) {
    throw new Error(`zip must contain exactly one text file, found ${files.length}`);
  }
  return files[0];
}

export function parseUpload(filename: string, bytes: Buffer): ParseFileResult {
  const lower = filename.toLowerCase();
  const isZip = lower.endsWith(".zip") || (bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50);
  if (isZip) {
    const inner = unzipSingleText(bytes);
    return parseText(inner.text, inner.name);
  }
  return parseText(bytes.toString("latin1"), filename);
}

export function zipStored(name: string, text: string): Buffer {
  const data = Buffer.from(text, "latin1");
  const nameB = Buffer.from(name, "utf8");
  const crc = crc32(data) >>> 0;
  const local = Buffer.alloc(30 + nameB.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(20, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt16LE(0, 10);
  local.writeUInt16LE(0, 12);
  local.writeUInt16LE(0, 14);
  local.writeUInt32LE(crc, 16);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameB.length, 26);
  local.writeUInt16LE(0, 28);
  nameB.copy(local, 30);
  const cd = Buffer.alloc(46 + nameB.length);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(20, 4);
  cd.writeUInt16LE(20, 6);
  cd.writeUInt16LE(0, 8);
  cd.writeUInt16LE(0, 10);
  cd.writeUInt16LE(0, 12);
  cd.writeUInt16LE(0, 14);
  cd.writeUInt32LE(crc, 16);
  cd.writeUInt32LE(data.length, 20);
  cd.writeUInt32LE(data.length, 24);
  cd.writeUInt16LE(nameB.length, 28);
  cd.writeUInt16LE(0, 30);
  cd.writeUInt16LE(0, 32);
  cd.writeUInt16LE(0, 34);
  cd.writeUInt16LE(0, 36);
  cd.writeUInt32LE(0, 38);
  cd.writeUInt32LE(0, 42);
  nameB.copy(cd, 46);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(local.length + data.length, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([local, data, cd, eocd]);
}

export function trimField(value: string | undefined | null): string {
  return String(value ?? "").trim();
}

export function invoiceKeyOf(fields: Record<string, string>): string {
  return [
    trimField(fields.billing_party),
    trimField(fields.invoice_number),
    trimField(fields.account_date_yymm),
  ].join("|");
}

export type BalanceIssue = {
  kind: "DETAIL_SOURCE" | "ZZ_VS_SUBTOTALS" | "FILE_FMT9" | "MISSING_ZZ" | "MISSING_FMT9";
  invoiceKey: string;
  billingParty: string;
  invoiceNumber: string;
  accountDate: string;
  detailSource: string | null;
  message: string;
};

type Money = { count: number; labor: number; material: number };

function emptyMoney(): Money {
  return { count: 0, labor: 0, material: 0 };
}

export function balanceReport(records: ParsedRecord[]): { ok: boolean; issues: BalanceIssue[] } {
  const issues: BalanceIssue[] = [];
  const details = new Map<string, Map<string, Money>>();
  const subs = new Map<string, Map<string, Money>>();
  const zz = new Map<string, Money>();
  const meta = new Map<string, { billingParty: string; invoiceNumber: string; accountDate: string }>();

  const ensure = (key: string, fields: Record<string, string>) => {
    if (!meta.has(key)) {
      meta.set(key, {
        billingParty: trimField(fields.billing_party),
        invoiceNumber: trimField(fields.invoice_number),
        accountDate: trimField(fields.account_date_yymm),
      });
    }
  };

  let file: Money = emptyMoney();
  for (const rec of records) {
    if (rec.recordFormat !== "1") continue;
    const key = invoiceKeyOf(rec.fields);
    ensure(key, rec.fields);
    const ds = trimField(rec.fields.detail_source) || "??";
    const by = details.get(key) ?? new Map<string, Money>();
    const bucket = by.get(ds) ?? emptyMoney();
    bucket.count += 1;
    bucket.labor += rec.cents.labor_cents ?? 0;
    bucket.material += signedMaterial(rec.cents.material_cents ?? 0, rec.fields.material_sign);
    by.set(ds, bucket);
    details.set(key, by);
    file.count += 1;
    file.labor += rec.cents.labor_cents ?? 0;
    file.material += signedMaterial(rec.cents.material_cents ?? 0, rec.fields.material_sign);
  }

  for (const rec of records) {
    if (rec.recordFormat !== "8") continue;
    const key = invoiceKeyOf(rec.fields);
    ensure(key, rec.fields);
    const ds = trimField(rec.fields.detail_source) || "??";
    const money: Money = {
      count: rec.cents.record_count ?? 0,
      labor: rec.cents.labor_cents ?? 0,
      material: signedMaterial(rec.cents.material_cents ?? 0, rec.fields.material_sign),
    };
    if (ds === "ZZ") {
      zz.set(key, money);
      continue;
    }
    const by = subs.get(key) ?? new Map<string, Money>();
    by.set(ds, money);
    subs.set(key, by);
  }

  const keys = new Set<string>([
    ...Array.from(details.keys()),
    ...Array.from(subs.keys()),
    ...Array.from(zz.keys()),
  ]);
  for (const key of Array.from(keys)) {
    const info = meta.get(key) ?? {
      billingParty: key.split("|")[0] ?? "",
      invoiceNumber: key.split("|")[1] ?? "",
      accountDate: key.split("|")[2] ?? "",
    };
    const det = details.get(key) ?? new Map<string, Money>();
    const sub = subs.get(key) ?? new Map<string, Money>();
    const dsKeys = new Set<string>([...Array.from(det.keys()), ...Array.from(sub.keys())]);
    for (const ds of Array.from(dsKeys)) {
      const a = det.get(ds) ?? emptyMoney();
      const b = sub.get(ds);
      if (!b) {
        issues.push({
          kind: "DETAIL_SOURCE",
          invoiceKey: key,
          ...info,
          detailSource: ds,
          message: `DETAIL_SOURCE_SUBTOTAL_MISMATCH: ${key} ${ds} has detail and no format 8`,
        });
        continue;
      }
      if (a.count !== b.count || a.labor !== b.labor || a.material !== b.material) {
        issues.push({
          kind: "DETAIL_SOURCE",
          invoiceKey: key,
          ...info,
          detailSource: ds,
          message: `DETAIL_SOURCE_SUBTOTAL_MISMATCH: ${key} ${ds} detail ${a.count}/${a.labor}/${a.material} != fmt8 ${b.count}/${b.labor}/${b.material}`,
        });
      }
    }
    const sum = emptyMoney();
    for (const bucket of Array.from(sub.values())) {
      sum.count += bucket.count;
      sum.labor += bucket.labor;
      sum.material += bucket.material;
    }
    const total = zz.get(key);
    if (!total) {
      issues.push({
        kind: "MISSING_ZZ",
        invoiceKey: key,
        ...info,
        detailSource: "ZZ",
        message: `MISSING_ZZ: ${key} has no format 8 ZZ total`,
      });
    } else if (sum.count !== total.count || sum.labor !== total.labor || sum.material !== total.material) {
      issues.push({
        kind: "ZZ_VS_SUBTOTALS",
        invoiceKey: key,
        ...info,
        detailSource: "ZZ",
        message: `ZZ_VS_SUBTOTALS: ${key} subtotals ${sum.count}/${sum.labor}/${sum.material} != ZZ ${total.count}/${total.labor}/${total.material}`,
      });
    }
  }

  const nines = records.filter((rec) => rec.recordFormat === "9");
  if (!nines.length) {
    issues.push({
      kind: "MISSING_FMT9",
      invoiceKey: "*",
      billingParty: "",
      invoiceNumber: "",
      accountDate: "",
      detailSource: null,
      message: "MISSING_FMT9: file has no format 9 control",
    });
  } else {
    const nine = nines[nines.length - 1];
    const got: Money = {
      count: nine.cents.record_count ?? 0,
      labor: nine.cents.labor_cents ?? 0,
      material: signedMaterial(nine.cents.material_cents ?? 0, nine.fields.material_sign),
    };
    if (got.count !== file.count || got.labor !== file.labor || got.material !== file.material) {
      issues.push({
        kind: "FILE_FMT9",
        invoiceKey: "*",
        billingParty: "",
        invoiceNumber: "",
        accountDate: trimField(nine.fields.account_date_yymm),
        detailSource: null,
        message: `FILE_FMT9: control ${got.count}/${got.labor}/${got.material} != detail ${file.count}/${file.labor}/${file.material}`,
      });
    }
  }
  return { ok: issues.length === 0, issues };
}

export function yymmToIsoMonth(yymm: string): string | null {
  const t = yymm.trim();
  if (!/^\d{4}$/.test(t)) return null;
  const year = 2000 + Number(t.slice(0, 2));
  const month = Number(t.slice(2, 4));
  if (month < 1 || month > 12) return null;
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

export function yymmddToIso(yymmdd: string): string | null {
  const t = yymmdd.trim();
  if (!/^\d{6}$/.test(t) || t === "000000") return null;
  const year = 2000 + Number(t.slice(0, 2));
  const month = Number(t.slice(2, 4));
  const day = Number(t.slice(4, 6));
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function isoToYymmdd(iso: string | null | undefined): string {
  if (!iso) return "000000";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return "000000";
  return `${m[1].slice(2)}${m[2]}${m[3]}`;
}

export function monthIndex(yymm: string): number | null {
  const iso = yymmToIsoMonth(yymm);
  if (!iso) return null;
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  return year * 12 + month;
}

/** January repair may appear on the May DX when the limit is 3 (limit + 1). */
export function isTimeBarred(repairYymmdd: string, accountYymm: string, limitMonths: number): boolean {
  const repairIso = yymmddToIso(repairYymmdd);
  if (!repairIso) return false;
  const repairIdx = monthIndex(repairIso.slice(2, 4) + repairIso.slice(5, 7));
  const accountIdx = monthIndex(accountYymm);
  if (repairIdx == null || accountIdx == null) return false;
  return accountIdx > repairIdx + limitMonths + 1;
}
