/* eslint-disable no-console */
/** Run: npx tsx client/src/lib/copy-cars.test.ts */

import {
  collectPages,
  copiedCarCount,
  copyCarLine,
  copyCarsToastTitle,
  formatCarsClipboard,
  formatCopyRows,
  resolveCarsToCopy,
  writeClipboardText,
} from "./copy-cars";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

ok(copyCarLine({ reporting_marks: "OFOX", car_number: "310100" }) === "OFOX 310100", "mark and number");
ok(copyCarLine({ reporting_marks: "ofox", car_number: "310100" }) === "OFOX 310100", "uppercases the mark");
ok(copyCarLine({ reporting_marks: "OFOX", car_number: "100" }) === "OFOX 000100", "pads a short number to six digits");
ok(copyCarLine({ marks: "KCS", number: "310100" }) === "KCS 310100", "marks/number aliases");
ok(copyCarLine({ car_initial: "TFOX", car_number: "901745" }) === "TFOX 901745", "car_initial alias");
ok(copyCarLine({ car: "OFOX 310100" }) === "OFOX 310100", "preformatted car string");
ok(copyCarLine("OFOX310100") === "OFOX 310100", "compact string");
ok(copyCarLine({}) === "", "blank identity is empty");
ok(copyCarLine(null) === "", "null is empty");

ok(
  formatCarsClipboard([
    { reporting_marks: "OFOX", car_number: "310100" },
    { reporting_marks: "", car_number: "" },
    { reporting_marks: "OFOX", car_number: "310101" },
  ]) === "OFOX 310100\nOFOX 310101",
  "one car per line, blanks dropped",
);

ok(copyCarsToastTitle(0) === "Copied 0 cars", "toast for zero");
ok(copyCarsToastTitle(1) === "Copied 1 car", "toast is singular for one car");
ok(copyCarsToastTitle(12) === "Copied 12 cars", "toast for many");

const repeated = [
  { reporting_marks: "OFOX", car_number: "310100" },
  { reporting_marks: "KCS", car_number: "100" },
  { reporting_marks: "ofox", car_number: "310100" },
  "OFOX310100",
  { reporting_marks: "TFOX", car_number: "901745" },
  { marks: "KCS", number: "100" },
] as const;
const deduped = formatCarsClipboard(repeated);
ok(
  deduped === "OFOX 310100\nKCS 000100\nTFOX 901745",
  "formatCarsClipboard keeps the first copy of each line",
);
ok(copiedCarCount(deduped) === 3, "count uses the deduped clipboard text");
ok(copyCarsToastTitle(copiedCarCount(deduped)) === "Copied 3 cars", "toast count follows the deduped list");

const oneCarTwice = formatCopyRows([
  { reporting_marks: "OFOX", car_number: "310100" },
  { reporting_marks: "OFOX", car_number: "310100" },
]);
ok(oneCarTwice === "OFOX 310100", "formatCopyRows drops a repeated identity");
ok(copiedCarCount(oneCarTwice) === 1, "a repeated car counts once");
ok(copyCarsToastTitle(copiedCarCount(oneCarTwice)) === "Copied 1 car", "one unique car is singular");

const viaLineOf = formatCopyRows(
  [
    { railcar: { reporting_marks: "TFOX", car_number: "901745" } },
    { railcar: { reporting_marks: "OFOX", car_number: "310101" } },
    { railcar: { reporting_marks: "tfox", car_number: "901745" } },
  ],
  (row) => ({
    reporting_marks: row.railcar.reporting_marks,
    car_number: row.railcar.car_number,
  }),
);
ok(viaLineOf === "TFOX 901745\nOFOX 310101", "formatCopyRows dedupes mapped lines in first-seen order");
ok(copiedCarCount(viaLineOf) === 2, "mapped duplicates do not increase the count");

type Car = { id: number; reporting_marks: string; car_number: string };
const page: Car[] = [
  { id: 1, reporting_marks: "OFOX", car_number: "310100" },
  { id: 2, reporting_marks: "OFOX", car_number: "310101" },
];
const rest: Car[] = [
  ...page,
  { id: 3, reporting_marks: "KCS", car_number: "100" },
  { id: 4, reporting_marks: "TFOX", car_number: "901745" },
];

const noneSelected = await resolveCarsToCopy({ rows: page, selectedIds: new Set<number>() });
ok(noneSelected.mode === "all" && noneSelected.rows.length === 2 && !noneSelected.fetchedAll, "empty selection copies the rows in hand");

const checked = await resolveCarsToCopy({
  rows: rest,
  selectedIds: new Set([4, 1]),
});
ok(checked.mode === "selected" && !checked.fetchedAll, "checked rows win");
ok(
  checked.rows.map((row) => row.id).join(",") === "1,4",
  "selected rows stay in list order, not click order",
);
ok(
  formatCarsClipboard(checked.rows) === "OFOX 310100\nTFOX 901745",
  "selected rows format as mark number",
);

let fetches = 0;
const pageOnly = await resolveCarsToCopy({
  rows: page,
  selectedIds: new Set([2]),
  totalCount: rest.length,
  loadAll: async () => {
    fetches += 1;
    return rest;
  },
});
ok(pageOnly.mode === "selected" && !pageOnly.fetchedAll && fetches === 0, "selection fully on the current page does not fetch");
ok(pageOnly.rows.map((row) => row.id).join(",") === "2", "current-page selection is that car");

const acrossPages = await resolveCarsToCopy({
  rows: page,
  selectedIds: [1, 4],
  totalCount: rest.length,
  loadAll: async () => {
    fetches += 1;
    return rest;
  },
});
ok(acrossPages.mode === "selected" && acrossPages.fetchedAll && fetches === 1, "a checked id on another page fetches the filtered set");
ok(acrossPages.rows.map((row) => row.id).join(",") === "1,4", "cross-page selection is filtered from the full result");

const allPages = await resolveCarsToCopy({
  rows: page,
  totalCount: rest.length,
  loadAll: async () => {
    fetches += 1;
    return rest;
  },
});
ok(allPages.mode === "all" && allPages.fetchedAll && fetches === 2, "no selection on a paged table fetches every page");
ok(allPages.rows.length === 4, "fetched result is the full filtered list");

const fits = await resolveCarsToCopy({
  rows: rest,
  totalCount: rest.length,
  loadAll: async () => {
    fetches += 1;
    return [];
  },
});
ok(fits.mode === "all" && !fits.fetchedAll && fetches === 2, "when the filtered result is already loaded, do not fetch");

const empty = await resolveCarsToCopy({
  rows: [] as Car[],
  totalCount: 0,
  loadAll: async () => {
    fetches += 1;
    return rest;
  },
});
ok(empty.rows.length === 0 && !empty.fetchedAll && fetches === 2, "an empty filter does not fetch");

const paged = await collectPages(async (pageNumber, pageSize) => {
  ok(pageSize === 2, "collectPages passes the page size");
  const start = (pageNumber - 1) * pageSize;
  return { rows: rest.slice(start, start + pageSize), total: rest.length };
}, 2);
ok(paged.map((row) => row.id).join(",") === "1,2,3,4", "collectPages walks until total");

const clipboard: string[] = [];
const previousNavigator = globalThis.navigator;
const previousDocument = globalThis.document;
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    clipboard: {
      writeText: async (text: string) => {
        clipboard.push(`clip:${text}`);
      },
    },
  },
});
await writeClipboardText("OFOX 310100");
ok(clipboard.join("|") === "clip:OFOX 310100", "uses navigator.clipboard.writeText");

Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    clipboard: {
      writeText: async () => {
        throw new Error("denied");
      },
    },
  },
});
const area = { value: "", style: {} as CSSStyleDeclaration, focus() {}, select() {}, setAttribute() {} };
Object.defineProperty(globalThis, "document", {
  configurable: true,
  value: {
    body: { appendChild() {}, removeChild() {} },
    createElement() {
      return area;
    },
    execCommand(command: string) {
      if (command === "copy") {
        clipboard.push(`fallback:${area.value}`);
        return true;
      }
      return false;
    },
  },
});
await writeClipboardText("KCS 000100");
ok(clipboard[1] === "fallback:KCS 000100", "falls back to textarea execCommand");

Object.defineProperty(globalThis, "navigator", { configurable: true, value: previousNavigator });
Object.defineProperty(globalThis, "document", { configurable: true, value: previousDocument });

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
