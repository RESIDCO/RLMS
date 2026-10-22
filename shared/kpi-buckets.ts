export const KPI_BUCKETS = [
  "op",
  "off_rent",
  "idle",
  "unassigned",
  "on_rent",
  "idle_on_ol",
  "awaiting_rent_start",
  "shop_conflict",
  "future_rent_start",
  "no_link",
  "mtm",
  "going_on_lease",
  "sold_needs_tag",
  "sale_unclear",
  "sold_tag_suspect",
  "sold_missing_buyer",
  "leased_off_rent",
  "rental_abatement",
  "unbucketed",
] as const;

export type KpiBucket = (typeof KPI_BUCKETS)[number];

export const KPI_TITLES: Record<string, string> = {
  op: "Total Fleet",
  off_rent: "Off Rent",
  idle: "Idle (committed)",
  unassigned: "Unassigned / Available for Opportunities",
  on_rent: "Active Cars (on rent)",
  idle_on_ol: "Idle on OL — under review",
  awaiting_rent_start: "Awaiting rent start",
  shop_conflict: "Shop conflict",
  future_rent_start: "Future rent starts",
  no_link: "No lease link",
  mtm: "Month to Month",
  going_on_lease: "Going On Lease",
  sold_needs_tag: "Sold – needs tag",
  sale_unclear: "Sale unclear",
  sold_tag_suspect: "Sold tag suspect",
  sold_missing_buyer: "Sold with blank buyer",
  leased_off_rent: "Tagged Leased but off rent",
  rental_abatement: "Rental abatement",
  unbucketed: "Unbucketed cars",
};

/** Idle (committed) counts off-rent cars in any of these four states. */
export const IDLE_COMMITTED_SUBTITLE =
  "Off rent with an open Commitment, an open program, a Going on lease label, or awaiting rent start.";

/** KPI car list source. Unbucketed reads its own view so other buckets stay on v_rlms_kpi_car_rows. */
export const KPI_CAR_ROWS_VIEW = "v_rlms_kpi_car_rows";
export const UNBUCKETED_CARS_VIEW = "v_rlms_unbucketed_cars";

export function kpiCarRowsSource(bucket: string): string {
  return bucket === "unbucketed" ? UNBUCKETED_CARS_VIEW : KPI_CAR_ROWS_VIEW;
}

export function showUnbucketedWarning(count: number | null | undefined): boolean {
  return typeof count === "number" && Number.isFinite(count) && count > 0;
}

export function unbucketedWarningLabel(count: number): string {
  return `Unbucketed cars: ${count.toLocaleString("en-US")}`;
}

export const KPI_SORT_COLS = [
  "car",
  "entity",
  "status_tag",
  "derived_status",
  "current_lease",
  "lessee",
  "legal_owner",
  "buyer",
  "commitment",
  "rent_start_date",
  "last_ol",
  "reason",
] as const;

/** Same order/widths on every KPI list. Long text truncates; car stays one line. */
export const KPI_COL_LAYOUT: Record<(typeof KPI_SORT_COLS)[number], { minWidth: string; truncate?: boolean }> = {
  car: { minWidth: "9.5rem" },
  entity: { minWidth: "5.5rem" },
  status_tag: { minWidth: "4.5rem" },
  derived_status: { minWidth: "5.5rem" },
  current_lease: { minWidth: "8rem", truncate: true },
  lessee: { minWidth: "9rem", truncate: true },
  legal_owner: { minWidth: "7rem" },
  buyer: { minWidth: "6rem" },
  commitment: { minWidth: "10rem", truncate: true },
  rent_start_date: { minWidth: "6.5rem" },
  last_ol: { minWidth: "5.5rem" },
  reason: { minWidth: "8rem" },
};

export const KPI_GROUP_COLS = ["current_lease", "lessee", "entity", "reason"] as const;

export const KPI_PRIMARY_ORDER: KpiBucket[] = [
  "sold_needs_tag",
  "sale_unclear",
  "sold_tag_suspect",
  "sold_missing_buyer",
  "leased_off_rent",
  "rental_abatement",
  "on_rent",
  "awaiting_rent_start",
  "idle_on_ol",
  "shop_conflict",
  "future_rent_start",
  "idle",
  "unassigned",
  "off_rent",
  "no_link",
  "mtm",
  "going_on_lease",
];

export type KpiFlagRow = {
  active?: boolean | null;
  is_sold?: boolean | null;
  is_op?: boolean | null;
  off_rent?: boolean | null;
  on_ol?: boolean | null;
  on_rent?: boolean | null;
  awaiting_rent_start?: boolean | null;
  shop_conflict?: boolean | null;
  future_rent_start?: boolean | null;
  no_assignment?: boolean | null;
  has_open_commitment?: boolean | null;
  in_open_program?: boolean | null;
  going_on_lease?: boolean | null;
  sold_needs_tag?: boolean | null;
  sale_unclear?: boolean | null;
  sold_tag_suspect?: boolean | null;
  sold_missing_buyer?: boolean | null;
  status_tag?: string | null;
  lease_status?: string | null;
  open_abatement?: boolean | null;
};

/**
 * Same three-valued OR as rlms_fleet_kpis_core:
 * true if any flag is true, false only when every flag is false, otherwise null.
 */
export function idleCommitmentSeed(r: KpiFlagRow): boolean | null {
  const parts = [r.has_open_commitment, r.in_open_program, r.going_on_lease, r.awaiting_rent_start];
  if (parts.some((p) => p === true)) return true;
  if (parts.every((p) => p === false)) return false;
  return null;
}

export type OperatingBucketMembership = {
  onRent: boolean;
  abatement: boolean;
  idle: boolean;
  unassigned: boolean;
};

/** Partition of an operating car across the four dashboard buckets. Flags must be exactly true or false. */
export function operatingBucketMembership(r: KpiFlagRow): OperatingBucketMembership {
  const op = r.is_op === true;
  const off = r.off_rent === true;
  const notOff = r.off_rent === false;
  const abate = r.open_abatement === true;
  const notAbate = r.open_abatement === false;
  const seed = idleCommitmentSeed(r);
  return {
    onRent: op && notOff && notAbate,
    abatement: op && abate,
    idle: op && off && seed === true,
    unassigned: op && off && seed === false,
  };
}

/**
 * Operating car in none of on rent, abatement, idle, or unassigned,
 * or in more than one of the three non-revenue buckets.
 */
export function isUnbucketedOperatingCar(r: KpiFlagRow): boolean {
  if (r.is_op !== true) return false;
  const m = operatingBucketMembership(r);
  const nonRevenue = [m.abatement, m.idle, m.unassigned].filter(Boolean).length;
  const covered = [m.onRent, m.abatement, m.idle, m.unassigned].filter(Boolean).length;
  return covered === 0 || nonRevenue > 1;
}

export function kpiBucketsForRow(r: KpiFlagRow): KpiBucket[] {
  if (r.active !== true) return [];
  const out: KpiBucket[] = [];
  const idleSeed =
    Boolean(r.has_open_commitment) ||
    Boolean(r.in_open_program) ||
    Boolean(r.going_on_lease) ||
    Boolean(r.awaiting_rent_start);
  if (r.is_op) out.push("op");
  if (r.is_op && r.off_rent) out.push("off_rent");
  if (r.is_op && r.off_rent && idleSeed) out.push("idle");
  if (r.is_op && r.off_rent && !idleSeed) out.push("unassigned");
  if (r.is_op && !r.off_rent && !r.open_abatement) out.push("on_rent");
  if (r.is_op && r.open_abatement && !r.is_sold) out.push("rental_abatement");
  if (r.is_op && r.status_tag === "Idle" && r.on_ol) out.push("idle_on_ol");
  if (r.is_op && r.awaiting_rent_start) out.push("awaiting_rent_start");
  if (r.is_op && r.off_rent && r.status_tag === "Leased") out.push("leased_off_rent");
  if (r.is_op && r.shop_conflict) out.push("shop_conflict");
  if (r.is_op && r.future_rent_start) out.push("future_rent_start");
  if (r.is_op && r.no_assignment) out.push("no_link");
  if (r.is_op && /MTM|month\s*to\s*month/i.test(String(r.lease_status ?? ""))) out.push("mtm");
  if (r.is_op && r.going_on_lease) out.push("going_on_lease");
  if (r.sold_needs_tag) out.push("sold_needs_tag");
  if (r.sale_unclear) out.push("sale_unclear");
  if (r.sold_tag_suspect) out.push("sold_tag_suspect");
  if (r.sold_missing_buyer) out.push("sold_missing_buyer");
  if (isUnbucketedOperatingCar(r)) out.push("unbucketed");
  return out;
}

export function primaryKpiBucket(buckets: KpiBucket[], preferred?: string | null): KpiBucket | null {
  if (preferred && (buckets as string[]).includes(preferred)) return preferred as KpiBucket;
  return KPI_PRIMARY_ORDER.find((b) => buckets.includes(b)) ?? buckets[0] ?? null;
}

export function kpiBucketTitle(bucket: string | null | undefined): string {
  if (!bucket) return "—";
  return KPI_TITLES[bucket] ?? bucket;
}
