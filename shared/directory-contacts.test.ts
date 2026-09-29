/* eslint-disable no-console */
/** Run: npx tsx shared/directory-contacts.test.ts */

import { leftoverLegacyContacts, riderContactDedupeKey, companyNameForRider, pickUniqueCompanyByCleanName, pickUniqueCompanyByPrefix, pickUniqueCompanyStartingWith, pickUniqueCompanyForLessee, directoryCleanName, isPlaceholderLessee, wizardRiderContactBody } from "./directory-contacts";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

ok(riderContactDedupeKey("A@X.com", "Jane") === riderContactDedupeKey("a@x.com", " jane "), "dedupe key is case/space insensitive");
ok(
  leftoverLegacyContacts(
    [{ name: "Jane", email: "jane@x.com" }],
    [{ name: "Jane", email: "jane@x.com" }, { name: "Bob", email: null }],
  ).map((c) => c.name).join(",") === "Bob",
  "leftover keeps unmatched legacy rows",
);
ok(companyNameForRider({ lessee: "Agrex", riderName: "OL1" }) === "Agrex", "company name prefers lessee");
ok(companyNameForRider({ riderName: "OL 12" }) === "OL 12", "falls back to rider name");
ok(companyNameForRider({}) === "Unnamed company", "unnamed fallback");
ok(
  pickUniqueCompanyByCleanName("xSultran", [{ id: 1, name: "Sultran LTD" }])?.id === 1,
  "x-prefix lessee matches cleaned company",
);
ok(
  pickUniqueCompanyByCleanName("Occidental Chemical Corp", [{ id: 2, name: "Occidental Chemical Corporation" }])?.id === 2,
  "Corp vs Corporation matches",
);
ok(
  pickUniqueCompanyByCleanName("Acme", [{ id: 3, name: "Acme Inc" }, { id: 4, name: "Acme LLC" }]) === null,
  "ambiguous cleaned names are not auto-picked",
);
ok(
  pickUniqueCompanyByPrefix("Detroit Salt", [{ id: 93, name: "The Detroit Salt Company Lc" }])?.id === 93,
  "prefix matches Detroit Salt to The Detroit Salt Company",
);
ok(
  pickUniqueCompanyByPrefix("Trinity", [{ id: 250, name: "Trinity Industries Leasing Company" }]) === null,
  "does not attach a short lessee to a leasing company",
);
ok(
  pickUniqueCompanyByPrefix("GEON", [{ id: 128, name: "Geon Performance Solutions LLC" }]) === null,
  "short brand tokens are not prefix-matched",
);
ok(
  directoryCleanName("Alpek Polyester (xTrinity)") === directoryCleanName("Alpek Polyester"),
  "parenthetical sold-to is ignored for matching",
);
ok(
  pickUniqueCompanyByPrefix("Alpek Polyester (xTrinity)", [{ id: 31, name: "Alpek Polyester USA LLC" }])?.id === 31,
  "Alpek (xTrinity) prefix-matches Alpek Polyester USA",
);
ok(
  pickUniqueCompanyStartingWith("GEON", [{ id: 128, name: "Geon Performance Solutions LLC" }])?.id === 128,
  "short unique lessee starts the company name",
);
ok(
  pickUniqueCompanyStartingWith("Ineos", [
    { id: 1, name: "Ineos Pigments USA INC" },
    { id: 2, name: "Ineos Olefins & Polymers USA A Division of Ineos USA LLC" },
  ]) === null,
  "ambiguous Ineos affiliates are not auto-picked",
);
ok(
  pickUniqueCompanyStartingWith("Canadian Pacific", [{ id: 9, name: "Canadian National Railways" }]) === null,
  "does not attach CP to CN via a shared first word",
);
ok(isPlaceholderLessee("IDLE (xAxiall)"), "idle sold-to is not a company match target");
ok(isPlaceholderLessee("Available Equipment"), "available equipment is a placeholder lessee");
ok(!isPlaceholderLessee("Agrex, Inc."), "real lessees are not placeholders");
ok(
  pickUniqueCompanyForLessee("IDLE (xDow)", [{ id: 1, name: "Dow" }]) === null,
  "placeholder lessees are not unique-linked",
);
ok(
  pickUniqueCompanyForLessee("GEON", [{ id: 128, name: "Geon Performance Solutions LLC" }])?.id === 128,
  "unique lessee chains to starts-with",
);
ok(wizardRiderContactBody({ contact_name: "  ", contact_title: "Mgr", contact_email: "a@b.com", contact_phone: "1" }) === undefined, "blank name skips wizard contact");
ok(
  JSON.stringify(wizardRiderContactBody({ contact_name: " Jane ", contact_title: " Mgr ", contact_email: "", contact_phone: "555" }))
    === JSON.stringify({ name: "Jane", title: "Mgr", email: null, phone: "555" }),
  "wizard contact trims and nulls empty email",
);

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
