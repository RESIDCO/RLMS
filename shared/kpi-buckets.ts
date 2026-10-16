export const KPI_BUCKETS = [
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
] as const;

export type KpiBucket = (typeof KPI_BUCKETS)[number];

export const KPI_TITLES: Record<string, string> = {
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
