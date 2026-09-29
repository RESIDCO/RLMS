/** Pure helpers for directory vs leftover rider_contacts. */

import { cleanCompanyName } from "./agent-contact-dedup";

export function riderContactDedupeKey(email: string | null | undefined, name: string): string {
  return `${String(email ?? "").trim().toLowerCase()}|${String(name ?? "").trim().toLowerCase()}`;
}

export function leftoverLegacyContacts<T extends { email?: string | null; name: string }>(
  directory: T[],
  legacy: T[],
): T[] {
  const seen = new Set(directory.map((d) => riderContactDedupeKey(d.email, d.name)));
  return legacy.filter((c) => !seen.has(riderContactDedupeKey(c.email, c.name)));
}

export function companyNameForRider(opts: {
  companyName?: string | null;
  lessee?: string | null;
  riderName?: string | null;
}): string {
  const n = [opts.companyName, opts.lessee, opts.riderName].map((s) => String(s ?? "").trim()).find(Boolean);
  return n || "Unnamed company";
}

/** Strip sold-to "x" prefix, parentheticals like (xTrinity), then legal suffixes. */
export function directoryCleanName(raw: string): string {
  return cleanCompanyName(
    String(raw ?? "")
      .replace(/\([^)]*\)/g, " ")
      .trim()
      .replace(/^x+/i, ""),
  );
}

const PLACEHOLDER_LESSEE_KEYS = new Set([
  "available",
  "availableequipment",
  "idle",
  "na",
  "n",
  "none",
  "tbd",
  "unknown",
  "vacant",
  "open",
]);

export function isPlaceholderLessee(raw: string): boolean {
  const key = directoryCleanName(raw);
  return !key || PLACEHOLDER_LESSEE_KEYS.has(key);
}

export function pickUniqueCompanyByCleanName<T extends { name: string }>(
  needle: string,
  companies: T[],
): T | null {
  const key = directoryCleanName(needle);
  if (!key) return null;
  const hits = companies.filter((c) => directoryCleanName(c.name) === key);
  return hits.length === 1 ? hits[0] : null;
}

/** Unique longest prefix/contains match (min 6 cleaned chars). Skips leasing companies unless the needle also looks like a lessor/lessee lease brand. */
export function pickUniqueCompanyByPrefix<T extends { name: string }>(
  needle: string,
  companies: T[],
): T | null {
  const key = directoryCleanName(needle);
  if (key.length < 6) return null;
  const hits = companies.filter((c) => {
    const ck = directoryCleanName(c.name);
    if (!ck || ck === key) return false;
    if (ck.includes("leas") && !key.includes("leas")) return false;
    const shorter = key.length <= ck.length ? key : ck;
    const longer = key.length <= ck.length ? ck : key;
    if (shorter.length < 6) return false;
    return longer.startsWith(shorter);
  });
  if (!hits.length) return null;
  const maxLen = Math.max(...hits.map((c) => directoryCleanName(c.name).length));
  const atMax = hits.filter((c) => directoryCleanName(c.name).length === maxLen);
  return atMax.length === 1 ? atMax[0] : null;
}

/** Unique company whose cleaned name starts with the full lessee token (min 4 chars). GEON → Geon Performance; Ineos with many affiliates stays unmatched. */
export function pickUniqueCompanyStartingWith<T extends { name: string }>(
  needle: string,
  companies: T[],
): T | null {
  const key = directoryCleanName(needle);
  if (key.length < 4) return null;
  const hits = companies.filter((c) => {
    const ck = directoryCleanName(c.name);
    if (!ck) return false;
    if (ck.includes("leas") && !key.includes("leas")) return false;
    return ck.startsWith(key);
  });
  return hits.length === 1 ? hits[0] : null;
}

/** Conservative unique pick only — never creates a company, never picks when 2+ names fit. */
export function pickUniqueCompanyForLessee<T extends { name: string }>(needle: string, companies: T[]): T | null {
  if (isPlaceholderLessee(needle)) return null;
  return (
    pickUniqueCompanyByCleanName(needle, companies) ??
    pickUniqueCompanyByPrefix(needle, companies) ??
    pickUniqueCompanyStartingWith(needle, companies)
  );
}

/** Optional lessee contact on New Lease Setup — omit when name is blank. */
export function wizardRiderContactBody(r: {
  contact_name: string;
  contact_title: string;
  contact_email: string;
  contact_phone: string;
}): { name: string; title: string | null; email: string | null; phone: string | null } | undefined {
  const name = String(r.contact_name ?? "").trim();
  if (!name) return undefined;
  return {
    name,
    title: String(r.contact_title ?? "").trim() || null,
    email: String(r.contact_email ?? "").trim() || null,
    phone: String(r.contact_phone ?? "").trim() || null,
  };
}
