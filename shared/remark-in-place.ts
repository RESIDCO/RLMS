/**
 * Remark preview and parsing for the bulk tool.
 *
 * Apply is server/remark-apply.ts → remark_railcars_apply. The old mark
 * becomes an inactive row. The new mark is a new active id that keeps the
 * lease. This module never reads or writes rent_events.
 */

import { normalizeStoredCarNumber, splitCarNumber } from "./residco-import";
import { csvCarNumberField, csvField } from "./car-export-identity";

export const REMARK_BATCH_MAX = 500;
export const REMARK_CONFIRM = "REMARK";
/** Suffix stored on car_number_history.reason so Undo can delete the rows it added. */
export const REMARK_CHANGE_GROUP_MARKER = "change_group ";

export type RemarkStatus =
  | "ready"
  | "inactive"
  | "not_found"
  | "clash"
  | "already"
  | "moved"
  | "duplicate"
  | "ambiguous"
  | "invalid";

export type RemarkInputRow = {
  line: number;
  input: string;
  old_mark: string;
  old_number: string;
  new_mark: string;
  new_number: string;
  error?: string;
};

export type RemarkCarRecord = {
  id: number;
  reporting_marks: string | null;
  car_initial: string | null;
  car_number: string;
  active: boolean | null;
  status: string | null;
  fleet_status: string | null;
  lessee_name: string | null;
  rider_external_id: string | null;
  assignment_label: string | null;
  old_car_initial?: string | null;
  old_car_number?: string | null;
  program: string | null;
};

export type RemarkHistoryRef = {
  railcar_id: number;
  old_car_initial: string | null;
  old_car_number: string | null;
};

export type RemarkClash = {
  id: number;
  reporting_marks: string | null;
  car_number: string;
  active: boolean | null;
  status: string | null;
  fleet_status: string | null;
  lessee_name: string | null;
};

export type RemarkPreviewRow = {
  line: number;
  input: string;
  old_mark: string;
  old_number: string;
  new_mark: string;
  new_number: string;
  status: RemarkStatus;
  message: string;
  railcar_id: number | null;
  active: boolean | null;
  program: string | null;
  lease: string | null;
  lessee: string | null;
  clash: RemarkClash | null;
};

export type RemarkPreview = {
  rows: RemarkPreviewRow[];
  counts: Record<RemarkStatus, number> & { total: number; blockers: number };
  ready: RemarkPreviewRow[];
};

export type RemarkApplyItem = {
  id: number;
  old_reporting_marks: string;
  old_car_number: string;
  reporting_marks: string;
  car_number: string;
};

export type RemarkAliasTarget = {
  railcarId: number;
  currentMark: string;
  currentNumber: string;
};

export function paddedCarNumber(raw: unknown): string | null {
  const n = normalizeStoredCarNumber(raw);
  return n.ok ? n.car_number : null;
}

/** Same key shape as VCF carKey: MARK|zero-padded number. */
export function remarkIdentityKey(mark: string, number: string): string | null {
  const m = String(mark ?? "").trim().toUpperCase();
  const num = paddedCarNumber(number);
  if (!m || !num) return null;
  return `${m}|${num}`;
}

export function remarkHistoryReason(reason: string, changeGroup: string): string {
  const base = reason.trim() || "Remark";
  return `${base}; ${REMARK_CHANGE_GROUP_MARKER}${changeGroup}`;
}

export function buildRemarkAliasIndex(input: {
  cars: Array<{
    id: number;
    reporting_marks?: string | null;
    car_initial?: string | null;
    car_number?: string | null;
    old_car_initial?: string | null;
    old_car_number?: string | null;
  }>;
  history: RemarkHistoryRef[];
}): Map<string, RemarkAliasTarget | "ambiguous"> {
  const carsById = new Map<number, (typeof input.cars)[number]>();
  for (const car of input.cars) carsById.set(Number(car.id), car);
  const index = new Map<string, RemarkAliasTarget | "ambiguous">();

  const add = (oldMark: string | null | undefined, oldNumber: string | null | undefined, car: (typeof input.cars)[number]) => {
    const currentMark = String(car.car_initial || car.reporting_marks || "").trim().toUpperCase();
    const currentNumber = paddedCarNumber(car.car_number);
    const oldKey = remarkIdentityKey(String(oldMark ?? ""), String(oldNumber ?? ""));
    if (!currentMark || !currentNumber || !oldKey) return;
    const currentKey = remarkIdentityKey(currentMark, currentNumber);
    if (!currentKey || oldKey === currentKey) return;
    const target: RemarkAliasTarget = {
      railcarId: Number(car.id),
      currentMark,
      currentNumber,
    };
    const prev = index.get(oldKey);
    if (!prev) index.set(oldKey, target);
    else if (prev !== "ambiguous" && prev.railcarId !== target.railcarId) index.set(oldKey, "ambiguous");
  };

  for (const row of input.history) {
    const car = carsById.get(Number(row.railcar_id));
    if (!car) continue;
    add(row.old_car_initial, row.old_car_number, car);
  }
  for (const car of input.cars) add(car.old_car_initial, car.old_car_number, car);
  return index;
}

function normHeader(raw: string): string {
  return String(raw ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function cellText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  if (typeof value === "object") {
    const rec = value as { text?: unknown; result?: unknown };
    if (rec.text != null) return cellText(rec.text);
    if (rec.result != null) return cellText(rec.result);
  }
  return String(value).trim();
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else quoted = !quoted;
      continue;
    }
    if (!quoted && (ch === "," || ch === "\t" || ch === ";")) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

type HeaderMap = { oldMark: number; oldNum: number; newMark: number; newNum: number | null };

function headerMap(cells: string[]): HeaderMap | null {
  const norms = cells.map(normHeader);
  const remarkIdx = norms.map((h, i) => (h === "remark" ? i : -1)).filter((i) => i >= 0);
  const find = (names: string[], skip = new Set<number>()) =>
    norms.findIndex((h, i) => names.includes(h) && !skip.has(i));
  const oldMark = find(["oldmark", "oldcarinitial", "frommark", "prefix", "reportingmarks", "mark", "carinitial", "oldreportingmarks", "initial"]);
  const oldNum = find(["number", "carnumber", "oldnumber", "oldcarnumber", "num"]);
  let newMark = find(["newmark", "tomark", "newcarinitial", "newreportingmarks", "newinitial"]);
  let newNum: number | null = find(["newnumber", "newcarnumber", "remarknumber", "tonewnumber"]);
  if (newMark < 0 && remarkIdx.length) newMark = remarkIdx[0];
  if (newNum == null || newNum < 0) {
    newNum = remarkIdx.length > 1 ? remarkIdx[1] : null;
  }
  if (oldMark < 0 || oldNum < 0 || newMark < 0) return null;
  return { oldMark, oldNum, newMark, newNum };
}

function rowFromParts(line: number, input: string, oldRaw: string, numRaw: string, newRaw: string, newNumRaw: string): RemarkInputRow {
  const oldSplit = splitCarNumber(oldRaw.includes(" ") || /\d/.test(oldRaw) ? oldRaw : `${oldRaw} ${numRaw}`);
  const oldMark = (oldSplit.reporting_marks ?? oldRaw).trim().toUpperCase();
  const oldNumber = paddedCarNumber(numRaw || oldSplit.car_number);
  const newSplit = splitCarNumber(newRaw);
  const newMark = (newSplit.reporting_marks ?? newRaw).trim().toUpperCase();
  const newNumber = paddedCarNumber(newNumRaw || newSplit.car_number || oldNumber || "");
  const base = {
    line,
    input,
    old_mark: oldMark,
    old_number: oldNumber ?? "",
    new_mark: newMark,
    new_number: newNumber ?? "",
  };
  if (!/^[A-Z]{2,6}$/.test(oldMark)) return { ...base, error: "Old mark must be 2–6 letters" };
  if (!oldNumber) return { ...base, error: "Car number must be 1–6 digits" };
  if (!/^[A-Z]{2,6}$/.test(newMark)) return { ...base, error: "New mark must be 2–6 letters" };
  if (!newNumber) return { ...base, error: "New car number must be 1–6 digits" };
  return base;
}

function rowFromArrow(line: number, input: string, left: string, right: string): RemarkInputRow {
  const old = splitCarNumber(left);
  const neu = splitCarNumber(right);
  return rowFromParts(
    line,
    input,
    old.reporting_marks ?? "",
    old.car_number,
    neu.reporting_marks ?? right,
    neu.car_number,
  );
}

function rowFromCells(line: number, cells: string[], headers: HeaderMap | null): RemarkInputRow | null {
  const input = cells.join(" ").trim();
  if (!input) return null;
  if (headers) {
    return rowFromParts(
      line,
      input,
      cells[headers.oldMark] ?? "",
      cells[headers.oldNum] ?? "",
      cells[headers.newMark] ?? "",
      headers.newNum == null ? "" : cells[headers.newNum] ?? "",
    );
  }
  if (cells.length === 1) {
    const arrow = cells[0].match(/^(.+?)\s*(?:=>|->|→|>)\s*(.+)$/);
    if (arrow) return rowFromArrow(line, input, arrow[1], arrow[2]);
    return { line, input, old_mark: "", old_number: "", new_mark: "", new_number: "", error: "Could not read this row" };
  }
  const arrow = input.match(/^(.+?)\s*(?:=>|->|→|>)\s*(.+)$/);
  if (arrow && cells.length <= 2) return rowFromArrow(line, input, arrow[1], arrow[2]);
  if (cells.length >= 3) {
    return rowFromParts(line, input, cells[0], cells[1], cells[2], cells[3] ?? "");
  }
  return { line, input, old_mark: "", old_number: "", new_mark: "", new_number: "", error: "Could not read this row" };
}

export function parseRemarkMatrix(matrix: unknown[][]): { ok: true; rows: RemarkInputRow[] } | { ok: false; error: string } {
  const lines = matrix
    .map((row) => (Array.isArray(row) ? row.map(cellText) : []))
    .filter((row) => row.some((cell) => cell.trim() !== ""));
  if (!lines.length) return { ok: false, error: "No cars to remark" };
  let start = 0;
  let headers: HeaderMap | null = null;
  const first = headerMap(lines[0]);
  if (first) {
    headers = first;
    start = 1;
  }
  const rows: RemarkInputRow[] = [];
  for (let i = start; i < lines.length; i += 1) {
    const trimmed = lines[i].map((c) => c.trim());
    while (trimmed.length && trimmed[trimmed.length - 1] === "") trimmed.pop();
    if (!trimmed.some(Boolean)) continue;
    if (trimmed[0].startsWith("#")) continue;
    const row = rowFromCells(i + 1, trimmed, headers);
    if (row) rows.push(row);
  }
  if (!rows.length) return { ok: false, error: "No cars to remark" };
  if (rows.length > REMARK_BATCH_MAX) {
    return { ok: false, error: `At most ${REMARK_BATCH_MAX} cars per batch (got ${rows.length}).` };
  }
  return { ok: true, rows };
}

export function parseRemarkText(text: string): { ok: true; rows: RemarkInputRow[] } | { ok: false; error: string } {
  const raw = String(text ?? "").replace(/^\uFEFF/, "");
  const matrix = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      if (/[,\t;]/.test(line)) return splitCsvLine(line);
      const arrow = line.match(/^(.+?)\s*(?:=>|->|→|>)\s*(.+)$/);
      if (arrow) return [line];
      return line.split(/\s+/);
    });
  return parseRemarkMatrix(matrix);
}

function currentMark(car: RemarkCarRecord): string {
  return String(car.reporting_marks || car.car_initial || "").trim().toUpperCase();
}

function leaseOf(car: RemarkCarRecord): string | null {
  const rider = String(car.rider_external_id ?? "").trim();
  const label = String(car.assignment_label ?? "").trim();
  return rider || label || null;
}

function clashOf(car: RemarkCarRecord): RemarkClash {
  return {
    id: car.id,
    reporting_marks: car.reporting_marks,
    car_number: car.car_number,
    active: car.active,
    status: car.status,
    fleet_status: car.fleet_status,
    lessee_name: car.lessee_name,
  };
}

function blankRow(row: RemarkInputRow, status: RemarkStatus, message: string, car?: RemarkCarRecord | null, clash?: RemarkClash | null): RemarkPreviewRow {
  return {
    line: row.line,
    input: row.input,
    old_mark: row.old_mark,
    old_number: row.old_number,
    new_mark: row.new_mark,
    new_number: row.new_number,
    status,
    message,
    railcar_id: car?.id ?? null,
    active: car ? car.active === true : null,
    program: car?.program ?? null,
    lease: car ? leaseOf(car) : null,
    lessee: car?.lessee_name ?? null,
    clash: clash ?? null,
  };
}

export function classifyRemarkBatch(input: {
  rows: RemarkInputRow[];
  cars: RemarkCarRecord[];
  history: RemarkHistoryRef[];
}): RemarkPreview {
  const byKey = new Map<string, RemarkCarRecord[]>();
  const byId = new Map<number, RemarkCarRecord>();
  for (const car of input.cars) {
    byId.set(car.id, car);
    const key = remarkIdentityKey(currentMark(car), car.car_number);
    if (!key) continue;
    const list = byKey.get(key) ?? [];
    list.push(car);
    byKey.set(key, list);
  }
  const historyIds = new Map<string, number[]>();
  const pushHist = (key: string | null, id: number) => {
    if (!key || !byId.has(id)) return;
    const list = historyIds.get(key) ?? [];
    if (!list.includes(id)) list.push(id);
    historyIds.set(key, list);
  };
  for (const row of input.history) {
    pushHist(remarkIdentityKey(String(row.old_car_initial ?? ""), String(row.old_car_number ?? "")), Number(row.railcar_id));
  }
  for (const car of input.cars) {
    pushHist(remarkIdentityKey(String(car.old_car_initial ?? ""), String(car.old_car_number ?? "")), car.id);
  }

  const first: RemarkPreviewRow[] = input.rows.map((row) => {
    if (row.error) return blankRow(row, "invalid", row.error);
    const oldKey = remarkIdentityKey(row.old_mark, row.old_number);
    const newKey = remarkIdentityKey(row.new_mark, row.new_number);
    if (!oldKey || !newKey) return blankRow(row, "invalid", "Could not read mark and number");
    const direct = byKey.get(oldKey) ?? [];
    let car: RemarkCarRecord | null = null;
    let viaHistory = false;
    if (direct.length > 1) return blankRow(row, "ambiguous", "More than one car has this mark and number");
    if (direct.length === 1) car = direct[0];
    else {
      const ids = historyIds.get(oldKey) ?? [];
      if (ids.length > 1) return blankRow(row, "ambiguous", "This old mark matches more than one car");
      if (ids.length === 1) {
        car = byId.get(ids[0]) ?? null;
        viaHistory = true;
      }
    }
    if (!car) return blankRow(row, "not_found", "No car with this mark and number");
    const nowKey = remarkIdentityKey(currentMark(car), car.car_number);
    const label = `${currentMark(car)} ${car.car_number}`;
    if (nowKey === newKey) {
      return blankRow(row, "already", `Already ${label}`);
    }
    if (viaHistory) {
      return blankRow(
        row,
        "moved",
        `Already remarked in RLMS -> ${label}. Paste the current mark to remark it again.`,
        car,
      );
    }
    if (car.active !== true) {
      return blankRow(row, "inactive", "Inactive cars are skipped and never changed", car);
    }
    const occupants = (byKey.get(newKey) ?? []).filter((other) => other.id !== car!.id);
    if (occupants.length) {
      const other = occupants[0];
      const state = other.active === true ? "an active" : "an inactive";
      return blankRow(
        row,
        "clash",
        `Target ${currentMark(other)} ${other.car_number} already exists as ${state} car (record ${other.id}). Remark will not merge into it.`,
        car,
        clashOf(other),
      );
    }
    return blankRow(
      row,
      "ready",
      `Remark to ${row.new_mark} ${row.new_number}. The old mark stays inactive and the lease moves to the new car.`,
      car,
    );
  });

  const targetCount = new Map<string, number>();
  const sourceCount = new Map<number, number>();
  for (const row of first) {
    if (row.status !== "ready" || row.railcar_id == null) continue;
    const key = remarkIdentityKey(row.new_mark, row.new_number) ?? "";
    targetCount.set(key, (targetCount.get(key) ?? 0) + 1);
    sourceCount.set(row.railcar_id, (sourceCount.get(row.railcar_id) ?? 0) + 1);
  }
  const rows = first.map((row) => {
    if (row.status !== "ready" || row.railcar_id == null) return row;
    const key = remarkIdentityKey(row.new_mark, row.new_number) ?? "";
    if ((targetCount.get(key) ?? 0) > 1 || (sourceCount.get(row.railcar_id) ?? 0) > 1) {
      return { ...row, status: "duplicate" as const, message: "This batch uses that car or target more than once" };
    }
    return row;
  });

  const counts = {
    total: rows.length,
    ready: 0,
    inactive: 0,
    not_found: 0,
    clash: 0,
    already: 0,
    moved: 0,
    duplicate: 0,
    ambiguous: 0,
    invalid: 0,
    blockers: 0,
  };
  for (const row of rows) counts[row.status] += 1;
  counts.blockers = counts.total - counts.ready;
  return { rows, counts, ready: rows.filter((row) => row.status === "ready") };
}

export function selectRemarkApply(
  preview: RemarkPreview,
  mode: "all" | "good",
): { ok: true; items: RemarkApplyItem[] } | { ok: false; error: string } {
  if (mode === "all" && preview.counts.blockers > 0) {
    return { ok: false, error: `${preview.counts.blockers} row(s) are not ready. Fix them, or apply only the ready rows.` };
  }
  const picked = mode === "good" ? preview.ready : preview.rows.filter((row) => row.status === "ready");
  if (!picked.length) return { ok: false, error: "No ready rows to remark" };
  const items: RemarkApplyItem[] = [];
  for (const row of picked) {
    if (row.railcar_id == null) return { ok: false, error: "A ready row is missing its car id" };
    items.push({
      id: row.railcar_id,
      old_reporting_marks: row.old_mark,
      old_car_number: row.old_number,
      reporting_marks: row.new_mark,
      car_number: row.new_number,
    });
  }
  return { ok: true, items };
}

function csvCell(value: unknown): string {
  return csvField(value);
}

export function remarkPreviewToCsv(rows: RemarkPreviewRow[]): string {
  const header = [
    "line",
    "input",
    "old_mark",
    "old_number",
    "new_mark",
    "new_number",
    "status",
    "railcar_id",
    "active",
    "program",
    "lease",
    "lessee",
    "clash_id",
    "clash",
    "message",
  ];
  const body = rows.map((row) => [
    row.line,
    row.input,
    row.old_mark,
    row.old_number,
    row.new_mark,
    row.new_number,
    row.status,
    row.railcar_id ?? "",
    row.active == null ? "" : row.active ? "yes" : "no",
    row.program ?? "",
    row.lease ?? "",
    row.lessee ?? "",
    row.clash?.id ?? "",
    row.clash ? `${row.clash.reporting_marks ?? ""} ${row.clash.car_number}`.trim() : "",
    row.message,
  ]);
  const numberIndexes = new Set([3, 5]);
  return [
    header.map(csvCell).join(","),
    ...body.map((line) => line.map((cell, index) => (numberIndexes.has(index) ? csvCarNumberField(cell) : csvCell(cell))).join(",")),
  ].join("\n");
}
