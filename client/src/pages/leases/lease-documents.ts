export type LeaseDoc = {
  id: number;
  file_name: string;
  file_size: number;
  mime_type: string | null;
  source_path: string | null;
  source_modified: string | null;
  doc_class: string | null;
  source: string | null;
  rider_id?: number | null;
  rider_code?: string | null;
  sub_folder?: string | null;
};

export type LeaseDocFilter = {
  q?: string;
  ol?: string;
  docClass?: string;
};

export function leaseDocumentsPath(kind: "rider" | "lessee", id: number) {
  return kind === "rider"
    ? `/api/lease-mgmt/riders/${id}/documents`
    : `/api/lease-mgmt/lessees/${id}/documents`;
}

/** Header / empty-state copy. Zero attachments stays the existing phrase. */
export function documentCountLabel(count: number) {
  if (count <= 0) return "No contract on file";
  if (count === 1) return "1 document";
  return `${count} documents`;
}

export function classKey(raw: string | null | undefined) {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : "other";
}

export function classLabel(raw: string | null | undefined) {
  if (raw === "likely_executed") return "Likely executed";
  const key = classKey(raw);
  return key === "other" ? "Other" : key;
}

function modifiedMs(doc: { source_modified: string | null }) {
  if (!doc.source_modified) return Number.NEGATIVE_INFINITY;
  const t = Date.parse(doc.source_modified);
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
}

export function compareLeaseDocsNewestFirst<T extends { id: number; source_modified: string | null }>(a: T, b: T) {
  const dt = modifiedMs(b) - modifiedMs(a);
  if (dt !== 0) return dt;
  return b.id - a.id;
}

export function filterLeaseDocs<T extends LeaseDoc>(rows: T[], filter: LeaseDocFilter): T[] {
  const needle = (filter.q ?? "").trim().toLowerCase();
  const ol = filter.ol && filter.ol !== "all" ? filter.ol : null;
  const docClass = filter.docClass && filter.docClass !== "all" ? filter.docClass : null;
  return rows.filter((r) => {
    if (ol && String(r.rider_code ?? r.rider_id ?? "") !== ol) return false;
    if (docClass && classKey(r.doc_class) !== docClass) return false;
    if (!needle) return true;
    const hay = [
      r.file_name,
      r.source_path ?? "",
      r.rider_code ?? "",
      r.sub_folder ?? "",
      r.doc_class ?? "",
      classLabel(r.doc_class),
    ].join(" ").toLowerCase();
    return hay.includes(needle);
  });
}

export type LeaseDocGroup<T> = {
  key: string;
  label: string;
  docs: T[];
};

/** Groups by doc class. Groups and rows are newest-first. */
export function groupLeaseDocs<T extends LeaseDoc>(rows: T[]): LeaseDocGroup<T>[] {
  const m = new Map<string, T[]>();
  for (const row of rows) {
    const key = classKey(row.doc_class);
    const list = m.get(key) ?? [];
    list.push(row);
    m.set(key, list);
  }
  const groups: LeaseDocGroup<T>[] = [];
  for (const [key, docs] of Array.from(m.entries())) {
    const sorted = [...docs].sort(compareLeaseDocsNewestFirst);
    groups.push({ key, label: classLabel(key), docs: sorted });
  }
  groups.sort((a, b) => {
    const aTop = a.docs[0];
    const bTop = b.docs[0];
    if (!aTop || !bTop) return a.docs.length - b.docs.length;
    return compareLeaseDocsNewestFirst(aTop, bTop);
  });
  return groups;
}

export function distinctDocClasses(rows: LeaseDoc[]) {
  const keys = new Set<string>();
  for (const row of rows) keys.add(classKey(row.doc_class));
  return Array.from(keys).sort((a, b) => classLabel(a).localeCompare(classLabel(b)));
}
