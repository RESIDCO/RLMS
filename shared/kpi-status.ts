/** KPI status (derived_status) aligned with dashboard Idle / Available. */

export type KpiStatusFlags = {
  is_sold?: boolean | null;
  is_op?: boolean | null;
  off_rent?: boolean | null;
  on_rent?: boolean | null;
  open_abatement?: boolean | null;
  has_open_commitment?: boolean | null;
  in_open_program?: boolean | null;
  going_on_lease?: boolean | null;
  awaiting_rent_start?: boolean | null;
};

export function kpiIdlePlan(r: KpiStatusFlags): boolean {
  return Boolean(
    r.has_open_commitment || r.in_open_program || r.going_on_lease || r.awaiting_rent_start,
  );
}

export function derivedKpiStatus(r: KpiStatusFlags): "Sold" | "Leased" | "Idle" | "Unassigned" {
  if (r.is_sold) return "Sold";
  if (r.open_abatement) return "Leased";
  if (!r.off_rent) return "Leased";
  if (kpiIdlePlan(r)) return "Idle";
  return "Unassigned";
}

export function dashboardIdle(r: KpiStatusFlags): boolean {
  return Boolean(r.is_op) && Boolean(r.off_rent) && kpiIdlePlan(r);
}

export function dashboardUnassigned(r: KpiStatusFlags): boolean {
  return Boolean(r.is_op) && Boolean(r.off_rent) && !kpiIdlePlan(r);
}

/** Among operating cars, KPI status Idle/Unassigned must match dashboard Idle/Available. */
export function derivedAgreesWithDashboard(r: KpiStatusFlags): boolean {
  if (r.is_sold || !r.is_op) return true;
  const d = derivedKpiStatus(r);
  if (d === "Leased") return !r.off_rent;
  if (d === "Idle") return dashboardIdle(r);
  if (d === "Unassigned") return dashboardUnassigned(r);
  return true;
}
