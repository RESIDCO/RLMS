import ExcelJS from "exceljs";
import { displayLeaseNumber } from "@shared/residco-import";
import { carBuildYear } from "@shared/build-year";
import { displayRailcarStatus, displayStatusInputFromRailcar } from "@shared/fleet-status";
import { excelSheetName } from "@shared/programs";
import { resolveLeaseType } from "@shared/lease-type";
import { queryRailcars } from "./railcar-list";
import { supabaseAdmin } from "./supabase";

type LeaseRow = {
  id: number;
  lease_number: string | null;
  agreement_number: string | null;
  lessor: string | null;
  lessee: string | null;
  lease_type: string | null;
  effective_date: string | null;
  notes: string | null;
};

type RiderRow = {
  id: number;
  master_lease_id: number;
  rider_name: string | null;
  schedule_number: string | null;
  effective_date: string | null;
  expiration_date: string | null;
  permissible_commodity: string | null;
  monthly_rate_pct: number | null;
  lessors_cost: number | null;
  base_term_months: number | null;
  monthly_rent_per_car: number | null;
  sold_to: string | null;
  notes: string | null;
};

const CAR_HEADERS = [
  "Rider",
  "Marks",
  "Car Number",
  "Lessee",
  "Rental Status",
  "Entity",
  "NBV",
  "OAC",
  "OEC",
  "Capacity",
  "Lining",
  "Build Year",
  "Lease Type",
] as const;

function money(v: unknown): number | string {
  if (v == null || v === "") return "";
  const n = Number(v);
  return Number.isFinite(n) ? n : "";
}

function liningOf(c: any): string {
  return c.lining_material || c.lining || c.coating || "";
}

function carRow(c: any, leaseType: string | null | undefined): (string | number)[] {
  return [
    c.assignment?.rider?.rider_name ?? c.rider_external_id ?? "",
    c.reporting_marks ?? "",
    c.car_number ?? "",
    c.assignment?.fleet_name ?? c.lessee_name ?? "",
    displayRailcarStatus(displayStatusInputFromRailcar(c)),
    c.entity ?? "",
    money(c.nbv),
    money(c.oac),
    money(c.oec),
    c.capacity_cf != null && Number.isFinite(Number(c.capacity_cf)) ? Number(c.capacity_cf) : "",
    liningOf(c),
    carBuildYear(c) ?? "",
    resolveLeaseType(c.lease_type, leaseType) ?? "",
  ];
}

export async function buildLeaseReport(opts: { leaseIds: number[] }): Promise<{ buffer: Buffer; filename: string }> {
  const ids = opts.leaseIds.filter((n) => Number.isFinite(n) && n > 0);
  if (!ids.length) throw new Error("Select at least one master lease");

  const [{ data: leases, error: leaseErr }, { data: riders, error: riderErr }] = await Promise.all([
    supabaseAdmin.from("master_leases").select("*").in("id", ids).order("lease_number"),
    supabaseAdmin.from("riders").select("*").in("master_lease_id", ids).order("rider_name"),
  ]);
  if (leaseErr) throw leaseErr;
  if (riderErr) throw riderErr;

  const leaseList = (leases ?? []) as LeaseRow[];
  const riderList = (riders ?? []) as RiderRow[];
  const ridersByLease = new Map<number, RiderRow[]>();
  for (const r of riderList) {
    const list = ridersByLease.get(r.master_lease_id) ?? [];
    list.push(r);
    ridersByLease.set(r.master_lease_id, list);
  }

  const carsByLease = new Map<number, any[]>();
  for (const lease of leaseList) {
    const { rows } = await queryRailcars({
      lease_id: lease.id,
      all: true,
      active: "all",
      sort: "car_number",
      dir: "asc",
      page: 1,
      pageSize: 1,
    });
    carsByLease.set(lease.id, rows);
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "RLMS";

  const summary = wb.addWorksheet("Summary");
  summary.columns = [
    { header: "Lease Number", key: "lease_number", width: 18 },
    { header: "Agreement Number", key: "agreement_number", width: 20 },
    { header: "Lessor", key: "lessor", width: 22 },
    { header: "Lessee", key: "lessee", width: 22 },
    { header: "Type", key: "lease_type", width: 16 },
    { header: "Effective Date", key: "effective_date", width: 14 },
    { header: "Rider Count", key: "rider_count", width: 12 },
    { header: "Car Count", key: "car_count", width: 12 },
    { header: "Notes", key: "notes", width: 36 },
  ];
  summary.getRow(1).font = { bold: true };

  const usedNames = new Set<string>(["summary", "riders"]);

  for (const lease of leaseList) {
    const cars = carsByLease.get(lease.id) ?? [];
    const ridersFor = ridersByLease.get(lease.id) ?? [];
    summary.addRow({
      lease_number: displayLeaseNumber(lease.lease_number),
      agreement_number: lease.agreement_number ?? "",
      lessor: lease.lessor ?? "",
      lessee: lease.lessee ?? "",
      lease_type: lease.lease_type ?? "",
      effective_date: lease.effective_date ?? "",
      rider_count: ridersFor.length,
      car_count: cars.length,
      notes: lease.notes ?? "",
    });
  }

  const ridersSheet = wb.addWorksheet("Riders");
  ridersSheet.columns = [
    { header: "Lease Number", key: "lease_number", width: 18 },
    { header: "Rider Name", key: "rider_name", width: 22 },
    { header: "Schedule Number", key: "schedule_number", width: 16 },
    { header: "Effective Date", key: "effective_date", width: 14 },
    { header: "Expiration Date", key: "expiration_date", width: 14 },
    { header: "Commodity", key: "commodity", width: 18 },
    { header: "Monthly Rate %", key: "monthly_rate_pct", width: 14 },
    { header: "Lessor Cost", key: "lessors_cost", width: 14 },
    { header: "Base Term (mo)", key: "base_term_months", width: 14 },
    { header: "Monthly Rent/Car", key: "monthly_rent_per_car", width: 16 },
    { header: "Sold To", key: "sold_to", width: 16 },
    { header: "Car Count", key: "car_count", width: 12 },
    { header: "Notes", key: "notes", width: 36 },
  ];
  ridersSheet.getRow(1).font = { bold: true };

  const leaseById = new Map(leaseList.map((l) => [l.id, l]));
  for (const rider of riderList) {
    const lease = leaseById.get(rider.master_lease_id);
    const cars = (carsByLease.get(rider.master_lease_id) ?? []).filter(
      (c) => c.assignment?.rider?.id === rider.id || c.assignment?.rider_id === rider.id,
    );
    ridersSheet.addRow({
      lease_number: displayLeaseNumber(lease?.lease_number),
      rider_name: rider.rider_name ?? "",
      schedule_number: rider.schedule_number ?? "",
      effective_date: rider.effective_date ?? "",
      expiration_date: rider.expiration_date ?? "",
      commodity: rider.permissible_commodity ?? "",
      monthly_rate_pct: rider.monthly_rate_pct ?? "",
      lessors_cost: money(rider.lessors_cost),
      base_term_months: rider.base_term_months ?? "",
      monthly_rent_per_car: money(rider.monthly_rent_per_car),
      sold_to: rider.sold_to ?? "",
      car_count: cars.length,
      notes: rider.notes ?? "",
    });
  }

  for (const lease of leaseList) {
    const name = excelSheetName(displayLeaseNumber(lease.lease_number) || `MLA ${lease.id}`, usedNames);
    const sheet = wb.addWorksheet(name);
    sheet.addRow([...CAR_HEADERS]);
    sheet.getRow(1).font = { bold: true };
    for (const c of carsByLease.get(lease.id) ?? []) {
      sheet.addRow(carRow(c, lease.lease_type));
    }
    sheet.columns.forEach((col, i) => {
      col.width = i === 0 || i === 3 ? 22 : i === 12 ? 16 : 14;
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return {
    buffer: Buffer.from(buf),
    filename: `RLMS_Leases_${y}${m}${day}.xlsx`,
  };
}
