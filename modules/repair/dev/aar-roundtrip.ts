/**
 * Byte-for-byte round-trip check against Sample_Shop_500byte_OFOX2609.txt
 * Run: npx tsx modules/repair/dev/aar-roundtrip.ts
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { parseAarFile, serializeLine } from "../services/aar-parser";

const sample = join(
  dirname(fileURLToPath(import.meta.url)),
  "reference/Sample_Shop_500byte_OFOX2609.txt",
);

const bytes = readFileSync(sample);
const parsed = parseAarFile(bytes);
let mismatches = 0;
for (const line of parsed.lines) {
  if (serializeLine(line) !== line.rawLine) {
    mismatches++;
    console.error(`mismatch line ${line.lineNo}`);
  }
}
const labor = parsed.lines.reduce((s, l) => s + (l.laborCents ?? 0), 0);
const material = parsed.lines.reduce((s, l) => s + (l.materialCents ?? 0), 0);
console.log(
  JSON.stringify(
    {
      ok: mismatches === 0,
      lines: parsed.lines.length,
      lineEnding: parsed.lineEnding,
      sha256: parsed.sha256,
      flags: parsed.flags,
      laborCents: labor,
      materialCents: material,
      mismatches,
    },
    null,
    2,
  ),
);
if (mismatches > 0) process.exit(1);
