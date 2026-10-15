/**
 * Lease-link Off Rent + derived rental status (Idle / Unassigned / Leased).
 * Must stay in lockstep with public.rlms_is_on_ol / rlms_is_on_rent / rlms_is_off_rent in SQL.
 */

export type LinkInput = {
  hasAssignment?: boolean | null;
  rider?: string | null;
  lesseeName?: string | null;
  assignmentLabel?: string | null;
  rentStartDate?: string | null;
  asOf?: string | null;
  fleetStatus?: string | null;
  /** Default false until Bruce flips rlms_app_settings.rent_start_enforced. */
  rentStartEnforced?: boolean | null;
};

export const COMMITMENT_TYPES = ["program", "deal", "scrap", "other"] as const;
export type CommitmentType = (typeof COMMITMENT_TYPES)[number];

export type DerivedFleetStatus = "Leased" | "Idle" | "Unassigned" | "Sold";

const OFF_RENT_RIDER = /^(EA|EX|XOL)/i;
const X_LESSEE = /^\(?x[A-Z(]/;

export function isOffRentRider(rider: string | null | undefined): boolean {
  return OFF_RENT_RIDER.test(String(rider ?? "").trim());
}

export function isXLesseeText(v: string | null | undefined): boolean {
  return X_LESSEE.test(String(v ?? "").trim());
}

export function isoDateOnly(v: string | null | undefined): string | null {
  const d = String(v ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

export function isOnOl(input: LinkInput): boolean {
  if (input.hasAssignment === false) return false;
  if (!isOnRentOlRider(input.rider)) return false;
  if (isXLesseeText(input.lesseeName) || isXLesseeText(input.assignmentLabel)) return false;
  return true;
}

export function isOnRent(input: LinkInput): boolean {
  if (!isOnOl(input)) return false;
  const d = isoDateOnly(input.rentStartDate);
  const asOf = isoDateOnly(input.asOf) ?? new Date().toISOString().slice(0, 10);
  if (d) return d <= asOf;
  const enforced = input.rentStartEnforced === true;
  if (!enforced && String(input.fleetStatus ?? "") !== "Idle") return true;
  return false;
}

/** Same-rider moves keep the date unless a new one is explicitly supplied. */
export function assignmentRentStartOnMove(input: {
  fromRiderId?: number | null;
  toRiderId: number;
  prevDate?: string | null;
  prevSetBy?: string | null;
  prevSetAt?: string | null;
  dateSupplied?: boolean;
  suppliedDate?: string | null;
  actor?: string | null;
  movedAt?: string | null;
}): {
  rent_start_date: string | null;
  rent_start_set_by: string | null;
  rent_start_set_at: string | null;
  priorDateNote: string | null;
} {
  const supplied = Boolean(input.dateSupplied) && Boolean(isoDateOnly(input.suppliedDate));
  const sameRider = input.fromRiderId != null && Number(input.fromRiderId) === Number(input.toRiderId);
  if (supplied) {
    return {
      rent_start_date: isoDateOnly(input.suppliedDate),
      rent_start_set_by: input.actor ?? "system",
      rent_start_set_at: input.movedAt ?? null,
      priorDateNote: sameRider ? null : isoDateOnly(input.prevDate),
    };
  }
  if (sameRider) {
    return {
      rent_start_date: isoDateOnly(input.prevDate) ?? (input.prevDate ? String(input.prevDate).slice(0, 10) : null),
      rent_start_set_by: input.prevSetBy ?? null,
      rent_start_set_at: input.prevSetAt ?? null,
      priorDateNote: null,
    };
  }
  return {
    rent_start_date: null,
    rent_start_set_by: null,
    rent_start_set_at: null,
    priorDateNote: isoDateOnly(input.prevDate) ?? (input.prevDate ? String(input.prevDate).slice(0, 10) : null),
  };
}

export function isOffRentLink(input: LinkInput): boolean {
  return !isOnRent(input);
}

export function implicitAwaitingLabel(ol: string | null | undefined, lessee: string | null | undefined): string {
  return `${String(ol ?? "").trim()} – ${String(lessee ?? "").trim() || "lessee"} (awaiting rent start)`;
}

export function derivedFleetStatus(input: {
  sold?: boolean;
  offRent: boolean;
  onOl?: boolean;
  hasOpenCommitment: boolean;
}): DerivedFleetStatus {
  if (input.sold) return "Sold";
  if (!input.offRent) return "Leased";
  if (input.onOl || input.hasOpenCommitment) return "Idle";
  return "Unassigned";
}

/** Status from the lease-link fields on a new/imported car (no DB recompute). */
export function statusFromAssignmentLink(input: LinkInput & {
  sold?: boolean;
  hasOpenCommitment?: boolean;
  seedIdle?: boolean;
}): DerivedFleetStatus {
  const offRent = isOffRentLink(input);
  return derivedFleetStatus({
    sold: input.sold,
    offRent,
    onOl: isOnOl(input),
    hasOpenCommitment: Boolean(input.hasOpenCommitment || input.seedIdle),
  });
}

/** CSV or paste: "TFOX 000644,2024-10-18" or cars plus a single fallback date. */
export function parseCarDateRows(
  text: string,
  fallbackDate?: string | null,
): { initial: string; number: string; raw: string; date: string | null }[] {
  const fb = isoDateOnly(fallbackDate);
  const out: { initial: string; number: string; raw: string; date: string | null }[] = [];
  for (const line of String(text ?? "").split(/\n/)) {
    const s = line.trim();
    if (!s) continue;
    if (/^car\b/i.test(s) && /\bdate\b/i.test(s)) continue;
    const dateInLine = s.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    const date = isoDateOnly(dateInLine?.[1]) ?? fb;
    const tokens = parseCarListText(s.replace(/\b\d{4}-\d{2}-\d{2}\b/g, " "));
    if (!tokens.length) {
      out.push({ initial: "", number: "", raw: s, date });
      continue;
    }
    for (const t of tokens) out.push({ ...t, date });
  }
  return out;
}

export function xLesseeName(priorLessee: string | null | undefined): string {
  const s = String(priorLessee ?? "").trim();
  if (!s) return "xLessee";
  if (isXLesseeText(s) || /^x/i.test(s)) return s;
  return `x${s}`;
}

/** Match stored car_number whether padded to 6 or stored short. */
export function carNumberLookupValues(number: string): string[] {
  const digits = String(number ?? "").replace(/\D/g, "");
  if (!digits) return [];
  const stripped = digits.replace(/^0+/, "") || "0";
  return Array.from(new Set([digits, stripped, stripped.padStart(6, "0"), digits.padStart(6, "0")]));
}

export type ParsedCarToken = { initial: string; number: string; raw: string };

/** Mark + number, any spacing: TFOX 000644, TFOX000644, TFOX-644. */
export function parseCarListText(text: string): ParsedCarToken[] {
  const out: ParsedCarToken[] = [];
  const seen = new Set<string>();
  const re = /\b([A-Z]{2,5})\s*[-]?\s*(\d{1,7})\b/gi;
  for (const line of String(text ?? "").split(/[\n,;]+/)) {
    const s = line.trim();
    if (!s) continue;
    re.lastIndex = 0;
    let m = re.exec(s);
    if (!m) {
      out.push({ initial: "", number: "", raw: s });
      continue;
    }
    while (m) {
      const initial = m[1].toUpperCase();
      const number = m[2].padStart(6, "0");
      const key = `${initial}|${number}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ initial, number, raw: s });
      }
      m = re.exec(s);
    }
  }
  return out;
}

export function isOnRentOlRider(rider: string | null | undefined): boolean {
  const s = String(rider ?? "").trim().toUpperCase();
  if (!s) return false;
  return /^(OL|FL)[0-9]/.test(s) && !/^X(OL|FL)/.test(s);
}
