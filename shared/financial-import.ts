/**
 * §3 Financial Data Refresh — Asset Report parse, rail filter, reconciliation.
 * Preview is dry-run; commit writes rider_financial_summary + refreshes railcars.
 */

export type FinRawRow = Record<string, unknown>;

export type FlaggedFinancialRow = {
  entity: "Main" | "RPS";
  rider_id: string;
  asset: string;
  count_cars: number;
  reason: string;
  lessee: string | null;
};

export type FinancialParsedRow = {
  entity: "Main" | "RPS";
  snapshot_month: string;
  rider_id: string;
  car_type: string;
  count_cars: number;
  lessee: string | null;
  former_deal: string | null;
  legal_owner: string | null;
  net_equipment_cost_total: number | null;
  net_equipment_cost_per_car: number | null;
  total_book_value: number | null;
  book_value_per_asset: number | null;
  total_monthly_depreciation: number | null;
  monthly_depreciation_per_asset: number | null;
  monthly_rent_per_car: number | null;
  monthly_rent_total: number | null;
  lease_end_residual_total: number | null;
  lease_end_residual_per_asset: number | null;
  months_until_lease_exp: number | null;
  lease_exp_date: string | null;
  deal_resp: string | null;
  lender: string | null;
  liability_insurance_exp: string | null;
  property_insurance_exp: string | null;
  raw_air_rail_power: string | null;
};

export type ActiveCarForJoin = {
  id: number;
  rider_external_id: string | null;
  car_type: string | null;
  mechanical_designation: string | null;
  general_description: string | null;
  entity: string | null;
};

/** Canonical rail Asset values (normalized). Anything else on a Rail row is flagged. */
export const RAIL_ASSET_CANONICAL = new Set([
  "COV HOPPER",
  "PD COV HOPPER",
  "OP HOPPERS",
  "COAL HOPPERS",
  "GONDOLAS",
  "COAL GONDOLAS",
  "STEEL GOND",
  "TANK CARS",
  "CENTERBEAM",
  "BULKHEAD FLATS",
  "BULKHEAD F",
  "SAND CARS",
  "COIL CARS",
  "COV COIL",
  "BOXCARS",
]);

const ALWAYS_FLAG_ASSETS = new Set(["LOCOMOTIVE", "JOINT VENTURE"]);

function normKey(h: unknown): string {
  return String(h ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function str(v: unknown): string | null {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  return s || null;
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  const s = String(v).trim().replace(/[$,\s]/g, "");
  if (!s || /^n\/?a$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function intNum(v: unknown): number {
  const n = num(v);
  return n == null ? 0 : Math.round(n);
}

/** Normalize Air/Rail/Power → Rail | Air | Power | null */
export function normalizeAirRailPower(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  const key = String(raw)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  if (key === "rail") return "Rail";
  if (key === "air") return "Air";
  if (key === "power") return "Power";
  return str(raw);
}

export function normalizeAssetType(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function parseDateCell(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === "number") {
    // Excel serial
    const epoch = Date.UTC(1899, 11, 30) + v * 86400000;
    return new Date(epoch).toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return null;
}

function monthsBetween(fromIso: string, toIso: string): number {
  const [fy, fm] = fromIso.slice(0, 7).split("-").map(Number);
  const [ty, tm] = toIso.slice(0, 7).split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

/** Prefer the months column; if blank, derive from Lease Exp vs snapshot month. */
function resolveLeaseTerm(
  snapshotMonth: string | null,
  monthsRaw: unknown,
  leaseExpRaw: unknown
): { months: number | null; leaseExp: string | null } {
  const leaseExp = parseDateCell(leaseExpRaw);
  let months = num(monthsRaw);
  if (months == null && leaseExp && snapshotMonth) {
    months = monthsBetween(snapshotMonth, leaseExp);
  }
  return { months, leaseExp };
}

/** Detect snapshot_month from a header cell that is a Date / ISO date. */
export function detectSnapshotMonth(headers: unknown[]): string | null {
  for (const h of headers) {
    if (h instanceof Date && !Number.isNaN(h.getTime())) {
      const d = new Date(Date.UTC(h.getUTCFullYear(), h.getUTCMonth(), 1));
      return d.toISOString().slice(0, 10);
    }
    const s = parseDateCell(h);
    if (s) {
      return `${s.slice(0, 8)}01`;
    }
  }
  return null;
}

type ColMap = Record<string, number>;

function buildColMap(headers: unknown[]): ColMap {
  const map: ColMap = {};
  const aliases: Record<string, string[]> = {
    sub: ["sub", "rider", "riderid"],
    lessee: ["lessee"],
    former_deal: ["formerdeal"],
    count: ["count"],
    asset: ["asset"],
    net_equipment_cost_total: [
      "netequipmentcost123122orpurchasedate",
      "netequipmentcost33126orpurchasedate",
      "netequipmentcost",
    ],
    net_equipment_cost_per_car: [
      "netequipmentcostpercar123122orpurchasedate",
      "netequipmentcostpercar33126orpurchasedate",
      "netequipmentcostpercar",
    ],
    total_book_value: ["totalbookvalue", "netequipmentcost"], // RPS uses Net Equipment Cost as total BV-ish
    book_value_per_asset: ["bvperasset"],
    total_monthly_depreciation: ["totalmonthlydepreciation"],
    monthly_depreciation_per_asset: [
      "monthlydepreciationperasset",
      "monthlydepreciationpercar",
    ],
    monthly_rent_per_car: ["monthlyrentpc"],
    monthly_rent_total: ["monthlyrenttotal", "totalmonthlyrent"],
    lease_end_residual_total: [
      "leaseendtotalresidualvalue",
      "leaseendrv",
      "totalresidualvalue",
    ],
    lease_end_residual_per_asset: ["leaseendrvperasset", "rvperasset"],
    months_until_lease_exp: [
      "ofmonthsuntilleaseexp",
      "ofmonthsuntilleasexp",
      "monthsuntilleaseexp",
      "monthsuntilleasexp",
    ],
    lease_exp_date: ["leaseexp"],
    owner_entity: ["ownerentity"],
    deal_resp: ["dealresp"],
    lender: ["lender"],
    air_rail_power: ["airrailpower"],
    liability_insurance_exp: ["libailityinsuranceexpdate", "liabilityinsuranceexpdate"],
    property_insurance_exp: ["propertyinsuranceexpdate"],
  };
  headers.forEach((h, i) => {
    // Skip stray trailing numeric / date "headers" on Main sheet
    if (h instanceof Date) return;
    if (typeof h === "number") return;
    const nk = normKey(h);
    if (!nk) return;
    for (const [field, alts] of Object.entries(aliases)) {
      if (alts.includes(nk) && map[field] == null) map[field] = i;
    }
  });
  return map;
}

function cell(row: unknown[], map: ColMap, field: string): unknown {
  const i = map[field];
  return i == null ? null : row[i];
}

/**
 * Map a live railcar to an Asset Report family for rider+type join.
 * VCF stores AAR codes (C214); Asset Report uses COV HOPPER / TANK CARS / etc.
 */
export function carToAssetFamily(car: ActiveCarForJoin): string | null {
  const mech = String(car.mechanical_designation ?? "")
    .trim()
    .toUpperCase();
  const ct = String(car.car_type ?? "")
    .trim()
    .toUpperCase();
  const desc = String(car.general_description ?? "").toLowerCase();
  const entity = String(car.entity ?? "");
  const isCoal = entity === "Coal" || entity === "Main-Coal" || desc.includes("coal");
  const exact = normalizeAssetType(car.car_type);
  if (exact && RAIL_ASSET_CANONICAL.has(exact)) return exact;

  if (mech === "T" || ct.startsWith("T")) return "TANK CARS";
  if (mech === "LO" || ct.startsWith("C") || ct.startsWith("J")) {
    if (desc.includes("pressure") || /\bpd\b/.test(desc)) return "PD COV HOPPER";
    if (desc.includes("open") || desc.includes("ore")) return "OP HOPPERS";
    return "COV HOPPER";
  }
  if (["GT", "GB", "GBS", "GTS", "GBSR"].includes(mech) || ct.startsWith("G")) {
    return isCoal ? "COAL GONDOLAS" : "GONDOLAS";
  }
  if (["HTS", "HT"].includes(mech) || ct.startsWith("H")) {
    return isCoal ? "COAL HOPPERS" : "OP HOPPERS";
  }
  if (["FBC", "FBS", "FL"].includes(mech) || ct.startsWith("F")) {
    if (desc.includes("center")) return "CENTERBEAM";
    if (desc.includes("coil")) return "COIL CARS";
    return "BULKHEAD FLATS";
  }
  if (mech === "XL" || ct.startsWith("X") || ct.startsWith("A")) return "BOXCARS";
  return null;
}

const ASSET_ALIASES: Record<string, string[]> = {
  GONDOLAS: ["COAL GONDOLAS", "STEEL GOND"],
  "COAL GONDOLAS": ["GONDOLAS", "STEEL GOND"],
  "OP HOPPERS": ["COAL HOPPERS"],
  "COAL HOPPERS": ["OP HOPPERS"],
  "COV HOPPER": ["PD COV HOPPER", "SAND CARS"],
  "PD COV HOPPER": ["COV HOPPER"],
  "BULKHEAD FLATS": ["BULKHEAD F", "CENTERBEAM"],
  "BULKHEAD F": ["BULKHEAD FLATS"],
  CENTERBEAM: ["BULKHEAD FLATS"],
  "COIL CARS": ["COV COIL"],
  "COV COIL": ["COIL CARS"],
};

export function candidateAssetFamilies(car: ActiveCarForJoin): string[] {
  const primary = carToAssetFamily(car);
  const out: string[] = [];
  if (primary) out.push(primary);
  for (const a of [...out]) {
    for (const alt of ASSET_ALIASES[a] ?? []) {
      if (!out.includes(alt)) out.push(alt);
    }
  }
  return out;
}

export type SheetParseResult = {
  entity: "Main" | "RPS";
  rows: FinancialParsedRow[];
  flagged: FlaggedFinancialRow[];
  skippedBlank: number;
  skippedNonRail: number;
  snapshotMonthFromSheet: string | null;
};

export function parseAssetSheet(
  entity: "Main" | "RPS",
  matrix: unknown[][],
  snapshotMonthOverride?: string | null
): SheetParseResult {
  if (!matrix.length) {
    return {
      entity,
      rows: [],
      flagged: [],
      skippedBlank: 0,
      skippedNonRail: 0,
      snapshotMonthFromSheet: null,
    };
  }
  const headers = matrix[0] ?? [];
  const snapshotMonthFromSheet = detectSnapshotMonth(headers);
  const snapshot_month = snapshotMonthOverride || snapshotMonthFromSheet;
  const map = buildColMap(headers);
  const rows: FinancialParsedRow[] = [];
  const flagged: FlaggedFinancialRow[] = [];
  let skippedBlank = 0;
  let skippedNonRail = 0;

  for (let r = 1; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    const rider_id = str(cell(row, map, "sub"));
    if (!rider_id) {
      skippedBlank += 1;
      continue;
    }
    const assetRaw = cell(row, map, "asset");
    const asset = normalizeAssetType(assetRaw);
    const count_cars = intNum(cell(row, map, "count"));
    const lessee = str(cell(row, map, "lessee"));
    const airNorm =
      entity === "Main" ? normalizeAirRailPower(cell(row, map, "air_rail_power")) : "Rail";

    if (entity === "Main" && airNorm !== "Rail") {
      skippedNonRail += 1;
      continue;
    }

    const flagReason = (() => {
      if (!asset) return "Blank Asset";
      if (ALWAYS_FLAG_ASSETS.has(asset)) return `Excluded asset type: ${asset}`;
      if (!RAIL_ASSET_CANONICAL.has(asset)) return `Non-car / unrecognized Asset: ${asset}`;
      return null;
    })();

    if (flagReason) {
      flagged.push({
        entity,
        rider_id,
        asset: asset || "(blank)",
        count_cars,
        reason: flagReason,
        lessee,
      });
      continue;
    }

    if (!snapshot_month) {
      // Can't write without month — surface as flagged
      flagged.push({
        entity,
        rider_id,
        asset,
        count_cars,
        reason: "snapshot_month could not be detected — confirm month at upload",
        lessee,
      });
      continue;
    }

    // RPS: Total Book Value column may be absent; Net Equipment Cost (idx total_book_value alias) used carefully
    const total_book_value =
      entity === "Main"
        ? num(cell(row, map, "total_book_value"))
        : num(cell(row, map, "book_value_per_asset")) != null && count_cars
          ? (num(cell(row, map, "book_value_per_asset")) as number) * count_cars
          : num(cell(row, map, "total_book_value"));

    const leaseTerm = resolveLeaseTerm(
      snapshot_month,
      cell(row, map, "months_until_lease_exp"),
      cell(row, map, "lease_exp_date")
    );

    rows.push({
      entity,
      snapshot_month,
      rider_id,
      car_type: asset,
      count_cars,
      lessee,
      former_deal: str(cell(row, map, "former_deal")),
      legal_owner: str(cell(row, map, "owner_entity")),
      net_equipment_cost_total: num(cell(row, map, "net_equipment_cost_total")),
      net_equipment_cost_per_car: num(cell(row, map, "net_equipment_cost_per_car")),
      total_book_value,
      book_value_per_asset: num(cell(row, map, "book_value_per_asset")),
      total_monthly_depreciation: num(cell(row, map, "total_monthly_depreciation")),
      monthly_depreciation_per_asset: num(cell(row, map, "monthly_depreciation_per_asset")),
      monthly_rent_per_car: num(cell(row, map, "monthly_rent_per_car")),
      monthly_rent_total: num(cell(row, map, "monthly_rent_total")),
      lease_end_residual_total: num(cell(row, map, "lease_end_residual_total")),
      lease_end_residual_per_asset: num(cell(row, map, "lease_end_residual_per_asset")),
      months_until_lease_exp: leaseTerm.months,
      lease_exp_date: leaseTerm.leaseExp,
      deal_resp: str(cell(row, map, "deal_resp")),
      lender: str(cell(row, map, "lender")),
      liability_insurance_exp: parseDateCell(cell(row, map, "liability_insurance_exp")),
      property_insurance_exp: parseDateCell(cell(row, map, "property_insurance_exp")),
      raw_air_rail_power: airNorm,
    });
  }

  return { entity, rows, flagged, skippedBlank, skippedNonRail, snapshotMonthFromSheet };
}

export type MatchPath = "alias" | "single_rider_fallback" | "none";

export type MatchPathStats = {
  alias: number;
  single_rider_fallback: number;
  none: number;
  /** Coal cars forced to none (Bruce: no Coal financial source) */
  coalExcluded: number;
};

export type FinancialReview = {
  snapshotMonth: string | null;
  snapshotMonthDetected: boolean;
  main: SheetParseResult;
  rps: SheetParseResult;
  qualifyingRows: number;
  qualifyingCarCount: number;
  flaggedCount: number;
  flagged: FlaggedFinancialRow[];
  skippedNonRail: number;
  /** rider|asset keys in file with no matching active car (after entity rules) */
  fileNoCarMatches: Array<{ rider_id: string; car_type: string; entity: string; count_cars: number }>;
  /** active cars with no file match — coal separated */
  carsNoFileMatch: {
    total: number;
    coal: number;
    mainRps: number;
    sampleMainRps: Array<{
      id: number;
      rider_external_id: string | null;
      car_type: string | null;
      mapped_asset: string | null;
      entity: string | null;
    }>;
  };
  activeCarsInRlms: number;
  fileVsActiveDelta: number;
  refreshPreview: {
    carsMatched: number;
    carsUnmatched: number;
    multiBatchRiderTypes: number;
  };
  matchPathStats: MatchPathStats;
  /** Alias / family mapping table for Bruce review */
  assetFamilyMappingNotes: Array<{ from: string; to: string }>;
  joinRules: {
    entityScoped: boolean;
    coalCarsNeverMatch: boolean;
    detail: string;
  };
  unmatchedRiders: string[];
};

function riderTypeKey(rider: string, carType: string, entity?: string) {
  return entity ? `${rider}|${carType}|${entity}` : `${rider}|${carType}`;
}

/** Map RLMS car.entity → financial sheet entity filter. Coal never matches. */
export function financialSheetForCarEntity(
  entity: string | null | undefined
): "Main" | "RPS" | null {
  if (entity === "Rail Partners Select") return "RPS";
  if (entity === "Main") return "Main";
  // Coal / Main-Coal / unknown → no financial source
  return null;
}

/** Weighted average of per-asset figures across cost-basis batches (§3.4). */
export function averageBatches(batches: FinancialParsedRow[]): {
  nbv: number | null;
  monthly_rent_per_car: number | null;
  monthly_depr_per_car: number | null;
  lease_end_residual_per_car: number | null;
  legal_owner: string | null;
  oec: number | null;
} {
  let w = 0;
  let nbv = 0;
  let rent = 0;
  let depr = 0;
  let rv = 0;
  let oec = 0;
  let hasNbv = false;
  let hasRent = false;
  let hasDepr = false;
  let hasRv = false;
  let hasOec = false;
  let legal_owner: string | null = null;
  for (const b of batches) {
    const cw = Math.max(b.count_cars || 0, 1);
    w += cw;
    if (b.book_value_per_asset != null) {
      nbv += b.book_value_per_asset * cw;
      hasNbv = true;
    }
    if (b.monthly_rent_per_car != null) {
      rent += b.monthly_rent_per_car * cw;
      hasRent = true;
    }
    if (b.monthly_depreciation_per_asset != null) {
      depr += b.monthly_depreciation_per_asset * cw;
      hasDepr = true;
    }
    if (b.lease_end_residual_per_asset != null) {
      rv += b.lease_end_residual_per_asset * cw;
      hasRv = true;
    }
    if (b.net_equipment_cost_per_car != null) {
      oec += b.net_equipment_cost_per_car * cw;
      hasOec = true;
    }
    if (!legal_owner && b.legal_owner) legal_owner = b.legal_owner;
  }
  if (w <= 0) {
    return {
      nbv: null,
      monthly_rent_per_car: null,
      monthly_depr_per_car: null,
      lease_end_residual_per_car: null,
      legal_owner,
      oec: null,
    };
  }
  return {
    nbv: hasNbv ? nbv / w : null,
    monthly_rent_per_car: hasRent ? rent / w : null,
    monthly_depr_per_car: hasDepr ? depr / w : null,
    lease_end_residual_per_car: hasRv ? rv / w : null,
    legal_owner,
    oec: hasOec ? oec / w : null,
  };
}

export function buildFinancialReview(
  mainMatrix: unknown[][],
  rpsMatrix: unknown[][],
  activeCars: ActiveCarForJoin[],
  snapshotMonthOverride?: string | null
): FinancialReview {
  const main = parseAssetSheet("Main", mainMatrix, snapshotMonthOverride);
  const rps = parseAssetSheet("RPS", rpsMatrix, snapshotMonthOverride);
  main.rows = mergeFinancialRowsByUniqueKey(main.rows);
  rps.rows = mergeFinancialRowsByUniqueKey(rps.rows);
  const allRows = [...main.rows, ...rps.rows];
  const flagged = [...main.flagged, ...rps.flagged];
  const snapshotMonth =
    snapshotMonthOverride ||
    main.snapshotMonthFromSheet ||
    rps.snapshotMonthFromSheet ||
    allRows[0]?.snapshot_month ||
    null;

  const qualifyingCarCount = allRows.reduce((s, r) => s + (r.count_cars || 0), 0);

  // Index by rider|asset|sheetEntity — join is entity-scoped.
  // Coal cars never match (Bruce: no Coal financial source).
  const fileByRiderTypeEntity = new Map<string, FinancialParsedRow[]>();
  const assetsByRiderEntity = new Map<string, Set<string>>();
  for (const r of allRows) {
    const k = riderTypeKey(r.rider_id, r.car_type, r.entity);
    const list = fileByRiderTypeEntity.get(k) ?? [];
    list.push(r);
    fileByRiderTypeEntity.set(k, list);
    const rk = `${r.rider_id}|${r.entity}`;
    const set = assetsByRiderEntity.get(rk) ?? new Set();
    set.add(r.car_type);
    assetsByRiderEntity.set(rk, set);
  }

  const activeWithRider = activeCars.filter((c) => c.rider_external_id);
  let carsMatched = 0;
  let carsUnmatched = 0;
  let coalUnmatched = 0;
  let mainRpsUnmatched = 0;
  const matchPathStats: MatchPathStats = {
    alias: 0,
    single_rider_fallback: 0,
    none: 0,
    coalExcluded: 0,
  };
  const sampleMainRps: FinancialReview["carsNoFileMatch"]["sampleMainRps"] = [];
  const matchedFileKeys = new Set<string>();
  const matchedRiderIds = new Set<string>();
  const multiBatchKeys = new Set<string>();

  for (const car of activeWithRider) {
    const rider = String(car.rider_external_id).trim();
    const sheetEnt = financialSheetForCarEntity(car.entity);
    const isCoal = car.entity === "Coal" || car.entity === "Main-Coal";

    if (!sheetEnt || isCoal) {
      carsUnmatched += 1;
      coalUnmatched += 1;
      matchPathStats.none += 1;
      matchPathStats.coalExcluded += 1;
      continue;
    }

    let mapped = carToAssetFamily(car);
    let batches: FinancialParsedRow[] | undefined;
    let usedKey: string | null = null;
    let path: MatchPath = "none";

    for (const asset of candidateAssetFamilies(car)) {
      const k = riderTypeKey(rider, asset, sheetEnt);
      const found = fileByRiderTypeEntity.get(k);
      if (found?.length) {
        batches = found;
        usedKey = k;
        mapped = asset;
        path = "alias";
        break;
      }
    }
    if (!batches?.length) {
      const only = assetsByRiderEntity.get(`${rider}|${sheetEnt}`);
      if (only && only.size === 1) {
        const asset = [...only][0];
        usedKey = riderTypeKey(rider, asset, sheetEnt);
        batches = fileByRiderTypeEntity.get(usedKey);
        mapped = asset;
        path = "single_rider_fallback";
      }
    }

    if (batches && batches.length && usedKey) {
      carsMatched += 1;
      matchedFileKeys.add(usedKey);
      matchedRiderIds.add(rider);
      if (batches.length > 1) multiBatchKeys.add(usedKey);
      if (path === "alias") matchPathStats.alias += 1;
      else matchPathStats.single_rider_fallback += 1;
    } else {
      carsUnmatched += 1;
      matchPathStats.none += 1;
      mainRpsUnmatched += 1;
      if (sampleMainRps.length < 40) {
        sampleMainRps.push({
          id: car.id,
          rider_external_id: car.rider_external_id,
          car_type: car.car_type,
          mapped_asset: mapped,
          entity: car.entity,
        });
      }
    }
  }

  const fileNoCarMatches: FinancialReview["fileNoCarMatches"] = [];
  for (const [k, batches] of fileByRiderTypeEntity) {
    if (matchedFileKeys.has(k)) continue;
    const parts = k.split("|");
    const rider_id = parts[0];
    const car_type = parts[1];
    const entity = parts[2] ?? batches[0]?.entity ?? "Main";
    const count_cars = batches.reduce((s, b) => s + (b.count_cars || 0), 0);
    fileNoCarMatches.push({ rider_id, car_type, entity, count_cars });
  }
  fileNoCarMatches.sort((a, b) => b.count_cars - a.count_cars);

  const fileRiderIds = [...new Set(allRows.map((r) => r.rider_id))];
  const unmatchedRiders = fileRiderIds.filter((id) => !matchedRiderIds.has(id)).sort();

  return {
    snapshotMonth,
    snapshotMonthDetected: !!(main.snapshotMonthFromSheet || rps.snapshotMonthFromSheet || snapshotMonthOverride),
    main,
    rps,
    qualifyingRows: allRows.length,
    qualifyingCarCount,
    flaggedCount: flagged.length,
    flagged,
    skippedNonRail: main.skippedNonRail + rps.skippedNonRail,
    fileNoCarMatches,
    carsNoFileMatch: {
      total: carsUnmatched,
      coal: coalUnmatched,
      mainRps: mainRpsUnmatched,
      sampleMainRps,
    },
    activeCarsInRlms: activeCars.length,
    fileVsActiveDelta: qualifyingCarCount - activeCars.length,
    refreshPreview: {
      carsMatched,
      carsUnmatched,
      multiBatchRiderTypes: multiBatchKeys.size,
    },
    matchPathStats,
    assetFamilyMappingNotes: [
      { from: "mech LO / AAR C* / J*", to: "COV HOPPER (or PD COV HOPPER / OP HOPPERS by description)" },
      { from: "mech T / AAR T*", to: "TANK CARS" },
      { from: "mech GT/GB/GBS/GTS / AAR G*", to: "GONDOLAS" },
      { from: "mech HTS/HT / AAR H*", to: "OP HOPPERS" },
      { from: "mech FBC/FBS/FL / AAR F*", to: "BULKHEAD FLATS / CENTERBEAM / COIL CARS by description" },
      { from: "mech XL / AAR X*|A*", to: "BOXCARS" },
      { from: "GONDOLAS ↔ STEEL GOND", to: "family aliases" },
      { from: "COV HOPPER ↔ PD COV HOPPER ↔ SAND CARS", to: "family aliases" },
      { from: "BULKHEAD FLATS ↔ BULKHEAD F ↔ CENTERBEAM", to: "family aliases" },
      { from: "COIL CARS ↔ COV COIL", to: "family aliases" },
      { from: "Example: C214 + LO + '5250 cf covered hoppers'", to: "COV HOPPER" },
      { from: "Example: T075 + T + stainless tank", to: "TANK CARS" },
      { from: "Example: G719 + GT + Mill Gondola", to: "GONDOLAS" },
    ],
    joinRules: {
      entityScoped: true,
      coalCarsNeverMatch: true,
      detail:
        "Main cars only match Main-sheet rows; RPS cars only match RPS-sheet rows; " +
        "entity=Coal never match (even if Main sheet has COAL GONDOLAS/HOPPERS for the same rider).",
    },
    unmatchedRiders,
  };
}

function roundCents(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.round(v * 100) / 100;
}

function financialUniqKey(r: FinancialParsedRow): string {
  const oec = roundCents(r.net_equipment_cost_per_car);
  return `${r.snapshot_month}|${r.rider_id}|${r.car_type}|${r.entity}|${oec == null ? "" : oec.toFixed(2)}`;
}

function addMoney(a: number | null, b: number | null): number | null {
  if (a == null && b == null) return null;
  return roundCents((a ?? 0) + (b ?? 0));
}

function firstText(a: string | null, b: string | null): string | null {
  const x = String(a ?? "").trim();
  if (x) return a;
  const y = String(b ?? "").trim();
  return y ? b : a ?? b;
}

function earlierIso(a: string | null, b: string | null): string | null {
  if (a && b) return a <= b ? a : b;
  return a ?? b;
}

/** Same grain as rider_financial_summary_uniq — merge source lines that would collide. */
export function mergeFinancialRowsByUniqueKey(rows: FinancialParsedRow[]): FinancialParsedRow[] {
  const order: string[] = [];
  const byKey = new Map<string, FinancialParsedRow>();
  for (const r of rows) {
    const k = financialUniqKey(r);
    const prev = byKey.get(k);
    if (!prev) {
      byKey.set(k, { ...r });
      order.push(k);
      continue;
    }
    const ca = Math.max(prev.count_cars || 0, 0);
    const cb = Math.max(r.count_cars || 0, 0);
    const count = ca + cb;
    const earlierDate = earlierIso(prev.lease_exp_date, r.lease_exp_date);
    const monthsFromEarlierDate =
      earlierDate && earlierDate === prev.lease_exp_date
        ? prev.months_until_lease_exp
        : earlierDate && earlierDate === r.lease_exp_date
          ? r.months_until_lease_exp
          : null;
    const months =
      monthsFromEarlierDate != null
        ? monthsFromEarlierDate
        : prev.months_until_lease_exp != null && r.months_until_lease_exp != null
          ? Math.min(prev.months_until_lease_exp, r.months_until_lease_exp)
          : prev.months_until_lease_exp ?? r.months_until_lease_exp;
    byKey.set(k, {
      ...prev,
      count_cars: count,
      lessee: firstText(prev.lessee, r.lessee),
      former_deal: firstText(prev.former_deal, r.former_deal),
      legal_owner: firstText(prev.legal_owner, r.legal_owner),
      net_equipment_cost_total: addMoney(prev.net_equipment_cost_total, r.net_equipment_cost_total),
      net_equipment_cost_per_car: prev.net_equipment_cost_per_car ?? r.net_equipment_cost_per_car,
      total_book_value: addMoney(prev.total_book_value, r.total_book_value),
      book_value_per_asset:
        count > 0 && addMoney(prev.total_book_value, r.total_book_value) != null
          ? roundCents((addMoney(prev.total_book_value, r.total_book_value) as number) / count)
          : prev.book_value_per_asset ?? r.book_value_per_asset,
      total_monthly_depreciation: addMoney(prev.total_monthly_depreciation, r.total_monthly_depreciation),
      monthly_depreciation_per_asset:
        count > 0 && addMoney(prev.total_monthly_depreciation, r.total_monthly_depreciation) != null
          ? roundCents((addMoney(prev.total_monthly_depreciation, r.total_monthly_depreciation) as number) / count)
          : prev.monthly_depreciation_per_asset ?? r.monthly_depreciation_per_asset,
      monthly_rent_total: addMoney(prev.monthly_rent_total, r.monthly_rent_total),
      monthly_rent_per_car:
        count > 0 && addMoney(prev.monthly_rent_total, r.monthly_rent_total) != null
          ? roundCents((addMoney(prev.monthly_rent_total, r.monthly_rent_total) as number) / count)
          : prev.monthly_rent_per_car ?? r.monthly_rent_per_car,
      lease_end_residual_total: addMoney(prev.lease_end_residual_total, r.lease_end_residual_total),
      lease_end_residual_per_asset:
        count > 0 && addMoney(prev.lease_end_residual_total, r.lease_end_residual_total) != null
          ? roundCents((addMoney(prev.lease_end_residual_total, r.lease_end_residual_total) as number) / count)
          : prev.lease_end_residual_per_asset ?? r.lease_end_residual_per_asset,
      months_until_lease_exp: months,
      lease_exp_date: earlierDate,
      deal_resp: firstText(prev.deal_resp, r.deal_resp),
      lender: firstText(prev.lender, r.lender),
      liability_insurance_exp: earlierIso(prev.liability_insurance_exp, r.liability_insurance_exp),
      property_insurance_exp: earlierIso(prev.property_insurance_exp, r.property_insurance_exp),
      raw_air_rail_power: firstText(prev.raw_air_rail_power, r.raw_air_rail_power),
    });
  }
  return order.map((k) => byKey.get(k)!);
}

export function financialRowToDbPayload(r: FinancialParsedRow): Record<string, unknown> {
  return {
    snapshot_month: r.snapshot_month,
    rider_id: r.rider_id,
    car_type: r.car_type,
    entity: r.entity,
    count_cars: r.count_cars,
    lessee: r.lessee,
    former_deal: r.former_deal,
    legal_owner: r.legal_owner,
    net_equipment_cost_total: r.net_equipment_cost_total,
    net_equipment_cost_per_car: r.net_equipment_cost_per_car,
    total_book_value: r.total_book_value,
    book_value_per_asset: r.book_value_per_asset,
    total_monthly_depreciation: r.total_monthly_depreciation,
    monthly_depreciation_per_asset: r.monthly_depreciation_per_asset,
    monthly_rent_per_car: r.monthly_rent_per_car,
    monthly_rent_total: r.monthly_rent_total,
    lease_end_residual_total: r.lease_end_residual_total,
    lease_end_residual_per_asset: r.lease_end_residual_per_asset,
    months_until_lease_exp: r.months_until_lease_exp,
    deal_resp: r.deal_resp,
    lender: r.lender,
    liability_insurance_exp: r.liability_insurance_exp,
    property_insurance_exp: r.property_insurance_exp,
    raw_air_rail_power: r.raw_air_rail_power,
  };
}

/** Per-car fields the financial refresh is allowed to write. Nothing else on railcars.
 *  Intentionally excludes fleet_status / fleet_status_source — a monthly Asset Report
 *  must never reset a human Idle/Sold pick. */
export const RAILCAR_FINANCIAL_REFRESH_FIELDS = [
  "nbv",
  "oec",
  "monthly_rent_per_car",
  "monthly_depr_per_car",
  "financial_snapshot_month",
] as const;

export function normalizeSnapshotMonth(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const ym = s.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?/);
  if (!ym) return null;
  return `${ym[1]}-${ym[2].padStart(2, "0")}-01`;
}

export type SummaryRowForRefresh = {
  snapshot_month: string;
  rider_id: string;
  car_type: string;
  entity: string;
  count_cars: number;
  book_value_per_asset: number | null;
  monthly_rent_per_car: number | null;
  monthly_depreciation_per_asset: number | null;
  net_equipment_cost_per_car: number | null;
};

export type CarFinancialUpdate = {
  id: number;
  nbv: number | null;
  oec: number | null;
  monthly_rent_per_car: number | null;
  monthly_depr_per_car: number | null;
  financial_snapshot_month: string;
};

function snapshotKey(raw: string): string {
  return normalizeSnapshotMonth(raw) ?? String(raw).slice(0, 10);
}

/**
 * For each active car, take matching Asset Report batches from the latest
 * snapshot_month that has a hit for that rider+type+entity. Never averages
 * across months.
 */
export function buildCarFinancialUpdates(
  cars: ActiveCarForJoin[],
  summaryRows: SummaryRowForRefresh[]
): { updates: CarFinancialUpdate[]; leftBlank: number; coalSkipped: number } {
  const fileByRiderTypeEntity = new Map<string, SummaryRowForRefresh[]>();
  const assetsByRiderEntity = new Map<string, Set<string>>();
  for (const r of summaryRows) {
    const row = { ...r, snapshot_month: snapshotKey(String(r.snapshot_month)) };
    const k = `${row.rider_id}|${row.car_type}|${row.entity}`;
    const list = fileByRiderTypeEntity.get(k) ?? [];
    list.push(row);
    fileByRiderTypeEntity.set(k, list);
    const rk = `${row.rider_id}|${row.entity}`;
    const set = assetsByRiderEntity.get(rk) ?? new Set();
    set.add(row.car_type);
    assetsByRiderEntity.set(rk, set);
  }

  const updates: CarFinancialUpdate[] = [];
  let leftBlank = 0;
  let coalSkipped = 0;

  for (const car of cars) {
    const rider = String(car.rider_external_id ?? "").trim();
    const sheetEnt = financialSheetForCarEntity(car.entity);
    if (!rider || !sheetEnt) {
      if (!sheetEnt) coalSkipped += 1;
      leftBlank += 1;
      continue;
    }

    // Collect hits per asset family, then use the first family (candidate order)
    // that has the latest snapshot_month. Never average across months, and never
    // mix two families from the same month.
    const familyHits: SummaryRowForRefresh[][] = [];
    for (const asset of candidateAssetFamilies(car)) {
      const found = fileByRiderTypeEntity.get(`${rider}|${asset}|${sheetEnt}`);
      if (found?.length) familyHits.push(found);
    }
    if (!familyHits.length) {
      const only = assetsByRiderEntity.get(`${rider}|${sheetEnt}`);
      if (only && only.size === 1) {
        const found = fileByRiderTypeEntity.get(`${rider}|${[...only][0]}|${sheetEnt}`);
        if (found?.length) familyHits.push(found);
      }
    }
    if (!familyHits.length) {
      leftBlank += 1;
      continue;
    }
    const latest = familyHits
      .flatMap((rows) => rows.map((b) => b.snapshot_month))
      .sort()
      .at(-1)!;
    const chosen = familyHits.find((rows) => rows.some((b) => b.snapshot_month === latest))!;
    const latestBatches = chosen.filter((b) => b.snapshot_month === latest);
    const avg = averageBatches(latestBatches as FinancialParsedRow[]);
    updates.push({
      id: car.id,
      nbv: roundMoney(avg.nbv),
      oec: roundMoney(avg.oec),
      monthly_rent_per_car: roundMoney(avg.monthly_rent_per_car),
      monthly_depr_per_car: roundMoney(avg.monthly_depr_per_car),
      financial_snapshot_month: latest,
    });
  }

  return { updates, leftBlank, coalSkipped };
}

function roundMoney(v: number | null): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.round(v * 100) / 100;
}

export function carFinancialFingerprint(u: {
  nbv: number | null;
  oec: number | null;
  monthly_rent_per_car: number | null;
  monthly_depr_per_car: number | null;
  financial_snapshot_month?: string | null;
}): string {
  const n = (v: number | null | undefined) => {
    const r = roundMoney(v ?? null);
    return r == null ? "" : String(r);
  };
  return [
    n(u.nbv),
    n(u.oec),
    n(u.monthly_rent_per_car),
    n(u.monthly_depr_per_car),
    snapshotKey(String(u.financial_snapshot_month ?? "")),
  ].join("|");
}
