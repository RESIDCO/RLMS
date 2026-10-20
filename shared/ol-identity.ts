/** Compact OL / rider labels so "ol2021" and "OL 2021" match "OL2021". */
export function compactOlKey(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function isSoldOl(raw: unknown): boolean {
  return compactOlKey(raw) === "sold";
}

export const AD_HOC_LEASE_NUMBER = "AD-HOC-OL";

export function isAdHocLeaseNumber(raw: unknown): boolean {
  return String(raw ?? "").trim().toUpperCase() === AD_HOC_LEASE_NUMBER;
}

export function findRiderByOlLabel<T extends { rider_name?: string | null; schedule_number?: string | null }>(
  riders: T[],
  label: string,
): T | undefined {
  const key = compactOlKey(label);
  if (!key) return undefined;
  const matches = riders.filter(
    (r) => compactOlKey(r.rider_name) === key || compactOlKey(r.schedule_number) === key,
  );
  if (!matches.length) return undefined;
  const exact = matches.find(
    (r) => String(r.rider_name ?? "").trim().toUpperCase() === String(label ?? "").trim().toUpperCase(),
  );
  return exact ?? matches[0];
}

export function assignmentLabelFromOl(
  lessee: string | null | undefined,
  ol: string | null | undefined,
): string | null {
  const l = String(lessee ?? "").trim();
  const o = String(ol ?? "").trim();
  if (!l && !o) return null;
  if (!l) return o;
  if (!o) return l;
  return `${l} - ${o}`;
}

export function canonicalLesseeFromOl(opts: {
  isSold: boolean;
  isAdHoc: boolean;
  masterLessee: string | null | undefined;
  carLesseeCounts: Array<{ lessee: string; n: number }>;
}): { lessee: string | null; source: "master_lease" | "cars" | null } {
  if (opts.isSold || opts.isAdHoc) return { lessee: null, source: null };
  const mla = String(opts.masterLessee ?? "").trim();
  if (mla) return { lessee: mla, source: "master_lease" };
  const top = [...opts.carLesseeCounts]
    .filter((row) => String(row.lessee ?? "").trim())
    .sort((a, b) => b.n - a.n || a.lessee.localeCompare(b.lessee))[0];
  const lessee = top ? String(top.lessee).trim() : null;
  return lessee ? { lessee, source: "cars" } : { lessee: null, source: null };
}

export type OlIdentity = {
  rider_id: number;
  rider_name: string;
  schedule_number: string | null;
  is_sold: boolean;
  is_adhoc: boolean;
  canonical_lessee: string | null;
  lessee_source: "master_lease" | "cars" | null;
  master_lease_number: string | null;
  lease_type: string | null;
  expiration_date: string | null;
  lease_status: string | null;
  account_manager: string | null;
  owner_entity: string | null;
  /** Lease-level fleet entity. Null skips the car-entity mismatch warning. */
  entity: string | null;
  sold_to: string | null;
  suggested_lessee: string | null;
};
