/**
 * Plain-English column dictionary for headers, pickers, and KPI reason values.
 * Lookup: getColumn(listKey, colKey) tries "listKey:colKey" then "colKey".
 */

export type ColumnDictEntry = {
  key: string;
  label: string;
  meaning: string;
  source: string;
  derivation: string;
};

function d(
  key: string,
  label: string,
  meaning: string,
  source: string,
  derivation: string,
): ColumnDictEntry {
  return { key, label, meaning, source, derivation };
}

/** Shared across fleet / search / browse / lease / KPI where the key matches. */
const SHARED: ColumnDictEntry[] = [
  d("car", "Car", "Reporting marks plus car number — the car’s identity on the list.", "calculated", "Marks and number from railcars, shown as MARK NNNNNN."),
  d("marks", "Marks", "AAR reporting marks on the car.", "railcars.reporting_marks", "Stored on the railcar; not calculated."),
  d("car_number", "Car number", "Numeric body of the car ID after the marks.", "railcars.car_number", "Stored on the railcar; displayed with marks as the full car ID."),
  d("entity", "Entity", "Which Residco book the car sits on (Main, Coal, RPS, etc.).", "railcars.entity", "Stored on the railcar."),
  d("type", "Car type", "Equipment family (tank, hopper, gon, etc.).", "railcars.car_type", "Stored on the railcar."),
  d("lease_type", "Lease type", "OL vs FL (and related) for the current assignment.", "calculated", "From the current rider/MLA lease type, with car-level override when present."),
  d("status", "Rental status", "How the car is working today: on rent, idle, sold, and similar.", "calculated", "RLMS rental status from assignment, Sold tag, commitments, and rent start — not a free-typed field."),
  d("rental_status", "Rental status", "How the car is working today: on rent, idle, sold, and similar.", "calculated", "Same as Status on Fleet: derived from assignment, Sold, commitments, and rent start."),
  d("flag", "Flag", "Ops flag on the car (shop, hold, and similar markers).", "railcars.ops_flag", "Stored ops flag; staff-maintained."),
  d("lessee", "Lessee", "Who is leasing the car on the current assignment.", "railcars.lessee_name / assignment", "From the current rider/MLA lessee when assigned."),
  d("rider", "Rider", "Current OL/FL (rider) the car is on.", "railcars.rider_external_id / riders", "Current assignment rider label."),
  d("lease", "Lease", "Master lease (MLA) number for the current rider.", "master_leases.lease_number", "Via the current rider’s master lease."),
  d("expires", "Expires", "When the current rider/lease is set to expire.", "riders.expiration_date", "Rider expiration, with governed/estimated expiry when that is what the list shows."),
  d("effective", "Effective", "When the rider/lease started.", "riders.effective_date", "Stored on the rider."),
  d("ol", "Current OL", "Current operating/finance lease (rider) ID.", "railcars.rider_external_id", "Current assignment rider code (OL/FL)."),
  d("car_count", "Cars", "How many cars are on this rider or in this group.", "calculated", "Count of assigned cars for the row."),
  d("status_tag", "Status tag", "Tag stored on the car (Leased, Idle, Sold, Abatement, Unassigned).", "railcars.fleet_status", "Typed/stored fleet status tag — not the KPI status."),
  d(
    "derived_status",
    "KPI status",
    "KPI status, calculated by RLMS, not typed in. On rent = on an OL/FL lease (rent start blank counts as on rent while enforcement is off) unless tagged Idle. Idle = off rent with a Commitment, open program, Going On Lease, or awaiting rent start. Unassigned = off rent with no plan.",
    "calculated",
    "Sold wins (tag or outside buyer). Else on rent unless off-rent. Idle when off rent with a plan (Commitment, open program, Going On Lease, or awaiting rent start). Otherwise Unassigned (Available for Opportunities).",
  ),
  d("current_lease", "Current lease", "OL/FL the car is linked to right now.", "calculated", "Current assignment rider (link_rider) from the KPI row."),
  d("legal_owner", "Legal owner", "Legal owner on the equipment.", "railcars.legal_owner", "Stored on the railcar."),
  d("buyer", "Buyer", "Outside buyer when the car is a sale.", "calculated", "First non-blank of car sold-to, rider sold-to, MLA sold-to, or sale classification buyer."),
  d("commitment", "Commitment", "Open plan for the car (program, deal, scrap, or similar).", "car_commitments", "Open (not cleared) commitment: type, name, and target date. Awaiting rent start can show an implicit Going On Lease commitment."),
  d("rent_start_date", "Rent start", "Date rent started (or will start) on the current assignment.", "railcar_assignments.rent_start_date", "From the current assignment row."),
  d("last_ol", "Last OL", "Most recent OL/FL this car was on.", "calculated", "Latest assignment-history rider whose ID looks like OL/FL."),
  d("reason", "Why in KPI", "Why this car is in this KPI list.", "calculated", "Rule label from sold, no link, Idle-on-OL, future rent start, EA/EX/xOL, x-lessee, open Commitment, program, or Going On Lease. Hover a value for that rule."),
  d("nbv", "NBV", "Net book value per car.", "railcars.nbv", "Stored financial field."),
  d("oac", "OAC", "Original acquisition cost per car.", "railcars.oac", "Stored financial field."),
  d("oec", "Net equip. cost", "Net equipment cost per car.", "railcars.oec", "Stored financial field."),
  d("monthly_rent_per_car", "Monthly rent P/C", "Monthly rent per car on the current assignment.", "calculated", "From the current rider/assignment rent."),
  d("monthly_depr_per_car", "Monthly depr P/C", "Monthly depreciation per car.", "calculated", "From financials on the current assignment/rider."),
  d("build_year", "Build year", "Year the car was built.", "railcars.build_year", "Stored / UMLER build year."),
  d("capacity_cf", "Capacity (cf)", "Cubic-foot capacity.", "railcars.capacity_cf", "Stored equipment attribute."),
  d("lining", "Lining", "Tank/hopper lining material.", "railcars.lining", "Stored equipment attribute."),
  d("description", "Description", "Short equipment description.", "railcars.description", "Stored general description."),
  d("mech_designation", "Mech. designation", "AAR mechanical designation.", "railcars.mechanical_designation", "Stored / UMLER."),
  d("equipment_type_code", "Equip. type", "Equipment type code (ETC).", "railcars.equipment_type_code", "Stored / UMLER."),
  d("commodity", "Commodity", "Commodity the car is set up for.", "railcars.commodity", "Stored on the railcar."),
  d("commodity_family", "Commodity family", "Broader commodity family.", "railcars.commodity_family", "Stored on the railcar."),
  d("dot_code", "DOT code", "DOT specification / tank code.", "railcars.dot_code", "Stored / UMLER."),
  d("lease_start_date", "Lease start", "Start date of the current lease assignment.", "calculated", "From the current rider/assignment."),
  d("lease_end_date", "Lease end", "End date of the current lease assignment.", "calculated", "From the current rider/assignment."),
  d("lease_expiry", "Lease expiry", "Expiration used for the current lease (including estimated).", "calculated", "Governed/estimated expiry when a hard date is not on the rider."),
  d("data_source", "Data source", "Where this car’s master data last came from.", "railcars.data_source", "Stored source stamp (UMLER, VCF, manual, etc.)."),
  d("active", "Active", "Whether the car is in the active fleet (not deactivated).", "railcars.active", "Stored. Inactive cars are excluded from most KPIs."),
  d("rider_external_id", "Rider ID", "Current OL/FL code.", "railcars.rider_external_id", "Same as Current OL."),
  d("account_manager_initials", "Acct mgr", "Account manager initials for the current lessee/account.", "calculated", "From the account on the current assignment."),
  d("am_note", "Latest AM note", "Most recent account-manager note on this rider/account.", "rider account comments", "Latest comment snippet, not a car field."),
  d("comment_event_note", "Comment / event note", "Free-text comment or event note on the car.", "railcars.comment_event_note", "Stored on the railcar."),
  d("complete", "Outcome", "Whether this program car has reached its outcome (done).", "calculated", "Done if the car is inactive, has an outcome date, or is marked complete."),
];

const NAMESPACED: ColumnDictEntry[] = [
  d("programs:title", "Title", "Program name.", "programs.name", "Stored program title."),
  d("programs:type", "Type", "Work type (Return, Remark, Acquisition, Quals, etc.).", "programs.type", "Stored type, or inferred from category when type is blank."),
  d("programs:lifecycle", "Lifecycle", "Draft, active, closed, or cancelled.", "calculated", "Closed if closed_date is set; otherwise stored lifecycle (default active)."),
  d("programs:progress", "Progress", "Cars finished vs still open on this program.", "calculated", "Done / open-link count from program cars (inactive, outcome, or complete = done)."),
  d("programs:target", "Target date", "When the program is supposed to be finished.", "programs.target_completion_date", "Stored target. Past due with remaining cars is Stale."),
  d("programs:ready", "Ready", "Active program with no remaining open cars — ready to review/close.", "calculated", "Ready to close when lifecycle is active and remaining = 0."),
  d("programs:owner", "Owner", "Account manager for the program.", "programs.account_manager", "Stored on the program."),
  d("programs:entity", "Entity", "Residco book this program is for.", "programs.entity", "Stored on the program."),
  d("program_cars:active", "Active", "Whether the linked car is in the active fleet.", "railcars.active", "From the linked railcar, not the program row."),
  d("program_cars:milestone", "Milestone", "Optional milestone on this car in the program.", "program_cars.milestone", "Staff-entered; never enforced."),
  d("program_cars:milestone_at", "Milestone date", "Date of the current milestone.", "program_cars.milestone_at", "Staff-entered."),
  d("program_cars:notes", "Notes", "Notes on this car in the program.", "program_cars.notes", "Staff-entered on the program-car row."),
  d("program_cars:shop", "Shop / yard", "Shop or yard assigned for this program car.", "program_cars.shop_id → shops", "Link to shops."),
  d("program_cars:commitment", "Commitment", "Open Commitment on this car, if any.", "car_commitments", "Open commitment for the linked railcar."),
  d("program_cars:kpi", "KPI bucket", "Which dashboard KPI list this car currently falls in.", "calculated", "Same KPI rules as the dashboard (off rent, idle, unassigned, sold, etc.)."),
  d("program_cars:car", "Car", "Car in this program.", "program_cars.railcar_id → railcars", "Marks + number of the linked railcar."),
  d("browse_ol_list:ol", "OL / Rider", "Operating or finance lease (rider) in this group.", "riders.rider_external_id / rider_name", "Group row’s OL code; name shown under the code when different."),
];

export const COLUMN_DICTIONARY: Record<string, ColumnDictEntry> = {};
for (const e of [...SHARED, ...NAMESPACED]) COLUMN_DICTIONARY[e.key] = e;

export const KPI_REASON_VALUES: Record<string, ColumnDictEntry> = Object.fromEntries(
  [
    d("Sold – needs tag", "Sold – needs tag", "Outside sale evidence exists but the car is not tagged Sold.", "calculated", "Sale classification or sold-to points outside, and fleet_status is not Sold."),
    d("Sold", "Sold", "Car is tagged Sold.", "railcars.fleet_status", "Stored tag is Sold."),
    d("no link", "No link", "No current lease assignment.", "calculated", "No current rider/MLA link."),
    d("Idle-on-OL awaiting rent start", "Awaiting rent start", "On an OL/FL, tagged Idle, waiting for rent to start.", "calculated", "Awaiting rent start (and often Idle + on OL)."),
    d("future rent start", "Future rent start", "Rent start date is in the future.", "calculated", "rent_start_date is after today while otherwise on assignment."),
    d("EA/EX/xOL", "EA / EX / xOL", "Rider code is an expiration/exit style ID, treated as off rent.", "calculated", "Current rider matches EA, EX, or xOL."),
    d("x-lessee", "x-lessee", "Lessee or assignment label is an x-name, treated as off rent.", "calculated", "Lessee or assignment label starts with x (or (x)."),
    d("open Commitment", "Open commitment", "Off rent with a staff Commitment (program, deal, scrap, or other).", "car_commitments", "Open (not cleared) row on car_commitments."),
    d("program", "Program", "Car is on an open program.", "program_cars", "Active program membership (in_open_program)."),
    d("Going On Lease", "Going on lease", "Car is in the Going On Lease path (implicit commitment / rent start).", "calculated", "going_on_lease flag from KPI rules."),
  ].map((e) => [e.key, e]),
);

/** Data columns each table renders (no checkbox/actions chrome). */
export const RENDERED_COLUMNS: Record<string, readonly string[]> = {
  kpi_cars: [
    "car",
    "entity",
    "status_tag",
    "derived_status",
    "current_lease",
    "lessee",
    "legal_owner",
    "buyer",
    "commitment",
    "rent_start_date",
    "last_ol",
    "reason",
  ],
  programs: ["title", "type", "lifecycle", "progress", "target", "ready", "owner", "entity"],
  program_cars: [
    "car",
    "complete",
    "active",
    "milestone",
    "milestone_at",
    "notes",
    "shop",
    "commitment",
    "kpi",
  ],
  fleet_registry: [
    "marks",
    "car_number",
    "lease_type",
    "entity",
    "type",
    "status",
    "flag",
    "lessee",
    "rider",
    "lease",
    "expires",
    "nbv",
    "oac",
    "oec",
    "monthly_rent_per_car",
    "monthly_depr_per_car",
    "build_year",
    "capacity_cf",
    "lining",
    "description",
    "mech_designation",
    "equipment_type_code",
    "commodity",
    "commodity_family",
    "dot_code",
    "lease_start_date",
    "lease_end_date",
    "lease_expiry",
    "data_source",
    "active",
    "rider_external_id",
    "account_manager_initials",
    "am_note",
    "comment_event_note",
  ],
  search_results: [
    "marks",
    "car_number",
    "lease_type",
    "entity",
    "type",
    "status",
    "lessee",
    "rider",
    "lease",
    "expires",
    "nbv",
    "oac",
    "oec",
    "monthly_rent_per_car",
    "monthly_depr_per_car",
    "build_year",
    "capacity_cf",
    "lining",
    "description",
    "mech_designation",
    "equipment_type_code",
    "commodity",
    "commodity_family",
    "dot_code",
    "lease_start_date",
    "lease_end_date",
    "lease_expiry",
    "data_source",
    "active",
    "rider_external_id",
    "account_manager_initials",
    "am_note",
    "comment_event_note",
  ],
  browse_car_list: ["marks", "car_number", "lease_type", "entity", "status", "type", "lessee", "ol"],
  browse_ol_list: ["ol", "lease_type", "effective", "expires", "car_count"],
  lease_rider_cars: [
    "marks",
    "car_number",
    "lease_type",
    "lessee",
    "rental_status",
    "entity",
    "nbv",
    "oac",
    "oec",
    "capacity_cf",
    "lining",
    "build_year",
  ],
};

export function getColumn(listKey: string, colKey: string): ColumnDictEntry | undefined {
  if (colKey.startsWith("cf:")) {
    const name = colKey.slice(3) || "custom";
    return d(
      colKey,
      name.replace(/_/g, " "),
      "Custom field on this program.",
      "program_cars.custom_fields",
      "Defined on the program; stored per car in custom_fields.",
    );
  }
  return COLUMN_DICTIONARY[`${listKey}:${colKey}`] ?? COLUMN_DICTIONARY[colKey];
}

export function columnLabel(listKey: string, colKey: string, fallback?: string): string {
  return getColumn(listKey, colKey)?.label ?? fallback ?? colKey;
}

export function columnHelpText(entry: ColumnDictEntry): string {
  return `${entry.meaning}\n\nSource: ${entry.source}\nHow: ${entry.derivation}`;
}

export function getKpiReason(value: string | null | undefined): ColumnDictEntry | undefined {
  if (value == null || value === "" || value === "—") return undefined;
  return KPI_REASON_VALUES[value];
}
