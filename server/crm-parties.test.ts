/* eslint-disable no-console */
/** Run: npx tsx server/crm-parties.test.ts */

import { CrmHttpError } from "./crm-error";
import {
  createProspectInMemory,
  createQuickDealInMemory,
  dedupProspectsInMemory,
  emptyPartyMemory,
  markProspectCompanyCustomerInMemory,
  promoteCompanyInMemory,
  searchPartiesInMemory,
  type PartyMemory,
} from "./crm-parties-core";
import { undoApplyOrder } from "@shared/undo";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

function seed(): PartyMemory {
  const db = emptyPartyMemory();
  db.seq = 10;
  db.accounts.push(
    { id: 1, name: "Xcel Energy", account_manager: "AM" },
    { id: 2, name: "DTE", account_manager: null },
    { id: 3, name: "xIngevity", account_manager: null },
    { id: 4, name: "IDLE - x", account_manager: null },
    { id: 5, name: "available", account_manager: null },
    { id: 6, name: "Unassigned", account_manager: null },
  );
  db.leases.push({ account_id: 1, is_placeholder: false });
  db.clientAccountIds.push(1);
  db.companies.push({
    id: 7,
    name: "Loose Co",
    account_id: null,
    relationship_type: "prospect",
    status: "target",
    source: null,
    reporting_marks: ["GATX"],
    merged_into_id: null,
  });
  db.umler.push({ id: 8, reporting_mark: "GATX", owner_group: "GATX Owner", umler_owner: "GATX" });
  return db;
}

const visible = searchPartiesInMemory(seed(), "", 50).map((row) => row.label);
ok(visible.includes("Xcel Energy"), "Xcel Energy is searchable");
ok(visible.includes("DTE"), "DTE is searchable");
ok(!visible.some((label) => /xIngevity|IDLE|available|Unassigned/i.test(label)), "placeholder names stay out of search");

const db = seed();
const created = createProspectInMemory(
  db,
  { name: "Test Prospect Co", company_type: "prospect", reporting_marks: ["abc"], contact: { name: "Ada", email: "ada@example.com" } },
  "g1",
);
ok(created.account_id > 0 && created.company_id != null && created.contact_id != null, "quick-create returns account, company, and contact");
ok(db.companies.filter((row) => row.account_id === created.account_id).length === 1, "one company for the new account");
const shown = searchPartiesInMemory(db, "Test Prospect", 20).find((row) => row.account_id === created.account_id);
ok(shown?.kind === "prospect", "picker shows the new account as a prospect");
let duplicate = false;
try {
  createProspectInMemory(db, { name: "test prospect co", company_type: "prospect" }, "g2");
} catch (err) {
  duplicate = err instanceof CrmHttpError && err.status === 409 && err.body.account_id === created.account_id;
}
ok(duplicate, "same name again is 409 with the existing account");

const beforeReuse = db.log.filter((row) => row.table === "accounts" && row.op === "insert").length;
createProspectInMemory(db, { name: "ignored", company_type: "prospect", use_existing: { kind: "account", id: created.account_id } }, "g3");
ok(db.log.filter((row) => row.table === "accounts" && row.op === "insert").length === beforeReuse, "reused account is not logged as an insert");
ok(db.log.every((row) => !("updated_at" in row.after) && !("search_vector" in row.after)), "diffs omit updated_at and search_vector");

const promoted = promoteCompanyInMemory(db, 7, "g4");
ok(promoted.company_id === 7 && db.companies.filter((row) => row.name === "Loose Co").length === 1, "promote sets account_id and does not add a second company");
let clash = false;
try {
  const other = emptyPartyMemory();
  other.seq = 20;
  other.accounts.push({ id: 1, name: "Acme", account_manager: null });
  other.companies.push(
    { id: 2, name: "Acme Linked", account_id: 1, relationship_type: "customer", status: "target", source: null, reporting_marks: [], merged_into_id: null },
    { id: 3, name: "Acme", account_id: null, relationship_type: "prospect", status: "target", source: null, reporting_marks: [], merged_into_id: null },
  );
  promoteCompanyInMemory(other, 3, "g5");
} catch (err) {
  clash = err instanceof CrmHttpError && err.status === 409 && err.message.startsWith("Already linked to");
}
ok(clash, "exact-name account that already has a company is 409");

let placeholder = false;
try {
  createProspectInMemory(emptyPartyMemory(), { name: "xIngevity", company_type: "prospect" }, "g6");
} catch (err) {
  placeholder = err instanceof CrmHttpError && err.status === 400;
}
ok(placeholder, "placeholder prospect name is 400");

const dealDb = emptyPartyMemory();
createQuickDealInMemory(dealDb, { name: "Deal Co", company_type: "railroad", contact: { name: "Bea" }, opportunity: true }, "deal");
const tables = dealDb.log.map((row) => row.table).join(",");
ok(tables === "accounts,companies,company_contacts,opportunities,opportunity_contacts", "combined group inserts parent before child");
ok(
  undoApplyOrder(dealDb.log).map((row) => row.table).join(",") === "opportunity_contacts,opportunities,company_contacts,companies,accounts",
  "undo of that group deletes children first",
);

const dedup = dedupProspectsInMemory(seed(), "GATX Owner", ["GATX"]);
ok(dedup.some((row) => row.source === "umler" && row.reporting_marks.includes("GATX")), "UMLER hit keeps the mark");
ok(dedupProspectsInMemory(seed(), "", []).length === 0, "blank name does not match everything");

function linkedCompany(relationship: string): PartyMemory {
  const memory = emptyPartyMemory();
  memory.seq = 30;
  memory.accounts.push({ id: 1, name: "Won Prospect", account_manager: null });
  memory.companies.push({
    id: 2,
    name: "Won Prospect",
    account_id: 1,
    relationship_type: relationship,
    status: "target",
    source: "crm_quick_create",
    reporting_marks: [],
    merged_into_id: null,
  });
  return memory;
}

const wonDb = linkedCompany("prospect");
ok(
  markProspectCompanyCustomerInMemory(wonDb, 1, "won", { previousStage: "proposal", isProspect: true }),
  "winning a prospect deal updates the linked company",
);
ok(wonDb.companies[0]?.relationship_type === "customer", "linked company relationship is customer");
const companyLog = wonDb.log.filter((row) => row.table === "companies");
ok(
  companyLog.length === 1 && companyLog[0]?.op === "update" && companyLog[0].after.relationship_type === "customer",
  "change capture logs the company update",
);
ok(
  companyLog[0]?.before.relationship_type === "prospect" && !("updated_at" in companyLog[0].after) && !("search_vector" in companyLog[0].after),
  "company update diff keeps the old relationship and drops noise",
);
ok(
  !markProspectCompanyCustomerInMemory(wonDb, 1, "won-again", { previousStage: "won", isProspect: true }) &&
    wonDb.log.filter((row) => row.table === "companies").length === 1,
  "an already-won deal does not rewrite the company",
);

const clientDeal = linkedCompany("prospect");
ok(
  !markProspectCompanyCustomerInMemory(clientDeal, 1, "client", { previousStage: "proposal", isProspect: false }) &&
    clientDeal.companies[0]?.relationship_type === "prospect" &&
    clientDeal.log.length === 0,
  "a client win leaves the company relationship alone",
);

const alreadyCustomer = linkedCompany("customer");
ok(
  !markProspectCompanyCustomerInMemory(alreadyCustomer, 1, "customer", { previousStage: null, isProspect: true }) &&
    alreadyCustomer.log.length === 0,
  "a company that is already a customer is not logged again",
);

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
