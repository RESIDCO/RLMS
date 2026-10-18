/* eslint-disable no-console */
/** Run: npx tsx shared/crm.test.ts */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isPlaceholderLessee } from "./lease-mgmt";
import { isUndoAllowedTable, REFERENCED_SINCE_MESSAGE, finalizeUndoPreview, referencedSinceBlocksUndo, undoApplyOrder, UNDO_ALLOWED_TABLES } from "./undo";
import {
  addMonthsIso,
  changeCaptureRow,
  classifyAccountParty,
  contactBelongsToAccount,
  diffOpportunityContacts,
  FINANCE_LEASE_TAG,
  financeLeaseTag,
  isActiveRider,
  isRenewalCandidate,
  lostNeedsReason,
  mostCommonValue,
  normalizeTags,
  renewalAutoNotes,
  renewalExclusion,
  type RenewalRiderInput,
  wonProspectBecomesCustomer,
  wonProspectNextStep,
  wonReletNeedsRemarket,
} from "./crm";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

const TODAY = "2026-10-18";

function rider(overrides: Partial<RenewalRiderInput> = {}): RenewalRiderInput {
  return {
    lifecycle_status: "active",
    is_placeholder: false,
    expiration_date: "2027-04-18",
    expiration_source: "asset_report",
    on_rent_nonsold_leased: 4,
    has_open_renewal: false,
    ...overrides,
  };
}

ok(addMonthsIso("2026-10-18", 12) === "2027-10-18", "12 months from 18 Oct");
ok(addMonthsIso("2026-10-18", 6) === "2027-04-18", "6 months from 18 Oct");
ok(addMonthsIso("2026-10-18", 18) === "2028-04-18", "18 months from 18 Oct");
ok(addMonthsIso("2026-01-31", 1) === "2026-02-28", "month clamp non-leap");
ok(addMonthsIso("2024-01-31", 1) === "2024-02-29", "month clamp leap");

ok(isRenewalCandidate(rider(), { today: TODAY, months: 12 }), "baseline candidate");
ok(renewalExclusion(rider({ is_placeholder: true }), { today: TODAY, months: 12 }) === "placeholder", "placeholder excluded");
ok(isActiveRider(rider({ lifecycle_status: null })), "null lifecycle with on-rent cars is active");
ok(isRenewalCandidate(rider({ lifecycle_status: null }), { today: TODAY, months: 12 }), "null with on-rent cars is included");
ok(
  !isActiveRider(rider({ lifecycle_status: null, on_rent_nonsold_leased: 0 }))
    && !isRenewalCandidate(rider({ lifecycle_status: null, on_rent_nonsold_leased: 0 }), { today: TODAY, months: 12 }),
  "null with only sold or idle cars is excluded",
);
ok(
  renewalExclusion(rider({ lifecycle_status: null, is_placeholder: true, on_rent_nonsold_leased: 4 }), { today: TODAY, months: 12 }) === "placeholder",
  "null placeholder with on-rent cars stays excluded",
);
ok(renewalExclusion(rider({ lifecycle_status: "closed" }), { today: TODAY, months: 12 }) === "lifecycle", "closed excluded");
ok(
  !isActiveRider(rider({ lifecycle_status: "off_lease_pending_remarketing", on_rent_nonsold_leased: 3 }))
    && renewalExclusion(rider({ lifecycle_status: "off_lease_pending_remarketing", on_rent_nonsold_leased: 3 }), { today: TODAY, months: 12 }) === "lifecycle",
  "off lease never counts",
);
ok(
  isRenewalCandidate(rider({ lifecycle_status: null, on_rent_nonsold_leased: 5 }), { today: TODAY, months: 12 })
    && financeLeaseTag("FL2429") === FINANCE_LEASE_TAG
    && financeLeaseTag("FL2429") === "Finance lease (FL)",
  "FL is included and tagged",
);
ok(financeLeaseTag("OL1739") === null, "OL number is not a finance lease");
ok(financeLeaseTag("xOL1804") === null, "xOL number is not a finance lease");
ok(financeLeaseTag("  FL2120") === "Finance lease (FL)", "FL prefix allows surrounding space");
ok(!FINANCE_LEASE_TAG.toLowerCase().includes("confirm"), "finance lease tag has no confirm wording");
ok(renewalAutoNotes("asset_report") === null, "generated FL renewal has no warning note");
ok(renewalAutoNotes("asset_report_multi_term") === "multi-term: check car groups", "multi-term note unchanged");
ok(renewalExclusion(rider({ on_rent_nonsold_leased: 0 }), { today: TODAY, months: 12 }) === "on_rent", "sold / zero on-rent excluded");
ok(renewalExclusion(rider({ expiration_source: "car_records" }), { today: TODAY, months: 12 }) === "expiry_source", "car_records excluded");
ok(renewalExclusion(rider({ expiration_source: null }), { today: TODAY, months: 12 }) === "expiry_source", "null source excluded");
ok(renewalExclusion(rider({ expiration_date: null }), { today: TODAY, months: 12 }) === "window", "null expiry excluded");
ok(isRenewalCandidate(rider({ expiration_source: "asset_report_multi_term" }), { today: TODAY, months: 12 }), "multi_term included");
ok(renewalExclusion(rider({ has_open_renewal: true }), { today: TODAY, months: 12 }) === "open_renewal", "open renewal excluded");

ok(isRenewalCandidate(rider({ expiration_date: TODAY }), { today: TODAY, months: 12 }), "window includes today");
ok(isRenewalCandidate(rider({ expiration_date: "2027-10-17" }), { today: TODAY, months: 12 }), "window includes day before end");
ok(renewalExclusion(rider({ expiration_date: "2027-10-18" }), { today: TODAY, months: 12 }) === "window", "window excludes today+months");
ok(renewalExclusion(rider({ expiration_date: "2026-10-17" }), { today: TODAY, months: 12 }) === "window", "past expiry excluded");
ok(isRenewalCandidate(rider({ expiration_date: "2027-04-17" }), { today: TODAY, months: 6 }), "6 month inside edge");
ok(renewalExclusion(rider({ expiration_date: "2027-04-18" }), { today: TODAY, months: 6 }) === "window", "6 month exclusive end");
ok(isRenewalCandidate(rider({ expiration_date: "2028-04-17" }), { today: TODAY, months: 18 }), "18 month inside edge");
ok(renewalExclusion(rider({ expiration_date: "2028-04-18" }), { today: TODAY, months: 18 }) === "window", "18 month exclusive end");

ok(lostNeedsReason("lost", null), "lost without reason");
ok(lostNeedsReason("lost", ""), "lost with blank reason");
ok(lostNeedsReason("lost", "   "), "lost with whitespace reason");
ok(!lostNeedsReason("lost", "rate"), "lost with reason is ok");
ok(!lostNeedsReason("won", null), "won does not need a loss reason");
ok(!lostNeedsReason("identified", null), "open stage does not need a loss reason");

ok(wonReletNeedsRemarket({ type: "relet", stage: "won", won_rider_id: null }), "won relet without successor");
ok(!wonReletNeedsRemarket({ type: "relet", stage: "won", won_rider_id: 12 }), "won relet with successor");
ok(!wonReletNeedsRemarket({ type: "renewal", stage: "won", won_rider_id: null }), "won renewal is not a remarket");

ok(mostCommonValue(["T", "H", "T", null, " "]) === "T", "most common car type");
ok(mostCommonValue(["B", "A", "A", "B"]) === "A", "tie breaks alphabetically");
ok(mostCommonValue([null, " "]) === null, "no car type");

const previous = [
  "railcars",
  "car_commitments",
  "car_rent_stops",
  "program_cars",
  "program_car_milestones",
  "programs",
  "railcar_assignments",
  "assignment_history",
  "car_status_history",
  "car_tags",
  "car_lists",
  "car_list_members",
  "riders",
  "master_leases",
  "attachments",
];
for (const table of previous) ok(isUndoAllowedTable(table), `${table} stays undoable`);
ok(isUndoAllowedTable("opportunities"), "opportunities undoable");
ok(isUndoAllowedTable("crm_activities"), "crm_activities undoable");
ok(UNDO_ALLOWED_TABLES.includes("attachments"), "attachments remains on the allowlist");
ok(UNDO_ALLOWED_TABLES.indexOf("attachments") < UNDO_ALLOWED_TABLES.indexOf("opportunities"), "CRM tables appended after attachments");
for (const table of ["accounts", "companies", "company_contacts", "opportunity_contacts"]) {
  ok(isUndoAllowedTable(table), `${table} undoable`);
}

ok(!isPlaceholderLessee("Xcel Energy"), "Xcel Energy is not a placeholder");
ok(!isPlaceholderLessee("DTE"), "DTE is not a placeholder");
ok(isPlaceholderLessee("xIngevity") && isPlaceholderLessee("IDLE - x") && isPlaceholderLessee("available") && isPlaceholderLessee("Unassigned"), "placeholder names excluded");
ok(classifyAccountParty({ hasLessee: true, allPlaceholderLessee: false, isClient: true, name: "Xcel Energy" }) === "client", "Xcel client stays in the picker");
ok(classifyAccountParty({ hasLessee: false, allPlaceholderLessee: false, isClient: false, name: "DTE" }) === "prospect", "DTE prospect stays in the picker");
ok(classifyAccountParty({ hasLessee: false, allPlaceholderLessee: false, isClient: false, name: "xIngevity" }) === "excluded", "xIngevity excluded");
ok(classifyAccountParty({ hasLessee: true, allPlaceholderLessee: true, isClient: false, name: "IDLE - x" }) === "excluded", "placeholder lessee excluded");
ok(classifyAccountParty({ hasLessee: true, allPlaceholderLessee: false, isClient: false, name: "Georgia Pacific" }) === "former", "former client");

const tags = normalizeTags(["  Fleet ", "fleet", "Hoppers"]);
ok(tags.ok && tags.tags.join(",") === "fleet,hoppers", "tags trimmed and unique");
ok(!normalizeTags(["x".repeat(31)]).ok, "tag length rejected");
ok(!normalizeTags(Array.from({ length: 11 }, (_, i) => `t${i}`)).ok, "tag count rejected");
ok(contactBelongsToAccount(9, 9) && !contactBelongsToAccount(8, 9) && !contactBelongsToAccount(null, 9), "contact belongs to the same account");
ok(wonProspectNextStep({ type: "new_business", stage: "won", isProspect: true }) === "setup_lessee", "won prospect next step");
ok(wonProspectNextStep({ type: "renewal", stage: "won", isProspect: true }) === null, "won renewal is not lessee setup");
ok(wonProspectNextStep({ type: "expansion", stage: "won", isProspect: false }) === null, "client win does not ask for setup");
ok(wonProspectBecomesCustomer({ stage: "won", previousStage: "proposal", isProspect: true, relationshipType: "prospect" }), "won prospect company becomes a customer");
ok(!wonProspectBecomesCustomer({ stage: "won", previousStage: "won", isProspect: true, relationshipType: "prospect" }), "already-won deal does not convert again");
ok(!wonProspectBecomesCustomer({ stage: "proposal", previousStage: "identified", isProspect: true, relationshipType: "prospect" }), "open stage does not convert the company");
ok(!wonProspectBecomesCustomer({ stage: "won", previousStage: null, isProspect: false, relationshipType: "prospect" }), "client win does not convert the company");
ok(!wonProspectBecomesCustomer({ stage: "won", previousStage: null, isProspect: true, relationshipType: "customer" }), "customer company is left as a customer");
const capture = changeCaptureRow({ name: "Acme", updated_at: "now", search_vector: "vec", notes_search_vector: "n" });
ok(capture.name === "Acme" && !("updated_at" in capture) && !("search_vector" in capture) && !("notes_search_vector" in capture), "capture row drops noise");
const contactDiff = diffOpportunityContacts(
  [{ id: 1, contact_id: 4, role: "primary" }],
  [{ contact_id: 4, role: "billing" }],
);
ok(contactDiff.deleteIds.join(",") === "1" && contactDiff.insert[0]?.role === "billing", "role change deletes then inserts");

const migration = readFileSync(resolve(process.cwd(), "migrations/20261111_crm_p1_1.sql"), "utf8");
ok(migration.includes("btrim(a.name) ~ '^x[A-Z0-9&]'") && migration.includes("btrim(a.name) ~* '^(idle|available|unassigned)'"), "party search name guard matches isPlaceholderLessee");
ok(migration.includes("Must stay in sync with isPlaceholderLessee in shared/lease-mgmt.ts"), "party search guard stays in sync with isPlaceholderLessee");
ok(migration.indexOf("create table crm_umler_owner_ref") < migration.indexOf("function public.crm_prospect_dedup"), "dedup function is created after the umler table");
ok(migration.includes("'referenced since'"), "undo returns referenced since");
const undoFn = migration.slice(migration.indexOf("FUNCTION public.rlms_undo_change_group"));
ok(undoFn.indexOf("'referenced since'") < undoFn.indexOf("restored := restored + 1"), "referenced since is decided before any restore");
for (const table of ["attachments", "opportunities", "crm_activities", "accounts", "companies", "company_contacts", "opportunity_contacts"]) {
  ok(undoFn.includes(`'${table}'`), `${table} stays in the undo function`);
}
for (const entity of ["railcar", "rider", "program", "program_car", "master_lease", "account", "opportunity", "crm_activity", "company", "company_contact", "opportunity_contact"]) {
  ok(migration.includes(`'${entity}'`), `entity type ${entity} kept`);
}
ok(!migration.includes("isCrmPlaceholderName"), "migration does not invent a second name helper");

const quickOrder = undoApplyOrder([
  { id: 1, table: "accounts" },
  { id: 2, table: "companies" },
  { id: 3, table: "company_contacts" },
  { id: 4, table: "opportunities" },
  { id: 5, table: "opportunity_contacts" },
]).map((row) => row.table);
ok(quickOrder.join(",") === "opportunity_contacts,opportunities,company_contacts,companies,accounts", "quick-create undo deletes children first");
ok(referencedSinceBlocksUndo({ table: "accounts", op: "insert", outside: true }), "outside reference blocks account undo");
const refused = finalizeUndoPreview({ conflicts: [], referencedSince: true });
ok(!refused.ok && refused.status === 409 && refused.message === REFERENCED_SINCE_MESSAGE, "preview refuses with referenced since");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
