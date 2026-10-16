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
};

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

export const KPI_GROUP_COLS = ["current_lease", "lessee", "entity", "reason"] as const;

export const KPI_PRIMARY_ORDER: KpiBucket[] = [
  "sold_needs_tag",
  "sale_unclear",
  "sold_tag_suspect",
  "sold_missing_buyer",
  "leased_off_rent",
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
};

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
  if (r.is_op && !r.off_rent) out.push("on_rent");
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
