/** Agent-contact deduction + company-name cleaning for directory dedup (rev 6). */

export const GENERIC_LEGAL_WORDS = [
  "incorporated",
  "corporation",
  "company",
  "limited",
  "the",
  "inc",
  "llc",
  "llp",
  "corp",
  "ltd",
  "lp",
  "plc",
  "sa",
  "co",
] as const;

export const AGENT_DOMAIN_NAMES: Record<string, string> = {
  alltranstek: "Alltranstek",
  rasdataservices: "RAS Data Services",
  qts: "QTS",
  gafg: "GATX Financial",
  southernco: "Southern Company",
  wecenergygroup: "WEC Energy Group",
  trin: "TrinityRail",
  riotinto: "Rio Tinto",
  dukeenergy: "Duke Energy",
  midwestrailcar: "Midwest Railcar",
};

const TLDS = new Set([
  "com", "org", "net", "edu", "gov", "co", "ca", "mx", "uk", "us", "io", "biz", "info",
]);

export function cleanCompanyName(name: string): string {
  let s = String(name || "").toLowerCase();
  s = s.replace(/&/g, " and ");
  s = s.replace(/[^a-z0-9]+/g, " ");
  const parts = s.split(/\s+/).filter(Boolean).filter((w) => !(GENERIC_LEGAL_WORDS as readonly string[]).includes(w));
  return parts.join("");
}

export function emailDomainRoot(email: string): string | null {
  const at = String(email || "").trim().toLowerCase().split("@")[1];
  if (!at) return null;
  const labels = at.split(".").filter(Boolean);
  const kept = labels.filter((l) => !TLDS.has(l));
  const root = (kept.length ? kept : labels).join("").replace(/-/g, "");
  return root || null;
}

export function orgNameFromDomain(email: string): string {
  const at = String(email || "").trim().toLowerCase().split("@")[1] || "";
  const host = at.replace(/^www\./, "");
  const labels = host.split(".").filter((l) => l && !TLDS.has(l));
  const key = labels.join("").replace(/-/g, "");
  if (AGENT_DOMAIN_NAMES[key]) return AGENT_DOMAIN_NAMES[key];
  const primary = labels[0] || host.split(".")[0] || "Unknown";
  if (AGENT_DOMAIN_NAMES[primary.replace(/-/g, "")]) return AGENT_DOMAIN_NAMES[primary.replace(/-/g, "")];
  return primary
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** pg_trgm-like dice on 3-grams (good enough for the 0.35 / 0.3 gates). */
export function trigramSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const grams = (s: string) => {
    const padded = `  ${s} `;
    const set = new Set<string>();
    for (let i = 0; i <= padded.length - 3; i++) set.add(padded.slice(i, i + 3));
    return set;
  };
  const A = grams(a);
  const B = grams(b);
  let inter = 0;
  A.forEach((g) => {
    if (B.has(g)) inter += 1;
  });
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function nameDomainMatch(domainRoot: string, nameClean: string, threshold = 0.35): boolean {
  if (!domainRoot || !nameClean) return false;
  if (domainRoot.includes(nameClean) || nameClean.includes(domainRoot)) return true;
  return trigramSimilarity(domainRoot, nameClean) > threshold;
}

export type SharedAppearance = {
  contactId: number;
  companyId: number;
  companyName: string;
};

export type AgentClassifyResult =
  | {
      outcome: "single_home";
      homeCompanyId: number;
      homeCompanyName: string;
      orgName: string;
      tagContactIds: number[];
      leaveContactIds: number[];
    }
  | {
      outcome: "zero_home";
      homeCompanyId: null;
      orgName: string;
      tagContactIds: number[];
      leaveContactIds: number[];
    }
  | {
      outcome: "ambiguous";
      matchingCompanyIds: number[];
      orgName: string;
      tagContactIds: number[];
      leaveContactIds: number[];
    };

export function classifySharedEmail(email: string, appearances: SharedAppearance[]): AgentClassifyResult | null {
  const companies = new Map<number, string>();
  for (const a of appearances) companies.set(a.companyId, a.companyName);
  if (companies.size <= 1) return null;

  const domainRoot = emailDomainRoot(email);
  const orgName = orgNameFromDomain(email);
  if (!domainRoot) {
    return { outcome: "ambiguous", matchingCompanyIds: Array.from(companies.keys()), orgName, tagContactIds: [], leaveContactIds: appearances.map((a) => a.contactId) };
  }

  const matches: number[] = [];
  companies.forEach((name, id) => {
    if (nameDomainMatch(domainRoot, cleanCompanyName(name))) matches.push(id);
  });

  if (matches.length === 1) {
    const homeCompanyId = matches[0];
    const homeCompanyName = companies.get(homeCompanyId)!;
    return {
      outcome: "single_home",
      homeCompanyId,
      homeCompanyName,
      orgName: homeCompanyName,
      tagContactIds: appearances.filter((a) => a.companyId !== homeCompanyId).map((a) => a.contactId),
      leaveContactIds: appearances.filter((a) => a.companyId === homeCompanyId).map((a) => a.contactId),
    };
  }
  if (matches.length === 0) {
    return {
      outcome: "zero_home",
      homeCompanyId: null,
      orgName,
      tagContactIds: appearances.map((a) => a.contactId),
      leaveContactIds: [],
    };
  }
  return {
    outcome: "ambiguous",
    matchingCompanyIds: matches,
    orgName,
    tagContactIds: [],
    leaveContactIds: appearances.map((a) => a.contactId),
  };
}

export function marksOverlap(a: string[] | null | undefined, b: string[] | null | undefined): boolean {
  const A = new Set((a ?? []).map((m) => String(m).toUpperCase()).filter(Boolean));
  const B = new Set((b ?? []).map((m) => String(m).toUpperCase()).filter(Boolean));
  if (!A.size || !B.size) return false;
  for (const m of Array.from(A)) if (B.has(m)) return true;
  return false;
}

export function marksIdentical(a: string[] | null | undefined, b: string[] | null | undefined): boolean {
  const norm = (x: string[] | null | undefined) =>
    Array.from(new Set((x ?? []).map((m) => String(m).toUpperCase()).filter(Boolean))).sort();
  const A = norm(a);
  const B = norm(b);
  if (A.length !== B.length) return false;
  return A.every((v, i) => v === B[i]);
}

export function classifyCompanyPair(opts: {
  nameA: string;
  nameB: string;
  marksA: string[] | null;
  marksB: string[] | null;
}): { kind: "company_duplicate" | "company_family" | null; sim: number } {
  const sim = trigramSimilarity(cleanCompanyName(opts.nameA), cleanCompanyName(opts.nameB));
  if (sim <= 0.5) return { kind: null, sim };
  const emptyA = !(opts.marksA && opts.marksA.length);
  const emptyB = !(opts.marksB && opts.marksB.length);
  const distinctBoth =
    !emptyA && !emptyB && !marksIdentical(opts.marksA, opts.marksB) && !marksOverlap(opts.marksA, opts.marksB);
  if (sim > 0.85 && (marksIdentical(opts.marksA, opts.marksB) || emptyA || emptyB)) {
    return { kind: "company_duplicate", sim };
  }
  if (distinctBoth) return { kind: "company_family", sim };
  return { kind: null, sim };
}
