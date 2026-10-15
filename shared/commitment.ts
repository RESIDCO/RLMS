/**
 * Lease-link Off Rent + derived rental status (Idle / Unassigned / Leased).
 * Must stay in lockstep with public.rlms_is_off_rent in SQL.
 */

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

export function isOffRentLink(input: {
  hasAssignment?: boolean | null;
  rider?: string | null;
  lesseeName?: string | null;
  assignmentLabel?: string | null;
}): boolean {
  if (input.hasAssignment === false) return true;
  if (isOffRentRider(input.rider)) return true;
  if (isXLesseeText(input.lesseeName)) return true;
  if (isXLesseeText(input.assignmentLabel)) return true;
  return false;
}

export function derivedFleetStatus(input: {
  sold?: boolean;
  offRent: boolean;
  hasOpenCommitment: boolean;
}): DerivedFleetStatus {
  if (input.sold) return "Sold";
  if (!input.offRent) return "Leased";
  return input.hasOpenCommitment ? "Idle" : "Unassigned";
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
  return s.startsWith("OL") && !s.startsWith("XOL");
}
