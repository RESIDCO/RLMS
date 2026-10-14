/**
 * Railinc CRB 500-byte writer (CRIPYYMM).
 * Record formats: 1 detail, 6 contact, 8 invoice subtotal/total, 9 file total.
 * Cols 2–5 = billing party mark on every record.
 * Local file export only — no FTP.
 */

import { createHash } from "crypto";
import { getBundledLayout, type LayoutVersion } from "./aar-layout";
import { parseLine, type ParsedAarLine } from "./aar-parser";

export type CrbDetailLine = {
  /** Prefer original shop Format-1 raw line when present */
  rawLine?: string | null;
  carInitial: string;
  carNumber: string;
  repairDateYymmdd: string;
  splc?: string;
  repairingParty: string;
  repairingPartyInvoice?: string;
  facilityType?: string;
  locationOnCar?: string;
  quantity?: number;
  conditionCode?: string;
  appliedJobCode: string;
  appliedQualifier?: string;
  whyMade?: string;
  removedJobCode?: string;
  removedQualifier?: string;
  responsibilityCode: string;
  laborCents: number;
  materialCents: number;
  materialSign?: "D" | "C";
  machinePriceable?: string;
  description?: string;
  lineNumber: number;
  detailSource?: string;
  kindOfCar?: string;
  loadEmpty?: string;
};

export type CrbInvoiceInput = {
  billedParty: string;
  invoiceNumber: string;
  invoiceDateYymmdd: string;
  paymentDueYymmdd?: string;
  contact: {
    companyName: string;
    contactName?: string;
    email?: string;
    address1: string;
    address2?: string;
    city?: string;
    state?: string;
    country?: string;
    zip?: string;
    phone?: string;
  };
  details: CrbDetailLine[];
};

export type CrbFileInput = {
  billingParty: string;
  accountMonthYymm: string;
  currency?: string;
  taxpayerId?: string;
  paymentTerms?: string;
  invoices: CrbInvoiceInput[];
};

function pad(s: string, len: number, side: "left" | "right" = "right", ch = " "): string {
  const t = (s ?? "").slice(0, len);
  return side === "left" ? t.padStart(len, ch) : t.padEnd(len, ch);
}

function num(n: number, len: number): string {
  const v = Math.max(0, Math.trunc(n || 0));
  return String(v).padStart(len, "0").slice(-len);
}

function mark4(m: string): string {
  return pad((m ?? "").toUpperCase().trim(), 4);
}

function blankRecord(): string[] {
  return Array.from({ length: 500 }, () => " ");
}

function put(chars: string[], start1: number, len: number, value: string): void {
  const start = start1 - 1;
  for (let i = 0; i < len; i++) {
    chars[start + i] = value[i] ?? " ";
  }
}

/** Zero-fill blank cents fields so serialize(parse(line)) round-trips. */
function finalizeRecord(line: string, recordFormat: string, layout = getBundledLayout()): string {
  const chars = line.split("");
  for (const f of layout.fields) {
    if (f.record_format !== recordFormat && f.record_format !== "*") continue;
    if (f.data_type !== "cents") continue;
    const start = f.col_start - 1;
    const slice = chars.slice(start, start + f.length).join("");
    if (!slice.trim()) {
      put(chars, f.col_start, f.length, num(0, f.length));
    }
  }
  return chars.join("");
}

function headerFields(
  chars: string[],
  format: string,
  billing: string,
  billed: string,
  acct: string,
  invoice: string,
  currency: string,
): void {
  put(chars, 1, 1, format);
  put(chars, 2, 4, mark4(billing));
  put(chars, 6, 4, mark4(billed));
  put(chars, 10, 4, pad(acct, 4, "left", "0"));
  put(chars, 14, 16, pad(invoice, 16));
  put(chars, 30, 1, pad(currency, 1));
}

/** Build a Format 1 line, reusing original raw bytes when available. */
export function buildDetailRecord(
  billingParty: string,
  billedParty: string,
  accountMonth: string,
  invoiceNumber: string,
  currency: string,
  d: CrbDetailLine,
  layout: LayoutVersion = getBundledLayout(),
): string {
  const detailSource = pad(d.detailSource ?? "RE", 2);
  if (d.rawLine && d.rawLine.length === 500 && d.rawLine[0] === "1") {
    const chars = d.rawLine.split("");
    put(chars, 2, 4, mark4(billingParty));
    put(chars, 6, 4, mark4(billedParty));
    put(chars, 10, 4, pad(accountMonth, 4, "left", "0"));
    put(chars, 14, 16, pad(invoiceNumber, 16));
    put(chars, 30, 1, pad(currency, 1));
    put(chars, 31, 2, detailSource);
    put(chars, 138, 1, pad(String(d.responsibilityCode ?? "6"), 1));
    put(chars, 149, 7, num(d.laborCents, 7));
    put(chars, 156, 8, num(Math.abs(d.materialCents), 8));
    put(chars, 164, 1, d.materialSign ?? (d.materialCents < 0 ? "C" : "D"));
    put(chars, 289, 5, num(d.lineNumber, 5));
    const out = finalizeRecord(chars.join(""), "1", layout);
    parseLine(out, d.lineNumber, layout);
    return out;
  }

  const chars = blankRecord();
  headerFields(chars, "1", billingParty, billedParty, accountMonth, invoiceNumber, currency);
  put(chars, 31, 2, detailSource);
  put(chars, 48, 4, mark4(d.carInitial));
  put(chars, 52, 6, num(Number(d.carNumber) || 0, 6));
  put(chars, 58, 1, pad(d.kindOfCar ?? "", 1));
  put(chars, 59, 1, pad(d.loadEmpty ?? "E", 1));
  put(chars, 60, 6, pad(d.repairDateYymmdd || `${accountMonth}01`, 6, "left", "0"));
  put(chars, 66, 6, pad(d.splc ?? "000000", 6, "left", "0"));
  put(chars, 72, 4, mark4(d.repairingParty));
  put(chars, 76, 16, pad(d.repairingPartyInvoice ?? "", 16));
  put(chars, 107, 2, pad(d.facilityType ?? "CS", 2));
  put(chars, 109, 2, pad(d.locationOnCar ?? "", 2));
  put(chars, 113, 4, num(d.quantity ?? 1, 4));
  put(chars, 117, 1, pad(d.conditionCode ?? "1", 1));
  put(chars, 120, 4, pad(d.appliedJobCode || "0000", 4, "left", "0"));
  put(chars, 124, 3, pad(d.appliedQualifier ?? "", 3));
  put(chars, 127, 2, pad(d.whyMade ?? "00", 2, "left", "0"));
  put(chars, 131, 4, pad(d.removedJobCode || d.appliedJobCode || "0000", 4, "left", "0"));
  put(chars, 135, 3, pad(d.removedQualifier ?? d.appliedQualifier ?? "", 3));
  put(chars, 138, 1, pad(String(d.responsibilityCode ?? "6"), 1));
  put(chars, 149, 7, num(d.laborCents, 7));
  put(chars, 156, 8, num(Math.abs(d.materialCents), 8));
  put(chars, 164, 1, d.materialSign ?? (d.materialCents < 0 ? "C" : "D"));
  put(chars, 165, 1, pad(d.machinePriceable ?? "N", 1));
  put(chars, 167, 50, pad(d.description ?? "LESSEE REBILL RESP 6", 50));
  put(chars, 289, 5, num(d.lineNumber, 5));
  return finalizeRecord(chars.join(""), "1", layout);
}

export function buildContactRecord(
  billingParty: string,
  billedParty: string,
  accountMonth: string,
  invoiceNumber: string,
  currency: string,
  contact: CrbInvoiceInput["contact"],
): string {
  const chars = blankRecord();
  headerFields(chars, "6", billingParty, billedParty, accountMonth, invoiceNumber, currency);
  put(chars, 31, 2, "BP");
  put(chars, 33, 50, pad(contact.companyName || billedParty, 50));
  put(chars, 83, 35, pad(contact.contactName ?? "", 35));
  put(chars, 153, 25, pad(contact.phone ?? "", 25));
  put(chars, 203, 60, pad(contact.email ?? "", 60));
  put(chars, 263, 45, pad(contact.address1 || "ADDRESS ON FILE", 45));
  put(chars, 308, 45, pad(contact.address2 ?? "", 45));
  put(chars, 443, 35, pad(contact.city ?? "", 35));
  put(chars, 478, 2, pad(contact.state ?? "", 2));
  put(chars, 480, 2, pad(contact.country ?? "US", 2));
  put(chars, 482, 10, pad(contact.zip ?? "", 10));
  return finalizeRecord(chars.join(""), "6");
}

export function buildFormat8(
  billingParty: string,
  billedParty: string,
  accountMonth: string,
  invoiceNumber: string,
  currency: string,
  detailSource: string,
  recordCount: number,
  laborCents: number,
  materialCents: number,
  invoiceDateYymmdd: string,
  taxpayerId: string,
  paymentTerms: string,
  paymentDueYymmdd: string,
): string {
  const chars = blankRecord();
  headerFields(chars, "8", billingParty, billedParty, accountMonth, invoiceNumber, currency);
  put(chars, 31, 2, pad(detailSource, 2));
  put(chars, 33, 7, num(recordCount, 7));
  put(chars, 40, 10, num(laborCents, 10));
  const matAbs = Math.abs(materialCents);
  put(chars, 50, 16, num(matAbs, 16));
  put(chars, 66, 1, materialCents < 0 ? "C" : "D");
  put(chars, 67, 6, pad(invoiceDateYymmdd, 6, "left", "0"));
  if (detailSource === "ZZ") {
    put(chars, 73, 15, pad(taxpayerId, 15));
  }
  put(chars, 88, 2, pad(paymentTerms, 2));
  put(chars, 90, 6, pad(paymentDueYymmdd, 6, "left", "0"));
  return finalizeRecord(chars.join(""), "8");
}

export function buildFormat9(
  billingParty: string,
  accountMonth: string,
  recordCount: number,
  laborCents: number,
  materialCents: number,
): string {
  const chars = blankRecord();
  put(chars, 1, 1, "9");
  put(chars, 2, 4, mark4(billingParty));
  put(chars, 6, 4, "ZZZZ");
  put(chars, 10, 4, pad(accountMonth, 4, "left", "0"));
  put(chars, 14, 16, "ZZZZZZZZZZZZZZZZ");
  put(chars, 30, 1, "Z");
  put(chars, 31, 2, "ZZ");
  put(chars, 33, 7, num(recordCount, 7));
  put(chars, 40, 10, num(laborCents, 10));
  put(chars, 50, 16, num(Math.abs(materialCents), 16));
  put(chars, 66, 1, materialCents < 0 ? "C" : "D");
  return finalizeRecord(chars.join(""), "9");
}

export type BuiltCrbFile = {
  filename: string;
  records: string[];
  bytes: Buffer;
  sha256: string;
  detailCount: number;
  laborCents: number;
  materialCents: number;
  invoiceCount: number;
};

/**
 * Build a complete CRIP file.
 * Order per invoice: Format 1s by DS → 8 DS → 6 BP → 8 ZZ; file ends with 9.
 */
export function buildCripFile(input: CrbFileInput): BuiltCrbFile {
  const billing = mark4(input.billingParty);
  const acct = pad(input.accountMonthYymm, 4, "left", "0");
  const currency = pad(input.currency ?? "U", 1);
  const taxpayerId = input.taxpayerId ?? "";
  const paymentTerms = pad(input.paymentTerms ?? "30", 2);
  const records: string[] = [];
  let fileLabor = 0;
  let fileMaterial = 0;
  let fileDetails = 0;

  for (const inv of input.invoices) {
    const billed = mark4(inv.billedParty);
    const invoiceNo = pad(inv.invoiceNumber, 16);
    const byDs = new Map<string, CrbDetailLine[]>();
    for (const d of inv.details) {
      const ds = pad(d.detailSource ?? "RE", 2);
      const list = byDs.get(ds) ?? [];
      list.push(d);
      byDs.set(ds, list);
    }

    let invLabor = 0;
    let invMaterial = 0;
    let invDetails = 0;

    for (const [ds, details] of byDs) {
      let dsLabor = 0;
      let dsMaterial = 0;
      for (const d of details) {
        const rec = buildDetailRecord(billing, billed, acct, invoiceNo, currency, d);
        records.push(rec);
        dsLabor += d.laborCents;
        dsMaterial += d.materialCents;
        invDetails++;
      }
      records.push(
        buildFormat8(
          billing,
          billed,
          acct,
          invoiceNo,
          currency,
          ds,
          details.length,
          dsLabor,
          dsMaterial,
          inv.invoiceDateYymmdd,
          taxpayerId,
          paymentTerms,
          inv.paymentDueYymmdd ?? inv.invoiceDateYymmdd,
        ),
      );
      invLabor += dsLabor;
      invMaterial += dsMaterial;
    }

    records.push(
      buildContactRecord(billing, billed, acct, invoiceNo, currency, inv.contact),
    );
    records.push(
      buildFormat8(
        billing,
        billed,
        acct,
        invoiceNo,
        currency,
        "ZZ",
        invDetails,
        invLabor,
        invMaterial,
        inv.invoiceDateYymmdd,
        taxpayerId,
        paymentTerms,
        inv.paymentDueYymmdd ?? inv.invoiceDateYymmdd,
      ),
    );
    fileLabor += invLabor;
    fileMaterial += invMaterial;
    fileDetails += invDetails;
  }

  records.push(buildFormat9(billing, acct, fileDetails, fileLabor, fileMaterial));

  const body = records.map((r) => r + "\r\n").join("");
  const bytes = Buffer.from(body, "latin1");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const filename = `CRIP${acct}.txt`;

  return {
    filename,
    records,
    bytes,
    sha256,
    detailCount: fileDetails,
    laborCents: fileLabor,
    materialCents: fileMaterial,
    invoiceCount: input.invoices.length,
  };
}

export function parseBuiltRecords(records: string[]): ParsedAarLine[] {
  return records.map((r, i) => parseLine(r, i + 1));
}
