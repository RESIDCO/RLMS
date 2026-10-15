/**
 * Validate CRB/CRIP record order and invoice totals before export.
 * Also tolerates detail-only extracts (e.g. Sample_Shop_500byte_OFOX2609.txt).
 */

import { parseAarFile, signedMaterialCents, type ParsedAarLine } from "./aar-parser";

export type CrbValidationResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  isCompleteCrip: boolean;
  detailCount: number;
  invoiceCount: number;
  laborCents: number;
  materialCents: number;
};

type InvoiceAcc = {
  key: string;
  detailsByDs: Map<string, { count: number; labor: number; material: number }>;
  sawDsSubtotal: Set<string>;
  sawContact: boolean;
  sawZz: boolean;
  zzLabor: number;
  zzMaterial: number;
  zzCount: number;
  detailLabor: number;
  detailMaterial: number;
  detailCount: number;
};

function invoiceKey(line: ParsedAarLine): string {
  const billed = String(line.fields.billed_party ?? "").trim();
  const acct = String(line.fields.account_date_yymm ?? "").trim();
  const inv = String(line.fields.invoice_number ?? "").trim();
  return `${billed}|${acct}|${inv}`;
}

/**
 * Validate mandatory CRIP order (App G.3) and Format 8/9 totals.
 * Detail-only files (Format 1 only) return ok=true with warning detail_only_extract.
 */
export function validateCripRecords(lines: ParsedAarLine[]): CrbValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const formats = new Set(lines.map((l) => l.recordFormat));
  const isCompleteCrip =
    formats.has("1") && formats.has("6") && formats.has("8") && formats.has("9");

  if (!lines.length) {
    return {
      ok: false,
      errors: ["empty file"],
      warnings,
      isCompleteCrip: false,
      detailCount: 0,
      invoiceCount: 0,
      laborCents: 0,
      materialCents: 0,
    };
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.rawLine.length !== 500) {
      errors.push(`line ${i + 1}: length ${line.rawLine.length} != 500`);
    }
    const billing = String(line.fields.billing_party ?? line.rawLine.slice(1, 5));
    if (billing.trim().length === 0) {
      errors.push(`line ${i + 1}: billing party (cols 2-5) blank`);
    }
  }

  if (!isCompleteCrip) {
    if (formats.has("1") && !formats.has("6") && !formats.has("8") && !formats.has("9")) {
      warnings.push("detail_only_extract");
      const detailCount = lines.filter((l) => l.recordFormat === "1").length;
      const laborCents = lines
        .filter((l) => l.recordFormat === "1")
        .reduce((s, l) => s + (l.laborCents ?? 0), 0);
      const materialCents = lines
        .filter((l) => l.recordFormat === "1")
        .reduce((s, l) => s + signedMaterialCents(l), 0);
      return {
        ok: errors.length === 0,
        errors,
        warnings,
        isCompleteCrip: false,
        detailCount,
        invoiceCount: 0,
        laborCents,
        materialCents,
      };
    }
    errors.push(
      `incomplete CRIP formats present=[${[...formats].sort().join(",")}] need 1,6,8,9`,
    );
  }

  if (lines[lines.length - 1].recordFormat !== "9") {
    errors.push("file must end with Format 9");
  }

  const invoices = new Map<string, InvoiceAcc>();
  let openKey: string | null = null;
  let fileDetailCount = 0;
  let fileLabor = 0;
  let fileMaterial = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const n = i + 1;
    if (line.recordFormat === "9") {
      if (i !== lines.length - 1) errors.push(`line ${n}: Format 9 must be last`);
      const rc = Number(line.fields.record_count ?? 0);
      const labor = Number(line.fields.labor_cents ?? 0);
      const mat = Number(line.fields.material_cents ?? 0);
      const sign = String(line.fields.material_sign ?? "D").toUpperCase();
      const matSigned = sign === "C" ? -mat : mat;
      if (rc !== fileDetailCount) {
        errors.push(`Format 9 record_count ${rc} != detail count ${fileDetailCount}`);
      }
      if (labor !== fileLabor) {
        errors.push(`Format 9 labor ${labor} != detail labor ${fileLabor}`);
      }
      if (matSigned !== fileMaterial) {
        errors.push(`Format 9 material ${matSigned} != detail material ${fileMaterial}`);
      }
      if (String(line.fields.billed_party ?? "").trim() !== "ZZZZ") {
        errors.push(`Format 9 billed party must be ZZZZ`);
      }
      continue;
    }

    const key = invoiceKey(line);
    if (line.recordFormat === "1") {
      if (openKey && openKey !== key) {
        const prev = invoices.get(openKey);
        if (prev && !prev.sawZz) {
          errors.push(`invoice ${openKey}: missing Format 8 ZZ before next invoice`);
        }
      }
      openKey = key;
      let inv = invoices.get(key);
      if (!inv) {
        inv = {
          key,
          detailsByDs: new Map(),
          sawDsSubtotal: new Set(),
          sawContact: false,
          sawZz: false,
          zzLabor: 0,
          zzMaterial: 0,
          zzCount: 0,
          detailLabor: 0,
          detailMaterial: 0,
          detailCount: 0,
        };
        invoices.set(key, inv);
      }
      if (inv.sawZz) errors.push(`line ${n}: detail after Format 8 ZZ for ${key}`);
      if (inv.sawContact) errors.push(`line ${n}: detail after Format 6 for ${key}`);
      const ds = String(line.fields.detail_source ?? "").trim() || "??";
      if (inv.sawDsSubtotal.has(ds)) {
        errors.push(`line ${n}: detail for DS ${ds} after its Format 8 subtotal`);
      }
      const bucket = inv.detailsByDs.get(ds) ?? { count: 0, labor: 0, material: 0 };
      bucket.count++;
      bucket.labor += line.laborCents ?? 0;
      bucket.material += signedMaterialCents(line);
      inv.detailsByDs.set(ds, bucket);
      inv.detailCount++;
      inv.detailLabor += line.laborCents ?? 0;
      inv.detailMaterial += signedMaterialCents(line);
      fileDetailCount++;
      fileLabor += line.laborCents ?? 0;
      fileMaterial += signedMaterialCents(line);
      continue;
    }

    if (line.recordFormat === "8") {
      const inv = invoices.get(key);
      if (!inv) {
        errors.push(`line ${n}: Format 8 without preceding details for ${key}`);
        continue;
      }
      const ds = String(line.fields.detail_source ?? "").trim();
      const rc = Number(line.fields.record_count ?? 0);
      const labor = Number(line.fields.labor_cents ?? 0);
      const mat = Number(line.fields.material_cents ?? 0);
      const sign = String(line.fields.material_sign ?? "D").toUpperCase();
      const matSigned = sign === "C" ? -mat : mat;
      if (ds === "ZZ") {
        if (!inv.sawContact) {
          errors.push(`line ${n}: Format 8 ZZ before Format 6 BP for ${key}`);
        }
        inv.sawZz = true;
        inv.zzCount = rc;
        inv.zzLabor = labor;
        inv.zzMaterial = matSigned;
        if (rc !== inv.detailCount) {
          errors.push(`invoice ${key}: 8 ZZ count ${rc} != details ${inv.detailCount}`);
        }
        if (labor !== inv.detailLabor) {
          errors.push(`invoice ${key}: 8 ZZ labor ${labor} != details ${inv.detailLabor}`);
        }
        if (matSigned !== inv.detailMaterial) {
          errors.push(
            `invoice ${key}: 8 ZZ material ${matSigned} != details ${inv.detailMaterial}`,
          );
        }
      } else {
        if (inv.sawContact || inv.sawZz) {
          errors.push(`line ${n}: DS subtotal after contact/ZZ for ${key}`);
        }
        const bucket = inv.detailsByDs.get(ds);
        if (!bucket) {
          errors.push(`line ${n}: Format 8 DS ${ds} with no details`);
        } else {
          if (rc !== bucket.count) {
            errors.push(`invoice ${key} DS ${ds}: count ${rc} != ${bucket.count}`);
          }
          if (labor !== bucket.labor) {
            errors.push(`invoice ${key} DS ${ds}: labor ${labor} != ${bucket.labor}`);
          }
          if (matSigned !== bucket.material) {
            errors.push(
              `invoice ${key} DS ${ds}: material ${matSigned} != ${bucket.material}`,
            );
          }
          inv.sawDsSubtotal.add(ds);
        }
      }
      continue;
    }

    if (line.recordFormat === "6") {
      const inv = invoices.get(key);
      if (!inv) {
        errors.push(`line ${n}: Format 6 without details for ${key}`);
        continue;
      }
      for (const ds of inv.detailsByDs.keys()) {
        if (!inv.sawDsSubtotal.has(ds)) {
          errors.push(`invoice ${key}: missing Format 8 for DS ${ds} before contact`);
        }
      }
      const ctype = String(line.fields.contact_type ?? line.rawLine.slice(30, 32)).trim();
      if (ctype === "BP") inv.sawContact = true;
      continue;
    }

    errors.push(`line ${n}: unsupported record format ${line.recordFormat}`);
  }

  for (const inv of invoices.values()) {
    if (!inv.sawContact) errors.push(`invoice ${inv.key}: missing Format 6 BP`);
    if (!inv.sawZz) errors.push(`invoice ${inv.key}: missing Format 8 ZZ`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    isCompleteCrip,
    detailCount: fileDetailCount,
    invoiceCount: invoices.size,
    laborCents: fileLabor,
    materialCents: fileMaterial,
  };
}

export function validateCripBytes(bytes: Buffer): CrbValidationResult {
  const parsed = parseAarFile(bytes);
  const result = validateCripRecords(parsed.lines);
  if (parsed.flags.includes("detail_only_extract") && !result.warnings.includes("detail_only_extract")) {
    result.warnings.push("detail_only_extract");
  }
  return result;
}
