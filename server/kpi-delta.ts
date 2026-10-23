import { formatCarId } from "@shared/residco-import";
import { supabaseAdmin } from "./supabase";
import {
  kpiBucketTitle,
  kpiBucketsForRow,
  primaryKpiBucket,
  projectRentStopFlags,
  type KpiFlagRow,
} from "@shared/kpi-buckets";

const FLAG_COLS =
  "railcar_id, car, active, is_sold, is_op, off_rent, on_ol, on_rent, awaiting_rent_start, shop_conflict, future_rent_start, no_assignment, has_open_commitment, in_open_program, going_on_lease, sold_needs_tag, sale_unclear, sold_tag_suspect, sold_missing_buyer, status_tag, lease_status, buyer, rent_start_date, open_abatement";

export type KpiPatch =
  | { kind: "commitment"; action: "set" | "clear" }
  | { kind: "rent_start"; dateById: Map<number, string | null> }
  | { kind: "sold"; buyer?: string | null; buyerById?: Map<number, string | null> }
  | { kind: "unsold" }
  | { kind: "buyer" }
  | { kind: "abatement" }
  | { kind: "off_rent" }
  | { kind: "convert" };

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function applyPatch(row: any, patch: KpiPatch): KpiFlagRow {
  const next: KpiFlagRow = { ...row };
  if (patch.kind === "abatement" || patch.kind === "off_rent" || patch.kind === "convert") {
    return projectRentStopFlags(next, patch.kind);
  }
  if (patch.kind === "commitment") {
    next.has_open_commitment = patch.action === "set";
    return next;
  }
  if (patch.kind === "rent_start") {
    const date = patch.dateById.get(row.railcar_id) ?? null;
    const today = todayIso();
    if (!date) {
      next.awaiting_rent_start = Boolean(row.on_ol);
      next.future_rent_start = false;
      next.on_rent = false;
      next.off_rent = Boolean(row.on_ol) || Boolean(row.off_rent);
      return next;
    }
    if (date <= today) {
      next.awaiting_rent_start = false;
      next.future_rent_start = false;
      next.on_rent = Boolean(row.on_ol);
      next.off_rent = !row.on_ol;
      return next;
    }
    next.awaiting_rent_start = Boolean(row.on_ol);
    next.future_rent_start = Boolean(row.on_ol) && date <= addDays(today, 30);
    next.on_rent = false;
    next.off_rent = Boolean(row.on_ol);
    return next;
  }
  if (patch.kind === "sold") {
    const buyer = patch.buyerById?.get(row.railcar_id) ?? patch.buyer ?? row.buyer;
    next.is_sold = true;
    next.is_op = false;
    next.status_tag = "Sold";
    next.sold_needs_tag = false;
    next.sold_tag_suspect = false;
    next.sale_unclear = false;
    next.sold_missing_buyer = !buyer;
    next.off_rent = false;
    next.on_rent = false;
    next.awaiting_rent_start = false;
    return next;
  }
  if (patch.kind === "buyer") {
    next.sold_missing_buyer = false;
    return next;
  }
  next.is_sold = false;
  next.is_op = true;
  next.status_tag = row.status_tag === "Sold" ? "Leased" : row.status_tag;
  next.sold_needs_tag = false;
  next.sold_tag_suspect = false;
  next.sold_missing_buyer = false;
  return next;
}

export async function annotateKpiDelta(
  ids: number[],
  patch: KpiPatch,
  preferredBucket?: string | null,
) {
  const uniq = Array.from(new Set(ids.filter((n) => Number.isFinite(n) && n > 0)));
  if (!uniq.length) return [];
  const { data, error } = await supabaseAdmin
    .from("v_rlms_kpi_car_rows")
    .select(FLAG_COLS)
    .in("railcar_id", uniq)
    .eq("active", true);
  if (error) throw error;
  return (data ?? []).map((row: any) => {
    const before = kpiBucketsForRow(row);
    const afterRow = applyPatch(row, patch);
    const after = kpiBucketsForRow(afterRow);
    const beforePrimary = primaryKpiBucket(before, preferredBucket);
    const afterPrimary = primaryKpiBucket(after, preferredBucket);
    return {
      railcar_id: row.railcar_id,
      car: formatCarId(row),
      before,
      after,
      before_primary: beforePrimary,
      after_primary: afterPrimary,
      before_title: kpiBucketTitle(beforePrimary),
      after_title: kpiBucketTitle(afterPrimary),
      leaves_current: preferredBucket ? after.includes(preferredBucket as any) === false : beforePrimary !== afterPrimary,
    };
  });
}

export async function loadKpiCarRow(id: number) {
  const { data, error } = await supabaseAdmin
    .from("v_rlms_kpi_car_rows")
    .select(
      "railcar_id, active, car, reporting_marks, car_number, entity, status_tag, derived_status, current_lease, lessee, legal_owner, buyer, commitment, rent_start_date, last_ol, reason, sale_class, is_sold, is_op, off_rent, on_ol, on_rent, awaiting_rent_start, shop_conflict, future_rent_start, no_assignment, has_open_commitment, in_open_program, going_on_lease, sold_needs_tag, sale_unclear, sold_tag_suspect, sold_missing_buyer, lease_status, master_lease_id, rider_id, open_abatement, rent_stop_type, stop_date, expected_resume_date, rent_stop_reason",
    )
    .eq("railcar_id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw Object.assign(new Error("Car not found"), { status: 404 });
  if (data.active !== true) throw Object.assign(new Error("rejected: inactive"), { status: 400, code: "inactive" });
  const buckets = kpiBucketsForRow(data);
  return {
    row: { ...data, car: formatCarId(data) },
    buckets,
    primary: primaryKpiBucket(buckets),
    titles: buckets.map(kpiBucketTitle),
  };
}
