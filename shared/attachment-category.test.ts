/* eslint-disable no-console */
/** Run: npx tsx shared/attachment-category.test.ts */

import {
  OPP_DOC_CATEGORIES,
  OPP_DOC_CATEGORY_LABEL,
  attachmentDownloadHeaders,
  bidFileCategoryCounts,
  filterBidFiles,
  isOppDocCategory,
  opportunityFileLineLabel,
  suggestCategory,
} from "./attachment-category";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

const values = OPP_DOC_CATEGORIES.map((row) => row.value);
ok(values.join(",") === "bid_sheet,drawings,inspection,correspondence,pricing,legal,other", "category list is the fixed bid set");
ok(OPP_DOC_CATEGORY_LABEL.bid_sheet === "Bid sheet / Car list", "bid sheet label");
ok(OPP_DOC_CATEGORY_LABEL.correspondence === "Correspondence", "correspondence label");
ok(isOppDocCategory("pricing") && !isOppDocCategory("likely_executed") && !isOppDocCategory("doc_class"), "only bid categories pass");

ok(suggestCategory("note.msg") === "correspondence", ".msg suggests correspondence");
ok(suggestCategory("note.eml") === "correspondence", ".eml suggests correspondence");
ok(suggestCategory("model.xlsx") === "pricing", ".xlsx suggests pricing");
ok(suggestCategory("model.xls") === "pricing", ".xls suggests pricing");
ok(suggestCategory("cars.csv") === "pricing", ".csv suggests pricing");
ok(suggestCategory("scan.pdf") === "other", "default category is other");
ok(suggestCategory("not-an-xls.xlsx") === "pricing", ".xlsx is not treated as .xls");

const msg = attachmentDownloadHeaders("thread.msg", "application/octet-stream");
ok(msg.contentType === "application/vnd.ms-outlook" && msg.disposition === "attachment", ".msg downloads");
const eml = attachmentDownloadHeaders("thread.eml", "text/plain");
ok(eml.contentType === "message/rfc822" && eml.disposition === "attachment", ".eml downloads");
const pdf = attachmentDownloadHeaders("bid.pdf", "application/octet-stream");
ok(pdf.contentType === "application/pdf" && pdf.disposition === "inline", "pdf stays inline");

const rows = [
  { id: 1, doc_category: "pricing", opportunity_line_id: 7 },
  { id: 2, doc_category: "correspondence", opportunity_line_id: null },
  { id: 3, doc_category: null, opportunity_line_id: 7 },
  { id: 4, doc_category: "drawings", opportunity_line_id: 8 },
];
const onDeal = filterBidFiles(rows, { category: "all", line: 7 });
ok(onDeal.map((row) => row.id).join(",") === "1,3", "deal filter keeps that line");
ok(filterBidFiles(rows, { category: "all", line: "none" }).map((row) => row.id).join(",") === "2", "offering only");
ok(filterBidFiles(onDeal, { category: "pricing", line: "all" }).map((row) => row.id).join(",") === "1", "category chip filters inside the deal");
const counts = bidFileCategoryCounts(onDeal);
ok(counts.pricing === 1 && counts.other === 1 && counts.drawings === 0, "chip counts follow the deal filter");
ok(opportunityFileLineLabel("7", "ACME") === "7 – ACME", "deal label");
ok(opportunityFileLineLabel("8", null) === "8", "deal label without a lessee");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
