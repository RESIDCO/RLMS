/* eslint-disable no-console */
/** Run: npx tsx shared/dv-material-guardrails.test.ts */

import {
  enrichDvResultWarnings,
  hasMaterialComposition,
  isMaterialCompositionMissing,
  materialGuardrailWarnings,
  materialSumMismatchWarning,
  MATERIAL_COMPOSITION_MISSING_WARNING,
  validateMaterialCompositionForSave,
} from "./dv-material-guardrails";

let passed = 0;
let failed = 0;

function eq(actual: unknown, expected: unknown, label: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed += 1;
  else {
    failed += 1;
    console.error(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const base = {
  tareWeightLb: 64200,
  steelWeightLb: 0,
  aluminumWeightLb: 0,
  stainlessWeightLb: 0,
  nonMetallicWeightLb: 0,
};

eq(isMaterialCompositionMissing(base), true, "all zero with tare is missing");
eq(hasMaterialComposition(base), false, "all zero with tare fails composition");
eq(validateMaterialCompositionForSave(base) != null, true, "save blocked when missing");

const steelOnly = { ...base, steelWeightLb: 64200 };
eq(isMaterialCompositionMissing(steelOnly), false, "steel only is ok");
eq(materialSumMismatchWarning(steelOnly), null, "steel equals tare — no mismatch");

const split = { ...base, steelWeightLb: 52644, aluminumWeightLb: 11556 };
eq(materialSumMismatchWarning(split), null, "82/18 split matches tare");
eq(materialGuardrailWarnings(split).length, 0, "valid split has no warnings");

const partial = { ...base, aluminumWeightLb: 11556 };
const mismatch = materialSumMismatchWarning(partial);
eq(mismatch != null && mismatch.includes("11,556") && mismatch.includes("64,200"), true, "partial entry warns");
eq(materialGuardrailWarnings(partial).length, 0, "mismatch alone does not add banner warning");

const enriched = enrichDvResultWarnings({ warnings: ["existing"] }, base);
eq(enriched.warnings.includes("existing"), true, "preserves existing warnings");
eq(enriched.warnings.includes(MATERIAL_COMPOSITION_MISSING_WARNING), true, "adds material warning");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
