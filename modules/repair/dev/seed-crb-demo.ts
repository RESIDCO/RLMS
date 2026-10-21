/**
 * §I synthetic CRB demo. DEMO marks only. No licensed code or price tables.
 * Idempotent: the same bytes re-upload as a no-op.
 * Run: npm run repair:seed-crb-demo
 * Also invoked at the end of repair:seed-shop-demo.
 */
import { resolve } from "path";
import { fileURLToPath } from "url";
import { DEFAULT_TENANT_ID, q } from "../db";
import { migrateLocal } from "./migrate-local";
import { buildRecord } from "../server/crb/parse500";
import { uploadCrbFile } from "../server/crb/ingest";
import { upsertBillerHeader } from "../server/crb/review";

const TENANT = DEFAULT_TENANT_ID;

type Spec = {
  billing: string;
  invoice: string;
  car: string;
  num: string;
  repair?: string;
  detail?: string;
  job?: string;
  qual?: string;
  why?: string;
  loc?: string;
  resp?: string;
  dcParty?: string;
  dcDate?: string;
  labor: number;
  material?: number;
  sign?: "D" | "C";
  machine?: string;
  wrong?: string;
  narrative?: string;
  kind?: string;
  load?: string;
  repairingInvoice?: string;
  rate?: number;
  resubmitted?: string;
  lineNo: number;
};

type ShopHit = {
  invoiceNo: string;
  car: string;
  num: string;
  job: string;
  qual: string;
  loc: string;
  repair: string;
};

function ok(msg: string) {
  console.log(`  OK  ${msg}`);
}

function lineRecord(s: Spec): string {
  return buildRecord("1", {
    billing_party: s.billing,
    billed_party: "DEMO",
    account_date_yymm: "2605",
    invoice_number: s.invoice,
    currency: "U",
    detail_source: s.detail ?? "BR",
    car_initial: s.car,
    car_number: s.num,
    kind_of_car: s.kind ?? "G",
    load_empty: s.load ?? "L",
    repair_date_yymmdd: s.repair ?? "260510",
    splc: "123456",
    repairing_party: "DMSH",
    repairing_party_invoice: s.repairingInvoice ?? "",
    facility_type: "RT",
    location_on_car: s.loc ?? "A1",
    quantity: 1,
    condition_code: "1",
    applied_job_code: s.job ?? "1001",
    applied_qualifier: s.qual ?? "001",
    why_made: s.why ?? "01",
    responsibility: s.resp ?? "1",
    dc_jic_party: s.dcParty ?? "",
    dc_jic_date: s.dcDate ?? "000000",
    labor_cents: s.labor,
    material_cents: Math.abs(s.material ?? 0),
    material_sign: s.sign ?? "D",
    machine_priceable: s.machine ?? "N",
    wrong_repair: s.wrong ?? "N",
    narrative_non_wheel: s.narrative ?? "DEMO synthetic line",
    labor_rate: s.rate ?? 0,
    line_number: s.lineNo,
    railinc_inbound_date: "261001",
    railinc_outbound_date: "261005",
    resubmitted_ind: s.resubmitted ?? "",
  });
}

function fill(billing: string, invoice: string, cars: Array<{ car: string; num: string }>, perCar: number, labor: number, startLine: number, overrides?: (index: number, carIndex: number) => Partial<Spec>): Spec[] {
  const out: Spec[] = [];
  let n = startLine;
  cars.forEach((car, carIndex) => {
    for (let i = 0; i < perCar; i++) {
      const base: Spec = {
        billing,
        invoice,
        car: car.car,
        num: car.num,
        labor,
        lineNo: n,
      };
      out.push({ ...base, ...(overrides ? overrides(i, carIndex) : {}) });
      n += 1;
    }
  });
  return out;
}

function cars(from: number, count: number): Array<{ car: string; num: string }> {
  return Array.from({ length: count }, (_, i) => ({
    car: "DEMO",
    num: String(from + i).padStart(6, "0"),
  }));
}

async function shopHit(): Promise<ShopHit | null> {
  const { rows } = await q<{
    invoice_no: string;
    car_mark: string;
    car_number: string;
    job: string | null;
    qual: string | null;
    loc: string | null;
    raw_line: string | null;
  }>(
    `SELECT i.invoice_no, e.car_mark, e.car_number,
            il.aar_job_code AS job, il.qualifier AS qual, il.location_on_car AS loc, il.raw_line
     FROM repair.invoice_lines il
     JOIN repair.invoices i ON i.id = il.invoice_id AND i.deleted_at IS NULL
     JOIN repair.events e ON e.id = i.event_id AND e.deleted_at IS NULL
     WHERE i.tenant_id = $1 AND e.car_mark = 'DEMO'
       AND COALESCE(il.aar_job_code, '') <> ''
     ORDER BY i.invoice_no, il.id
     LIMIT 1`,
    [TENANT],
  );
  const row = rows[0];
  if (!row) return null;
  const job = String(row.job ?? "").trim();
  const loc = String(row.loc ?? "").trim();
  if (!/^\d{1,4}$/.test(job) || loc.length > 2) return null;
  const raw = row.raw_line ?? "";
  const repair = raw.length >= 65 ? raw.slice(59, 65).trim() : "";
  return {
    invoiceNo: row.invoice_no.trim(),
    car: row.car_mark.trim().toUpperCase(),
    num: row.car_number.replace(/\D/g, "").padStart(6, "0"),
    job,
    qual: String(row.qual ?? "").trim().slice(0, 3),
    loc,
    repair: /^\d{6}$/.test(repair) ? repair : "260510",
  };
}

function buildLines(hit: ShopHit | null): Spec[] {
  const lines: Spec[] = [];
  lines.push(
    ...fill("DMRA", "INV-DEMO-BAL", cars(100010, 8), 4, 2500, 1, (i, carIndex) => {
      if (hit && carIndex === 0 && i === 0) {
        return {
          car: hit.car,
          num: hit.num,
          job: hit.job,
          qual: hit.qual,
          loc: hit.loc || "A1",
          repair: hit.repair,
          repairingInvoice: hit.invoiceNo,
        };
      }
      if (!hit && carIndex === 0 && i === 0) {
        return { job: "1001", qual: "001", loc: "A1", repair: "260510" };
      }
      return {};
    }),
  );
  lines.push(...fill("DMRB", "INV-DEMO-OOB", cars(100018, 5), 3, 3000, 100));
  lines.push(
    ...fill("DMSH", "INV-DEMO-PCT", cars(100023, 6), 4, 47000, 200, (i, carIndex) => {
      if (carIndex === 0 && i === 0) {
        return {
          labor: 119000,
          why: "08",
          wrong: "Y",
          narrative: "DEMO wrong repair",
        };
      }
      return {};
    }),
  );
  lines.push(
    ...fill("DMRA", "INV-DEMO-DUP", cars(100029, 6), 4, 2000, 300, (i, carIndex) => {
      if (carIndex === 0 && i === 0) {
        if (hit) {
          return {
            car: hit.car,
            num: hit.num,
            job: hit.job,
            qual: hit.qual,
            loc: hit.loc || "A1",
            repair: hit.repair,
            repairingInvoice: hit.invoiceNo,
            narrative: "DEMO duplicate of shop invoice",
          };
        }
        return {
          car: "DEMO",
          num: "100010",
          job: "1001",
          qual: "001",
          loc: "A1",
          repair: "260510",
          narrative: "DEMO duplicate inside CRB",
        };
      }
      return {};
    }),
  );
  lines.push(
    ...fill("DMRB", "INV-DEMO-MIN", cars(100035, 6), 4, 2000, 400, (i, carIndex) => {
      if (carIndex === 0 && i === 0) {
        return { labor: 4000, why: "08", wrong: "Y", narrative: "DEMO small wrong repair" };
      }
      return {};
    }),
  );

  const mixCars: Array<{ car: string; num: string }> = [
    { car: "DEMO", num: "100098" },
    { car: "DEMO", num: "100099" },
    { car: "OTHR", num: "999001" },
    ...cars(100041, 6),
  ];
  lines.push(
    ...fill("DMSH", "INV-DEMO-MIX", mixCars, 4, 1000, 500, (i, carIndex) => {
      if (carIndex === 3 && i === 0) {
        return { repair: "240115", detail: "BR", labor: 1800, narrative: "DEMO time barred" };
      }
      if (carIndex === 4 && i === 0) {
        return {
          detail: "DC",
          resp: "3",
          dcParty: "DCRD",
          dcDate: "260101",
          labor: 2200,
          narrative: "DEMO resp 3 DC",
        };
      }
      if (carIndex === 5 && i === 0) {
        return { detail: "CB", labor: 0, material: 5000, sign: "C", narrative: "DEMO credit CB" };
      }
      if (carIndex === 5 && i === 1) {
        return { why: "45", wrong: "Y", labor: 2500, narrative: "DEMO why made 45" };
      }
      if (carIndex === 6 && i === 0) {
        return { load: "E", labor: 200000, rate: 10000, narrative: "DEMO empty labor" };
      }
      if (carIndex === 6 && i === 1) {
        return { resp: "2", labor: 1500, narrative: "DEMO handling line" };
      }
      if (carIndex === 7 && i === 0) {
        return {
          job: "9001",
          qual: "001",
          machine: "Y",
          labor: 15000,
          narrative: "DEMO price stub",
        };
      }
      if (carIndex === 8 && i === 0) {
        return { resubmitted: "R", repair: "200101", detail: "OT", labor: 1600, narrative: "DEMO resubmit" };
      }
      return {};
    }),
  );
  return lines;
}

function signedMaterial(s: Spec): number {
  const mag = Math.abs(s.material ?? 0);
  return s.sign === "C" ? -mag : mag;
}

export function buildDemoText(lines: Spec[]): string {
  const records: string[] = [];
  records.push(
    buildRecord("6", {
      billing_party: "DMRA",
      billed_party: "DEMO",
      account_date_yymm: "2605",
      invoice_number: "INV-DEMO-BAL",
      currency: "U",
      contact_type: "BI",
      company: "DEMO BILLER",
      contact_name: "DEMO CONTACT",
      city: "DEMO CITY",
      state: "IL",
      country: "US",
      zip: "60601",
    }),
  );
  for (const line of lines) records.push(lineRecord(line));
  records.push(`${"X"}${" ".repeat(499)}`);

  const byInvoice = new Map<string, Spec[]>();
  for (const line of lines) {
    const key = `${line.billing}|${line.invoice}`;
    const list = byInvoice.get(key) ?? [];
    list.push(line);
    byInvoice.set(key, list);
  }
  let fileLabor = 0;
  let fileMaterial = 0;
  let fileCount = 0;
  for (const [key, group] of Array.from(byInvoice.entries())) {
    const [billing, invoice] = key.split("|");
    const byDs = new Map<string, Spec[]>();
    for (const line of group) {
      const ds = line.detail ?? "BR";
      const list = byDs.get(ds) ?? [];
      list.push(line);
      byDs.set(ds, list);
    }
    let sumLabor = 0;
    let sumMaterial = 0;
    let sumCount = 0;
    for (const [ds, dsLines] of Array.from(byDs.entries())) {
      const labor = dsLines.reduce((s, line) => s + line.labor, 0);
      const material = dsLines.reduce((s, line) => s + signedMaterial(line), 0);
      sumLabor += labor;
      sumMaterial += material;
      sumCount += dsLines.length;
      const skew = invoice === "INV-DEMO-OOB" ? 100 : 0;
      records.push(fmt8(billing, invoice, ds, dsLines.length, labor + skew, material));
    }
    const zzSkew = invoice === "INV-DEMO-OOB" ? 200 : 0;
    records.push(fmt8(billing, invoice, "ZZ", sumCount, sumLabor + zzSkew, sumMaterial));
    fileLabor += sumLabor;
    fileMaterial += sumMaterial;
    fileCount += sumCount;
  }
  records.push(
    buildRecord("9", {
      filler_billing: "ZZZZ",
      billed_party: "DEMO",
      account_date_yymm: "2605",
      filler_invoice: "Z".repeat(16),
      filler_currency: "Z",
      filler_detail: "ZZ",
      record_count: fileCount,
      labor_cents: fileLabor,
      material_cents: Math.abs(fileMaterial),
      material_sign: fileMaterial < 0 ? "C" : "D",
    }),
  );
  return `${records.join("\n")}\n`;
}

function fmt8(billing: string, invoice: string, ds: string, count: number, labor: number, material: number): string {
  return buildRecord("8", {
    billing_party: billing,
    billed_party: "DEMO",
    account_date_yymm: "2605",
    invoice_number: invoice,
    currency: "U",
    detail_source: ds,
    record_count: count,
    labor_cents: labor,
    material_cents: Math.abs(material),
    material_sign: material < 0 ? "C" : "D",
    invoice_date: "260515",
    railinc_inbound_date: "261001",
    railinc_outbound_date: "261005",
  });
}

function totals(lines: Spec[], invoice: string): { cents: number; cars: number } {
  const group = lines.filter((line) => line.invoice === invoice);
  const cents = group.reduce((sum, line) => sum + line.labor + signedMaterial(line), 0);
  const cars = new Set(group.map((line) => `${line.car}|${line.num}`)).size;
  return { cents, cars };
}

async function ensureOwned(num: string, withLease: boolean) {
  await q(
    `INSERT INTO public.railcars (id, car_number, car_initial, reporting_marks, active, entity, lessee_name)
     SELECT GREATEST((SELECT COALESCE(MAX(id), 0) FROM public.railcars), 70000) + 1,
            $1, 'DEMO', 'DEMO', true, 'Main', $2
     WHERE NOT EXISTS (
       SELECT 1 FROM public.railcars WHERE car_initial = 'DEMO' AND car_number = $1
     )`,
    [num, withLease ? "DEMO LESSEE" : null],
  );
  await q(
    `INSERT INTO public.v_valid_export_rows_data
       (export_src, export_id, car_initial, car_number, active, rider, assignment, assignment_id, lessee, start_date, end_date)
     SELECT 1, 88000, 'DEMO', $1, 1, $2, 'DEMO-G', $3, $4, '2020-01-01', NULL
     WHERE NOT EXISTS (
       SELECT 1 FROM public.v_valid_export_rows_data WHERE car_initial = 'DEMO' AND car_number = $1
     )`,
    [num, withLease ? "R1" : null, withLease ? "AG-DEMO" : null, withLease ? "DEMO LESSEE" : null],
  );
}

async function ensureRefs() {
  await q(
    `INSERT INTO repair.ref_job_codes (tenant_id, job_code, description, source, active, created_by)
     SELECT $1, '9001', 'DEMO synthetic job', 'DEMO', true, 'seed-crb-demo'
     WHERE NOT EXISTS (
       SELECT 1 FROM repair.ref_job_codes
       WHERE tenant_id = $1 AND job_code = '9001' AND deleted_at IS NULL
     )`,
    [TENANT],
  );
  await q(
    `INSERT INTO repair.ref_job_code_prices
       (tenant_id, job_code, qualifier, price_cents, labor_cents, material_cents, source, price_key, active, created_by)
     SELECT $1, '9001', '001', 10000, 10000, 0, 'DEMO', 'DEMO|9001|001', true, 'seed-crb-demo'
     WHERE NOT EXISTS (
       SELECT 1 FROM repair.ref_job_code_prices
       WHERE tenant_id = $1 AND price_key = 'DEMO|9001|001' AND deleted_at IS NULL
     )`,
    [TENANT],
  );
}

export async function seedCrbDemo(): Promise<{ fileId: string; noop: boolean; lines: number; cars: number }> {
  process.env.REPAIR_LOCAL_DB = process.env.REPAIR_LOCAL_DB ?? "1";
  process.env.REPAIR_DEV_BYPASS_AUTH = process.env.REPAIR_DEV_BYPASS_AUTH ?? "1";
  if (!process.env.DATABASE_URL && !process.env.REPAIR_DATABASE_URL) {
    process.env.DATABASE_URL = "postgresql://repairdev:repairdev@127.0.0.1:5433/rlms_repair_dev";
  }
  await migrateLocal();
  for (let n = 100010; n <= 100046; n++) await ensureOwned(String(n), true);
  await ensureOwned("100098", false);
  await ensureRefs();
  const hit = await shopHit();
  const lines = buildLines(hit);
  const text = buildDemoText(lines);
  const bal = totals(lines, "INV-DEMO-BAL");
  const pct = totals(lines, "INV-DEMO-PCT");
  const dup = totals(lines, "INV-DEMO-DUP");
  const min = totals(lines, "INV-DEMO-MIN");
  const mix = totals(lines, "INV-DEMO-MIX");
  const headers: Array<[string, string, number, number]> = [
    ["DMRA", "INV-DEMO-BAL", bal.cents, bal.cars],
    ["DMSH", "INV-DEMO-PCT", pct.cents, pct.cars],
    ["DMRA", "INV-DEMO-DUP", dup.cents, dup.cars + 3],
    ["DMRB", "INV-DEMO-MIN", min.cents, min.cars],
    ["DMSH", "INV-DEMO-MIX", mix.cents, mix.cars],
    ["DMRA", "INV-DEMO-GHOST", 100, 1],
  ];
  for (const [billing, invoice, cents, carCount] of headers) {
    const saved = await upsertBillerHeader({
      billingParty: billing,
      invoiceNumber: invoice,
      accountMonth: "2605",
      invoiceDate: "2026-05-15",
      receivedDate: "2026-10-01",
      totalCents: cents,
      carCount,
      actor: "seed-crb-demo",
    });
    if (!saved.ok) throw new Error(saved.error);
  }
  const uploaded = await uploadCrbFile({
    filename: "DEMO_CRB_2605.txt",
    bytes: Buffer.from(text, "latin1"),
    actor: "seed-crb-demo",
  });
  const carCount = new Set(lines.map((line) => `${line.car}|${line.num}`)).size;
  ok(`${uploaded.noop ? "noop" : "loaded"} ${uploaded.fileId} lines=${lines.length} cars=${carCount} control=${uploaded.controlStatus}`);
  return { fileId: uploaded.fileId, noop: uploaded.noop, lines: lines.length, cars: carCount };
}

const isMain = !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  seedCrbDemo()
    .then((result) => {
      console.log("=== repair:seed-crb-demo PASS ===");
      console.log(JSON.stringify(result));
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
