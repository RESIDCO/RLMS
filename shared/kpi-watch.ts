/**
 * Lease-ended watch status exclusions.
 * Mirrors the watch CTE in rlms_fleet_kpis_core: Month to Month, then scrap programs
 * (lease_status matching SCRAP, including SCRAPPING). Rent is unchanged.
 */

export function leaseEndedWatchStatusExcluded(leaseStatus: string | null | undefined): boolean {
  const st = String(leaseStatus ?? "").toUpperCase();
  if (/\bMTM\b|MONTH\s*TO\s*MONTH/.test(st)) return true;
  if (st.includes("SCRAP")) return true;
  return false;
}
