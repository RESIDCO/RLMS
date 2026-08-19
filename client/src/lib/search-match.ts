/** Strip spaces and punctuation so "OL 1736" matches "OL1736". */
export function compactSearch(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** True when any haystack field contains the query, including compact OL-style matches. */
export function matchesSearchQuery(haystacks: Array<string | null | undefined>, qRaw: string): boolean {
  const q = qRaw.trim().toLowerCase();
  if (!q) return true;
  const parts = haystacks.filter(Boolean).map(String);
  if (parts.some((p) => p.toLowerCase().includes(q))) return true;
  const qc = compactSearch(q);
  return qc.length > 0 && parts.some((p) => compactSearch(p).includes(qc));
}
