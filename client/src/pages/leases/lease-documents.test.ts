/* eslint-disable no-console */
/** Run: npx tsx client/src/pages/leases/lease-documents.test.ts */

import {
  documentCountLabel,
  filterLeaseDocs,
  groupLeaseDocs,
  type LeaseDoc,
} from "./lease-documents";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

function doc(partial: Pick<LeaseDoc, "id" | "file_name" | "doc_class" | "source_modified"> & Partial<LeaseDoc>): LeaseDoc {
  return {
    file_size: 1000,
    mime_type: "application/pdf",
    source_path: null,
    source: null,
    ...partial,
  };
}

ok(documentCountLabel(0) === "No contract on file", "zero attachments keeps the empty phrase");
ok(documentCountLabel(1) === "1 document", "singular");
ok(documentCountLabel(12) === "12 documents", "plural count");

const rows = [
  doc({ id: 1, file_name: "Amend No 1.pdf", doc_class: "Lease Docs", source_modified: "2017-08-28" }),
  doc({ id: 2, file_name: "Signature old.pdf", doc_class: "Signature Pages", source_modified: "2017-08-28" }),
  doc({ id: 3, file_name: "Amend No 4.pdf", doc_class: "Lease Docs", source_modified: "2021-07-08" }),
  doc({ id: 4, file_name: "Signature newer.pdf", doc_class: "Signature Pages", source_modified: "2020-08-28" }),
  doc({ id: 5, file_name: "Undated.pdf", doc_class: null, source_modified: null }),
];

const groups = groupLeaseDocs(rows);
ok(groups.map((g) => g.label).join("|") === "Lease Docs|Signature Pages|Other", "newest group first, undated last");
ok(groups[0].docs.map((d) => d.id).join(",") === "3,1", "lease docs newest first");
ok(groups[1].docs.map((d) => d.id).join(",") === "4,2", "signature pages newest first");

const onlySig = filterLeaseDocs(rows, { docClass: "Signature Pages" });
ok(onlySig.length === 2 && onlySig.every((d) => d.doc_class === "Signature Pages"), "doc class filter");
ok(filterLeaseDocs(rows, { q: "amend no 4" }).length === 1, "name filter");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
