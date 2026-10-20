export const LINEAGE_FILTERS = [
  { id: "all", label: "All" },
  { id: "mark_change", label: "Marks" },
  { id: "status_change", label: "Status" },
  { id: "rent_event", label: "Rent" },
  { id: "reassignment", label: "Assignment" },
  { id: "moves", label: "Moves" },
  { id: "note", label: "Notes" },
  { id: "attachment", label: "Files" },
] as const;

export type LineageFilterId = (typeof LINEAGE_FILTERS)[number]["id"];

/** Recent Moves is the Moves filter. It is the reassignment rows, same as Assignment. */
export function activityMatchesFilter(action: string, filter: string): boolean {
  if (filter === "all") return true;
  if (filter === "moves" || filter === "reassignment") return action === "reassignment";
  return action === filter;
}
