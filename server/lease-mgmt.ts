import type { Express, Request, Response } from "express";
import {
  csvCarNumberField,
  csvField,
  isLeaseIssueCarKind,
  leadCarExportTable,
} from "@shared/car-export-identity";
import ExcelJS from "exceljs";
import { supabaseAdmin } from "./supabase";
import { fetchAllRows } from "./fetch-all";
import { appendNotesInGroup, stripNotesField, withNoteReport } from "./append-note";
import { recordChange, withChangeGroupResult } from "./change-log";
import { pickRow } from "@shared/change-log";
import { parseCarPasteList } from "@shared/programs";
import { resolveRailcarsByAnyIdentity } from "./activity-log";
import { loadOlIdentity, railcarIdentityPatch } from "./ol-identity";
import { assignmentRentStartOnMove } from "@shared/commitment";
import { pointCurrentAssignmentAt } from "./current-assignment";
import { listLeaseContactLinks } from "./directory";
import { queryRailcars } from "./railcar-list";
import {
  isPlaceholderLessee,
  isStandardRiderNumber,
  riderNumberDigits,
} from "@shared/lease-mgmt";
import { editedRiderEntity } from "@shared/rider-entity";

type RequireWrite = (req: Request, res: Response) => Promise<string | null>;

function errMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (m != null && String(m) && String(m) !== "[object Object]") return String(m);
  }
  try {
    return JSON.stringify(err);
  } catch {
    return "Unknown error";
  }
}

function errHandler(res: Response, err: unknown) {
  const msg = errMessage(err);
  const status = Number((err as { status?: number })?.status) || 500;
  console.error("[lease-mgmt]", msg);
  return res.status(status).json({ message: msg });
}

function reject(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}

function subFolderFromSource(sourcePath: string | null | undefined): string {
  if (!sourcePath) return "";
  const parts = String(sourcePath).replace(/\//g, "\\").split("\\").filter(Boolean);
  if (parts.length <= 2) return "";
  return parts.slice(1, -1).join("\\");
}

function shapeLeaseDoc(row: any, riderCode?: string | null) {
  return {
    id: Number(row.id),
    file_name: row.file_name,
    file_size: Number(row.file_size ?? 0),
    mime_type: row.mime_type,
    source_path: row.source_path ?? null,
    source_modified: row.source_modified ?? null,
    doc_class: row.doc_class ?? null,
    source: row.source ?? null,
    rider_id: row.entity_type === "rider" ? Number(row.entity_id) : null,
    rider_code: riderCode ?? null,
    sub_folder: subFolderFromSource(row.source_path),
  };
}

async function assertActiveCars(ids: number[]): Promise<{ ok: number[]; skipped: { id: number; reason: string }[] }> {
  const ok: number[] = [];
  const skipped: { id: number; reason: string }[] = [];
  if (!ids.length) return { ok, skipped };
  for (let i = 0; i < ids.length; i += 200) {
    const slice = ids.slice(i, i + 200);
    const { data, error } = await supabaseAdmin.from("railcars").select("id, active").in("id", slice);
    if (error) throw error;
    const byId = new Map((data ?? []).map((r: { id: number; active: boolean | null }) => [r.id, r]));
    for (const id of slice) {
      const row = byId.get(id);
      if (!row || row.active !== true) skipped.push({ id, reason: "inactive" });
      else ok.push(id);
    }
  }
  return { ok, skipped };
}

async function lesseeIdsForQuery(q: string): Promise<number[] | null> {
  const raw = q.trim();
  if (!raw) return null;
  const tokens = parseCarPasteList(raw);
  const ids = new Set<number>();
  const like = `%${raw.replace(/%/g, "")}%`;

  const { data: lessees, error: lErr } = await supabaseAdmin
    .from("master_leases")
    .select("id")
    .or(`lessee.ilike.${like},lease_number.ilike.${like},mla_number.ilike.${like}`);
  if (lErr) throw lErr;
  for (const r of lessees ?? []) ids.add(Number(r.id));

  const digits = raw.replace(/\s/g, "").toUpperCase().replace(/^(OL|EA)/, "");
  if (/^\d{4}$/.test(digits) || isStandardRiderNumber(raw.toUpperCase())) {
    const d = riderNumberDigits(raw.toUpperCase()) || digits;
    const { data: riders, error } = await supabaseAdmin
      .from("riders")
      .select("master_lease_id, rider_name, number_digits")
      .or(`number_digits.eq.${d},rider_name.ilike.%${d}%`);
    if (error) throw error;
    for (const r of riders ?? []) ids.add(Number(r.master_lease_id));
  }

  if (tokens.length) {
    const carIds: number[] = [];
    for (const tok of tokens) {
      carIds.push(...(await resolveRailcarsByAnyIdentity(tok)));
    }
    if (carIds.length) {
      const { data: assigns, error } = await supabaseAdmin
        .from("railcar_assignments")
        .select("rider_id, riders!inner(master_lease_id)")
        .in("railcar_id", [...new Set(carIds)]);
      if (error) throw error;
      for (const a of assigns ?? []) {
        const ml = (a as { riders?: { master_lease_id?: number } }).riders?.master_lease_id;
        if (ml) ids.add(Number(ml));
      }
    }
  }
  return [...ids];
}

const ISSUE_VIEWS: { view: string; cols: string }[] = [
  { view: "v_lease_issue_ea_on_rent", cols: "master_lease_id, rider_id" },
  { view: "v_lease_issue_unlinked", cols: "master_lease_id, proposed_rider_id" },
  { view: "v_lease_issue_lessee_mismatch", cols: "master_lease_id, rider_id" },
  { view: "v_lease_issue_dup_lessees", cols: "master_lease_id" },
  { view: "v_lease_issue_nonstandard", cols: "master_lease_id, rider_id" },
  { view: "v_lease_issue_past_exp", cols: "master_lease_id, rider_id" },
  { view: "v_lease_issue_rent_mismatch", cols: "master_lease_id" },
  { view: "v_lease_issue_placeholder", cols: "master_lease_id" },
];

async function issueLesseeIds(): Promise<Set<number>> {
  const ids = new Set<number>();
  const riderIds: number[] = [];
  for (const { view, cols } of ISSUE_VIEWS) {
    const rows = await fetchAllRows((from, to) =>
      supabaseAdmin.from(view).select(cols).range(from, to),
    );
    for (const r of rows as any[]) {
      if (r.master_lease_id) ids.add(Number(r.master_lease_id));
      if (r.rider_id) riderIds.push(Number(r.rider_id));
      if (r.proposed_rider_id) riderIds.push(Number(r.proposed_rider_id));
    }
  }
  const uniqRiders = [...new Set(riderIds.filter((n) => n > 0))];
  for (let i = 0; i < uniqRiders.length; i += 200) {
    const { data, error } = await supabaseAdmin
      .from("riders")
      .select("master_lease_id")
      .in("id", uniqRiders.slice(i, i + 200));
    if (error) throw error;
    for (const x of data ?? []) ids.add(Number(x.master_lease_id));
  }
  return ids;
}

async function issueCountsByLessee(lesseeIds: number[]): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (!lesseeIds.length) return map;
  const add = (id: number) => map.set(id, (map.get(id) ?? 0) + 1);
  const bumpFromRiders = async (riderIds: number[]) => {
    if (!riderIds.length) return;
    for (let i = 0; i < riderIds.length; i += 200) {
      const { data, error } = await supabaseAdmin
        .from("riders")
        .select("id, master_lease_id")
        .in("id", riderIds.slice(i, i + 200));
      if (error) throw error;
      for (const r of data ?? []) add(Number(r.master_lease_id));
    }
  };
  const want = new Set(lesseeIds);
  const mismatch = await fetchAllRows((from, to) =>
    supabaseAdmin.from("v_lease_issue_lessee_mismatch").select("master_lease_id").range(from, to),
  );
  for (const r of mismatch) {
    const id = Number((r as any).master_lease_id);
    if (want.has(id)) add(id);
  }
  const dups = await fetchAllRows((from, to) =>
    supabaseAdmin.from("v_lease_issue_dup_lessees").select("master_lease_id").range(from, to),
  );
  for (const r of dups) {
    const id = Number((r as any).master_lease_id);
    if (want.has(id)) add(id);
  }
  const ph = await fetchAllRows((from, to) =>
    supabaseAdmin.from("v_lease_issue_placeholder").select("master_lease_id").range(from, to),
  );
  for (const r of ph) {
    const id = Number((r as any).master_lease_id);
    if (want.has(id)) add(id);
  }
  const rent = await fetchAllRows((from, to) =>
    supabaseAdmin.from("v_lease_issue_rent_mismatch").select("master_lease_id").range(from, to),
  );
  for (const r of rent) {
    const id = Number((r as any).master_lease_id);
    if (want.has(id)) add(id);
  }
  const ea = await fetchAllRows((from, to) =>
    supabaseAdmin.from("v_lease_issue_ea_on_rent").select("rider_id").range(from, to),
  );
  await bumpFromRiders(ea.map((r: any) => Number(r.rider_id)).filter((n) => n > 0));
  const ns = await fetchAllRows((from, to) =>
    supabaseAdmin.from("v_lease_issue_nonstandard").select("rider_id").range(from, to),
  );
  await bumpFromRiders(ns.map((r: any) => Number(r.rider_id)).filter((n) => n > 0));
  const pe = await fetchAllRows((from, to) =>
    supabaseAdmin.from("v_lease_issue_past_exp").select("rider_id").range(from, to),
  );
  await bumpFromRiders(pe.map((r: any) => Number(r.rider_id)).filter((n) => n > 0));
  for (const id of [...map.keys()]) {
    if (!want.has(id)) map.delete(id);
  }
  return map;
}

async function moveActiveCars(opts: {
  carIds: number[];
  toRiderId: number;
  actor: string;
  date: string;
  reason: string;
}) {
  const identity = await loadOlIdentity(opts.toRiderId);
  if (!identity) reject("Destination rider not found");
  const { data: currentAssigns, error: caErr } = await supabaseAdmin
    .from("railcar_assignments")
    .select("id, railcar_id, rider_id, fleet_name, rent_start_date, rent_start_set_by, rent_start_set_at, assignment_status")
    .in("railcar_id", opts.carIds);
  if (caErr) throw caErr;
  const currentByCar = new Map<number, any>();
  for (const a of currentAssigns ?? []) currentByCar.set(a.railcar_id, a);
  const movedAt = `${opts.date}T12:00:00.000Z`;
  const historyRows: Record<string, unknown>[] = [];

  for (const carId of opts.carIds) {
    const prev = currentByCar.get(carId);
    const fromRiderId = prev?.rider_id ?? null;
    const fromFleet = prev?.fleet_name ?? null;
    const targetFleet = identity.canonical_lessee ?? fromFleet;
    const rent = assignmentRentStartOnMove({
      fromRiderId,
      toRiderId: opts.toRiderId,
      prevDate: prev?.rent_start_date ?? null,
      prevSetBy: prev?.rent_start_set_by ?? null,
      prevSetAt: prev?.rent_start_set_at ?? null,
      dateSupplied: true,
      suppliedDate: opts.date,
      actor: opts.actor,
      movedAt,
    });
    const assignAfter = {
      rider_id: opts.toRiderId,
      fleet_name: targetFleet,
      assigned_at: movedAt,
      rent_start_date: rent.rent_start_date,
      rent_start_set_by: rent.rent_start_set_by,
      rent_start_set_at: rent.rent_start_set_at,
      assignment_status: "on_lease",
    };
    if (prev) {
      const { error: uErr } = await supabaseAdmin.from("railcar_assignments").update(assignAfter).eq("id", prev.id);
      if (uErr) throw uErr;
      await pointCurrentAssignmentAt(supabaseAdmin, [{ id: prev.id, railcar_id: carId }]);
      await recordChange({
        table: "railcar_assignments",
        pk: Number(prev.id),
        before: pickRow(prev, ["rider_id", "fleet_name", "rent_start_date", "rent_start_set_by", "rent_start_set_at", "assignment_status"]),
        after: assignAfter,
        action: "reassignment",
        entity_type: "railcar",
        entity_id: carId,
        railcar_id: carId,
        rider_id: opts.toRiderId,
        actor: opts.actor,
      });
    } else {
      const { data: ins, error: iErr } = await supabaseAdmin
        .from("railcar_assignments")
        .insert({ railcar_id: carId, ...assignAfter })
        .select("id, railcar_id")
        .single();
      if (iErr) throw iErr;
      await pointCurrentAssignmentAt(supabaseAdmin, ins ? [ins] : []);
      await recordChange({
        table: "railcar_assignments",
        pk: ins?.id != null ? Number(ins.id) : null,
        before: {},
        after: { railcar_id: carId, ...assignAfter },
        action: "reassignment",
        entity_type: "railcar",
        entity_id: carId,
        railcar_id: carId,
        rider_id: opts.toRiderId,
        actor: opts.actor,
      });
    }
    const carPatch = railcarIdentityPatch(identity, targetFleet);
    const identKeys = Object.keys(carPatch);
    const { data: carPrior, error: carPriorErr } = await supabaseAdmin
      .from("railcars")
      .select("id, lessee_name, rider_external_id, assignment_label, lease_type")
      .eq("id", carId)
      .maybeSingle();
    if (carPriorErr) throw carPriorErr;
    const { error: carErr } = await supabaseAdmin.from("railcars").update(carPatch).eq("id", carId);
    if (carErr) throw carErr;
    await recordChange({
      table: "railcars",
      pk: carId,
      before: pickRow(carPrior, identKeys),
      after: pickRow({ ...(carPrior ?? {}), ...carPatch }, identKeys),
      action: "reassignment",
      entity_type: "railcar",
      entity_id: carId,
      railcar_id: carId,
      actor: opts.actor,
    });
    historyRows.push({
      railcar_id: carId,
      from_rider_id: fromRiderId,
      to_rider_id: opts.toRiderId,
      from_fleet_name: fromFleet,
      to_fleet_name: targetFleet,
      moved_at: movedAt,
      moved_by: opts.actor,
      reason: opts.reason,
    });
  }
  if (historyRows.length) {
    const { data: insertedHist, error: hErr } = await supabaseAdmin
      .from("assignment_history")
      .insert(historyRows)
      .select("id, railcar_id");
    if (hErr) throw hErr;
    for (const h of insertedHist ?? []) {
      await recordChange({
        table: "assignment_history",
        pk: Number(h.id),
        before: {},
        after: h,
        action: "reassignment",
        entity_type: "railcar",
        entity_id: Number(h.railcar_id),
        railcar_id: Number(h.railcar_id),
        rider_id: opts.toRiderId,
        actor: opts.actor,
      });
    }
  }
}

async function sendXlsx(res: Response, name: string, headers: string[], rows: Record<string, unknown>[]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(name.slice(0, 31));
  ws.addRow(headers);
  for (const r of rows) ws.addRow(headers.map((h) => r[h] ?? ""));
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${name}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}

function csvEscape(v: unknown) {
  const s = v == null ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function buildLeaseP1Previews() {
  const [eaMergeSrc, unlinked, dups, eaOnRent] = await Promise.all([
    fetchAllRows((from, to) =>
      supabaseAdmin.from("v_lease_rider_rollup").select("*").ilike("rider_name", "EA%").gt("cars", 0).range(from, to),
    ),
    fetchAllRows((from, to) => supabaseAdmin.from("v_lease_issue_unlinked").select("*").range(from, to)),
    fetchAllRows((from, to) => supabaseAdmin.from("v_lease_issue_dup_lessees").select("*").range(from, to)),
    fetchAllRows((from, to) => supabaseAdmin.from("v_lease_issue_ea_on_rent").select("*").range(from, to)),
  ]);

  const eaRiders = eaMergeSrc.filter((r: any) => String(r.rider_name ?? "").startsWith("EA") && Number(r.cars) > 0);
  const mergeRows: Record<string, unknown>[] = [];
  for (const ea of eaRiders) {
    const digits = String(ea.number_digits ?? riderNumberDigits(ea.rider_name) ?? "");
    let ol: any = null;
    if (digits) {
      const { data } = await supabaseAdmin
        .from("v_lease_rider_rollup")
        .select("*")
        .eq("number_digits", digits)
        .ilike("rider_name", "OL%")
        .maybeSingle();
      ol = data;
      if (!ol) {
        const { data: many } = await supabaseAdmin
          .from("v_lease_rider_rollup")
          .select("*")
          .eq("number_digits", digits)
          .ilike("rider_name", "OL%");
        ol = (many ?? []).find((r: any) => String(r.rider_name).startsWith("OL")) ?? (many ?? [])[0] ?? null;
      }
    }
    const eaLessee = String(ea.lessee ?? "");
    const olLessee = String(ol?.lessee ?? "");
    let check = "NO_MATCHING_OL - Bruce to name lessee";
    let action = "NEEDS BRUCE: no OL with same digits; name original lessee";
    if (ol) {
      const nameSame = eaLessee.replace(/^x/i, "").toLowerCase().includes(olLessee.split(" ")[0]?.toLowerCase() ?? "___");
      const stripped = eaLessee.replace(/^(idle\s*[-(]?\s*x?|x)/i, "").replace(/[)']+$/, "").trim().toLowerCase();
      const olKey = olLessee.toLowerCase();
      check = olKey.includes(stripped.split(" ")[0] ?? "") || stripped.includes(olKey.split(" ")[0] ?? "")
        ? "name_consistent"
        : "NAME_DIFFERS - review";
      const olCars = Number(ol.cars ?? 0);
      action = olCars === 0
        ? "merge into OL rider; whole rider -> Off lease - pending remarketing"
        : "merge into OL rider; partial return: only these cars -> Off lease - pending remarketing, OL stays Active";
      if (digits === "1503") action += " | Bruce handling OL1503 Washington Penn cars - exclude from apply";
    }
    mergeRows.push({
      ea_rider_id: ea.rider_id,
      ea_code: ea.rider_name,
      ea_lessee_now: eaLessee,
      ol_rider_id: ol?.rider_id ?? "",
      matching_ol: ol?.rider_name ?? "",
      proposed_lessee: olLessee,
      proposed_master_lease_id: ol?.master_lease_id ?? "",
      active_cars: ea.cars,
      leased_cars: ea.on_rent,
      check_note: ol ? check : "NO_MATCHING_OL - Bruce to name lessee",
      ol_active_cars: ol?.cars ?? "",
      ol_leased_cars: ol?.on_rent ?? "",
      proposed_action: ol ? action : action,
    });
  }

  const dupGroups = new Set(dups.map((r: any) => r.k));
  return {
    preview_ea_placeholder_merge: mergeRows,
    preview_unlinked_cars: unlinked,
    list_duplicate_lessee_candidates: dups,
    list_ea_on_rent_cars: eaOnRent,
    counts: {
      ea_riders_with_cars: eaRiders.length,
      ea_active_cars: eaRiders.reduce((n: number, r: any) => n + Number(r.cars ?? 0), 0),
      unlinked: unlinked.length,
      dup_groups: dupGroups.size,
      dup_rows: dups.length,
      ea_on_rent: eaOnRent.length,
    },
  };
}

export function registerLeaseMgmtRoutes(app: Express, requireWrite: RequireWrite) {
  app.get("/api/lease-mgmt/lessees", async (req, res) => {
    try {
      const q = String(req.query.q ?? "").trim();
      const status = String(req.query.status ?? "").trim();
      const am = String(req.query.am ?? "").trim();
      const expiring = String(req.query.expiring ?? "").trim();
      const hasIssues = String(req.query.has_issues ?? "") === "1" || String(req.query.has_issues ?? "") === "true";
      const hasEa = String(req.query.has_ea ?? "") === "1" || String(req.query.has_ea ?? "") === "true";
      const sort = String(req.query.sort ?? "lessee");
      const dir = String(req.query.dir ?? "asc") === "desc" ? false : true;
      const page = Math.max(1, Number(req.query.page ?? 1) || 1);
      const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize ?? 50) || 50));
      const includePlaceholders = String(req.query.include_placeholders ?? "") === "1";

      let idFilter: number[] | null = q ? await lesseeIdsForQuery(q) : null;
      if (q && idFilter && idFilter.length === 0) {
        return res.json({
          rows: [],
          total: 0,
          kpis: { cars: 0, on_rent: 0, off_rent: 0, monthly_rent: 0, expiring_6: 0, expiring_12: 0, issues: 0 },
        });
      }
      if (hasIssues) {
        const issueIds = [...(await issueLesseeIds())];
        idFilter = idFilter ? idFilter.filter((id) => issueIds.includes(id)) : issueIds;
      }

      const includeEmpty = String(req.query.include_empty ?? "") === "1";
      let query = supabaseAdmin.from("v_lease_lessee_rollup").select("*", { count: "exact" });
      if (!includePlaceholders) {
        query = query.is("merged_into_id", null);
      }
      if (!includeEmpty && !hasIssues) {
        query = query.gt("cars", 0);
      }
      if (idFilter) query = query.in("master_lease_id", idFilter.length ? idFilter : [-1]);
      if (am) query = query.eq("account_manager", am);
      if (hasEa) query = query.gt("ea_count", 0);
      if (expiring === "6") query = query.gt("ols_expiring_6mo", 0);
      if (expiring === "12") query = query.gt("ols_expiring_12mo", 0);
      if (status === "ea") query = query.gt("ea_count", 0);

      const sortCol =
        sort === "cars" ? "cars"
        : sort === "on_rent" ? "on_rent"
        : sort === "monthly_rent" ? "monthly_rent"
        : sort === "next_expiration" ? "next_expiration"
        : "lessee";
      query = query.order(sortCol, { ascending: dir, nullsFirst: false });
      const from = (page - 1) * pageSize;
      const { data, error, count } = await query.range(from, from + pageSize - 1);
      if (error) throw error;

      const kpisQuery = supabaseAdmin.from("v_lease_lessee_rollup").select("cars, on_rent, off_rent, monthly_rent, cars_expiring_6mo, cars_expiring_12mo");
      // Re-apply the same filters without paging
      let kq = supabaseAdmin.from("v_lease_lessee_rollup").select("*");
      if (!includePlaceholders) kq = kq.is("merged_into_id", null);
      if (!includeEmpty && !hasIssues) kq = kq.gt("cars", 0);
      if (idFilter) kq = kq.in("master_lease_id", idFilter.length ? idFilter : [-1]);
      if (am) kq = kq.eq("account_manager", am);
      if (hasEa) kq = kq.gt("ea_count", 0);
      if (expiring === "6") kq = kq.gt("ols_expiring_6mo", 0);
      if (expiring === "12") kq = kq.gt("ols_expiring_12mo", 0);
      if (status === "ea") kq = kq.gt("ea_count", 0);
      const kpiRows = await fetchAllRows((f, t) => kq.range(f, t));
      const kpis = {
        cars: kpiRows.reduce((n, r: any) => n + Number(r.cars ?? 0), 0),
        on_rent: kpiRows.reduce((n, r: any) => n + Number(r.on_rent ?? 0), 0),
        off_rent: kpiRows.reduce((n, r: any) => n + Number(r.off_rent ?? 0), 0),
        monthly_rent: kpiRows.reduce((n, r: any) => n + Number(r.monthly_rent ?? 0), 0),
        expiring_6: kpiRows.reduce((n, r: any) => n + Number(r.cars_expiring_6mo ?? 0), 0),
        expiring_12: kpiRows.reduce((n, r: any) => n + Number(r.cars_expiring_12mo ?? 0), 0),
        issues: 0,
      };
      const issueMap = await issueCountsByLessee((data ?? []).map((r: any) => Number(r.master_lease_id)));
      const allIssueIds = await issueLesseeIds();
      kpis.issues = allIssueIds.size;
      const rows = (data ?? []).map((r: any) => ({ ...r, issues: issueMap.get(Number(r.master_lease_id)) ?? 0 }));
      void kpisQuery;
      res.json({ rows, total: count ?? rows.length, kpis, page, pageSize });
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.get("/api/lease-mgmt/lessees/export", async (req, res) => {
    try {
      req.query.pageSize = "200";
      req.query.page = "1";
      const rows = await fetchAllRows((from, to) => {
        let q = supabaseAdmin.from("v_lease_lessee_rollup").select("*").eq("is_placeholder", false).is("merged_into_id", null);
        return q.range(from, to);
      });
      const headers = [
        "lessee", "account_manager", "ol_count", "ea_count", "cars", "on_rent", "off_rent",
        "monthly_rent", "next_expiration", "cars_expiring_6mo", "cars_expiring_12mo",
      ];
      await sendXlsx(res, "RLMS_Lessees", headers, rows as any);
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.get("/api/lease-mgmt/am-options", async (_req, res) => {
    try {
      const rows = await fetchAllRows((from, to) =>
        supabaseAdmin.from("v_lease_lessee_rollup").select("account_manager").not("account_manager", "is", null).range(from, to),
      );
      const set = [...new Set(rows.map((r: any) => String(r.account_manager ?? "").trim()).filter(Boolean))].sort();
      res.json(set);
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.get("/api/lease-mgmt/lessees/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { data: header, error } = await supabaseAdmin.from("v_lease_lessee_rollup").select("*").eq("master_lease_id", id).maybeSingle();
      if (error) throw error;
      if (!header) return res.status(404).json({ message: "Lessee not found" });
      const { data: ml } = await supabaseAdmin.from("master_leases").select("*").eq("id", id).maybeSingle();
      const riders = await fetchAllRows((from, to) =>
        supabaseAdmin.from("v_lease_rider_rollup").select("*").eq("master_lease_id", id).range(from, to),
      );
      const riderIds = riders.map((r: any) => Number(r.rider_id));
      const contacts = await listLeaseContactLinks({ masterLeaseId: id });
      let timeline: any[] = [];
      if (riderIds.length) {
        const { data: acts } = await supabaseAdmin
          .from("activity_log")
          .select("id, action, actor, occurred_at, entity_type, entity_id, rider_id, detail, change_group")
          .or(`entity_type.eq.master_lease,rider_id.in.(${riderIds.slice(0, 80).join(",")})`)
          .order("occurred_at", { ascending: false })
          .limit(200);
        timeline = acts ?? [];
      }
      const { data: mlActs } = await supabaseAdmin
        .from("activity_log")
        .select("id, action, actor, occurred_at, entity_type, entity_id, rider_id, detail, change_group")
        .eq("entity_type", "master_lease")
        .eq("entity_id", id)
        .order("occurred_at", { ascending: false })
        .limit(50);
      res.json({
        header: { ...header, ...ml },
        riders: riders.filter((r: any) => Number(r.cars) > 0 || r.lifecycle_status),
        all_riders: riders,
        contacts,
        timeline: [...(mlActs ?? []), ...timeline]
          .sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)))
          .slice(0, 200),
      });
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.patch("/api/lease-mgmt/lessees/:id", async (req, res) => {
    try {
      const actor = await requireWrite(req, res);
      if (!actor) return;
      const id = Number(req.params.id);
      const { data: before, error: bErr } = await supabaseAdmin.from("master_leases").select("*").eq("id", id).maybeSingle();
      if (bErr) throw bErr;
      if (!before) return res.status(404).json({ message: "Lessee not found" });
      const patch: Record<string, unknown> = {};
      if ("mla_number" in (req.body ?? {})) patch.mla_number = req.body.mla_number || null;
      if ("mla_doc_url" in (req.body ?? {})) patch.mla_doc_url = req.body.mla_doc_url || null;
      const result = await withChangeGroupResult(actor, async () => {
        const { data, error } = await supabaseAdmin.from("master_leases").update(patch).eq("id", id).select().single();
        if (error) throw error;
        await recordChange({
          table: "master_leases",
          pk: id,
          before: pickRow(before, Object.keys(patch)),
          after: pickRow(data, Object.keys(patch)),
          action: "update_lessee",
          entity_type: "master_lease",
          entity_id: id,
          actor,
        });
        return data;
      });
      res.json(result);
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.get("/api/lease-mgmt/riders/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { data: rollup, error } = await supabaseAdmin.from("v_lease_rider_rollup").select("*").eq("rider_id", id).maybeSingle();
      if (error) throw error;
      const { data: rider, error: rErr } = await supabaseAdmin.from("riders").select("*").eq("id", id).maybeSingle();
      if (rErr) throw rErr;
      if (!rider) return res.status(404).json({ message: "Rider not found" });
      const cars = await queryRailcars({ rider_id: id, active: "active", page: 1, pageSize: 75 });
      const { data: timeline } = await supabaseAdmin
        .from("activity_log")
        .select("id, action, actor, occurred_at, entity_type, entity_id, rider_id, detail, change_group")
        .eq("rider_id", id)
        .order("occurred_at", { ascending: false })
        .limit(100);
      res.json({ header: { ...rider, ...rollup }, cars, timeline: timeline ?? [] });
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.get("/api/lease-mgmt/riders/:id/documents", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { data: rider, error: rErr } = await supabaseAdmin.from("riders").select("id, rider_name").eq("id", id).maybeSingle();
      if (rErr) throw rErr;
      if (!rider) return res.status(404).json({ message: "Rider not found" });
      const { data, error } = await supabaseAdmin
        .from("attachments")
        .select("*")
        .eq("entity_type", "rider")
        .eq("entity_id", id)
        .order("source_modified", { ascending: false, nullsFirst: false });
      if (error) throw error;
      res.json({ rows: (data ?? []).map((row) => shapeLeaseDoc(row, rider.rider_name)) });
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.get("/api/lease-mgmt/lessees/:id/documents", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const riders = await fetchAllRows((from, to) =>
        supabaseAdmin.from("riders").select("id, rider_name").eq("master_lease_id", id).range(from, to),
      );
      const codeById = new Map(riders.map((r: any) => [Number(r.id), String(r.rider_name ?? "")]));
      const riderIds = riders.map((r: any) => Number(r.id));
      const { data: mlAtt, error: mlErr } = await supabaseAdmin
        .from("attachments")
        .select("*")
        .or(`and(entity_type.eq.master_lease,entity_id.eq.${id}),master_lease_id.eq.${id}`);
      if (mlErr) throw mlErr;
      let riderAtt: any[] = [];
      if (riderIds.length) {
        riderAtt = await fetchAllRows((from, to) =>
          supabaseAdmin.from("attachments").select("*").eq("entity_type", "rider").in("entity_id", riderIds).range(from, to),
        );
      }
      const seen = new Set<number>();
      const rows = [];
      for (const row of [...(mlAtt ?? []), ...riderAtt]) {
        const nid = Number(row.id);
        if (seen.has(nid)) continue;
        seen.add(nid);
        const code = row.entity_type === "rider" ? codeById.get(Number(row.entity_id)) ?? null : null;
        rows.push(shapeLeaseDoc(row, code));
      }
      rows.sort((a, b) => String(b.source_modified ?? "").localeCompare(String(a.source_modified ?? "")));
      res.json({ rows });
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.patch("/api/lease-mgmt/riders/:id", async (req, res) => {
    try {
      const actor = await requireWrite(req, res);
      if (!actor) return;
      const id = Number(req.params.id);
      const { data: before, error: bErr } = await supabaseAdmin.from("riders").select("*").eq("id", id).maybeSingle();
      if (bErr) throw bErr;
      if (!before) return res.status(404).json({ message: "Rider not found" });
      const allowed = [
        "effective_date", "expiration_date", "monthly_rent_per_car", "monthly_rate_pct",
        "lessors_cost", "owner_entity", "entity", "sublessee", "contract_doc_url", "permissible_commodity",
      ];
      const patch: Record<string, unknown> = {};
      for (const k of allowed) {
        if (k in (req.body ?? {})) patch[k] = req.body[k] === "" ? null : req.body[k];
      }
      if ("entity" in patch) patch.entity = editedRiderEntity(patch.entity);
      stripNotesField(patch);
      const result = await withChangeGroupResult(actor, async () => {
        let data = before;
        const keys = Object.keys(patch);
        if (keys.length) {
          const { data: updated, error } = await supabaseAdmin.from("riders").update(patch).eq("id", id).select().single();
          if (error) throw error;
          data = updated;
          await recordChange({
            table: "riders",
            pk: id,
            before: pickRow(before, keys),
            after: pickRow(updated, keys),
            action: "update_rider",
            entity_type: "rider",
            entity_id: id,
            rider_id: id,
            actor,
          });
        }
        const noteReport = await appendNotesInGroup({
          entityType: "rider",
          ids: [id],
          note: req.body?.append_note,
          actor,
        });
        return withNoteReport(data, req.body?.append_note, noteReport);
      });
      res.json(result);
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.post("/api/lease-mgmt/riders/:id/off-lease", async (req, res) => {
    try {
      const actor = await requireWrite(req, res);
      if (!actor) return;
      const id = Number(req.params.id);
      const date = String(req.body?.date ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ message: "date required (YYYY-MM-DD)" });
      const { data: rider } = await supabaseAdmin.from("riders").select("*").eq("id", id).maybeSingle();
      if (!rider) return res.status(404).json({ message: "Rider not found" });
      const { data: assigns } = await supabaseAdmin.from("railcar_assignments").select("id, railcar_id, assignment_status").eq("rider_id", id);
      const wanted = Array.isArray(req.body?.car_ids) && req.body.car_ids.length
        ? (req.body.car_ids as number[]).map(Number)
        : (assigns ?? []).map((a: any) => Number(a.railcar_id));
      const { ok, skipped } = await assertActiveCars(wanted);
      const result = await withChangeGroupResult(actor, async () => {
        for (const a of assigns ?? []) {
          if (!ok.includes(Number(a.railcar_id))) continue;
          const before = { assignment_status: a.assignment_status ?? null };
          const after = { assignment_status: "off_lease_pending_remarketing" };
          const { error } = await supabaseAdmin.from("railcar_assignments").update(after).eq("id", a.id);
          if (error) throw error;
          await recordChange({
            table: "railcar_assignments",
            pk: Number(a.id),
            before,
            after,
            action: "off_lease",
            entity_type: "railcar",
            entity_id: Number(a.railcar_id),
            railcar_id: Number(a.railcar_id),
            rider_id: id,
            actor,
          });
        }
        const { data: remaining } = await supabaseAdmin
          .from("railcar_assignments")
          .select("railcar_id, assignment_status, railcars!inner(active)")
          .eq("rider_id", id);
        const stillOn = (remaining ?? []).filter((a: any) => a.railcars?.active === true && a.assignment_status !== "off_lease_pending_remarketing");
        const riderPatch: Record<string, unknown> = {};
        if (!stillOn.length) {
          riderPatch.lifecycle_status = "off_lease_pending_remarketing";
          riderPatch.off_lease_at = date;
        }
        if (Object.keys(riderPatch).length) {
          const { data: afterR, error: uErr } = await supabaseAdmin.from("riders").update(riderPatch).eq("id", id).select().single();
          if (uErr) throw uErr;
          await recordChange({
            table: "riders",
            pk: id,
            before: pickRow(rider, Object.keys(riderPatch)),
            after: pickRow(afterR, Object.keys(riderPatch)),
            action: "off_lease",
            entity_type: "rider",
            entity_id: id,
            rider_id: id,
            actor,
            force: true,
          });
        }
        const carReport = await appendNotesInGroup({
          entityType: "railcar",
          ids: ok,
          note: req.body?.append_note,
          actor,
        });
        const riderReport = Object.keys(riderPatch).length
          ? await appendNotesInGroup({
              entityType: "rider",
              ids: [id],
              note: req.body?.append_note,
              actor,
            })
          : { appended: [], skipped: [] };
        return withNoteReport(
          { updated: ok.length, skipped, partial: stillOn.length > 0 },
          req.body?.append_note,
          { appended: [...carReport.appended, ...riderReport.appended], skipped: [...carReport.skipped, ...riderReport.skipped] },
        );
      });
      res.json(result);
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.post("/api/lease-mgmt/riders/:id/remarket", async (req, res) => {
    try {
      const actor = await requireWrite(req, res);
      if (!actor) return;
      const id = Number(req.params.id);
      const date = String(req.body?.date ?? "").slice(0, 10);
      const newOl = String(req.body?.new_ol_number ?? "").trim().toUpperCase();
      const lesseeId = Number(req.body?.lessee_id);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ message: "date required" });
      if (!isStandardRiderNumber(newOl) || !newOl.startsWith("OL")) {
        return res.status(400).json({ message: "new_ol_number must match OL####" });
      }
      const { data: ea } = await supabaseAdmin.from("riders").select("*").eq("id", id).maybeSingle();
      if (!ea) return res.status(404).json({ message: "Rider not found" });
      const destLessee = Number.isFinite(lesseeId) && lesseeId > 0 ? lesseeId : Number(ea.master_lease_id);
      const { data: ml } = await supabaseAdmin.from("master_leases").select("id, lessee, lease_number, is_placeholder").eq("id", destLessee).maybeSingle();
      if (!ml) return res.status(400).json({ message: "Lessee not found" });
      if (ml.is_placeholder || isPlaceholderLessee(ml.lessee) || isPlaceholderLessee(ml.lease_number)) {
        return res.status(400).json({ message: "Cannot remarket onto a placeholder lessee" });
      }
      const wanted = Array.isArray(req.body?.car_ids) ? (req.body.car_ids as number[]).map(Number) : [];
      if (!wanted.length) return res.status(400).json({ message: "car_ids required" });
      const { ok, skipped } = await assertActiveCars(wanted);
      if (!ok.length) return res.status(400).json({ message: "No active cars to move", skipped });

      const result = await withChangeGroupResult(actor, async () => {
        const { data: existing } = await supabaseAdmin
          .from("riders")
          .select("*")
          .eq("master_lease_id", destLessee)
          .eq("rider_name", newOl)
          .maybeSingle();
        let dest = existing;
        if (!dest) {
          const insert = {
            master_lease_id: destLessee,
            rider_name: newOl,
            schedule_number: newOl,
            number_digits: riderNumberDigits(newOl),
            lifecycle_status: "active",
            effective_date: date,
          };
          const { data: created, error: cErr } = await supabaseAdmin.from("riders").insert(insert).select().single();
          if (cErr) throw cErr;
          dest = created;
          await recordChange({
            table: "riders",
            pk: Number(created.id),
            before: {},
            after: created,
            action: "create_rider",
            entity_type: "rider",
            entity_id: Number(created.id),
            rider_id: Number(created.id),
            actor,
          });
        }
        await moveActiveCars({
          carIds: ok,
          toRiderId: Number(dest.id),
          actor,
          date,
          reason: `Remarket ${ea.rider_name} → ${newOl}`,
        });
        const eaPatch = {
          lifecycle_status: "closed",
          closed_at: date,
          successor_rider_id: Number(dest.id),
        };
        const { data: eaAfter, error: eaErr } = await supabaseAdmin.from("riders").update(eaPatch).eq("id", id).select().single();
        if (eaErr) throw eaErr;
        await recordChange({
          table: "riders",
          pk: id,
          before: pickRow(ea, Object.keys(eaPatch)),
          after: pickRow(eaAfter, Object.keys(eaPatch)),
          action: "remarket",
          entity_type: "rider",
          entity_id: id,
          rider_id: id,
          actor,
          force: true,
        });
        const carReport = await appendNotesInGroup({
          entityType: "railcar",
          ids: ok,
          note: req.body?.append_note,
          actor,
        });
        const riderReport = await appendNotesInGroup({
          entityType: "rider",
          ids: [id],
          note: req.body?.append_note,
          actor,
        });
        return withNoteReport(
          { new_rider_id: Number(dest.id), moved: ok.length, skipped },
          req.body?.append_note,
          { appended: [...carReport.appended, ...riderReport.appended], skipped: [...carReport.skipped, ...riderReport.skipped] },
        );
      });
      res.json(result);
    } catch (err) {
      errHandler(res, err);
    }
  });

  const issueKinds = {
    ea_on_rent: "v_lease_issue_ea_on_rent",
    unlinked: "v_lease_issue_unlinked",
    lessee_mismatch: "v_lease_issue_lessee_mismatch",
    duplicates: "v_lease_issue_dup_lessees",
    nonstandard: "v_lease_issue_nonstandard",
    past_exp: "v_lease_issue_past_exp",
    rent_mismatch: "v_lease_issue_rent_mismatch",
    placeholders: "v_lease_issue_placeholder",
  } as const;

  app.get("/api/lease-mgmt/issues", async (_req, res) => {
    try {
      const out: Record<string, { count: number; rows: unknown[] }> = {};
      for (const [k, view] of Object.entries(issueKinds)) {
        const rows = await fetchAllRows((from, to) => supabaseAdmin.from(view).select("*").range(from, to));
        out[k] = { count: rows.length, rows };
      }
      const dupGroups = new Set((out.duplicates.rows as any[]).map((r) => r.k)).size;
      out.duplicates = { ...out.duplicates, count: dupGroups, rows: out.duplicates.rows };
      (out as any).duplicate_rows = (out.duplicates.rows as any[]).length;
      res.json(out);
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.get("/api/lease-mgmt/issues/:kind.csv", async (req, res) => {
    try {
      const kind = String(req.params.kind) as keyof typeof issueKinds;
      const view = issueKinds[kind];
      if (!view) return res.status(404).json({ message: "Unknown issue kind" });
      const rows = await fetchAllRows((from, to) => supabaseAdmin.from(view).select("*").range(from, to)) as Record<string, unknown>[];
      let lines: string[];
      if (isLeaseIssueCarKind(kind) && rows[0]) {
        const table = leadCarExportTable(Object.keys(rows[0]), rows);
        lines = [
          table.headers.join(","),
          ...table.records.map((record) => record.map((cell, index) => (index === 1 ? csvCarNumberField(cell) : csvField(cell))).join(",")),
        ];
      } else {
        const headers = rows[0] ? Object.keys(rows[0]) : ["empty"];
        lines = [headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))];
      }
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${kind}.csv"`);
      res.send(lines.join("\n") + "\n");
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.get("/api/lease-mgmt/previews", async (_req, res) => {
    try {
      res.json(await buildLeaseP1Previews());
    } catch (err) {
      errHandler(res, err);
    }
  });
}

export function assertNewLesseeName(name: string | null | undefined) {
  if (isPlaceholderLessee(name)) {
    reject("Placeholder lessees (x…, IDLE, Available, Unassigned) cannot be created");
  }
}

export function assertNewRiderNumber(name: string | null | undefined) {
  const code = String(name ?? "").trim().toUpperCase();
  if (!isStandardRiderNumber(code)) {
    reject("Rider number must match OL#### or EA#### (YY + running number)");
  }
}
