/* eslint-disable no-console */
/** Run: npx tsx shared/car-detail-panel.test.ts */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { planMoveBatch, rentStartRequest } from "./move-plan.ts";
import {
  carPanelStatusLabel,
  commitmentVisibility,
  filterOlRiders,
  flagsFromCommitmentPayload,
  keepRentStartLabel,
  moveFormBlock,
  moveRentStartPayload,
  rentStartVisibility,
  type OlListRider,
} from "./car-detail-panel.ts";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

const onRent = { on_rent: true, off_rent: false, awaiting_rent_start: false, on_ol: true };
ok(carPanelStatusLabel(onRent) === "On rent", "on rent chip");
ok(commitmentVisibility(onRent, false) === "hidden", "on-rent car hides the commitment form");
ok(commitmentVisibility(onRent, true) === "readonly", "on-rent car with a commitment is read-only");
ok(rentStartVisibility(onRent, "2026-10-23") === "collapsed", "on-rent car collapses rent start");

const idle = {
  on_rent: false,
  off_rent: true,
  awaiting_rent_start: false,
  on_ol: false,
  has_open_commitment: true,
};
ok(carPanelStatusLabel(idle) === "Idle", "committed off-rent car is Idle");
ok(commitmentVisibility(idle, true) === "form", "Idle car shows the commitment form");
ok(rentStartVisibility(idle, "2026-10-23") === "collapsed", "Idle car collapses rent start");

const awaiting = {
  on_rent: false,
  off_rent: true,
  awaiting_rent_start: true,
  on_ol: true,
  rent_start_date: null,
};
ok(carPanelStatusLabel(awaiting) === "Awaiting rent start", "awaiting chip wins over Idle");
ok(commitmentVisibility(awaiting, false) === "form", "awaiting car can take a commitment");
ok(rentStartVisibility(awaiting, "2026-10-23") === "open", "awaiting car shows the rent start box");

const future = {
  on_rent: true,
  off_rent: false,
  awaiting_rent_start: false,
  future_rent_start: true,
  on_ol: true,
  rent_start_date: "2026-11-01",
};
ok(rentStartVisibility(future, "2026-10-23") === "open", "future rent start stays open");
ok(commitmentVisibility(future, false) === "hidden", "future start that is already on rent hides the form");

const unassigned = { on_rent: false, off_rent: true, awaiting_rent_start: false, no_assignment: true };
ok(carPanelStatusLabel(unassigned) === "Off rent", "unassigned off-rent chip");
ok(commitmentVisibility(unassigned, false) === "form", "unassigned car shows the commitment form");

const laterThan30 = {
  on_rent: false,
  off_rent: true,
  awaiting_rent_start: true,
  future_rent_start: false,
  rent_start_date: "2027-06-01",
};
ok(rentStartVisibility(laterThan30, "2026-10-23") === "open", "a start beyond the KPI window still opens the box");

ok(flagsFromCommitmentPayload(null) === null, "missing payload does not invent flags");
ok(flagsFromCommitmentPayload({ commitment: null }) === null, "a payload without KPI flags is not gated yet");
ok(
  flagsFromCommitmentPayload({ on_rent: true, off_rent: false, awaiting_rent_start: false })?.on_rent === true,
  "KPI flags are read from the commitment payload",
);

const riders: OlListRider[] = [
  { id: 1, rider_name: "OL100", lessee: "Old Lessee", car_count: 4 },
  { id: 2, rider_name: "OL200", lessee: "Covia", car_count: 12 },
  { id: 3, rider_name: "OL201", master_lease: { lessee: "ADM" }, car_count: 1 },
];
const all = filterOlRiders(riders, "");
ok(all.total === 3 && all.rows.map((row) => row.code).join(",") === "OL100,OL200,OL201", "empty search lists every OL");
ok(all.rows[1].lessee === "Covia" && all.rows[1].carCount === 12, "each row has code, lessee, and car count");
ok(filterOlRiders(riders, "cov").rows.map((row) => row.id).join(",") === "2", "typing filters by lessee");
ok(filterOlRiders(riders, "OL100").rows.length === 1, "typing the current OL does not hide it, it filters to it");
ok(filterOlRiders(riders, "OL9").rows.length === 0 && filterOlRiders(riders, "OL9").total === 0, "a mistype matches nothing and creates nothing");

const many = Array.from({ length: 81 }, (_, i) => ({ id: i + 1, rider_name: `OL${String(i + 1).padStart(4, "0")}`, car_count: i }));
const page = filterOlRiders(many, "");
ok(page.rows.length === 80 && page.total === 81, "the closed chevron page is the first 80 OLs");
ok(filterOlRiders(many, "OL0081").rows[0]?.id === 81, "typing still finds an OL past the first page");

const baseMove = {
  currentRiderId: 1,
  creating: false,
  rentChoice: "keep" as const,
  rentDate: "",
  reasonRequired: false,
  reason: "",
};
ok(moveFormBlock({ ...baseMove, selectedId: null }) === "Pick an OL.", "typed text is not a destination");
ok(
  moveFormBlock({ ...baseMove, selectedId: null, creating: true })?.includes("Create the new OL") === true,
  "a new OL has to be created explicitly",
);
ok(moveFormBlock({ ...baseMove, selectedId: 1 }) === "This car is already on that OL.", "same OL cannot be saved");
ok(moveFormBlock({ ...baseMove, selectedId: 2, rentChoice: "" }) === "Choose what happens to the rent start.", "rent start choice is required");
ok(moveFormBlock({ ...baseMove, selectedId: 2, rentChoice: "set", rentDate: "" }) === "Enter the new rent start date.", "set needs a date");
ok(moveFormBlock({ ...baseMove, selectedId: 2, rentChoice: "clear" }) === null, "clear is a complete choice");
ok(moveFormBlock({ ...baseMove, selectedId: 2 }) === null, "keep with a different OL can be previewed");

const keep = moveRentStartPayload("keep", "2020-01-01");
ok(keep.rent_start_action === "keep" && !("rent_start_date" in keep), "keep does not resend the date");
ok(moveRentStartPayload("clear", "2020-01-01").rent_start_action === "clear", "clear is explicit");
ok(moveRentStartPayload("set", "2026-11-02").rent_start_date === "2026-11-02", "set sends the new date");
ok(keepRentStartLabel("2020-01-01") === "Keep current rent start (01/01/2020)", "keep label names the current date");
ok(keepRentStartLabel(null) === "Keep current rent start (none)", "keep label when there is no date");

const kept = rentStartRequest({ action: "keep", rentStartDate: "2026-01-01" });
ok(kept.dateSupplied === false && kept.suppliedDate === null && kept.error === null, "keep ignores a stray date");
const cleared = rentStartRequest({ action: "clear", rentStartDate: "2026-01-01" });
ok(cleared.dateSupplied === false, "clear ignores a stray date");
ok(rentStartRequest({ action: "set", rentStartDate: null }).error === "A rent start date is required", "set without a date is rejected");
ok(rentStartRequest({ action: null, rentStartDate: null }).dateSupplied === false, "legacy omit still means no supplied date");

const keptPlan = planMoveBatch(
  [
    {
      id: 1,
      label: "HWCX 1",
      found: true,
      active: true,
      from_rider_id: 10,
      from_rider_name: "OL100",
      from_fleet: "Old",
      rent_start_date: "2024-01-01",
      rent_start_set_by: "bruce",
      rent_start_set_at: "2024-01-01T00:00:00Z",
      assignment_id: 9,
    },
  ],
  {
    toRiderId: 20,
    toRiderName: "OL200",
    olLessee: "Covia",
    typedLessee: null,
    dateSupplied: false,
    suppliedDate: null,
    rentStartAction: "keep",
    actor: "ada@example.com",
    movedAt: "2026-10-23T00:00:00.000Z",
  },
);
ok(keptPlan[0].assignment?.rent_start_date === "2024-01-01", "keep survives an OL change in the move plan");
ok(keptPlan[0].assignment?.rent_start_set_by === "bruce", "keep does not rewrite who set the date");
ok(keptPlan[0].rent_start_impact.includes("kept"), "preview says the rent start is kept");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fleet = readFileSync(join(root, "client/src/pages/FleetRegistry.tsx"), "utf8");
const carPage = readFileSync(join(root, "client/src/pages/CarDetail.tsx"), "utf8");
const form = readFileSync(join(root, "client/src/components/ReassignCarForm.tsx"), "utf8");
const combo = readFileSync(join(root, "client/src/components/OlCombobox.tsx"), "utf8");
ok(!fleet.includes("button-delete-car") && !carPage.includes("button-delete-car"), "delete button is gone from the panel and car page");
ok(!fleet.includes('apiRequest("DELETE", `/api/railcars/') && !carPage.includes('apiRequest("DELETE", `/api/railcars/'), "the panel and car page no longer call car delete");
ok(!form.includes("new codes are accepted") && !combo.includes("new codes are accepted"), "the move combobox does not accept mistyped codes");
ok(form.includes("Move to another OL") && form.includes("From:"), "the move form names the action and the current OL");
ok(combo.includes("+ Create new OL"), "a new OL is an explicit option");
ok(fleet.includes("Rent history") && fleet.includes("Correct rent start") === false, "rent history lives on the panel; the correct-rent link lives with the commitment panel");

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log(`${passed} passed, ${failed} failed`);
