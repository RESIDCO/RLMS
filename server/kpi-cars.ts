import type { Express, Request, Response } from "express";
import ExcelJS from "exceljs";
import { supabaseAdmin } from "./supabase";
import { fetchAllRows } from "./fetch-all";
import { KPI_BUCKETS, KPI_GROUP_COLS, KPI_SORT_COLS, KPI_TITLES, type KpiBucket } from "@shared/kpi-buckets";
import { whitelistExportCols } from "@shared/column-views";
import { formatCarId } from "@shared/residco-import";
import {
  CAR_EXPORT_NUMBER_HEADER,
  KPI_EXPORT_DATA_KEYS,
  buildKpiCarExport,
  stampExcelCarNumber,
  csvCarNumberField,
  csvField,
} from "@shared/car-export-identity";
import { loadKpiCarRow } from "./kpi-delta";
import { resolveRailcarsByAnyIdentity } from "./activity-log";
import { attachFormerly } from "./prior-marks";

const ROW_COLS =
  "railcar_id, active, car, reporting_marks, car_number, entity, status_tag, derived_status, current_lease, lessee, legal_owner, buyer, commitment, rent_start_date, last_ol, reason, sale_class, is_sold, is_op, off_rent, on_ol, on_rent, awaiting_rent_start, shop_conflict, future_rent_start, no_assignment, has_open_commitment, in_open_program, going_on_lease, sold_needs_tag, sale_unclear, sold_tag_suspect, sold_missing_buyer, lease_status, master_lease_id, rider_id, open_abatement, rent_stop_type, stop_date, expected_resume_date, rent_stop_reason";

function withFormattedCar<T extends { car?: string | null; reporting_marks?: string | null; car_number?: string | null }>(row: T): T {
  return { ...row, car: formatCarId(row) };
}

function isBucket(v: string): v is KpiBucket {
  return (KPI_BUCKETS as readonly string[]).includes(v);
}

function applyBucket(q: any, bucket: string) {
  if (!isBucket(bucket)) throw Object.assign(new Error("Unknown bucket"), { status: 400 });
  q = q.eq("active", true);
  if (bucket === "off_rent") return q.eq("is_op", true).eq("off_rent", true);
  if (bucket === "idle") {
    return q
      .eq("is_op", true)
      .eq("off_rent", true)
      .or("has_open_commitment.eq.true,in_open_program.eq.true,going_on_lease.eq.true,awaiting_rent_start.eq.true");
  }
  if (bucket === "unassigned") {
    return q
      .eq("is_op", true)
      .eq("off_rent", true)
      .eq("has_open_commitment", false)
      .eq("in_open_program", false)
      .eq("going_on_lease", false)
      .eq("awaiting_rent_start", false);
  }
  if (bucket === "op") return q.eq("is_op", true);
  if (bucket === "on_rent") return q.eq("is_op", true).eq("off_rent", false).eq("open_abatement", false);
  if (bucket === "rental_abatement") return q.eq("is_op", true).eq("open_abatement", true);
  if (bucket === "idle_on_ol") return q.eq("is_op", true).eq("status_tag", "Idle").eq("on_ol", true);
  if (bucket === "awaiting_rent_start") return q.eq("is_op", true).eq("awaiting_rent_start", true);
  if (bucket === "leased_off_rent") return q.eq("is_op", true).eq("off_rent", true).eq("status_tag", "Leased");
  if (bucket === "shop_conflict") return q.eq("is_op", true).eq("shop_conflict", true);
  if (bucket === "future_rent_start") return q.eq("is_op", true).eq("future_rent_start", true);
  if (bucket === "no_link") return q.eq("is_op", true).eq("no_assignment", true);
  if (bucket === "mtm") {
    return q.eq("is_op", true).or("lease_status.ilike.%MTM%,lease_status.ilike.%month to month%");
  }
  if (bucket === "going_on_lease") return q.eq("is_op", true).eq("going_on_lease", true);
  if (bucket === "sold_needs_tag") return q.eq("sold_needs_tag", true);
  if (bucket === "sale_unclear") return q.eq("sale_unclear", true);
  if (bucket === "sold_tag_suspect") return q.eq("sold_tag_suspect", true);
  if (bucket === "sold_missing_buyer") return q.eq("sold_missing_buyer", true);
  return q;
}

function parseListQuery(req: Request) {
  const bucket = String(req.query.bucket ?? "off_rent");
  const q = String(req.query.q ?? "").trim();
  const entity = String(req.query.entity ?? "").trim();
  const lease = String(req.query.lease ?? "").trim();
  const lessee = String(req.query.lessee ?? "").trim();
  const reason = String(req.query.reason ?? "").trim();
  const sortRaw = String(req.query.sort ?? "car");
  const sort = (KPI_SORT_COLS as readonly string[]).includes(sortRaw) ? sortRaw : "car";
  const dir = String(req.query.dir ?? "asc").toLowerCase() === "desc" ? "desc" : "asc";
  const groupRaw = String(req.query.group ?? "").trim();
  const group = groupRaw === "lease" ? "current_lease" : groupRaw;
  const groupCol = (KPI_GROUP_COLS as readonly string[]).includes(group) ? group : null;
  const page = Math.max(1, Number(req.query.page ?? 1) || 1);
  const pageSize = Math.min(500, Math.max(1, Number(req.query.page_size ?? 200) || 200));
  return { bucket, q, entity, lease, lessee, reason, sort, dir, groupCol, page, pageSize };
}

async function kpiTextOr(search: string): Promise<string> {
  const like = `*${search}*`;
  const text = `car.ilike.${like},lessee.ilike.${like},current_lease.ilike.${like},legal_owner.ilike.${like},reason.ilike.${like}`;
  const ids = (await resolveRailcarsByAnyIdentity(search)).slice(0, 80);
  if (!ids.length) return text;
  return `${text},railcar_id.in.(${ids.join(",")})`;
}

function filteredQuery(opts: ReturnType<typeof parseListQuery>, textOr?: string) {
  let q = supabaseAdmin.from("v_rlms_kpi_car_rows").select(ROW_COLS, { count: "exact" });
  q = applyBucket(q, opts.bucket);
  if (opts.q) {
    const like = `*${opts.q}*`;
    q = q.or(textOr ?? `car.ilike.${like},lessee.ilike.${like},current_lease.ilike.${like},legal_owner.ilike.${like},reason.ilike.${like}`);
  }
  if (opts.entity) q = q.eq("entity", opts.entity);
  if (opts.lease) q = q.eq("current_lease", opts.lease);
  if (opts.lessee) q = q.eq("lessee", opts.lessee);
  if (opts.reason) q = q.eq("reason", opts.reason);
  return q;
}

function errHandler(res: Response, err: any) {
  res.status(err?.status || 500).json({ message: err?.message ?? String(err) });
}

export async function listKpiCarsPaged(req: Request) {
  const opts = parseListQuery(req);
  const textOr = opts.q ? await kpiTextOr(opts.q) : undefined;
  const from = (opts.page - 1) * opts.pageSize;
  const to = from + opts.pageSize - 1;
  let q = filteredQuery(opts, textOr).order(opts.sort, { ascending: opts.dir === "asc", nullsFirst: false }).range(from, to);
  const { data, error, count } = await q;
  if (error) throw error;
  let groups: { key: string; count: number }[] | undefined;
  if (opts.groupCol) {
    const all = await fetchAllRows((a, b) => {
      let gq = supabaseAdmin.from("v_rlms_kpi_car_rows").select(opts.groupCol!);
      gq = applyBucket(gq, opts.bucket);
      if (opts.entity) gq = gq.eq("entity", opts.entity);
      if (opts.lease) gq = gq.eq("current_lease", opts.lease);
      if (opts.lessee) gq = gq.eq("lessee", opts.lessee);
      if (opts.reason) gq = gq.eq("reason", opts.reason);
      if (textOr) gq = gq.or(textOr);
      return gq.range(a, b);
    });
    const tally = new Map<string, number>();
    for (const row of all) {
      const key = String((row as any)[opts.groupCol] ?? "—");
      tally.set(key, (tally.get(key) ?? 0) + 1);
    }
    groups = Array.from(tally.entries())
      .map(([key, n]) => ({ key, count: n }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  }
  const formatted = (data ?? []).map((r: any) => withFormattedCar(r));
  const badged = await attachFormerly(
    formatted.map((r: any) => ({ ...r, id: Number(r.railcar_id) })),
    opts.q,
  );
  return {
    rows: badged.map(({ id: _id, ...row }) => row),
    total: count ?? 0,
    page: opts.page,
    page_size: opts.pageSize,
    bucket: opts.bucket,
    title: KPI_TITLES[opts.bucket] ?? opts.bucket,
    groups,
  };
}

const EXPORT_HEADERS = ["car", ...KPI_EXPORT_DATA_KEYS];

function fileBase(bucket: string) {
  const d = new Date().toISOString().slice(0, 10);
  return `RLMS_${bucket}_${d}`;
}

export async function exportKpiCars(req: Request, res: Response) {
  const opts = parseListQuery(req);
  const textOr = opts.q ? await kpiTextOr(opts.q) : undefined;
  const format = String(req.query.format ?? "csv").toLowerCase() === "xlsx" ? "xlsx" : "csv";
  const rows = await fetchAllRows((a, b) => {
    let q = supabaseAdmin.from("v_rlms_kpi_car_rows").select(ROW_COLS);
    q = applyBucket(q, opts.bucket);
    if (textOr) q = q.or(textOr);
    if (opts.entity) q = q.eq("entity", opts.entity);
    if (opts.lease) q = q.eq("current_lease", opts.lease);
    if (opts.lessee) q = q.eq("lessee", opts.lessee);
    if (opts.reason) q = q.eq("reason", opts.reason);
    return q.order(opts.sort, { ascending: opts.dir === "asc" }).range(a, b);
  });
  const name = fileBase(opts.bucket);
  const requested = whitelistExportCols(EXPORT_HEADERS, req.query.cols, EXPORT_HEADERS);
  const table = buildKpiCarExport(rows as any[], requested);
  const numberCol = table.headers.indexOf(CAR_EXPORT_NUMBER_HEADER);
  if (format === "csv") {
    const lines = [
      table.headers.join(","),
      ...table.records.map((record) => record.map((cell, index) => (index === numberCol ? csvCarNumberField(cell) : csvField(cell))).join(",")),
    ];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${name}.csv"`);
    res.send(lines.join("\n") + "\n");
    return;
  }
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(opts.bucket.slice(0, 31));
  ws.addRow(table.headers);
  for (const record of table.records) {
    const added = ws.addRow(record);
    if (numberCol >= 0) stampExcelCarNumber(added.getCell(numberCol + 1), record[numberCol]);
  }
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${name}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}

export function registerKpiCarRoutes(app: Express) {
  app.get("/api/kpi/car/:id", async (req, res) => {
    try {
      res.json(await loadKpiCarRow(Number(req.params.id)));
    } catch (e) {
      errHandler(res, e);
    }
  });
  app.get("/api/kpi/cars", async (req, res) => {
    try {
      res.json(await listKpiCarsPaged(req));
    } catch (e) {
      errHandler(res, e);
    }
  });
  app.get("/api/kpi/cars/export", async (req, res) => {
    try {
      await exportKpiCars(req, res);
    } catch (e) {
      errHandler(res, e);
    }
  });
  app.get("/api/kpi/cars/ids", async (req, res) => {
    try {
      const opts = parseListQuery(req);
      const textOr = opts.q ? await kpiTextOr(opts.q) : undefined;
      const rows = await fetchAllRows((a, b) => {
        let q = supabaseAdmin.from("v_rlms_kpi_car_rows").select("railcar_id");
        q = applyBucket(q, opts.bucket);
        if (opts.entity) q = q.eq("entity", opts.entity);
        if (opts.lease) q = q.eq("current_lease", opts.lease);
        if (opts.lessee) q = q.eq("lessee", opts.lessee);
        if (opts.reason) q = q.eq("reason", opts.reason);
        if (textOr) q = q.or(textOr);
        return q.range(a, b);
      });
      res.json({ ids: rows.map((r: any) => r.railcar_id), total: rows.length });
    } catch (e) {
      errHandler(res, e);
    }
  });
}
