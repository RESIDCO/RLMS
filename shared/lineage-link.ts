/** Same-tab Lineage links. `back` is an in-app path the Lineage page can return to. */

export function safeLineageBack(back: string | null | undefined): string | null {
  const value = String(back ?? "").trim();
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//")) return null;
  if (value.includes("\\")) return null;
  if (value.includes("://")) return null;
  return value;
}

export function lineageCarQuery(car: {
  id?: number | null;
  reporting_marks?: string | null;
  car_number?: string | null;
  query?: string | null;
}): string {
  const explicit = String(car.query ?? "").trim();
  if (explicit) return explicit;
  const label = [car.reporting_marks, car.car_number]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(" ");
  if (label) return label;
  const id = Number(car.id);
  return Number.isFinite(id) && id > 0 ? String(id) : "";
}

export function lineageCarHref(
  car: {
    id?: number | null;
    reporting_marks?: string | null;
    car_number?: string | null;
    query?: string | null;
  },
  back?: string | null,
): string {
  const q = lineageCarQuery(car);
  const safe = safeLineageBack(back);
  const parts: string[] = [];
  if (q) parts.push(`q=${encodeURIComponent(q)}`);
  if (safe) parts.push(`back=${encodeURIComponent(safe)}`);
  return parts.length ? `/history?${parts.join("&")}` : "/history";
}
