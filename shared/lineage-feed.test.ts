/** Run: npx tsx shared/lineage-feed.test.ts */
import { readFileSync } from "node:fs";
import { LINEAGE_SOURCE_TABLES, mergeLineageFeed, type LineageEvent } from "./lineage-feed";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

const activity: LineageEvent[] = [
  {
    id: 1,
    action: "reassignment",
    occurred_at: "2026-01-01T00:00:00.000Z",
    source_table: "assignment_history",
    source_id: 9,
    railcar_id: 4,
    detail: { from_fleet: "A", to_fleet: "B" },
    before: {},
    after: { id: 9 },
  },
  {
    id: 2,
    action: "note",
    occurred_at: "2026-02-01T00:00:00.000Z",
    railcar_id: 4,
    detail: { body: "already logged" },
  },
];

const merged = mergeLineageFeed(activity, {
  moves: [
    {
      id: 9,
      railcar_id: 4,
      from_fleet_name: "A",
      to_fleet_name: "B",
      moved_at: "2026-01-01T00:00:00.000Z",
      moved_by: "ada",
    },
    {
      id: 10,
      railcar_id: 4,
      from_fleet_name: "B",
      to_fleet_name: "C",
      moved_at: "2026-06-01T00:00:00.000Z",
      moved_by: "vcf-import",
      reason: "V_VALID_CARS assignment period",
    },
  ],
  marks: [{
    id: 3,
    railcar_id: 4,
    old_car_initial: "TILX",
    old_car_number: "1",
    new_car_initial: "TILX",
    new_car_number: "2",
    changed_at: "2026-05-01T00:00:00.000Z",
    changed_by: "ada",
    reason: "remark",
  }],
  statuses: [{
    id: 8,
    car_id: 4,
    event_type: "marked_inactive",
    from_status: "Idle",
    to_status: "Inactive",
    reason: "stored",
    created_by: "ada",
    created_at: "2026-04-01T00:00:00.000Z",
  }],
  rentStops: [{
    id: 11,
    railcar_id: 4,
    type: "Off rent",
    stop_date: "2026-07-01",
    reason: "damage",
    created_at: "2026-07-02T15:00:00.000Z",
  }],
  rentStopAudits: [
    { id: 1, op: "INSERT", at: "2026-07-02T15:00:00.000Z", new_row: { railcar_id: 4 } },
    { id: 2, op: "UPDATE", at: "2026-07-03T15:00:00.000Z", new_row: { railcar_id: 4, type: "Abatement", reason: "goodwill" } },
  ],
  programs: [{
    id: 6,
    railcar_id: 4,
    program_id: 2,
    program_name: "Shop",
    added_at: "2026-03-01T00:00:00.000Z",
    exited_date: "2026-03-20",
  }],
  carNotes: [
    { id: 4, notes: "already logged", reporting_marks: "TILX", car_number: "2", updated_at: "2026-02-02T00:00:00.000Z" },
    { id: 5, notes: "only on the car", reporting_marks: "GATX", car_number: "9", updated_at: "2026-08-01T00:00:00.000Z" },
  ],
  imports: [{ id: "load-1", kind: "vcf", file_name: "valid.csv", loaded_at: "2026-08-02T00:00:00.000Z", loaded_by: "import" }],
}, { limit: 20 });

const actions = merged.map((ev) => ev.action);
ok(merged[0]?.action === "import", "newest source sorts first");
ok(merged.some((ev) => ev.id === 1 && ev.before && ev.after), "change capture on the activity row is kept");
ok(!merged.some((ev) => ev.id === "assignment_history:9"), "a logged move is not shown again from move history");
ok(merged.some((ev) => ev.id === "assignment_history:10") === false, "VCF assignment noise is dropped before the cap");
ok(actions.includes("mark_change"), "mark changes are read");
ok(actions.includes("status_change"), "status history is read");
ok(merged.some((ev) => ev.action === "rent_stop" && ev.source_table === "car_rent_stops"), "rent stops are read");
ok(!merged.some((ev) => ev.id === "car_rent_stops_history:1"), "the insert audit is not a second rent stop");
ok(merged.some((ev) => ev.id === "car_rent_stops_history:2"), "a rent-stop update is kept");
ok(merged.filter((ev) => ev.action === "program").length === 2, "a program join and exit are both read");
ok(merged.some((ev) => ev.id === "railcars.notes:5"), "a car note with no log row is shown once");
ok(!merged.some((ev) => ev.id === "railcars.notes:4"), "a car note already in the log is not repeated");

const capped = mergeLineageFeed(
  [{ id: 1, action: "note", occurred_at: "2020-01-01T00:00:00.000Z", detail: { body: "old" } }],
  { rentStops: [{ id: 3, railcar_id: 1, type: "Abatement", stop_date: "2026-01-01", created_at: "2026-01-02T00:00:00.000Z" }] },
  { limit: 1 },
);
ok(capped.length === 1 && capped[0]?.action === "rent_stop", "the cap keeps the newer source row");

ok(!LINEAGE_SOURCE_TABLES.includes("rent_events" as (typeof LINEAGE_SOURCE_TABLES)[number]), "rent events are not a Lineage source");
ok(LINEAGE_SOURCE_TABLES.includes("activity_log"), "the activity log is a Lineage source");
ok(LINEAGE_SOURCE_TABLES.includes("car_rent_stops"), "rent stops are a Lineage source");

const reader = readFileSync(new URL("../server/lineage-read.ts", import.meta.url), "utf8");
ok(!reader.includes("rent_events"), "the reader does not name the rent event table");
ok(!/\.(insert|update|delete|upsert)\s*\(/.test(reader), "the reader only selects");

const withNoise = mergeLineageFeed([], {
  moves: [{
    id: 10,
    railcar_id: 4,
    moved_at: "2026-06-01T00:00:00.000Z",
    moved_by: "vcf-import",
    from_fleet_name: "B",
    to_fleet_name: "C",
  }],
}, { limit: 5, includeVcfNoise: true });
ok(withNoise.length === 1 && withNoise[0]?.action === "reassignment", "VCF moves stay available when noise is requested");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
