/**
 * Car and lease activity keep the original filter list.
 * The Lineage page opts into its own list with `variant="lineage"`.
 */
export const ACTIVITY_TIMELINE_FILTERS = [
  { id: "all", label: "All" },
  { id: "mark_change", label: "Marks" },
  { id: "status_change", label: "Status" },
  { id: "rent_event", label: "Rent" },
  { id: "reassignment", label: "Assignment" },
  { id: "note", label: "Notes" },
  { id: "attachment", label: "Files" },
] as const;

export const LINEAGE_SOURCE_FILTERS = [
  { id: "rent_stop", label: "Rent stops" },
  { id: "program", label: "Programs" },
  { id: "import", label: "Imports" },
] as const;

export type TimelineVariant = "activity" | "lineage";

export type TimelineFilter = { id: string; label: string };

export function timelineFilters(variant: TimelineVariant): readonly TimelineFilter[] {
  switch (variant) {
    case "activity":
      return ACTIVITY_TIMELINE_FILTERS;
    case "lineage": {
      const filters: TimelineFilter[] = [];
      for (const filter of ACTIVITY_TIMELINE_FILTERS) {
        filters.push(filter);
        if (filter.id === "reassignment") filters.push({ id: "moves", label: "Moves" });
      }
      return [...filters, ...LINEAGE_SOURCE_FILTERS];
    }
    default: {
      const unreachable: never = variant;
      return unreachable;
    }
  }
}
