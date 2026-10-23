import { isoDateOnly, type RentStartMoveAction } from "./commitment";
import { formatUsDate } from "./display-date";
import { displayLeaseNumber } from "./residco-import";

export type CarPanelStatus = "on_rent" | "idle" | "awaiting_rent_start" | "off_rent";

export const CAR_PANEL_STATUS_LABEL: Record<CarPanelStatus, string> = {
  on_rent: "On rent",
  idle: "Idle",
  awaiting_rent_start: "Awaiting rent start",
  off_rent: "Off rent",
};

export type CarPanelFlags = {
  on_rent?: boolean | null;
  off_rent?: boolean | null;
  awaiting_rent_start?: boolean | null;
  future_rent_start?: boolean | null;
  on_ol?: boolean | null;
  has_open_commitment?: boolean | null;
  in_open_program?: boolean | null;
  going_on_lease?: boolean | null;
  no_assignment?: boolean | null;
  rent_start_date?: string | null;
};

export type CommitmentVisibility = "form" | "readonly" | "hidden";
export type RentStartVisibility = "open" | "collapsed";
export type RentStopVisibility = "expander" | "hidden";

type FlagPayload = {
  on_rent?: boolean | null;
  off_rent?: boolean | null;
  awaiting_rent_start?: boolean | null;
  future_rent_start?: boolean | null;
  on_ol?: boolean | null;
  has_open_commitment?: boolean | null;
  in_open_program?: boolean | null;
  going_on_lease?: boolean | null;
  no_assignment?: boolean | null;
  rent_start_date?: string | null;
};

/** KPI flags from GET /api/commitments/car/:id. Missing flags mean the row has not loaded. */
export function flagsFromCommitmentPayload(data: FlagPayload | null | undefined): CarPanelFlags | null {
  if (!data) return null;
  if (data.on_rent == null && data.off_rent == null && data.awaiting_rent_start == null) return null;
  return {
    on_rent: data.on_rent === true,
    off_rent: data.off_rent === true,
    awaiting_rent_start: data.awaiting_rent_start === true,
    future_rent_start: data.future_rent_start === true,
    on_ol: data.on_ol === true,
    has_open_commitment: data.has_open_commitment === true,
    in_open_program: data.in_open_program === true,
    going_on_lease: data.going_on_lease === true,
    no_assignment: data.no_assignment === true,
    rent_start_date: data.rent_start_date == null ? null : String(data.rent_start_date),
  };
}

/** Header chip. Awaiting wins over Idle; On rent wins over Off rent. */
export function carPanelStatus(flags: CarPanelFlags): CarPanelStatus {
  if (flags.awaiting_rent_start === true) return "awaiting_rent_start";
  if (flags.on_rent === true) return "on_rent";
  if (
    flags.off_rent === true &&
    (flags.on_ol === true ||
      flags.has_open_commitment === true ||
      flags.in_open_program === true ||
      flags.going_on_lease === true)
  ) {
    return "idle";
  }
  return "off_rent";
}

export function carPanelStatusLabel(flags: CarPanelFlags): string {
  const status = carPanelStatus(flags);
  switch (status) {
    case "on_rent":
    case "idle":
    case "awaiting_rent_start":
    case "off_rent":
      return CAR_PANEL_STATUS_LABEL[status];
    default: {
      const _never: never = status;
      return _never;
    }
  }
}

/** Full rent-start editor only while the car is awaiting a start or the start is still in the future. */
export function rentStartVisibility(flags: CarPanelFlags, today?: string | null): RentStartVisibility {
  if (flags.awaiting_rent_start === true || flags.future_rent_start === true) return "open";
  const date = isoDateOnly(flags.rent_start_date);
  const asOf = isoDateOnly(today) ?? new Date().toISOString().slice(0, 10);
  if (date && date > asOf) return "open";
  return "collapsed";
}

/**
 * Abatement belongs on a car that is on rent. A car that already has an open stop
 * keeps Resume / Convert behind the same expander. Everyone else does not see the form.
 */
export function rentStopVisibility(
  flags: CarPanelFlags | null | undefined,
  hasOpenStop = false,
): RentStopVisibility {
  if (hasOpenStop || flags?.on_rent === true) return "expander";
  return "hidden";
}

/**
 * The commitment form is for off-rent, Idle, and unassigned cars.
 * An on-rent car shows an open commitment read-only, with Clear, and otherwise nothing.
 */
export function commitmentVisibility(flags: CarPanelFlags, hasOpenCommitment: boolean): CommitmentVisibility {
  const offRentLike =
    flags.off_rent === true || flags.awaiting_rent_start === true || flags.no_assignment === true;
  if (offRentLike) return "form";
  if (flags.on_rent === true) return hasOpenCommitment ? "readonly" : "hidden";
  return "form";
}

export function keepRentStartLabel(date: string | null | undefined): string {
  const parsed = isoDateOnly(date);
  if (!parsed) return "Keep current rent start (none)";
  return `Keep current rent start (${formatUsDate(parsed) || parsed})`;
}

export type OlListRider = {
  id: number;
  rider_name: string;
  schedule_number?: string | null;
  master_lease?: { lease_number?: string | null; lessee?: string | null } | null;
  car_count?: number | null;
  lessee?: string | null;
};

export type OlListRow = {
  id: number;
  code: string;
  lessee: string;
  carCount: number | null;
};

export const OL_LIST_PAGE = 80;

function compactSearch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function matchesOlQuery(haystacks: Array<string | null | undefined>, qRaw: string): boolean {
  const q = qRaw.trim().toLowerCase();
  if (!q) return true;
  const parts = haystacks.filter((part) => part != null && String(part).trim() !== "").map(String);
  if (parts.some((part) => part.toLowerCase().includes(q))) return true;
  const qc = compactSearch(q);
  return qc.length > 0 && parts.some((part) => compactSearch(part).includes(qc));
}

/** Empty search lists existing OLs. A typed value only filters; it never creates a rider. */
export function filterOlRiders(riders: readonly OlListRider[], query: string, limit = OL_LIST_PAGE): {
  rows: OlListRow[];
  total: number;
} {
  const q = query.trim().toLowerCase();
  const matched = !q
    ? [...riders]
    : riders.filter((rider) =>
        matchesOlQuery(
          [
            rider.rider_name,
            rider.schedule_number,
            displayLeaseNumber(rider.master_lease?.lease_number),
            rider.master_lease?.lessee,
            rider.lessee,
          ],
          q,
        ),
      );
  const qc = compactSearch(q);
  const ranked = !qc
    ? matched
    : [...matched].sort((a, b) => {
        const ac = compactSearch(`${a.rider_name ?? ""} ${a.schedule_number ?? ""}`);
        const bc = compactSearch(`${b.rider_name ?? ""} ${b.schedule_number ?? ""}`);
        return (ac.startsWith(qc) ? 0 : 1) - (bc.startsWith(qc) ? 0 : 1);
      });
  const page = q ? ranked : ranked.slice(0, limit);
  return {
    total: ranked.length,
    rows: page.map((rider) => ({
      id: rider.id,
      code: rider.rider_name,
      lessee: String(rider.master_lease?.lessee || rider.lessee || displayLeaseNumber(rider.master_lease?.lease_number) || "").trim(),
      carCount: typeof rider.car_count === "number" ? rider.car_count : null,
    })),
  };
}

export function moveFormBlock(input: {
  selectedId: number | null;
  currentRiderId: number | null;
  creating: boolean;
  rentChoice: RentStartMoveAction | "";
  rentDate: string;
  reasonRequired: boolean;
  reason: string;
}): string | null {
  if (input.creating) return "Create the new OL before moving, or pick an existing one.";
  if (input.selectedId == null) return "Pick an OL.";
  if (input.currentRiderId != null && input.selectedId === input.currentRiderId) {
    return "This car is already on that OL.";
  }
  const rentProblem = rentChoiceProblem(input.rentChoice, input.rentDate);
  if (rentProblem) return rentProblem;
  if (input.reasonRequired && !input.reason.trim()) return "A reason is required when the lessee is overridden.";
  return null;
}

function rentChoiceProblem(choice: RentStartMoveAction | "", date: string): string | null {
  switch (choice) {
    case "":
      return "Choose what happens to the rent start.";
    case "keep":
    case "clear":
      return null;
    case "set":
      return isoDateOnly(date) ? null : "Enter the new rent start date.";
    default: {
      const _never: never = choice;
      return _never;
    }
  }
}

/** keep omits the date so the server preserves the stored value instead of rewriting it. */
export function moveRentStartPayload(
  choice: RentStartMoveAction,
  date: string,
): { rent_start_action: RentStartMoveAction; rent_start_date?: string } {
  switch (choice) {
    case "keep":
      return { rent_start_action: "keep" };
    case "clear":
      return { rent_start_action: "clear" };
    case "set":
      return { rent_start_action: "set", rent_start_date: isoDateOnly(date) ?? "" };
    default: {
      const _never: never = choice;
      return _never;
    }
  }
}
