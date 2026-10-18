/** Parse Bruce's jss_preview.csv (45 rows) into Group A/B/C plans. Preview only. */

export type JssAction = "off_rent+sold+cut_up+umler_queue+note" | "note_only" | "none";

export type JssPlanRow = {
  railcar_id: number;
  car: string;
  active: boolean;
  ol: string;
  action: JssAction;
  off_rent_date: string | null;
  assignment_end_date: string | null;
  sale_date: string | null;
  buyer: string | null;
  cut_up_date: string | null;
  umler_delete_queue: string | null;
  tag: string | null;
  note: string | null;
  discrepancy_comment: string | null;
};

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

function yn(v: string) {
  return /^(true|1|yes)$/i.test(v.trim());
}

export function parseJssPreviewCsv(text: string): JssPlanRow[] {
  const lines = String(text ?? "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const rows: JssPlanRow[] = [];
  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line);
    const get = (name: string) => {
      const i = idx(name);
      return i >= 0 ? String(cols[i] ?? "").trim() : "";
    };
    rows.push({
      railcar_id: Number(get("railcar_id")),
      car: get("car"),
      active: yn(get("active")),
      ol: get("ol"),
      action: (get("action") || "none") as JssAction,
      off_rent_date: get("off_rent_date") || null,
      assignment_end_date: get("assignment_end_date") || null,
      sale_date: get("sale_date") || null,
      buyer: get("buyer") || null,
      cut_up_date: get("cut_up_date") || null,
      umler_delete_queue: get("umler_delete_queue") || null,
      tag: get("tag") || null,
      note: get("note") || null,
      discrepancy_comment: get("discrepancy_comment") || null,
    });
  }
  return rows;
}

export function jssGroups(rows: JssPlanRow[]) {
  const a = rows.filter((r) => r.action.startsWith("off_rent"));
  const b = rows.filter((r) => r.action === "note_only");
  const c = rows.filter((r) => r.action === "none" || !r.active);
  return { a, b, c };
}

export function jssStepOps(row: JssPlanRow): { step: string; op: string; value: unknown }[] {
  if (!row.active || row.action === "none") return [];
  if (row.action === "note_only") {
    return [
      { step: "5_note", op: "add_note", value: row.note },
      { step: "5_tag", op: "add_tag", value: row.tag },
    ];
  }
  return [
    { step: "1_off_rent", op: "rent_stop", value: row.off_rent_date },
    { step: "2_assignment_end", op: "end_assignment", value: row.assignment_end_date },
    { step: "3_mark_sold", op: "mark_sold", value: { buyer: row.buyer, effective_date: row.sale_date } },
    { step: "4_cut_up", op: "set_scrapped_at", value: row.cut_up_date },
    { step: "4_umler", op: "set_umler_status", value: row.umler_delete_queue || "delete_requested" },
    { step: "5_note", op: "add_note", value: row.note },
    { step: "5_tag", op: "add_tag", value: row.tag },
  ];
}
