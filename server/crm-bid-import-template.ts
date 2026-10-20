import ExcelJS from "exceljs";

const LINE_HEADERS: { header: string; comment: string; kind: "text" | "int" | "decimal" | "date" | "yn" }[] = [
  { header: "Deal", comment: "Seller deal number. Sub-groups of one deal stay on separate rows.", kind: "text" },
  { header: "Lessee", comment: "Lessee name as it should appear on the bid line.", kind: "text" },
  { header: "Rating", comment: "Credit rating, for example BBB- / NR.", kind: "text" },
  { header: "Country", comment: "Lessee country.", kind: "text" },
  { header: "Cars", comment: "Number of cars in the group.", kind: "int" },
  { header: "Equipment", comment: "Equipment description.", kind: "text" },
  { header: "Car type", comment: "Car type. Leave blank if the sheet does not have one.", kind: "text" },
  { header: "AAR", comment: "AAR car type code.", kind: "text" },
  { header: "Build year", comment: "Average build year.", kind: "int" },
  { header: "Commodity", comment: "Commodity hauled.", kind: "text" },
  { header: "Lease rate", comment: "Monthly lease rate per car. This is rent, not a bid price.", kind: "decimal" },
  { header: "Expiry", comment: "Lease expiry date.", kind: "date" },
  { header: "Purchase option", comment: "Y if the lease has a fixed purchase option, otherwise N.", kind: "yn" },
  { header: "Notes", comment: "Notes for this line.", kind: "text" },
];

function validation(kind: "int" | "decimal" | "date" | "yn"): ExcelJS.DataValidation {
  if (kind === "yn") {
    return { type: "list", allowBlank: true, formulae: ['"Y,N"'], showErrorMessage: true, error: "Enter Y or N" };
  }
  if (kind === "date") {
    return {
      type: "date",
      operator: "between",
      allowBlank: true,
      formulae: [new Date(1950, 0, 1), new Date(2100, 11, 31)],
      showErrorMessage: true,
      error: "Enter a date",
    };
  }
  if (kind === "decimal") {
    return {
      type: "decimal",
      operator: "greaterThanOrEqual",
      allowBlank: true,
      formulae: [0],
      showErrorMessage: true,
      error: "Enter a number",
    };
  }
  return {
    type: "whole",
    operator: "between",
    allowBlank: true,
    formulae: [0, 100000],
    showErrorMessage: true,
    error: "Enter a whole number",
  };
}

export async function buildBidImportTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "RLMS";
  const lines = workbook.addWorksheet("Lines");
  LINE_HEADERS.forEach((column, index) => {
    const cell = lines.getCell(1, index + 1);
    cell.value = column.header;
    cell.font = { bold: true };
    cell.note = column.comment;
    if (column.kind !== "text") {
      const rule = validation(column.kind);
      for (let row = 2; row <= 200; row += 1) lines.getCell(row, index + 1).dataValidation = rule;
    }
    lines.getColumn(index + 1).width = Math.max(14, column.header.length + 2);
  });
  const sample = [
    "1",
    "Example Lessee",
    "BBB",
    "U.S.",
    10,
    "Boxcar",
    "Box",
    "A203",
    2018,
    "Grain",
    500,
    new Date(Date.UTC(2030, 0, 31)),
    "Y",
    "Sample",
  ];
  sample.forEach((value, index) => {
    const cell = lines.getCell(2, index + 1);
    cell.value = value;
    if (value instanceof Date) cell.numFmt = "yyyy-mm-dd";
  });

  const offering = workbook.addWorksheet("Offering");
  const pairs: [string, string][] = [
    ["Title", ""],
    ["Seller", ""],
    ["Received", ""],
    ["Preliminary deadline", ""],
    ["Final deadline", ""],
    ["Award", ""],
  ];
  pairs.forEach((pair, index) => {
    offering.getCell(index + 1, 1).value = pair[0];
    offering.getCell(index + 1, 1).font = { bold: true };
    offering.getCell(index + 1, 2).value = pair[1];
  });
  offering.getColumn(1).width = 24;
  offering.getColumn(2).width = 36;
  offering.getCell(1, 1).note = "Offering title. Imported as the offering name when filled in.";
  offering.getCell(3, 2).note = "Date the offering was received.";

  const instructions = workbook.addWorksheet("Instructions");
  const text = [
    "RLMS bid sheet template.",
    "Put one car group on each row of the Lines sheet. Do not add a price per car column; lease rate is monthly rent.",
    "A total row is checked and not imported. Rows that share a deal number stay separate.",
    "Fill the Offering sheet for the title, seller, and deadlines.",
    "Save as .xlsx or export .csv of the Lines sheet. .xls and macro files are rejected.",
  ];
  text.forEach((line, index) => {
    instructions.getCell(index + 1, 1).value = line;
  });
  instructions.getColumn(1).width = 110;

  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out);
}
