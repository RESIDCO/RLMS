/**
 * 500-byte AAR/CRB parser.
 * - Immutable original bytes + SHA-256 (caller stores)
 * - Each raw 500-char line retained
 * - Positions from versioned layout table (no hard-coded slices in call sites)
 * - Amounts as integer cents
 * - Round-trip: serialize(parse(line)) === line
 */

import { createHash } from "crypto";
import {
  getBundledLayout,
  type LayoutField,
  type LayoutVersion,
} from "./aar-layout";

export type ParsedAarLine = {
  lineNo: number;
  rawLine: string;
  recordFormat: string;
  fields: Record<string, string | number | null>;
  laborCents: number | null;
  materialCents: number | null;
  materialSign: string | null;
  respCode: string | null;
  appliedJobCode: string | null;
  appliedQualifier: string | null;
  whyMade: string | null;
  aarComponentId: string | null;
  ddctIncidentId: string | null;
};

export type ParseAarFileResult = {
  sha256: string;
  byteLength: number;
  lineEnding: "CRLF" | "LF" | "CR" | "NONE";
  layoutVersion: string;
  isCompleteCrip: boolean;
  flags: string[];
  lines: ParsedAarLine[];
};

function detectLineEnding(buf: Buffer): "CRLF" | "LF" | "CR" | "NONE" {
  if (buf.includes(0x0d) && buf.includes(0x0a)) return "CRLF";
  if (buf.includes(0x0a)) return "LF";
  if (buf.includes(0x0d)) return "CR";
  return "NONE";
}

function splitRecords(buf: Buffer): { ending: ParseAarFileResult["lineEnding"]; records: string[] } {
  const ending = detectLineEnding(buf);
  let text = buf.toString("latin1");
  if (ending === "CRLF") text = text.replace(/\r\n/g, "\n");
  else if (ending === "CR") text = text.replace(/\r/g, "\n");
  const records = text.split("\n").filter((l, i, arr) => !(i === arr.length - 1 && l === ""));
  return { ending, records };
}

function sliceField(line: string, field: LayoutField): string {
  const start = field.col_start - 1;
  return line.slice(start, start + field.length);
}

function coerce(field: LayoutField, raw: string): string | number | null {
  if (field.data_type === "cents") {
    const digits = raw.replace(/\s/g, "");
    if (!digits) return null;
    if (!/^\d+$/.test(digits)) return null;
    return Number.parseInt(digits, 10);
  }
  if (field.data_type === "raw") return raw;
  return raw;
}

export function parseLine(
  rawLine: string,
  lineNo: number,
  layout: LayoutVersion = getBundledLayout(),
): ParsedAarLine {
  if (rawLine.length !== 500) {
    throw new Error(`Line ${lineNo}: expected 500 chars, got ${rawLine.length}`);
  }
  const recordFormat = rawLine[0] ?? "";
  const fieldsForFormat = layout.fields.filter(
    (f) => f.record_format === recordFormat || f.record_format === "*",
  );
  const fields: Record<string, string | number | null> = {};
  for (const f of fieldsForFormat) {
    const raw = sliceField(rawLine, f);
    fields[f.field_key] = coerce(f, raw);
  }
  return {
    lineNo,
    rawLine,
    recordFormat,
    fields,
    laborCents: (fields.labor_cents as number | null) ?? null,
    materialCents: (fields.material_cents as number | null) ?? null,
    materialSign: (fields.material_sign as string | null) ?? null,
    respCode: ((fields.responsibility_code as string | null) ?? "").trim() || null,
    appliedJobCode: ((fields.applied_job_code as string | null) ?? "").trim() || null,
    appliedQualifier: ((fields.applied_qualifier as string | null) ?? "").trim() || null,
    whyMade: ((fields.why_made as string | null) ?? "").trim() || null,
    aarComponentId: ((fields.aar_component_id as string | null) ?? "").trim() || null,
    ddctIncidentId: ((fields.ddct_incident_id as string | null) ?? "").trim() || null,
  };
}

/** Rebuild a 500-char line from parsed fields using the layout table. */
export function serializeLine(
  parsed: ParsedAarLine,
  layout: LayoutVersion = getBundledLayout(),
): string {
  const chars = parsed.rawLine.split("");
  if (chars.length !== 500) {
    throw new Error("serializeLine requires original rawLine length 500 as canvas");
  }
  const fieldsForFormat = layout.fields.filter(
    (f) => f.record_format === parsed.recordFormat || f.record_format === "*",
  );
  for (const f of fieldsForFormat) {
    const start = f.col_start - 1;
    let raw: string;
    const val = parsed.fields[f.field_key];
    if (f.data_type === "cents") {
      const n = val == null || val === "" ? 0 : Number(val);
      raw = String(Math.trunc(n)).padStart(f.length, "0").slice(-f.length);
    } else if (f.data_type === "raw") {
      raw = String(val ?? "").padEnd(f.length, " ").slice(0, f.length);
    } else {
      // Prefer exact original slice for round-trip fidelity on padding
      raw = parsed.rawLine.slice(start, start + f.length);
      if (val != null && String(val) !== raw) {
        const s = String(val);
        raw =
          f.data_type === "N"
            ? s.padStart(f.length, "0").slice(-f.length)
            : s.padEnd(f.length, " ").slice(0, f.length);
      }
    }
    for (let i = 0; i < f.length; i++) {
      chars[start + i] = raw[i] ?? " ";
    }
  }
  return chars.join("");
}

export function roundTripOk(
  rawLine: string,
  layout: LayoutVersion = getBundledLayout(),
): boolean {
  const parsed = parseLine(rawLine, 1, layout);
  return serializeLine(parsed, layout) === rawLine;
}

export function parseAarFile(
  bytes: Buffer,
  layout: LayoutVersion = getBundledLayout(),
): ParseAarFileResult {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const { ending, records } = splitRecords(bytes);
  const flags: string[] = [];
  const formats = new Set<string>();
  const lines: ParsedAarLine[] = [];

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    if (rec.length !== 500) {
      throw new Error(
        `Line ${i + 1}: expected 500 chars, got ${rec.length}. Rejecting file.`,
      );
    }
    if (!/^[\x20-\x7E]*$/.test(rec)) {
      flags.push(`line_${i + 1}_non_ascii`);
    }
    const parsed = parseLine(rec, i + 1, layout);
    formats.add(parsed.recordFormat);
    if (!roundTripOk(rec, layout)) {
      throw new Error(`Line ${i + 1}: round-trip mismatch`);
    }
    lines.push(parsed);
  }

  const isCompleteCrip =
    formats.has("1") && formats.has("6") && formats.has("8") && formats.has("9");
  if (formats.has("1") && !isCompleteCrip) {
    flags.push("detail_only_extract");
  }

  return {
    sha256,
    byteLength: bytes.length,
    lineEnding: ending,
    layoutVersion: layout.version,
    isCompleteCrip,
    flags,
    lines,
  };
}

/** Signed material cents (D = debit/positive for billed amount convention here). */
export function signedMaterialCents(line: ParsedAarLine): number {
  const n = line.materialCents ?? 0;
  if ((line.materialSign ?? "D").toUpperCase() === "C") return -n;
  return n;
}
