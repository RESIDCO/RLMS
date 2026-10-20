import { columnMinWidth, headerMinWidth, WRAP_TEXT_KEYS, type GridColSpec } from "@/lib/grid-column-layout";

function col(key: string, label: string, defaultWidth: number, extra?: { pinned?: boolean }): GridColSpec {
  const minWidth = headerMinWidth(label);
  return {
    key,
    label,
    defaultWidth: Math.max(defaultWidth, minWidth),
    minWidth,
    wrap: WRAP_TEXT_KEYS.has(key),
    pinned: extra?.pinned,
  };
}

export const BID_LINE_PRICE_KEYS = ["prelim_price_per_car", "final_price_per_car", "market_price_per_car"] as const;

/** Seller / evaluating lines. Price keys stay in the spec so a viewer session does not drop them from storage. */
export const BID_LINE_COLUMNS: GridColSpec[] = [
  col("seller_deal_ref", "Deal #", 96),
  col("lessee_desc", "Lessee", 240),
  col("lessee_rating", "Rating", 150),
  col("lessee_country", "Country", 110),
  col("aar_code", "AAR", 88),
  col("car_type", "Car type", 120),
  col("equipment_desc", "Equipment", 240),
  col("car_count", "Cars", 84),
  col("avg_build_year", "Avg build", 110),
  col("commodity", "Commodity", 180),
  col("lease_rate", "Lease rate", 120),
  col("lease_expiry", "Expiry", 128),
  col("purchase_option", "Purchase option", 160),
  col("include_in_bid", "Bid?", 80),
  col("exclude_reason", "Exclude reason", 160),
  col("prelim_price_per_car", "Prelim $/car", 130),
  col("final_price_per_car", "Final $/car", 124),
  col("outcome", "Outcome", 120),
  col("market_price_per_car", "Winning $/car", 140),
  col("loss_reason", "Loss reason", 150),
  col("notes", "Notes", 240),
  col("_total", "Total", 120, { pinned: true }),
  col("_calc", "Calc", 140, { pinned: true }),
  col("_actions", "Actions", 168, { pinned: true }),
];

export const BID_IMPORT_COLUMNS: GridColSpec[] = [
  col("seller_deal_ref", "Deal", 96),
  col("lessee_desc", "Lessee", 240),
  col("lessee_rating", "Rating", 150),
  col("lessee_country", "Country", 110),
  col("car_count", "Cars", 84),
  col("equipment_desc", "Equipment", 240),
  col("car_type", "Car type", 120),
  col("aar_code", "AAR", 88),
  col("avg_build_year", "Build year", 120),
  col("commodity", "Commodity", 180),
  col("lease_rate", "Lease rate", 120),
  col("lease_expiry", "Expiry", 128),
  col("purchase_option", "Purchase option", 160),
  col("notes", "Notes", 240),
];

export function bidLineMinWidths(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const spec of BID_LINE_COLUMNS) out[spec.key] = columnMinWidth(spec);
  return out;
}
