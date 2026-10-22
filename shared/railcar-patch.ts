/** Car edit writes. Blank inputs stay null, and unchanged columns are left out of the UPDATE. */

export const RAILCAR_FORM_KEYS = [
  "car_type",
  "equipment_type_code",
  "status",
  "fleet_status",
  "entity",
  "transit_status",
  "transit_label",
  "mechanical_designation",
  "general_description",
  "lease_type",
  "managed",
  "managed_category",
  "lining_material",
  "sold_to",
  "ops_flag",
  "nbv",
  "oac",
  "oec",
] as const;

export const RAILCAR_NUMERIC_KEYS = [
  "capacity_cf",
  "tare_weight_lbs",
  "load_limit_lbs",
  "built_year",
  "build_year",
  "monthly_rent_per_car",
  "monthly_depr_per_car",
  "total_bv_rider",
  "cars_on_rider_ar",
  "nbv",
  "oec",
  "oac",
] as const;

const NUMERIC = new Set<string>(RAILCAR_NUMERIC_KEYS);

const SKIP = new Set([
  "id",
  "car_number",
  "reporting_marks",
  "car_initial",
  "notes",
  "active",
  "active_status",
  "active_source",
  "fleet_status",
  "fleet_status_source",
  "append_note",
  "inactive_change_reason",
  "ops_flag_set_at",
  "created_at",
  "updated_at",
]);

const ENUM_KEEP_BLANK = new Set(["fleet_status", "active_source", "umler_status"]);

/** Turn blank strings into null before Zod coerce can make them 0. */
export function preprocessRailcarPatchBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  const out: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  for (const [key, value] of Object.entries(out)) {
    if (typeof value !== "string" || ENUM_KEEP_BLANK.has(key)) continue;
    if (value.trim() === "") out[key] = null;
  }
  return out;
}

function blankText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function asNumber(value: unknown): number | null | undefined {
  if (value == null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).trim().replace(/,/g, ""));
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}

export function diffRailcarPatch(
  prior: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const prev = prior ?? {};
  const src = incoming ?? {};
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(src)) {
    if (raw === undefined || SKIP.has(key)) continue;
    if (NUMERIC.has(key)) {
      const next = asNumber(raw);
      if (next === undefined) {
        out[key] = raw;
        continue;
      }
      const previous = asNumber(prev[key]);
      if (previous === undefined || previous !== next) out[key] = next;
      continue;
    }
    if (raw !== null && typeof raw === "object") {
      if (JSON.stringify(prev[key] ?? null) !== JSON.stringify(raw)) out[key] = raw;
      continue;
    }
    if (typeof raw === "boolean" || typeof prev[key] === "boolean") {
      if (prev[key] !== raw) out[key] = raw;
      continue;
    }
    const next = blankText(raw);
    if (blankText(prev[key]) !== next) out[key] = next;
  }
  if (src.fleet_status === "Sold" && prev.fleet_status !== "Sold") {
    out.fleet_status = "Sold";
    out.fleet_status_source = "manual";
  }
  return out;
}

/** Edit dialog payload: changed fields only. Entity stays off the wire unless it changed. */
export function railcarFormPatch(
  car: Record<string, unknown>,
  form: Record<string, unknown>,
): Record<string, unknown> {
  const incoming: Record<string, unknown> = {};
  for (const key of RAILCAR_FORM_KEYS) {
    if (Object.prototype.hasOwnProperty.call(form, key)) incoming[key] = form[key];
  }
  return diffRailcarPatch(car, incoming);
}
