import { displayLeaseNumber } from "@shared/residco-import";

export type DirectoryPersonLeaseBits = {
  id: number;
  via_company?: boolean;
  master_lease?: { lease_number?: string | null; lessee?: string | null } | null;
  rider?: { rider_name?: string | null; schedule_number?: string | null } | null;
};

export function directoryPersonLeaseLabel(p: DirectoryPersonLeaseBits): string {
  return [
    displayLeaseNumber(p.master_lease?.lease_number),
    p.master_lease?.lessee,
    p.rider?.rider_name || p.rider?.schedule_number,
  ].filter(Boolean).join(" · ");
}

/** One row per person; union lease labels; via_company if any source row is company-wide. */
export function groupDirectoryPeopleById<T extends DirectoryPersonLeaseBits>(
  people: T[],
): Array<T & { leases: string[] }> {
  const m = new Map<number, T & { leases: string[] }>();
  for (const p of people) {
    const leaseBit = directoryPersonLeaseLabel(p);
    const cur = m.get(p.id);
    if (!cur) {
      m.set(p.id, { ...p, leases: leaseBit ? [leaseBit] : [] });
      continue;
    }
    if (leaseBit && !cur.leases.includes(leaseBit)) cur.leases.push(leaseBit);
    if (p.via_company) cur.via_company = true;
  }
  return [...m.values()].sort((a, b) =>
    String((a as { name?: string }).name ?? a.id).localeCompare(String((b as { name?: string }).name ?? b.id)),
  );
}
