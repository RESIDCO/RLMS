/* eslint-disable no-console */
/** Run: npx tsx server/crm-bid-import.unit.test.ts */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BID_IMPORT_MAX_BYTES,
  BID_IMPORT_MAX_CELL,
  BidImportError,
  assertBidUpload,
  bidImportOpportunityError,
  bidImportRoleAllowed,
  inspectXlsxZip,
  parseBidWorkbook,
  sanitizeImportedLine,
  type ImportGrid,
} from "../shared/bid-import";
import { commitBidImport, revertPlan, type ImportLogRow } from "./crm-bid-import-commit";
import { gridsFromXlsx } from "./crm-bid-import-read";
import { buildBidImportTemplate } from "./crm-bid-import-template";
import { BID_IMPORT_TOKEN_TTL_MS, bidImportMacKey, fileSha256, signBidImportToken, verifyBidImportToken } from "./crm-bid-import-token";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

function grid(name: string, rows: ImportGrid["rows"]): ImportGrid {
  return { name, rows };
}

function zipEntry(name: string, compressed: number, uncompressed: number): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  const cd = new Uint8Array(46 + nameBytes.length);
  const view = new DataView(cd.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint32(20, compressed, true);
  view.setUint32(24, uncompressed, true);
  view.setUint16(28, nameBytes.length, true);
  cd.set(nameBytes, 46);
  const eocd = new Uint8Array(22);
  const end = new DataView(eocd.buffer);
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, 1, true);
  end.setUint16(10, 1, true);
  end.setUint32(12, cd.length, true);
  const out = new Uint8Array(cd.length + eocd.length);
  out.set(cd, 0);
  out.set(eocd, cd.length);
  return out;
}

const GOLDEN: Array<[string, number, string, string, number, boolean]> = [
  ["1", 98, "Lessee A – Building Materials Producer", "2038-06-30", 576.89, true],
  ["2", 84, "Lessee B – Soybean Processor", "2029-12-31", 475, false],
  ["3a", 48, "Lessee C – Petrochemical Manufacturer", "2029-03-31", 97.65, true],
  ["3b", 98, "Lessee C – Petrochemical Manufacturer", "2029-03-31", 133.92, true],
  ["3c", 373, "Lessee C – Petrochemical Manufacturer", "2029-03-31", 304.6, true],
  ["4", 333, "Lessee D – Intergrated Energy Company", "2031-10-31", 684.59, true],
  ["5", 333, "Lessee D – Intergrated Energy Company", "2034-02-28", 669.31, true],
  ["6", 23, "Lessee E – Cement Producer", "2031-06-30", 437.07, true],
  ["7", 31, "Lessee E – Cement Producer", "2029-06-30", 506.76, true],
  ["8", 33, "Lessee E – Cement Producer", "2027-06-30", 608.86, true],
  ["9", 40, "Lessee F – Cement Producer", "2032-06-30", 422.45, true],
  ["10", 41, "Lessee F – Cement Producer", "2029-06-30", 506.76, true],
  ["11", 22, "Lessee G – Ingredients Manufacturer", "2029-09-30", 540, false],
  ["12", 41, "Lessee G – Ingredients Manufacturer", "2029-09-30", 490, false],
  ["13", 290, "Lessee H – Class I Railroad", "2031-09-30", 425, false],
  ["14", 148, "Lessee H – Class I Railroad", "2031-09-30", 475, false],
  ["15", 198, "Lessee I – Steel Products Manufacturer", "2032-01-31", 436.58, true],
  ["16", 195, "Lessee I – Steel Products Manufacturer", "2038-12-31", 675.51, true],
  ["17", 231, "Lessee J – Steel Products Manufacturer", "2030-06-30", 554.58, true],
  ["18", 294, "Lessee K – Class I Railroad", "2028-09-30", 420, true],
  ["19", 220, "Lessee L – Aggregates Producer", "2035-03-31", 640.36, true],
  ["20", 182, "Lessee M – Agricultural Merchandiser", "2028-11-30", 558.99, true],
  ["21", 94, "Lessee G – Ingredients Manufacturer", "2029-10-31", 615, false],
];

async function main() {
  const bytes = readFileSync(join(import.meta.dirname, "../tests/fixtures/bflx-offering-summary-october-2026.xlsx"));
  const golden = parseBidWorkbook(await gridsFromXlsx(bytes), { today: "2026-10-20" });
  ok(golden.lines.length === 23, `golden line count ${golden.lines.length}`);
  ok(golden.car_total === 3450 && golden.stated_car_total === 3450, `golden cars ${golden.car_total}`);
  ok(golden.flags.some((flag) => flag.message === "Deal 3 (3 groups)"), "deal 3 is flagged as 3 groups");
  ok(golden.price_columns.length === 0, "the offering summary has no price column");
  golden.lines.forEach((line, index) => {
    const expected = GOLDEN[index];
    const rate = line.lease_rate ?? NaN;
    ok(
      expected != null
        && line.seller_deal_ref === expected[0]
        && line.car_count === expected[1]
        && line.lessee_desc === expected[2]
        && line.lease_expiry === expected[3]
        && Math.abs(rate - expected[4]) < 0.001
        && line.purchase_option === expected[5]
        && line.car_type == null
        && !("prelim_price_per_car" in line)
        && !("final_price_per_car" in line)
        && !("market_price_per_car" in line),
      `golden line ${expected?.[0] ?? index}`,
    );
  });
  ok(golden.lines[0]?.notes === "OM p.9; Country-specific taxes may apply", "deal 1 notes");
  ok(golden.lines[2]?.notes === "OM p.16; Deal 3 is one indivisible rider (3a/3b/3c)", "deal 3a notes");

  const header = ["Deal", "Lessee", "Cars"];
  const tooMany = [header, ...Array.from({ length: 2001 }, (_, index) => [String(index + 1), "Lessee", 1])];
  let rowError = "";
  try {
    parseBidWorkbook([grid("Lines", tooMany)]);
  } catch (err) {
    rowError = err instanceof Error ? err.message : "";
  }
  ok(/2000 lines/.test(rowError), `more than 2,000 lines is rejected (${rowError})`);
  let colError = "";
  try {
    parseBidWorkbook([grid("Lines", [Array.from({ length: 201 }, () => "Deal")])])
  } catch (err) {
    colError = err instanceof Error ? err.message : "";
  }
  ok(/200 columns/.test(colError), "more than 200 columns is rejected");
  let sheetError = "";
  try {
    parseBidWorkbook(Array.from({ length: 51 }, (_, index) => grid(`S${index}`, [header, ["1", "A", 1]])));
  } catch (err) {
    sheetError = err instanceof Error ? err.message : "";
  }
  ok(/50 sheets/.test(sheetError), "more than 50 sheets is rejected");

  const long = "x".repeat(BID_IMPORT_MAX_CELL + 1);
  const truncated = parseBidWorkbook([grid("Lines", [header, ["1", long, 2], [null, null, 9]])]);
  ok(truncated.lines[0]?.lessee_desc?.length === BID_IMPORT_MAX_CELL, "an over-long cell is truncated");
  ok(truncated.flags.some((flag) => flag.id === "truncated"), "truncation is flagged");
  ok(truncated.flags.some((flag) => flag.id === "car_total" && flag.severity === "block"), "a stated car total that does not match blocks");

  const groups = parseBidWorkbook([grid("Lines", [header, ["1", "Alpha", 10], ["", "Beta", 4]])]);
  ok(groups.lines.every((line) => line.seller_deal_ref === "1"), "a blank deal ref stays under the deal above it");
  ok(groups.flags.some((flag) => flag.message === "Deal 1 (2 groups)"), "blank-ref sub-groups are labelled");

  const priced = parseBidWorkbook([grid("Lines", [["Deal", "Lessee", "Cars", "Price per car"], ["1", "Alpha", 3, 100]])]);
  ok(priced.price_columns.length === 1 && !("prelim_price_per_car" in priced.lines[0]), "a price column is flagged and not copied onto the line");

  const cleaned = sanitizeImportedLine({ seller_deal_ref: "9", car_count: 4, prelim_price_per_car: 99, final_price_per_car: 88 }, 1);
  ok(cleaned.seller_deal_ref === "9" && !("prelim_price_per_car" in cleaned), "commit drops price fields");

  const template = parseBidWorkbook(await gridsFromXlsx(await buildBidImportTemplate()), { today: "2026-10-20" });
  ok(template.lines.length === 1 && template.lines[0]?.car_count === 10, "the template round-trips one sample line");
  const confidences = Object.values(template.lines[0]?.confidence ?? {});
  ok(confidences.length > 0 && confidences.every((level) => level === "high"), "template columns map at high confidence");

  const mapped = parseBidWorkbook([grid("Lines", [["Ref", "Customer", "Units"], ["7", "Kept", 3]])], {
    mapping: { seller_deal_ref: 0, lessee_desc: 1, car_count: 2 },
  });
  ok(mapped.lines[0]?.seller_deal_ref === "7" && mapped.lines[0]?.car_count === 3, "a saved mapping assigns columns");

  ok(!bidImportRoleAllowed("viewer") && bidImportRoleAllowed("editor") && bidImportRoleAllowed("admin"), "viewers cannot import");
  ok(bidImportOpportunityError(null)?.status === 404, "a missing opportunity is refused");
  ok(bidImportOpportunityError({ flavor: "portfolio_bid", stage: "qualified", deleted_at: "2026-01-01" })?.status === 400, "a deleted opportunity is refused");
  ok(bidImportOpportunityError({ flavor: null, stage: "qualified", deleted_at: null })?.message.includes("portfolio"), "a non-bid opportunity is refused");
  ok(bidImportOpportunityError({ flavor: "portfolio_bid", stage: "won", deleted_at: null }) != null, "a won opportunity is refused");
  ok(bidImportOpportunityError({ flavor: "portfolio_bid", stage: "closed", deleted_at: null }) != null, "a closed opportunity is refused");

  let nameError = "";
  try { assertBidUpload({ filename: "book.xls", byteLength: 10, bytes: new Uint8Array() }); } catch (err) { nameError = err instanceof Error ? err.message : ""; }
  ok(/\.xls/.test(nameError), ".xls is rejected");
  let macroName = "";
  try { assertBidUpload({ filename: "book.xlsm", byteLength: 10, bytes: new Uint8Array() }); } catch (err) { macroName = err instanceof Error ? err.message : ""; }
  ok(/xlsm/.test(macroName), ".xlsm is rejected");
  let sizeError: BidImportError | null = null;
  try { assertBidUpload({ filename: "book.csv", byteLength: BID_IMPORT_MAX_BYTES + 1 }); } catch (err) { sizeError = err instanceof BidImportError ? err : null; }
  ok(sizeError?.status === 413, "a file over 20 MB is rejected without reading it");
  const vba = inspectXlsxZip(zipEntry("xl/vbaProject.bin", 20, 20));
  ok(!vba.ok && /macro/i.test(vba.ok ? "" : vba.error), "a workbook with vbaProject.bin is rejected");
  const bomb = inspectXlsxZip(zipEntry("xl/workbook.xml", 10, 10 * 101));
  ok(!bomb.ok && /zip bomb/i.test(bomb.ok ? "" : bomb.error), "a zip bomb ratio is rejected");
  const huge = inspectXlsxZip(zipEntry("xl/workbook.xml", 1000, 101 * 1024 * 1024));
  ok(!huge.ok && /100 MB/.test(huge.ok ? "" : huge.error), "an uncompressed workbook over 100 MB is rejected");

  const key = bidImportMacKey("service-role");
  const now = Date.now();
  const payload = {
    opportunity_id: 7,
    file_sha256: fileSha256(new Uint8Array([1, 2, 3])),
    file_name: "sheet.xlsx",
    size: 3,
    actor: "editor@example.com",
    iat: now,
    stated_car_total: 3450,
    header_signature: "abc",
  };
  const token = signBidImportToken(payload, key);
  ok(verifyBidImportToken(token, key, now).ok, "a fresh token verifies");
  ok(!verifyBidImportToken(`${token}x`, key, now).ok, "a tampered token is rejected");
  ok(!verifyBidImportToken(signBidImportToken({ ...payload, iat: now - BID_IMPORT_TOKEN_TTL_MS - 1000 }, key), key, now).ok, "an expired token is rejected");
  ok(fileSha256(new Uint8Array([1])) !== payload.file_sha256, "a different file hash does not match the token");
  const route = readFileSync(join(import.meta.dirname, "crm-bid-import.ts"), "utf8");
  ok(route.includes("verified.payload.opportunity_id !== id"), "commit rejects an opportunity mismatch");
  ok(route.includes("verified.payload.file_sha256 !== fileSha256(file.buffer)"), "commit rejects a file hash mismatch");
  ok(route.includes('requireWrite'), "import routes require an editor or admin");

  const memory: { lines: { id: number; ref: string }[]; files: Map<string, Uint8Array>; logs: ImportLogRow[]; groups: string[] } = {
    lines: [{ id: 1, ref: "old" }],
    files: new Map(),
    logs: [],
    groups: [],
  };
  let seq = 1;
  const failedCommit = await commitBidImport({
    opportunityId: 4,
    actor: "editor",
    filename: "sheet.xlsx",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    bytes: Buffer.from("abc"),
    lines: [{ seller_deal_ref: "1", car_count: 2 }],
    header: null,
    deleteIds: [],
  }, {
    upload: async (path, body) => { memory.files.set(path, body); },
    remove: async (path) => { memory.files.delete(path); },
    inGroup: async (_actor, fn) => {
      const group = "group-fail";
      memory.groups.push(group);
      return fn(group);
    },
    saveLines: async (_id, body) => {
      for (const line of body.lines as { seller_deal_ref: string }[]) {
        seq += 1;
        memory.lines.push({ id: seq, ref: line.seller_deal_ref });
        memory.logs.push({ table_name: "opportunity_lines", row_pk: seq, op: "insert", before: {}, after: { seller_deal_ref: line.seller_deal_ref } });
      }
    },
    patchHeader: async () => undefined,
    attach: async () => { throw new Error("attachment failed"); },
    rollback: async () => {
      const plan = revertPlan(memory.logs);
      for (const item of plan.deletes) memory.lines = memory.lines.filter((line) => line.id !== item.id);
      memory.logs = [];
    },
  }).then(() => "ok", (err: Error) => err.message);
  ok(failedCommit === "attachment failed", "a failure at the attachment step rejects the import");
  ok(memory.lines.length === 1 && memory.lines[0]?.ref === "old" && memory.logs.length === 0 && memory.files.size === 0, "failure leaves no lines, no activity rows, and no storage object");

  memory.groups = [];
  const replaced = await commitBidImport({
    opportunityId: 4,
    actor: "editor",
    filename: "sheet.xlsx",
    mime: "application/octet-stream",
    bytes: Buffer.from("new"),
    lines: [{ seller_deal_ref: "9", car_count: 5 }],
    header: null,
    deleteIds: [1],
  }, {
    upload: async (path, body) => { memory.files.set(path, body); },
    remove: async (path) => { memory.files.delete(path); },
    inGroup: async (_actor, fn) => {
      memory.groups.push("group-replace");
      return fn("group-replace");
    },
    saveLines: async (_id, body) => {
      ok(body.delete_ids.length === 1, "replace passes the existing line ids");
      memory.logs.push({ table_name: "opportunity_lines", row_pk: 1, op: "update", before: { deleted_at: null, seller_deal_ref: "old" }, after: { deleted_at: "now" } });
      seq += 1;
      memory.lines.push({ id: seq, ref: "9" });
      memory.logs.push({ table_name: "opportunity_lines", row_pk: seq, op: "insert", before: {}, after: { seller_deal_ref: "9" } });
    },
    patchHeader: async () => undefined,
    attach: async () => {
      seq += 1;
      memory.logs.push({ table_name: "attachments", row_pk: seq, op: "insert", before: {}, after: { file_name: "sheet.xlsx" } });
    },
    rollback: async () => undefined,
  });
  ok(memory.groups.length === 1 && replaced.change_group === "group-replace", "replace writes one change group");
  const undo = revertPlan(memory.logs);
  const restored = memory.lines.filter((line) => !undo.deletes.some((item) => item.id === line.id));
  ok(undo.deletes.some((item) => item.table === "attachments") && restored.some((line) => line.ref === "old") && !restored.some((line) => line.ref === "9"), "undo of replace restores the prior line and removes the attachment");

  memory.logs = [];
  memory.lines = [{ id: 1, ref: "keep" }];
  await commitBidImport({
    opportunityId: 4,
    actor: "editor",
    filename: "more.csv",
    mime: "text/csv",
    bytes: Buffer.from("csv"),
    lines: [{ seller_deal_ref: "2", car_count: 1 }],
    header: null,
    deleteIds: [],
  }, {
    upload: async (path, body) => { memory.files.set(path, body); },
    remove: async (path) => { memory.files.delete(path); },
    inGroup: async (_actor, fn) => fn("group-append"),
    saveLines: async (_id, body) => {
      ok(body.delete_ids.length === 0, "append does not delete existing lines");
      seq += 1;
      memory.lines.push({ id: seq, ref: "2" });
      memory.logs.push({ table_name: "opportunity_lines", row_pk: seq, op: "insert", before: {}, after: {} });
    },
    patchHeader: async () => undefined,
    attach: async () => {
      seq += 1;
      memory.logs.push({ table_name: "attachments", row_pk: seq, op: "insert", before: {}, after: {} });
    },
    rollback: async () => undefined,
  });
  const appendUndo = revertPlan(memory.logs);
  const afterAppendUndo = memory.lines.filter((line) => !appendUndo.deletes.some((item) => item.id === line.id));
  ok(afterAppendUndo.length === 1 && afterAppendUndo[0]?.ref === "keep", "undo of append removes only the imported lines");

  console.log(`${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
