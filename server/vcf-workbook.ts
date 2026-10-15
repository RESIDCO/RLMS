import { createReadStream, mkdtempSync, writeFileSync, rmSync } from "fs";
import { createInterface } from "readline";
import { tmpdir } from "os";
import { join } from "path";
import ExcelJS from "exceljs";
import {
  compactVcfRowsFromMatrix,
  looksLikeVcfHeaderNames,
  type VcfRawRow,
} from "@shared/vcf-import";

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
      } else inQ = !inQ;
    } else if (ch === "," && !inQ) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function compactFromHeaderRows(headers: string[], lines: unknown[][]): VcfRawRow[] {
  return compactVcfRowsFromMatrix([headers, ...lines]);
}

async function parseCsvPath(filePath: string): Promise<VcfRawRow[]> {
  const rl = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });
  let headers: string[] | null = null;
  const chunk: unknown[][] = [];
  const rows: VcfRawRow[] = [];
  const flush = () => {
    if (!headers || !chunk.length) return;
    rows.push(...compactFromHeaderRows(headers, chunk));
    chunk.length = 0;
  };
  for await (const line of rl) {
    if (!line.trim()) continue;
    const cols = splitCsvLine(line);
    if (!headers) {
      headers = cols;
      if (!looksLikeVcfHeaderNames(headers)) {
        throw new Error("This does not look like a Valid Car File (need CAR_INITIAL, CAR_NUMBER, ACTIVE, ASSIGNMENT_ID).");
      }
      continue;
    }
    chunk.push(cols);
    if (chunk.length >= 2000) flush();
  }
  flush();
  if (!rows.length) throw new Error("No data rows found in file.");
  return rows;
}

function cellVal(v: unknown): unknown {
  if (v == null) return "";
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === "object" && v && "text" in (v as any)) return String((v as any).text ?? "");
  if (typeof v === "object" && v && "result" in (v as any)) return (v as any).result;
  return v;
}

async function parseXlsxPath(filePath: string): Promise<VcfRawRow[]> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(createReadStream(filePath), {
    entries: "emit",
    sharedStrings: "cache",
    hyperlinks: "ignore",
    styles: "ignore",
    worksheets: "emit",
  });
  const sheetsSeen: string[] = [];
  let headers: string[] | null = null;
  const chunk: unknown[][] = [];
  const rows: VcfRawRow[] = [];
  let capturedName = "";
  const flush = () => {
    if (!headers || !chunk.length) return;
    rows.push(...compactFromHeaderRows(headers, chunk));
    chunk.length = 0;
  };

  for await (const worksheetReader of reader as any) {
    const name = String(worksheetReader.name ?? `sheet${sheetsSeen.length + 1}`);
    sheetsSeen.push(name);
    const take =
      /^V_VALID_CARS$/i.test(name) ||
      /valid.?car/i.test(name) ||
      (!capturedName && sheetsSeen.length === 1);
    if (!take) {
      for await (const _row of worksheetReader) {
        /* drain */
      }
      continue;
    }
    if (capturedName && !/^V_VALID_CARS$/i.test(name) && !/valid.?car/i.test(name)) {
      for await (const _row of worksheetReader) {
        /* drain */
      }
      continue;
    }
    if (/^V_VALID_CARS$/i.test(name) || /valid.?car/i.test(name)) {
      headers = null;
      chunk.length = 0;
      rows.length = 0;
    }
    capturedName = name;
    for await (const row of worksheetReader) {
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      const cells = values.map(cellVal);
      if (!headers) {
        headers = cells.map((c) => String(c ?? ""));
        continue;
      }
      chunk.push(cells);
      if (chunk.length >= 2000) flush();
    }
    flush();
  }

  if (!rows.length) throw new Error("No data rows found in file.");
  return rows;
}

/** Parse a Valid Car File already on disk. Caller deletes the file. */
export async function parseVcfUploadFromPath(filePath: string, filename: string): Promise<VcfRawRow[]> {
  if (/\.(csv|txt)$/i.test(filename)) return parseCsvPath(filePath);
  return parseXlsxPath(filePath);
}

/** Parse an uploaded VCF buffer (writes a temp file so the ArrayBuffer can be released). */
export async function parseVcfUpload(buffer: Buffer, filename: string): Promise<VcfRawRow[]> {
  const dir = mkdtempSync(join(tmpdir(), "vcf-"));
  const safe = String(filename || "upload.xlsx").replace(/[^\w.\-]+/g, "_");
  const path = join(dir, safe || "upload.xlsx");
  try {
    writeFileSync(path, buffer);
    return await parseVcfUploadFromPath(path, filename);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
