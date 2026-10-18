/** Lessee > OL/EA rider > cars. Codes are YY + running number, not YYMM. */

export const PLACEHOLDER_LESSEE_RE = /^(x|idle|available|unassigned)/i;
export const RIDER_NUMBER_RE = /^(OL|EA)\d{4}$/;
export const RIDER_DIGITS_RE = /^(?:OL|EA)(\d{4})$/;

export type RiderLifecycle = "active" | "off_lease_pending_remarketing" | "closed";

export function isPlaceholderLessee(name: string | null | undefined): boolean {
  return PLACEHOLDER_LESSEE_RE.test(String(name ?? "").trim());
}

export function isStandardRiderNumber(code: string | null | undefined): boolean {
  return RIDER_NUMBER_RE.test(String(code ?? "").trim().toUpperCase());
}

export function riderNumberDigits(code: string | null | undefined): string | null {
  const m = String(code ?? "").trim().toUpperCase().match(RIDER_DIGITS_RE);
  return m ? m[1] : null;
}

export function displayRiderCode(opts: {
  lifecycle_status?: string | null;
  rider_name?: string | null;
  schedule_number?: string | null;
  number_digits?: string | null;
}): string {
  const digits = (opts.number_digits || riderNumberDigits(opts.rider_name) || riderNumberDigits(opts.schedule_number) || "").trim();
  if (digits.length === 4) {
    if (opts.lifecycle_status === "off_lease_pending_remarketing") return `EA${digits}`;
    if (opts.lifecycle_status === "active") return `OL${digits}`;
  }
  return String(opts.rider_name || opts.schedule_number || "").trim() || "—";
}

export function lifecycleLabel(status: string | null | undefined): string {
  if (status === "off_lease_pending_remarketing") return "Off lease - pending remarketing";
  if (status === "closed") return "Closed";
  if (status === "active") return "Active";
  return "—";
}
