/** Bid file categories. Lease Management keeps using doc_class; do not reuse it here. */

export const OPP_DOC_CATEGORIES = [
  { value: "bid_sheet", label: "Bid sheet / Car list" },
  { value: "drawings", label: "Drawings / Specs" },
  { value: "inspection", label: "Inspection report" },
  { value: "correspondence", label: "Correspondence" },
  { value: "pricing", label: "Pricing / Model" },
  { value: "legal", label: "Legal / Contract" },
  { value: "other", label: "Other" },
] as const;

export type OppDocCategory = (typeof OPP_DOC_CATEGORIES)[number]["value"];

export const OPP_DOC_CATEGORY_LABEL: Record<OppDocCategory, string> = {
  bid_sheet: "Bid sheet / Car list",
  drawings: "Drawings / Specs",
  inspection: "Inspection report",
  correspondence: "Correspondence",
  pricing: "Pricing / Model",
  legal: "Legal / Contract",
  other: "Other",
};

const CATEGORY_VALUES = new Set<string>(OPP_DOC_CATEGORIES.map((row) => row.value));

export function isOppDocCategory(value: unknown): value is OppDocCategory {
  return typeof value === "string" && CATEGORY_VALUES.has(value);
}

export function oppDocCategoryLabel(value: string | null | undefined): string {
  return isOppDocCategory(value) ? OPP_DOC_CATEGORY_LABEL[value] : OPP_DOC_CATEGORY_LABEL.other;
}

/** Pre-select a category from the file name. The user can still change it. */
export function suggestCategory(fileName: string): OppDocCategory {
  const name = fileName.trim().toLowerCase();
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot) : "";
  if (ext === ".msg" || ext === ".eml") return "correspondence";
  if (ext === ".xlsx" || ext === ".xls" || ext === ".csv") return "pricing";
  return "other";
}

export function attachmentDownloadHeaders(
  fileName: string,
  fallbackType: string,
): { contentType: string; disposition: "inline" | "attachment" } {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) {
    return { contentType: "application/pdf", disposition: "inline" };
  }
  if (lower.endsWith(".msg")) {
    return { contentType: "application/vnd.ms-outlook", disposition: "attachment" };
  }
  if (lower.endsWith(".eml")) {
    return { contentType: "message/rfc822", disposition: "attachment" };
  }
  return {
    contentType: fallbackType || "application/octet-stream",
    disposition: "attachment",
  };
}

export type BidFileRef = {
  doc_category?: string | null;
  opportunity_line_id?: number | null;
};

export function bidFileCategory(row: BidFileRef): OppDocCategory {
  return isOppDocCategory(row.doc_category) ? row.doc_category : "other";
}

export function filterBidFiles<T extends BidFileRef>(
  rows: T[],
  opts: { category: "all" | OppDocCategory; line: "all" | "none" | number },
): T[] {
  return rows.filter((row) => {
    if (opts.line === "none" && row.opportunity_line_id != null) return false;
    if (typeof opts.line === "number" && row.opportunity_line_id !== opts.line) return false;
    if (opts.category !== "all" && bidFileCategory(row) !== opts.category) return false;
    return true;
  });
}

export function bidFileCategoryCounts<T extends BidFileRef>(rows: T[]): Record<OppDocCategory, number> {
  const counts: Record<OppDocCategory, number> = {
    bid_sheet: 0,
    drawings: 0,
    inspection: 0,
    correspondence: 0,
    pricing: 0,
    legal: 0,
    other: 0,
  };
  for (const row of rows) counts[bidFileCategory(row)] += 1;
  return counts;
}

/** `7 – ACME`. The Files tab adds "(removed)" itself when the line is soft-deleted. */
export function opportunityFileLineLabel(sellerDealRef: string, lesseeDesc: string | null | undefined): string {
  const seller = sellerDealRef.trim();
  const lessee = (lesseeDesc ?? "").trim();
  const parts = [seller, lessee].filter(Boolean);
  return parts.join(" – ") || "Deal";
}
