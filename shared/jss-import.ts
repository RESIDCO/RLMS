/** R5: parse CSX trace CSV + JSS cut-up sheet rows into the JSS plan. */

import type { JssAction, JssPlanRow } from "./jss-preview";

const INDUSTRY: Record<string, string> = {
  BENNING: "Benning DC",
  CUMBERLAN: "Cumberland MD",
  CUMBERLAND: "Cumberland MD",
  JESSUP: "Jessup MD",
};

export function excelSerialToIso(n: number): string {
  const epoch = Date.UTC(1899, 11, 30);
  return new Date(epoch + Math.round(n) * 86400000).toISOString().slice(0, 10);
}

export function padCar(n: string | number): string {
  const s = String(n).replace(/\D/g, "");
  return s.padStart(s.length > 6 ? s.length : 6, "0");
}

export function carKey(mark: string, num: string | number): string {
  return `${String(mark).trim().toUpperCase()} ${padCar(num)}`;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export type TraceArrival = {
  car: string;
  date: string;
  location: string;
  event: string;
  basis: string;
};

export function parseCsxTraceCsv(text: string): TraceArrival[] {
  const lines = String(text ?? "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.trim().replace(/^"|"$/g, ""));
  const idx = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const out: TraceArrival[] = [];
  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line).map((c) => c.replace(/^"|"$/g, "").trim());
    const get = (name: string) => cols[idx(name)] ?? "";
    const city = get("Location City").replace(/\s+/g, " ").trim().toUpperCase();
    const st = get("Location State").trim().toUpperCase();
    const event = get("Event Text").replace(/\s+/g, " ").trim();
    const locKey = city.replace(/[^A-Z]/g, "");
    const industry = INDUSTRY[locKey];
    const y = Number(get("Year"));
    const m = Number(get("Month"));
    const d = Number(get("Day"));
    const year = y < 100 ? 2000 + y : y;
    const date = `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const isPlacement = /^ACTUAL PLACEMENT/i.test(event) && Boolean(industry);
    const isDoa = /^RELEASED/i.test(event) && locKey === "BENNING";
    if (!isPlacement && !isDoa) continue;
    out.push({
      car: carKey(get("Initial"), get("Number")),
      date,
      location: industry ?? `${city}, ${st}`,
      event: event.split(" ")[0],
      basis: isDoa ? "RELEASED at Benning DC (DOA, counts as arrived)" : "ACTUAL PLACEMENT",
    });
  }
  return out;
}

export type CutupRow = {
  car: string;
  cut_up_date: string | null;
  note: string;
  kind: "cut_up" | "will_not_make" | "lost" | "inactive_hint";
};

function cellStr(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

export function parseJssCutupRows(rows: unknown[][]): CutupRow[] {
  const byCar = new Map<string, CutupRow>();
  const confirmCutup = new Set(["TFOX 003037", "TFOX 003195"]);
  for (const raw of rows) {
    const mark = cellStr(raw[1]).replace(/\s+/g, "");
    const num = raw[2];
    if (!mark || num == null || num === "") continue;
    const car = carKey(mark, num);
    const dateCell = raw[3];
    const extra = [raw[4], raw[5]].map(cellStr).filter(Boolean).join(" | ");
    if (typeof dateCell === "number") {
      const iso = excelSerialToIso(dateCell);
      const prev = byCar.get(car);
      const keepLater = confirmCutup.has(car);
      if (!prev || (keepLater && iso > String(prev.cut_up_date ?? ""))) {
        byCar.set(car, { car, cut_up_date: iso, note: extra, kind: "cut_up" });
      } else if (!keepLater && prev.kind === "cut_up") {
        // first date wins except 3037/3195 (confirmed later 9/15)
      }
    } else {
      const t = cellStr(dateCell).toUpperCase();
      if (t.includes("WILL NOT MAKE")) {
        byCar.set(car, { car, cut_up_date: null, note: `WILL NOT MAKE ${extra}`.trim(), kind: "will_not_make" });
      } else if (t.includes("LOST")) {
        const kind = car.endsWith("001621") ? "inactive_hint" : "lost";
        byCar.set(car, { car, cut_up_date: null, note: `LOST ${extra}`.trim(), kind });
      }
    }
  }
  return [...byCar.values()];
}

const BRUCE_ARRIVAL: Record<string, string> = {
  "TFOX 100284": "2026-09-14",
};

export function buildJssPlanFromSources(opts: {
  cutupRows: unknown[][];
  traceCsv: string;
  cars?: { car: string; railcar_id: number; active: boolean; ol: string }[];
}): JssPlanRow[] {
  const cut = parseJssCutupRows(opts.cutupRows);
  const arrivals = new Map(parseCsxTraceCsv(opts.traceCsv).map((a) => [a.car, a]));
  const meta = new Map((opts.cars ?? []).map((c) => [c.car, c]));
  const cars = new Set([...cut.map((c) => c.car), ...arrivals.keys(), ...meta.keys()]);
  const out: JssPlanRow[] = [];
  for (const car of [...cars].sort()) {
    const c = cut.find((x) => x.car === car);
    const a = arrivals.get(car);
    const m = meta.get(car);
    const arrivalDate = BRUCE_ARRIVAL[car] ?? a?.date ?? null;
    const cutDate = c?.cut_up_date ?? null;
    const active = m ? m.active : car !== "TFOX 001621";
    if (!active || c?.kind === "inactive_hint") {
      out.push({
        railcar_id: m?.railcar_id ?? 0,
        car,
        active: false,
        ol: m?.ol ?? "",
        action: "none",
        off_rent_date: null,
        assignment_end_date: null,
        sale_date: null,
        buyer: null,
        cut_up_date: null,
        umler_delete_queue: null,
        tag: null,
        note: null,
        discrepancy_comment: null,
      });
      continue;
    }
    if (arrivalDate && cutDate) {
      const disc =
        cutDate < arrivalDate
          ? `Discrepancy: JSS cut-up date ${cutDate} is earlier than trace arrival ${arrivalDate} (${a?.location ?? "industry"}); off rent uses trace arrival ${arrivalDate}.`
          : null;
      out.push({
        railcar_id: m?.railcar_id ?? 0,
        car,
        active: true,
        ol: m?.ol ?? (car.endsWith("100284") ? "OL1961" : "OL1724"),
        action: "off_rent+sold+cut_up+umler_queue+note",
        off_rent_date: arrivalDate,
        assignment_end_date: arrivalDate,
        sale_date: cutDate,
        buyer: "Joseph Smith & Sons",
        cut_up_date: cutDate,
        umler_delete_queue: "delete_requested",
        tag: "JSS scrap sale 2026",
        note: disc,
        discrepancy_comment: disc,
      });
      continue;
    }
    out.push({
      railcar_id: m?.railcar_id ?? 0,
      car,
      active: true,
      ol: m?.ol ?? "OL1724",
      action: "note_only",
      off_rent_date: null,
      assignment_end_date: null,
      sale_date: null,
      buyer: null,
      cut_up_date: null,
      umler_delete_queue: null,
      tag: "JSS scrap sale 2026",
      note: c?.note ?? "note",
      discrepancy_comment: null,
    });
  }
  return out;
}

export type ImportTargetField = "off_rent_date" | "cut_up_date" | "note" | "tag" | "umler_status";

export function excelSerialOrIso(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" && v > 20000 && v < 80000) return excelSerialToIso(v);
  const s = String(v).trim();
  if (!s || /[a-zA-Z]/.test(s) && !/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const md = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (md) {
    const y = Number(md[3]) < 100 ? 2000 + Number(md[3]) : Number(md[3]);
    return `${y}-${md[1].padStart(2, "0")}-${md[2].padStart(2, "0")}`;
  }
  return null;
}

export function mapPerCarImport(
  rows: Record<string, unknown>[],
  opts: { carColumn: string; valueColumn: string; field: ImportTargetField },
): { car: string; field: string; value: unknown; skipped?: string }[] {
  const out: { car: string; field: string; value: unknown; skipped?: string }[] = [];
  for (const row of rows) {
    const car = String(row[opts.carColumn] ?? "").trim();
    if (!car) {
      out.push({ car: "", field: opts.field, value: null, skipped: "blank car" });
      continue;
    }
    const raw = row[opts.valueColumn];
    if (opts.field === "note" || opts.field === "tag" || opts.field === "umler_status") {
      const s = String(raw ?? "").trim();
      if (!s) out.push({ car, field: opts.field, value: null, skipped: "blank" });
      else out.push({ car, field: opts.field, value: s });
      continue;
    }
    const iso = excelSerialOrIso(raw);
    if (!iso) out.push({ car, field: opts.field, value: raw, skipped: "text/blank date" });
    else out.push({ car, field: opts.field, value: iso });
  }
  return out;
}

export function planKey(r: Pick<JssPlanRow, "car" | "action" | "off_rent_date" | "sale_date" | "cut_up_date">) {
  return [r.car, r.action, r.off_rent_date, r.sale_date, r.cut_up_date].join("|");
}
