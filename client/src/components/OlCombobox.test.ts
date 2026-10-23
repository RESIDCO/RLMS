/* eslint-disable no-console */
/** Run: npx tsx client/src/components/OlCombobox.test.ts */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OlCombobox } from "./OlCombobox";

const riders = [
  { id: 1, rider_name: "OL100", lessee: "Old Lessee", car_count: 4 },
  { id: 2, rider_name: "OL200", lessee: "Covia", car_count: 12 },
];

function render(query: string) {
  return renderToStaticMarkup(
    createElement(OlCombobox, {
      query,
      onQueryChange: () => undefined,
      riders,
      onSelect: () => undefined,
      onCreateNew: () => undefined,
      open: true,
    }),
  );
}

let failed = 0;
function ok(cond: boolean, label: string) {
  if (!cond) {
    failed += 1;
    console.error("FAIL", label);
  }
}

const empty = render("");
ok(empty.includes('value=""'), "search starts empty");
ok(empty.includes("OL100") && empty.includes("OL200"), "chevron list includes every OL, not only the current one");
ok(empty.includes("Old Lessee") && empty.includes("Covia"), "list shows the lessee");
ok(empty.includes("4 cars") && empty.includes("12 cars"), "list shows the car count");
ok(empty.includes("+ Create new OL"), "create is an explicit option");
ok(!empty.includes("new codes are accepted"), "helper does not accept new codes");
ok(empty.includes("No matching OLs.") === false, "empty search is not an empty result");

const filtered = render("Covia");
ok(filtered.includes("OL200") && !filtered.includes("OL100"), "typed search narrows the list");
ok(filtered.includes("+ Create new OL"), "create stays available while filtering");

const mistype = render("OL999");
ok(mistype.includes("No matching OLs."), "a mistype is not offered as a new OL");
ok(!mistype.includes("ol-option-"), "a mistype selects no rider");
ok(mistype.includes("+ Create new OL"), "the mistype can only proceed through Create new OL");

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log(`ol combobox render ok`);
