/** Text used by the in-program Filter box. Every token must match. */

export type ProgramCarFilterInput = {
  reporting_marks?: string | null;
  car_number?: string | null;
  status?: string | null;
  notes?: string | null;
  milestone?: string | null;
  shop?: string | null;
  commitment?: string | null;
  kpi?: string | null;
  flag?: string | null;
  ol?: string | null;
  custom?: Record<string, unknown> | null;
};

export function programCarSearchText(car: ProgramCarFilterInput): string {
  const number = String(car.car_number ?? "");
  const digits = number.replace(/\D/g, "");
  const stripped = digits.replace(/^0+/, "") || (digits ? "0" : "");
  const mark = String(car.reporting_marks ?? "").trim();
  const custom = Object.values(car.custom ?? {}).map((value) => (value == null ? "" : String(value)));
  return [
    mark,
    number,
    digits,
    stripped,
    mark && stripped ? `${mark} ${stripped}` : "",
    mark && number ? `${mark} ${number}` : "",
    mark && digits ? `${mark}${digits}` : "",
    mark && stripped ? `${mark}${stripped}` : "",
    car.status,
    car.notes,
    car.milestone,
    car.shop,
    car.commitment,
    car.kpi,
    car.flag,
    car.ol,
    ...custom,
  ]
    .filter((part) => String(part ?? "").trim() !== "")
    .join(" ")
    .toLowerCase();
}

export function programCarMatchesQuery(car: ProgramCarFilterInput, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = programCarSearchText(car);
  return q.split(/\s+/).every((part) => hay.includes(part));
}
