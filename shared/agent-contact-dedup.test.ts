/* eslint-disable no-console */
/** Run: npx tsx shared/agent-contact-dedup.test.ts */

import {
  cleanCompanyName,
  classifySharedEmail,
  classifyCompanyPair,
  orgNameFromDomain,
} from "./agent-contact-dedup";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

ok(cleanCompanyName("BASF Corporation") !== cleanCompanyName("Cleco Corporation") || cleanCompanyName("BASF Corporation") === "basf", "BASF vs Cleco do not collapse to corporation");
ok(cleanCompanyName("BASF Corporation") === "basf", "BASF strips corporation");
ok(cleanCompanyName("Cleco Corporation") === "cleco", "Cleco strips corporation");
ok(cleanCompanyName("Midwest Railcar") === "midwestrailcar", "Midwest Railcar cleans to domain-like root");
ok(orgNameFromDomain("mmcfarlane@midwestrailcar.com") === "Midwest Railcar", "lookup/pretty midwest");
ok(orgNameFromDomain("x@alltranstek.com") === "Alltranstek", "seed lookup alltranstek");

const mcFarlane = classifySharedEmail("mmcfarlane@midwestrailcar.com", [
  { contactId: 1, companyId: 10, companyName: "Farmers Elevator Inc." },
  { contactId: 2, companyId: 20, companyName: "Midwest Railcar" },
]);
ok(mcFarlane?.outcome === "single_home", "McFarlane single home");
ok(mcFarlane?.outcome === "single_home" && mcFarlane.homeCompanyId === 20, "home is Midwest Railcar");
ok(mcFarlane?.outcome === "single_home" && mcFarlane.tagContactIds.includes(1) && !mcFarlane.tagContactIds.includes(2), "tag Farmers copy only");

const alltran = classifySharedEmail("a@alltranstek.com", [
  { contactId: 3, companyId: 30, companyName: "Heidelberg Materials" },
  { contactId: 4, companyId: 31, companyName: "Nucor" },
]);
ok(alltran?.outcome === "zero_home", "Alltranstek zero home");
ok(alltran?.outcome === "zero_home" && alltran.tagContactIds.length === 2, "tag every appearance");

const abc = classifyCompanyPair({
  nameA: "ABC Recycling Inc",
  nameB: "ABC Recycling Ltd",
  marksA: ["AAAA"],
  marksB: ["BBBB"],
});
ok(abc.kind === "company_family", "ABC Inc/Ltd with distinct marks is family not duplicate");

const sw = classifyCompanyPair({
  nameA: "Southwest Rail Industries",
  nameB: "Southwest Rail Industries LLC",
  marksA: ["TJRX"],
  marksB: ["NTLX"],
});
ok(sw.kind === "company_family", "Southwest pair with TJRX vs NTLX is family");

console.log(`passed ${passed} failed ${failed}`);
if (failed) process.exit(1);
