import ExcelJS from "exceljs";
import { displayLeaseNumber } from "@shared/residco-import";
import { displayRailcarStatus, displayStatusInputFromRailcar } from "@shared/fleet-status";
import { excelSheetName } from "@shared/programs";
import { formatCalendarDate } from "@shared/lease-authority";
import { resolveLeaseType } from "@shared/lease-type";
import { loadTurning50Export, type Turning50ExportCar } from "./browse";

const CAR_HEADERS = [
  "OL",
  "Marks",
  "Car Number",
  "Lease Type",
  "Entity",
  "Status",
  "Type",
  "Lessee",
  "Build Year",
  "NBV",
  "OAC",
  "OEC",
  "Capacity",
  "Lining",
] as const;

function money(v: number | null | undefined): number | string {
  if (v == null) return "";
  return v;
}

function carCells(c: Turning50ExportCar, ol: string, mlaType: string | null): (string | number)[] {
  return [
    ol,
    c.reporting_marks ?? "",
    c.car_number ?? "",
    resolveLeaseType(c.lease_type, mlaType) ?? "",
    c.entity ?? "",
    displayRailcarStatus(displayStatusInputFromRailcar(c as any)),
    c.car_type ?? "",
    c.lessee_name ?? "",
    c.build_year ?? "",
    money(c.nbv),
    money(c.oac),
    money(c.oec),
    money(c.capacity_cf),
    c.lining ?? "",
  ];
}

function writeCarSheet(
  wb: ExcelJS.Workbook,
  name: string,
  rows: { car: Turning50ExportCar; ol: string; mlaType: string | null }[],
) {
  const sheet = wb.addWorksheet(name);
  sheet.addRow([...CAR_HEADERS]);
  sheet.getRow(1).font = { bold: true };
  for (const r of rows) sheet.addRow(carCells(r.car, r.ol, r.mlaType));
  sheet.columns.forEach((col, i) => {
    col.width = i === 0 || i === 3 || i === 7 ? 20 : 14;
  });
}

export async function buildTurning50Report(opts: {
  year: number;
  ols?: string[];
  carIds?: number[];
}): Promise<{ buffer: Buffer; filename: string }> {
  const year = opts.year;
  if (!Number.isFinite(year) || year < 1900 || year > 2100) {
    throw new Error("year is required");
  }
  const data = await loadTurning50Export(year, { ols: opts.ols, carIds: opts.carIds });
  if (!data.riders.length) throw new Error("No turning-50 cars match this export");

  const wb = new ExcelJS.Workbook();
  wb.creator = "RLMS";

  const ols = wb.addWorksheet("OLs");
  ols.columns = [
    { header: "OL / Rider", key: "ol", width: 16 },
    { header: "Rider name", key: "rider_name", width: 24 },
    { header: "Lease type", key: "lease_type", width: 18 },
    { header: "Effective", key: "effective_date", width: 14 },
    { header: "Expires", key: "expiration_date", width: 14 },
    { header: "MLA", key: "lease_number", width: 22 },
    { header: "Lessee", key: "lessee", width: 22 },
    { header: "Cars", key: "car_count", width: 10 },
  ];
  ols.getRow(1).font = { bold: true };
  for (const r of data.riders) {
    ols.addRow({
      ol: r.ol,
      rider_name: r.rider_name && r.rider_name !== r.ol ? r.rider_name : "",
      lease_type: r.lease_type ?? "",
      effective_date: formatCalendarDate(r.effective_date),
      expiration_date: formatCalendarDate(r.expiration_date),
      lease_number: displayLeaseNumber(r.lease_number) || "",
      lessee: r.lessee ?? "",
      car_count: r.cars.length,
    });
  }

  const allRows = data.riders.flatMap((r) =>
    r.cars.map((car) => ({ car, ol: r.ol, mlaType: r.lease_type })),
  );
  writeCarSheet(wb, "Cars", allRows);

  const used = new Set<string>(["ols", "cars"]);
  for (const r of data.riders) {
    writeCarSheet(
      wb,
      excelSheetName(r.ol, used),
      r.cars.map((car) => ({ car, ol: r.ol, mlaType: r.lease_type })),
    );
  }

  const buf = await wb.xlsx.writeBuffer();
  return {
    buffer: Buffer.from(buf),
    filename: `RLMS_Turning50_${year}.xlsx`,
  };
}
