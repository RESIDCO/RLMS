/**
 * Import licensed AAR reference CSVs/Excel from modules/repair/ref-data/
 * (or --dir). Upserts by natural key; records edition/quarter.
 *
 * Run: npm run repair:import-ref-data
 *
 * Empty header-only scaffolds → warn + soft OK (no invented AAR rows).
 */
import { createReadStream, existsSync, readdirSync } from "fs";
import { dirname, join, resolve } from "path";
import { createInterface } from "readline";
import { fileURLToPath } from "url";
import { DEFAULT_TENANT_ID, q } from "../db";
import { migrateLocal } from "./migrate-local";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = resolve(__dirname, "../ref-data");

type Row = Record<string, string>;

type TableSpec = {
  fileBase: string;
  table: string;
  /** Columns to upsert (excluding tenant_id). */
  key: string[];
  columns: string[];
  /** Optional mirror upsert into an existing operational table. */
  mirror?: {
    table: string;
    key: string[];
    columns: string[];
    map?: (row: Row) => Record<string, unknown>;
  };
};

const SPECS: TableSpec[] = [
  {
    fileBase: "ref_job_codes",
    table: "repair.ref_job_codes",
    key: ["job_code"],
    columns: [
      "job_code",
      "description",
      "rule",
      "price_list_qualifier",
      "category",
      "sub_category",
      "source",
      "rule_page",
      "effective_quarter",
      "edition",
    ],
  },
  {
    fileBase: "ref_job_code_prices",
    table: "repair.ref_job_code_prices",
    key: ["price_key"],
    columns: [
      "job_code",
      "qualifier",
      "condition_code",
      "why_made",
      "resp_code",
      "price_key",
      "price_cents",
      "labor_cents",
      "material_cents",
      "source",
      "rule_page",
      "effective_quarter",
      "edition",
    ],
  },
  {
    fileBase: "ref_qualifiers",
    table: "repair.ref_qualifiers",
    key: ["job_code", "qualifier"],
    columns: [
      "job_code",
      "qualifier",
      "description",
      "category",
      "sub_category",
      "qualifier_type",
      "basis",
      "source",
      "rule_page",
      "effective_quarter",
      "edition",
    ],
  },
  {
    fileBase: "ref_qualifier_generic",
    table: "repair.ref_qualifier_generic",
    key: ["qualifier"],
    columns: [
      "qualifier",
      "qualifier_type",
      "description",
      "category",
      "sub_category",
      "source",
      "rule_page",
      "effective_quarter",
      "edition",
    ],
  },
  {
    fileBase: "ref_qualifier_charts",
    table: "repair.ref_qualifier_charts",
    key: ["import_key"],
    columns: [
      "import_key",
      "rule",
      "chart_group",
      "qualifier",
      "description",
      "chart_title",
      "discontinued",
      "job_codes_using_chart",
      "source",
      "rule_page",
      "effective_quarter",
      "edition",
    ],
  },
  {
    fileBase: "ref_why_made",
    table: "repair.ref_why_made",
    key: ["code"],
    columns: ["code", "description", "source", "rule_page", "effective_quarter", "edition"],
  },
  {
    fileBase: "ref_condition_codes",
    table: "repair.ref_condition_codes",
    key: ["code"],
    columns: ["code", "description", "source", "rule_page", "effective_quarter", "edition"],
  },
  {
    fileBase: "ref_location_codes",
    table: "repair.ref_location_codes",
    key: ["code"],
    columns: ["code", "description", "source", "rule_page", "effective_quarter", "edition"],
  },
  {
    fileBase: "ref_responsibility_codes",
    table: "repair.ref_responsibility_codes",
    key: ["code"],
    columns: ["code", "description", "source", "rule_page", "effective_quarter", "edition"],
  },
  {
    fileBase: "ref_car_part_codes",
    table: "repair.ref_car_part_codes",
    key: ["code"],
    columns: [
      "code",
      "description",
      "category",
      "sub_category",
      "source",
      "rule_page",
      "effective_quarter",
      "edition",
    ],
  },
  {
    fileBase: "repair_categories",
    table: "repair.ref_repair_categories",
    key: ["combo_key"],
    columns: [
      "job_code",
      "qualifier",
      "combo_key",
      "description",
      "category",
      "sub_category",
      "source",
      "rule_page",
      "effective_quarter",
      "edition",
    ],
    mirror: {
      table: "repair.repair_categories",
      key: ["combo_key"],
      columns: ["job_code", "qualifier", "combo_key", "description", "category", "sub_category"],
    },
  },
  {
    fileBase: "component_id_rules",
    table: "repair.component_id_rules",
    key: ["job_code", "qualifier", "job_code_prefix", "label"],
    columns: [
      "job_code",
      "qualifier",
      "job_code_prefix",
      "label",
      "require_on",
      "active",
      "notes",
    ],
  },
];

function parseArgs() {
  const args = process.argv.slice(2);
  let dir = DEFAULT_DIR;
  let actor = "import-ref-data";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dir" && args[i + 1]) dir = resolve(args[++i]!);
    if (args[i] === "--actor" && args[i + 1]) actor = args[++i]!;
  }
  return { dir, actor };
}

function findSourceFile(dir: string, base: string): string | null {
  const candidates = [
    `${base}.csv`,
    `${base}.CSV`,
    `${base}.xlsx`,
    `${base}.xls`,
    `${base}.XLSX`,
  ];
  for (const name of candidates) {
    const p = join(dir, name);
    if (existsSync(p)) return p;
  }
  // Loose match: starts with base
  if (!existsSync(dir)) return null;
  const hit = readdirSync(dir).find(
    (f) =>
      f.toLowerCase().startsWith(base.toLowerCase()) &&
      (f.toLowerCase().endsWith(".csv") ||
        f.toLowerCase().endsWith(".xlsx") ||
        f.toLowerCase().endsWith(".xls")),
  );
  return hit ? join(dir, hit) : null;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQ = !inQ;
      continue;
    }
    if (ch === "," && !inQ) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

async function readCsvRows(path: string): Promise<{ headers: string[]; rows: Row[] }> {
  const rl = createInterface({ input: createReadStream(path, { encoding: "utf8" }) });
  let headers: string[] | null = null;
  const rows: Row[] = [];
  for await (const raw of rl) {
    const line = raw.replace(/^\uFEFF/, "").trimEnd();
    if (!line.trim()) continue;
    const cols = splitCsvLine(line);
    if (!headers) {
      headers = cols.map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
      continue;
    }
    const row: Row = {};
    headers.forEach((h, i) => {
      row[h] = (cols[i] ?? "").trim();
    });
    // Skip fully empty
    if (Object.values(row).every((v) => !v)) continue;
    rows.push(row);
  }
  return { headers: headers ?? [], rows };
}

async function readXlsxRows(path: string): Promise<{ headers: string[]; rows: Row[] }> {
  const ExcelJS = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const sheet = wb.worksheets[0];
  if (!sheet) return { headers: [], rows: [] };
  const matrix: string[][] = [];
  sheet.eachRow((row) => {
    const vals: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      vals[col - 1] = cell.text?.trim() ?? String(cell.value ?? "").trim();
    });
    matrix.push(vals.map((v) => v ?? ""));
  });
  if (!matrix.length) return { headers: [], rows: [] };
  const headers = matrix[0]!.map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const rows: Row[] = [];
  for (const cols of matrix.slice(1)) {
    const row: Row = {};
    headers.forEach((h, i) => {
      row[h] = (cols[i] ?? "").trim();
    });
    if (Object.values(row).every((v) => !v)) continue;
    rows.push(row);
  }
  return { headers, rows };
}

function pick(row: Row, col: string): string | null {
  const aliases: Record<string, string[]> = {
    job_code: ["job_code", "jobcode", "applied_job_code", "ajob"],
    qualifier: ["qualifier", "qa", "qual"],
    combo_key: ["combo_key", "combokey", "key"],
    description: ["description", "desc", "name", "display_name", "residco_sheet_description"],
    category: ["category", "cat"],
    sub_category: ["sub_category", "subcategory", "sub_cat", "subcat"],
    source: ["source", "source_file", "src"],
    // rule_page is PDF page; "rule" alone is the AAR rule number (job/charts)
    rule_page: ["pdf_page", "rule_page", "page", "aar_page"],
    rule: ["rule", "aar_rule", "fm_rule"],
    price_list_qualifier: [
      "price_list_qualifier",
      "qualifiers",
      "qlfr",
      "matrix_qualifier",
    ],
    qualifier_type: ["qualifier_type", "type"],
    basis: ["basis"],
    chart_group: ["chart_group", "group", "grp"],
    chart_title: ["chart_title", "chart", "title"],
    discontinued: ["discontinued", "disc", "obsolete"],
    job_codes_using_chart: [
      "job_codes_using_chart",
      "job_codes",
      "jobs",
      "starred_jobs",
    ],
    effective_quarter: [
      "effective",
      "effective_quarter",
      "quarter",
      "eff_quarter",
      "edition_quarter",
    ],
    edition: ["edition", "aar_edition", "version"],
    code: [
      "code",
      "wm",
      "why_made",
      "location_code",
      "condition_code",
      "resp_code",
      "car_part_code",
      "responsibility_code",
    ],
    condition_code: ["condition_code", "condition", "c"],
    why_made: ["why_made", "wm"],
    resp_code: ["resp_code", "responsibility_code", "r"],
    price_key: ["price_key"],
    price_cents: ["price_cents", "price", "amount_cents"],
    labor_cents: ["labor_cents", "labor"],
    material_cents: ["material_cents", "material"],
    job_code_prefix: ["job_code_prefix", "prefix"],
    label: ["label", "name", "title", "description"],
    require_on: ["require_on", "when", "require", "requirement"],
    active: ["active", "is_active"],
    notes: ["notes", "note", "comment", "requirement", "basis", "rule"],
  };
  const keys = aliases[col] ?? [col];
  for (const k of keys) {
    if (row[k] != null && String(row[k]).trim() !== "") return String(row[k]).trim();
  }
  return null;
}

function toBool(v: string | null, defaultTrue = true): boolean {
  if (v == null || v === "") return defaultTrue;
  return !/^(0|false|no|n|off)$/i.test(v);
}

function toBigIntOrNull(v: string | null): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[$,]/g, ""));
  if (!Number.isFinite(n)) return null;
  // If looks like dollars (has .), convert to cents
  if (String(v).includes(".")) return Math.round(n * 100);
  return Math.trunc(n);
}

function normalizeRequireOn(raw: string | null): string {
  if (!raw) return "FINAL_OR_INVOICE";
  const s = raw.toUpperCase();
  if (s === "FINAL" || s === "INVOICE" || s === "ALWAYS" || s === "FINAL_OR_INVOICE") {
    return s;
  }
  // Bruce CSV "requirement" is descriptive (CID flag etc.) — treat as needs CID on final/invoice
  if (/CID|COMPONENT/.test(s) && /:?\s*Y\b|REQUIRED|YES/.test(s)) {
    return "FINAL_OR_INVOICE";
  }
  if (/CID|COMPONENT/.test(s)) return "FINAL_OR_INVOICE";
  return "FINAL_OR_INVOICE";
}

async function upsertRows(
  spec: TableSpec,
  rows: Row[],
  opts: { tenantId: string; actor: string; sourceFile: string },
): Promise<number> {
  let n = 0;
  let rowIndex = 0;
  for (const raw of rows) {
    rowIndex += 1;
    const mapped: Record<string, unknown> = {};
    for (const col of spec.columns) {
      if (col === "import_key") continue; // set below for charts
      if (col.endsWith("_cents")) mapped[col] = toBigIntOrNull(pick(raw, col));
      else if (col === "active" || col === "discontinued")
        mapped[col] = toBool(pick(raw, col), col === "active");
      else mapped[col] = pick(raw, col);
    }

    // Per-file derived fields
    if (spec.fileBase === "ref_job_codes") {
      // CSV "qualifiers" → price_list_qualifier; "rule" is AAR rule number
      if (!mapped.price_list_qualifier) {
        mapped.price_list_qualifier = pick(raw, "price_list_qualifier");
      }
      if (!mapped.rule) mapped.rule = pick(raw, "rule");
      const jobN = Number(mapped.job_code);
      if (Number.isFinite(jobN) && jobN >= 8000 && jobN < 9000) {
        mapped.source = mapped.source || "Repair_Categories.xlsx";
      }
    }
    if (spec.fileBase === "repair_categories") {
      const job = String(mapped.job_code ?? pick(raw, "job_code") ?? "").trim();
      const qual = String(mapped.qualifier ?? pick(raw, "qualifier") ?? "").trim();
      const rowType = String(pick(raw, "row_type") ?? raw.row_type ?? "").trim();
      // job_code rows + car_part qualifier-only rows (empty job_code)
      if (!job && !qual) continue;
      if (job && qual) {
        mapped.job_code = job;
        mapped.qualifier = qual;
        mapped.combo_key = `${job}|${qual}`;
      } else if (job) {
        mapped.job_code = job;
        mapped.qualifier = null;
        mapped.combo_key = job;
      } else {
        // car_part_code (qualifier only) — job_code column is NOT NULL; use sentinel
        mapped.job_code = "PART";
        mapped.qualifier = qual;
        mapped.combo_key = `PART|${qual}`;
      }
      const jobN = Number(job);
      if (Number.isFinite(jobN) && jobN >= 8000 && jobN < 9000) {
        mapped.source = mapped.source || "Repair_Categories.xlsx";
      }
      void rowType;
    }
    if (spec.fileBase === "ref_qualifier_charts") {
      if (!mapped.rule || !mapped.qualifier) continue;
      if (!mapped.chart_group) mapped.chart_group = pick(raw, "chart_group") ?? "";
      if (!mapped.chart_title) mapped.chart_title = pick(raw, "chart_title") ?? "";
      mapped.discontinued = toBool(pick(raw, "discontinued"), false);
      // File-order key — rule/group/qual/chart are not unique in the FM charts
      mapped.import_key = [
        String(mapped.rule),
        String(mapped.chart_group ?? ""),
        String(mapped.qualifier),
        String(mapped.chart_title ?? ""),
        String(mapped.description ?? ""),
        String(mapped.rule_page ?? ""),
        String(rowIndex),
      ].join("|");
    }
    if (spec.fileBase === "ref_qualifier_generic") {
      if (!mapped.qualifier) continue;
    }
    if (spec.fileBase === "ref_job_code_prices") {
      const job = String(mapped.job_code ?? "").trim();
      if (!job) continue;
      const qual = String(mapped.qualifier ?? "").trim();
      const cond = String(mapped.condition_code ?? "").trim();
      const wm = String(mapped.why_made ?? "").trim();
      const resp = String(mapped.resp_code ?? "").trim();
      mapped.price_key = `${job}|${qual}|${cond}|${wm}|${resp}`;
    }
    if (spec.fileBase === "ref_qualifiers") {
      if (!mapped.qualifier) continue;
      // Unique qualifier rows may share qualifier across jobs — job_code required in key
      if (!mapped.job_code) mapped.job_code = pick(raw, "job_code");
    }
    if (
      spec.fileBase === "ref_condition_codes" ||
      spec.fileBase === "ref_location_codes" ||
      spec.fileBase === "ref_responsibility_codes" ||
      spec.fileBase === "ref_car_part_codes"
    ) {
      if (!mapped.code) continue;
    }
    if (spec.fileBase === "component_id_rules") {
      mapped.require_on = normalizeRequireOn(
        pick(raw, "require_on") || pick(raw, "requirement"),
      );
      if (!mapped.label) mapped.label = pick(raw, "description");
      mapped.notes = [
        pick(raw, "requirement"),
        pick(raw, "basis"),
        pick(raw, "rule"),
      ]
        .filter(Boolean)
        .join(" | ");
      // Only keep rows that actually require CID
      const req = String(pick(raw, "requirement") ?? "").toUpperCase();
      if (req && !(/CID|COMPONENT/.test(req) && /:?\s*Y\b|REQUIRED|YES/.test(req))) {
        // Still import but mark inactive if clearly N
        if (/CID.*:\s*N\b|:N\b/.test(req)) mapped.active = false;
      }
    }

    const primary = spec.key[0]!;
    if (mapped[primary] == null || String(mapped[primary]).trim() === "") {
      if (spec.fileBase === "component_id_rules") {
        if (!mapped.job_code && !mapped.job_code_prefix && !mapped.label) continue;
      } else if (spec.fileBase === "ref_qualifiers") {
        if (!mapped.qualifier) continue;
      } else continue;
    }

    if (spec.fileBase === "component_id_rules") {
      const existing = await q(
        `SELECT id FROM repair.component_id_rules
         WHERE tenant_id = $1 AND deleted_at IS NULL
           AND COALESCE(job_code,'') = COALESCE($2,'')
           AND COALESCE(qualifier,'') = COALESCE($3,'')
           AND COALESCE(label,'') = COALESCE($4,'')
         LIMIT 1`,
        [
          opts.tenantId,
          mapped.job_code ?? null,
          mapped.qualifier ?? null,
          mapped.label ?? null,
        ],
      );
      if (existing.rows[0]) {
        await q(
          `UPDATE repair.component_id_rules SET
             require_on = $2, active = $3, notes = $4,
             updated_at = now(), updated_by = $5
           WHERE id = $1`,
          [
            existing.rows[0].id,
            mapped.require_on ?? "FINAL_OR_INVOICE",
            mapped.active !== false,
            mapped.notes ?? null,
            opts.actor,
          ],
        );
      } else {
        await q(
          `INSERT INTO repair.component_id_rules
             (tenant_id, job_code, qualifier, job_code_prefix, label, require_on, active, notes, created_by)
           VALUES ($1,$2,$3,$4,$5,COALESCE($6,'FINAL_OR_INVOICE'),$7,$8,$9)`,
          [
            opts.tenantId,
            mapped.job_code ?? null,
            mapped.qualifier ?? null,
            mapped.job_code_prefix ?? null,
            mapped.label ?? null,
            mapped.require_on ?? "FINAL_OR_INVOICE",
            mapped.active !== false,
            mapped.notes ?? null,
            opts.actor,
          ],
        );
      }
      n += 1;
      continue;
    }

    if (spec.table === "repair.ref_job_code_prices") {
      const existing = await q(
        `SELECT id FROM repair.ref_job_code_prices
         WHERE tenant_id = $1 AND price_key = $2 AND deleted_at IS NULL
         LIMIT 1`,
        [opts.tenantId, mapped.price_key],
      );
      if (existing.rows[0]) {
        await q(
          `UPDATE repair.ref_job_code_prices SET
             qualifier=$2, condition_code=$3, why_made=$4, resp_code=$5,
             price_cents=$6, labor_cents=$7, material_cents=$8,
             source=$9, rule_page=$10, effective_quarter=$11, edition=$12,
             updated_at=now(), updated_by=$13
           WHERE id=$1`,
          [
            existing.rows[0].id,
            mapped.qualifier ?? null,
            mapped.condition_code ?? null,
            mapped.why_made ?? null,
            mapped.resp_code ?? null,
            mapped.price_cents,
            mapped.labor_cents,
            mapped.material_cents,
            mapped.source,
            mapped.rule_page,
            mapped.effective_quarter,
            mapped.edition,
            opts.actor,
          ],
        );
      } else {
        await q(
          `INSERT INTO repair.ref_job_code_prices
             (tenant_id, job_code, qualifier, condition_code, why_made, resp_code, price_key,
              price_cents, labor_cents, material_cents,
              source, rule_page, effective_quarter, edition, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [
            opts.tenantId,
            mapped.job_code,
            mapped.qualifier ?? null,
            mapped.condition_code ?? null,
            mapped.why_made ?? null,
            mapped.resp_code ?? null,
            mapped.price_key,
            mapped.price_cents,
            mapped.labor_cents,
            mapped.material_cents,
            mapped.source,
            mapped.rule_page,
            mapped.effective_quarter,
            mapped.edition,
            opts.actor,
          ],
        );
      }
      n += 1;
      continue;
    }

    if (spec.table === "repair.ref_qualifiers") {
      const existing = await q(
        `SELECT id FROM repair.ref_qualifiers
         WHERE tenant_id = $1 AND COALESCE(job_code,'') = COALESCE($2,'')
           AND qualifier = $3 AND deleted_at IS NULL
         LIMIT 1`,
        [opts.tenantId, mapped.job_code ?? null, mapped.qualifier],
      );
      if (existing.rows[0]) {
        await q(
          `UPDATE repair.ref_qualifiers SET
             description=$2, category=$3, sub_category=$4, source=$5,
             rule_page=$6, effective_quarter=$7, edition=$8,
             qualifier_type=$9, basis=$10,
             updated_at=now(), updated_by=$11
           WHERE id=$1`,
          [
            existing.rows[0].id,
            mapped.description,
            mapped.category,
            mapped.sub_category,
            mapped.source,
            mapped.rule_page,
            mapped.effective_quarter,
            mapped.edition,
            mapped.qualifier_type ?? null,
            mapped.basis ?? null,
            opts.actor,
          ],
        );
      } else {
        await q(
          `INSERT INTO repair.ref_qualifiers
             (tenant_id, job_code, qualifier, description, category, sub_category,
              source, rule_page, effective_quarter, edition, qualifier_type, basis, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            opts.tenantId,
            mapped.job_code ?? null,
            mapped.qualifier,
            mapped.description,
            mapped.category,
            mapped.sub_category,
            mapped.source,
            mapped.rule_page,
            mapped.effective_quarter,
            mapped.edition,
            mapped.qualifier_type ?? null,
            mapped.basis ?? null,
            opts.actor,
          ],
        );
      }
      n += 1;
      continue;
    }

    if (spec.table === "repair.ref_qualifier_generic") {
      const existing = await q(
        `SELECT id FROM repair.ref_qualifier_generic
         WHERE tenant_id = $1 AND qualifier = $2 AND deleted_at IS NULL LIMIT 1`,
        [opts.tenantId, mapped.qualifier],
      );
      if (existing.rows[0]) {
        await q(
          `UPDATE repair.ref_qualifier_generic SET
             qualifier_type=$2, description=$3, category=$4, sub_category=$5,
             source=$6, rule_page=$7, effective_quarter=$8, edition=$9,
             updated_at=now(), updated_by=$10
           WHERE id=$1`,
          [
            existing.rows[0].id,
            mapped.qualifier_type ?? null,
            mapped.description,
            mapped.category,
            mapped.sub_category,
            mapped.source,
            mapped.rule_page,
            mapped.effective_quarter,
            mapped.edition,
            opts.actor,
          ],
        );
      } else {
        await q(
          `INSERT INTO repair.ref_qualifier_generic
             (tenant_id, qualifier, qualifier_type, description, category, sub_category,
              source, rule_page, effective_quarter, edition, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            opts.tenantId,
            mapped.qualifier,
            mapped.qualifier_type ?? null,
            mapped.description,
            mapped.category,
            mapped.sub_category,
            mapped.source,
            mapped.rule_page,
            mapped.effective_quarter,
            mapped.edition,
            opts.actor,
          ],
        );
      }
      n += 1;
      continue;
    }

    if (spec.table === "repair.ref_qualifier_charts") {
      const existing = await q(
        `SELECT id FROM repair.ref_qualifier_charts
         WHERE tenant_id = $1 AND import_key = $2 AND deleted_at IS NULL
         LIMIT 1`,
        [opts.tenantId, mapped.import_key],
      );
      if (existing.rows[0]) {
        await q(
          `UPDATE repair.ref_qualifier_charts SET
             rule=$2, chart_group=$3, qualifier=$4, description=$5, chart_title=$6,
             discontinued=$7, job_codes_using_chart=$8,
             source=$9, rule_page=$10, effective_quarter=$11, edition=$12,
             updated_at=now(), updated_by=$13
           WHERE id=$1`,
          [
            existing.rows[0].id,
            mapped.rule,
            mapped.chart_group ?? "",
            mapped.qualifier,
            mapped.description,
            mapped.chart_title ?? "",
            mapped.discontinued === true,
            mapped.job_codes_using_chart ?? null,
            mapped.source,
            mapped.rule_page,
            mapped.effective_quarter,
            mapped.edition,
            opts.actor,
          ],
        );
      } else {
        await q(
          `INSERT INTO repair.ref_qualifier_charts
             (tenant_id, import_key, rule, chart_group, qualifier, description, chart_title,
              discontinued, job_codes_using_chart, source, rule_page,
              effective_quarter, edition, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [
            opts.tenantId,
            mapped.import_key,
            mapped.rule,
            mapped.chart_group ?? "",
            mapped.qualifier,
            mapped.description,
            mapped.chart_title ?? "",
            mapped.discontinued === true,
            mapped.job_codes_using_chart ?? null,
            mapped.source,
            mapped.rule_page,
            mapped.effective_quarter,
            mapped.edition,
            opts.actor,
          ],
        );
      }
      n += 1;
      continue;
    }

    const cols = spec.columns;
    const placeholders = cols.map((_, i) => `$${i + 2}`).join(",");
    const conflictTarget =
      spec.key.length === 1
        ? `(tenant_id, ${spec.key[0]})`
        : `(tenant_id, ${spec.key.join(", ")})`;

    const updates = cols
      .filter((c) => !spec.key.includes(c))
      .map((c) => `${c} = EXCLUDED.${c}`)
      .concat(["updated_at = now()", `updated_by = EXCLUDED.created_by`])
      .join(", ");

    const values = cols.map((c) => mapped[c] ?? null);
    await q(
      `INSERT INTO ${spec.table}
         (tenant_id, ${cols.join(", ")}, created_by)
       VALUES ($1, ${placeholders}, $${cols.length + 2})
       ON CONFLICT ${conflictTarget} DO UPDATE SET ${updates}`,
      [opts.tenantId, ...values, opts.actor],
    );
    n += 1;

    if (spec.mirror) {
      const m = spec.mirror;
      const mvals = m.columns.map((c) => mapped[c] ?? null);
      const mPlace = m.columns.map((_, i) => `$${i + 2}`).join(",");
      const mUpdates = m.columns
        .filter((c) => !m.key.includes(c))
        .map((c) => `${c} = EXCLUDED.${c}`)
        .concat(["updated_at = now()", "updated_by = EXCLUDED.created_by"])
        .join(", ");
      await q(
        `INSERT INTO ${m.table}
           (tenant_id, ${m.columns.join(", ")}, created_by, active)
         VALUES ($1, ${mPlace}, $${m.columns.length + 2}, true)
         ON CONFLICT (tenant_id, ${m.key.join(", ")}) DO UPDATE SET ${mUpdates}`,
        [opts.tenantId, ...mvals, opts.actor],
      );
    }
  }
  return n;
}

export async function importRefData(opts?: {
  dir?: string;
  actor?: string;
  tenantId?: string;
  migrate?: boolean;
}) {
  const dir = opts?.dir ?? DEFAULT_DIR;
  const actor = opts?.actor ?? "import-ref-data";
  const tenantId = opts?.tenantId ?? DEFAULT_TENANT_ID;
  if (opts?.migrate !== false) await migrateLocal();

  if (!existsSync(dir)) {
    return {
      ok: false as const,
      error: `ref-data directory missing: ${dir}`,
      soft: true,
      results: [] as Array<Record<string, unknown>>,
    };
  }

  const results: Array<Record<string, unknown>> = [];
  let anyData = false;

  for (const spec of SPECS) {
    const file = findSourceFile(dir, spec.fileBase);
    if (!file) {
      results.push({
        table: spec.table,
        file: null,
        rows: 0,
        status: "MISSING_FILE",
        message: `Place ${spec.fileBase}.csv (or .xlsx) under ${dir}`,
      });
      continue;
    }
    const lower = file.toLowerCase();
    const parsed = lower.endsWith(".csv")
      ? await readCsvRows(file)
      : await readXlsxRows(file);
    if (parsed.rows.length === 0) {
      results.push({
        table: spec.table,
        file,
        rows: 0,
        status: "EMPTY_SCAFFOLD",
        message: "Header only — licensed AAR rows not present yet",
      });
      await q(
        `INSERT INTO repair.ref_data_editions
           (tenant_id, table_name, edition, quarter, source_file, source_path, row_count, imported_by, notes)
         VALUES ($1,$2,NULL,NULL,$3,$4,0,$5,$6)`,
        [
          tenantId,
          spec.table,
          file.split(/[/\\]/).pop() ?? file,
          file,
          actor,
          "empty scaffold",
        ],
      );
      continue;
    }
    const count = await upsertRows(spec, parsed.rows, {
      tenantId,
      actor,
      sourceFile: file,
    });
    anyData = anyData || count > 0;
    const edition = pick(parsed.rows[0]!, "edition");
    const quarter = pick(parsed.rows[0]!, "effective_quarter");
    await q(
      `INSERT INTO repair.ref_data_editions
         (tenant_id, table_name, edition, quarter, source_file, source_path, row_count, imported_by, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        tenantId,
        spec.table,
        edition,
        quarter,
        file.split(/[/\\]/).pop() ?? file,
        file,
        count,
        actor,
        null,
      ],
    );
    results.push({
      table: spec.table,
      file,
      rows: count,
      status: "UPSERTED",
      edition,
      quarter,
    });
  }

  return {
    ok: true as const,
    dir,
    anyData,
    results,
    soft: !anyData,
    message: anyData
      ? "Ref data imported"
      : "No licensed AAR rows found — scaffolds only. Place Bruce’s CSVs under modules/repair/ref-data/ and re-run.",
  };
}

async function main() {
  const { dir, actor } = parseArgs();
  console.log("=== repair:import-ref-data ===");
  console.log(`dir=${dir}`);
  const result = await importRefData({ dir, actor });
  for (const r of result.results) {
    console.log(
      `  ${r.status}  ${r.table}  rows=${r.rows}` +
        (r.file ? `  ← ${String(r.file).split(/[/\\]/).pop()}` : "") +
        (r.message ? `  (${r.message})` : ""),
    );
  }
  if (!result.ok) {
    console.error(result.error);
    process.exit(result.soft ? 0 : 1);
  }
  console.log(result.message);
  if (result.soft) {
    console.log(
      "SOFT OK — licensed CSVs absent. Expected full counts when present: " +
        "job_codes≈855, qualifiers≈1259, qualifier_generic≈816, qualifier_charts≈304, why_made≈107, categories≈2170.",
    );
  }
  console.log("PASS import-ref-data");
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((e) => {
    console.error("FAIL", e);
    process.exit(1);
  });
}
