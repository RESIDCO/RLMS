/**
 * MARK Contacts workbook → companies + company_contacts (preview / commit).
 * Does not write accounts, riders, railcars, or rider_contacts.
 */

const STOP_WORDS = new Set(["inc", "llc", "corp", "corporation", "co", "company", "ltd", "the"]);

export const MARK_CONTACTS_SOURCE = "import_mark_contacts";

const CUSTOM_FIELD_MAP: Array<{ aliases: string[]; key: string }> = [
  { aliases: ["Source"], key: "record_source" },
  { aliases: ["Source.1", "Source 1"], key: "record_source_1" },
  { aliases: ["Source 2", "Source.2"], key: "record_source_2" },
  { aliases: ["Phone Ext"], key: "phone_ext" },
  { aliases: ["Alt Phone Ext"], key: "alt_phone_ext" },
  { aliases: ["Home Phone"], key: "home_phone" },
  { aliases: ["Fax"], key: "fax" },
  { aliases: ["Web Site", "Website"], key: "web_site" },
  { aliases: ["E MAIL 2 ADDRESS", "Email 2", "Email2"], key: "email_2" },
  { aliases: ["Branch Area"], key: "branch_area" },
  { aliases: ["Rail Primary"], key: "rail_primary" },
  { aliases: ["Rail Secondary"], key: "rail_secondary" },
  { aliases: ["Rail Third"], key: "rail_third" },
  { aliases: ["Asset Type"], key: "asset_type" },
  { aliases: ["Commodities"], key: "commodities" },
  { aliases: ["Locomotive"], key: "locomotive" },
  { aliases: ["ID/Status", "ID Status"], key: "id_status" },
  { aliases: ["Misc"], key: "misc" },
  { aliases: ["Spouse"], key: "spouse" },
  { aliases: ["Interests"], key: "interests" },
];

export function normalizeCompanyName(name: string): string {
  let s = String(name || "").toLowerCase().trim();
  s = s.replace(/[^a-z0-9 ]+/g, " ");
  s = s
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w))
    .join(" ");
  return s.replace(/\s+/g, " ").trim();
}

/** Split-decision only: keep legal-suffix words so Inc vs Ltd vs no-suffix stay distinct. */
export function normalizeCompanyNameLight(name: string): string {
  return String(name || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isSuffixOnlyDifference(lightA: string, lightB: string): boolean {
  if (lightA === lightB) return false;
  const [lo, hi] = lightA.length <= lightB.length ? [lightA, lightB] : [lightB, lightA];
  if (!hi.startsWith(lo + " ")) return false;
  const rest = hi.slice(lo.length).trim();
  return rest.split(/\s+/).every((w) => STOP_WORDS.has(w));
}

export function splitReportingMarks(raw: unknown): string[] {
  const s = String(raw ?? "").trim();
  if (!s) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of s.split(/[,;\s]+/)) {
    const m = part.trim().toUpperCase();
    if (!m || seen.has(m)) continue;
    seen.add(m);
    out.push(m);
  }
  return out;
}

function headerKey(h: string): string {
  return String(h || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function cell(row: Record<string, unknown>, ...aliases: string[]): string {
  const map = new Map<string, unknown>();
  for (const [k, v] of Object.entries(row || {})) map.set(headerKey(k), v);
  for (const a of aliases) {
    const v = map.get(headerKey(a));
    if (v == null) continue;
    const t = String(v).trim();
    if (t) return t;
  }
  return "";
}

function contactName(row: Record<string, unknown>): string {
  const full = cell(row, "Full Name");
  if (full) return full;
  return [cell(row, "First Name"), cell(row, "Middle Name"), cell(row, "Last Name")]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function street(row: Record<string, unknown>): string | null {
  const parts = [
    cell(row, "Mailing Street"),
    cell(row, "Mailing Street 2"),
    cell(row, "Mailing Street 3"),
  ].filter(Boolean);
  return parts.length ? parts.join("\n") : null;
}

function customFields(row: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { aliases, key } of CUSTOM_FIELD_MAP) {
    const v = cell(row, ...aliases);
    if (v) out[key] = v;
  }
  const country = cell(row, "Mailing Country");
  if (country && !/^(us|usa|united states)$/i.test(country)) out.mailing_country = country;
  return out;
}

function markSig(marks: string[]): string {
  return [...marks].sort().join("|");
}

function setsOverlap(a: string[], b: string[]): boolean {
  const bs = new Set(b);
  return a.some((x) => bs.has(x));
}

export type MarkSkipReason = "missing_company" | "missing_name" | "duplicate_row";

export type MarkSkip = {
  row: number;
  company: string;
  name: string;
  reason: MarkSkipReason;
};

export type MarkContactDraft = {
  sourceRow: number;
  name: string;
  title: string | null;
  department: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  alt_phone: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  function_role: string | null;
  custom_fields: Record<string, string>;
  source: typeof MARK_CONTACTS_SOURCE;
  is_primary: false;
};

export type MarkCompanyDraft = {
  key: string;
  name: string;
  normalized: string;
  originalSpellings: string[];
  reporting_marks: string[];
  markConflict: boolean;
  markSignatures: string[];
  contacts: MarkContactDraft[];
};

export type MarkPreview = {
  sourceRows: number;
  companiesToCreate: number;
  contactsToCreate: number;
  companiesAlreadyPresent: number;
  contactsAlreadyPresent: number;
  skipped: MarkSkip[];
  multiSpellingGroups: Array<{ normalized: string; spellings: string[]; rowCount: number }>;
  markConflictGroups: Array<{ name: string; signatures: string[] }>;
  spellingSplits: Array<{
    normalized: string;
    companies: Array<{ name: string; spellings: string[]; marks: string[] }>;
    borderline: boolean;
  }>;
  companies: MarkCompanyDraft[];
};

function pickDisplayName(spellings: string[]): string {
  const counts = new Map<string, number>();
  for (const s of spellings) counts.set(s, (counts.get(s) || 0) + 1);
  let best = spellings[0] || "";
  let n = -1;
  for (const [k, v] of counts) {
    if (v > n) {
      best = k;
      n = v;
    }
  }
  return best;
}

function contactDedupeKey(name: string, email: string): string {
  return `${name.trim().toLowerCase()}|${email.trim().toLowerCase()}`;
}

/**
 * Within a heavy-normalize() group: merge spellings that match under light
 * normalize (Inc. vs INC), or whose mark sets overlap. Split only when light
 * names differ AND both have nonempty disjoint marks (Ltd vs Inc; LLC vs none).
 */
function splitByLightNameAndMarks(
  members: Array<{ original: string; marks: string[]; row: Record<string, unknown>; rowIndex: number }>,
): Array<typeof members> {
  type LightBucket = { marks: Set<string>; members: typeof members };
  const byLight = new Map<string, LightBucket>();
  for (const m of members) {
    const light = normalizeCompanyNameLight(m.original);
    let g = byLight.get(light);
    if (!g) {
      g = { marks: new Set(), members: [] };
      byLight.set(light, g);
    }
    for (const mk of m.marks) g.marks.add(mk);
    g.members.push(m);
  }
  const lights = [...byLight.keys()];
  const parent = lights.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (i: number, j: number) => {
    const a = find(i);
    const b = find(j);
    if (a !== b) parent[a] = b;
  };
  for (let i = 0; i < lights.length; i++) {
    for (let j = i + 1; j < lights.length; j++) {
      const A = [...byLight.get(lights[i])!.marks];
      const B = [...byLight.get(lights[j])!.marks];
      if (!A.length || !B.length || setsOverlap(A, B)) union(i, j);
    }
  }
  const buckets = new Map<number, typeof members>();
  for (let i = 0; i < lights.length; i++) {
    const r = find(i);
    const list = buckets.get(r) || [];
    list.push(...byLight.get(lights[i])!.members);
    buckets.set(r, list);
  }
  return [...buckets.values()];
}

export function buildMarkContactsPreview(rows: Record<string, unknown>[]): MarkPreview {
  const skipped: MarkSkip[] = [];
  const buckets = new Map<
    string,
    Array<{ original: string; marks: string[]; row: Record<string, unknown>; rowIndex: number }>
  >();

  rows.forEach((row, i) => {
    const rowIndex = i + 2; // header is row 1
    const company = cell(row, "Company");
    const name = contactName(row);
    if (!company) {
      skipped.push({ row: rowIndex, company: "", name, reason: "missing_company" });
      return;
    }
    if (!name) {
      skipped.push({ row: rowIndex, company, name: "", reason: "missing_name" });
      return;
    }
    const original = company.trim();
    const norm = normalizeCompanyName(original);
    const list = buckets.get(norm) || [];
    list.push({ original, marks: splitReportingMarks(cell(row, "Reporting Marks")), row, rowIndex });
    buckets.set(norm, list);
  });

  const companies: MarkCompanyDraft[] = [];
  const multiSpellingGroups: MarkPreview["multiSpellingGroups"] = [];
  const spellingSplits: MarkPreview["spellingSplits"] = [];

  for (const [normalized, members] of buckets) {
    const uniqueSpellings = [...new Set(members.map((m) => m.original))];
    if (uniqueSpellings.length > 2) {
      multiSpellingGroups.push({
        normalized,
        spellings: uniqueSpellings,
        rowCount: members.length,
      });
    }
    const components = splitByLightNameAndMarks(members);
    const builtHere: MarkCompanyDraft[] = [];
    for (const comp of components) {
      const spellings = comp.map((m) => m.original);
      const display = pickDisplayName(spellings);
      const markUnion: string[] = [];
      const seenM = new Set<string>();
      const sigs = new Set<string>();
      for (const m of comp) {
        const sig = markSig(m.marks);
        if (sig) sigs.add(sig);
        for (const mk of m.marks) {
          if (seenM.has(mk)) continue;
          seenM.add(mk);
          markUnion.push(mk);
        }
      }
      const uniqueExact = [...new Set(spellings)];
      const seenPeople = new Set<string>();
      const contacts: MarkContactDraft[] = [];
      for (const m of comp) {
        const nm = contactName(m.row);
        const em = cell(m.row, "Email");
        const dk = contactDedupeKey(nm, em);
        if (seenPeople.has(dk)) {
          skipped.push({ row: m.rowIndex, company: display, name: nm, reason: "duplicate_row" });
          continue;
        }
        seenPeople.add(dk);
        contacts.push({
          sourceRow: m.rowIndex,
          name: nm,
          title: cell(m.row, "Title") || null,
          department: cell(m.row, "Department") || null,
          email: em || null,
          phone: cell(m.row, "Phone") || null,
          mobile: cell(m.row, "Mobile") || null,
          alt_phone: cell(m.row, "Alt Phone") || null,
          street: street(m.row),
          city: cell(m.row, "Mailing City") || null,
          state: cell(m.row, "Mailing State") || null,
          zip: cell(m.row, "Mailing Zip") || null,
          function_role: cell(m.row, "Function") || null,
          custom_fields: customFields(m.row),
          source: MARK_CONTACTS_SOURCE,
          is_primary: false,
        });
      }
      builtHere.push({
        key: companyIdempotencyKey(display, markUnion),
        name: display,
        normalized,
        originalSpellings: uniqueExact,
        reporting_marks: markUnion,
        markConflict: uniqueExact.length === 1 && sigs.size > 1,
        markSignatures: [...sigs],
        contacts,
      });
    }
    if (builtHere.length > 1) {
      const lights = [...new Set(members.map((m) => normalizeCompanyNameLight(m.original)))];
      const borderline = lights.some((a, i) =>
        lights.slice(i + 1).some((b) => isSuffixOnlyDifference(a, b)),
      );
      spellingSplits.push({
        normalized,
        companies: builtHere.map((c) => ({
          name: c.name,
          spellings: c.originalSpellings,
          marks: c.reporting_marks,
        })),
        borderline,
      });
    }
    companies.push(...builtHere);
  }

  companies.sort((a, b) => a.name.localeCompare(b.name));

  return {
    sourceRows: rows.length,
    companiesToCreate: companies.length,
    contactsToCreate: companies.reduce((n, c) => n + c.contacts.length, 0),
    companiesAlreadyPresent: 0,
    contactsAlreadyPresent: 0,
    skipped,
    multiSpellingGroups,
    spellingSplits,
    markConflictGroups: companies
      .filter((c) => c.markConflict)
      .map((c) => ({ name: c.name, signatures: c.markSignatures })),
    companies,
  };
}

export function companyIdempotencyKey(name: string, marks: string[]): string {
  return `${normalizeCompanyName(name)}::${name.trim().toLowerCase()}::${markSig(marks)}`;
}

export function existingCompanyKey(name: string, marks: string[] | null | undefined): string {
  return companyIdempotencyKey(name, marks || []);
}

/**
 * Match an import draft to a company already in the DB (including rows written
 * by SQL rather than this route). Prefer exact name, then light-normalize
 * (Inc. vs INC), then heavy-normalize only when marks overlap — never collapse
 * Ltd vs Inc / LLC vs none on name alone.
 */
export function matchExistingCompanyId(
  draft: { name: string; reporting_marks: string[] },
  existing: Array<{ id: number; name: string; reporting_marks?: string[] | null }>,
): number | undefined {
  const exactName = draft.name.trim().toLowerCase();
  const exactHits = existing.filter((e) => e.name.trim().toLowerCase() === exactName);
  if (exactHits.length === 1) return exactHits[0].id;
  if (exactHits.length > 1) {
    const byMarks = exactHits.filter((e) =>
      setsOverlap(e.reporting_marks || [], draft.reporting_marks) ||
      markSig(e.reporting_marks || []) === markSig(draft.reporting_marks),
    );
    if (byMarks.length === 1) return byMarks[0].id;
    return exactHits[0].id;
  }

  const light = normalizeCompanyNameLight(draft.name);
  const lightHits = existing.filter((e) => normalizeCompanyNameLight(e.name) === light);
  if (lightHits.length === 1) return lightHits[0].id;
  if (lightHits.length > 1) {
    const byMarks = lightHits.filter((e) =>
      !draft.reporting_marks.length ||
      !(e.reporting_marks || []).length ||
      setsOverlap(e.reporting_marks || [], draft.reporting_marks),
    );
    if (byMarks.length === 1) return byMarks[0].id;
  }

  const heavy = normalizeCompanyName(draft.name);
  const heavyHits = existing.filter((e) => normalizeCompanyName(e.name) === heavy);
  const overlapping = heavyHits.filter((e) => {
    const em = e.reporting_marks || [];
    if (!em.length || !draft.reporting_marks.length) return false;
    return setsOverlap(em, draft.reporting_marks);
  });
  if (overlapping.length === 1) return overlapping[0].id;
  return undefined;
}

export const COMPANY_CONTACT_CUSTOM_FIELD_LABELS: Record<string, string> = {
  record_source: "Record source",
  record_source_1: "Record source 1",
  record_source_2: "Record source 2",
  phone_ext: "Phone ext",
  alt_phone_ext: "Alt phone ext",
  home_phone: "Home phone",
  fax: "Fax",
  web_site: "Web site",
  email_2: "Email 2",
  branch_area: "Branch area",
  rail_primary: "Rail primary",
  rail_secondary: "Rail secondary",
  rail_third: "Rail third",
  asset_type: "Asset type",
  commodities: "Commodities",
  locomotive: "Locomotive",
  id_status: "ID / Status",
  misc: "Misc",
  spouse: "Spouse",
  interests: "Interests",
  mailing_country: "Mailing country",
};
