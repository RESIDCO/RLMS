/* eslint-disable no-console */
/** Run: npx tsx client/src/lib/grid-column-layout.test.ts */

import { BID_LINE_COLUMNS, BID_LINE_PRICE_KEYS } from "../components/crm/bid-grid-columns";
import {
  WRAP_TEXT_KEYS,
  cellTooltip,
  columnMinWidth,
  defaultLayout,
  displayColumns,
  headerMinWidth,
  parseStoredLayout,
  reorderGrid,
  resizeGrid,
} from "./grid-column-layout";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

const purchase = BID_LINE_COLUMNS.find((column) => column.key === "purchase_option");
ok(purchase != null && columnMinWidth(purchase) >= headerMinWidth("Purchase option"), "purchase option header sets the minimum width");
ok(headerMinWidth("Winning $/car") >= 72, "price header has a floor");
ok(WRAP_TEXT_KEYS.has("commodity") && WRAP_TEXT_KEYS.has("equipment_desc") && WRAP_TEXT_KEYS.has("notes"), "long text columns wrap");
ok(cellTooltip("  Plastic pellets  ") === "  Plastic pellets", "a commodity value is the hover tooltip");
ok(cellTooltip("   ") == null, "blank values have no tooltip");

const hiddenPrices = new Set<string>(BID_LINE_PRICE_KEYS);
const stored = ["commodity", "prelim_price_per_car", "seller_deal_ref", "notes"];
const visible = displayColumns(BID_LINE_COLUMNS, stored, hiddenPrices).map((column) => column.key);
ok(!visible.some((key) => hiddenPrices.has(key)), "viewer layout hides price columns");
ok(visible[0] === "commodity" && visible.includes("seller_deal_ref") && visible.includes("notes"), "viewer order keeps the saved non-price columns");
ok(visible.at(-1) === "_actions", "pinned actions stay at the end");

const editor = displayColumns(BID_LINE_COLUMNS, stored, new Set()).map((column) => column.key);
ok(editor.includes("prelim_price_per_car"), "editor layout still has the price column from the same saved order");

const moved = reorderGrid(BID_LINE_COLUMNS, defaultLayout(BID_LINE_COLUMNS).order, "notes", "seller_deal_ref");
ok(moved[0] === "notes" && moved.includes("prelim_price_per_car") && moved.at(-3) === "_total", "reorder keeps price columns and pins the trailing columns");

const narrow = parseStoredLayout(JSON.stringify({ order: ["nope", "notes"], widths: { notes: 10, commodity: 400 } }), BID_LINE_COLUMNS);
const notes = BID_LINE_COLUMNS.find((column) => column.key === "notes");
ok(notes != null && narrow.widths.notes === columnMinWidth(notes), "a saved width below the header minimum is raised");
ok(narrow.widths.commodity === 400, "a wider saved width is kept");
ok(narrow.order[0] === "notes" && !narrow.order.includes("nope") && narrow.order.includes("equipment_desc"), "unknown keys drop and new columns are appended");
ok(resizeGrid(BID_LINE_COLUMNS, narrow.widths, "notes", 40).notes === columnMinWidth(notes!), "drag cannot shrink a header below its label");

const reset = defaultLayout(BID_LINE_COLUMNS);
ok(reset.order[0] === "seller_deal_ref" && reset.widths.notes >= columnMinWidth(notes!), "reset restores the default order and widths");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
