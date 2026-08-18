/**
 * DV Calculator material-composition guardrails (UI/validation only).
 * Does not alter Rule 107 depreciated-value math — only warnings and save checks.
 */

export const MATERIAL_COMPOSITION_MISSING_WARNING =
  "Material composition not entered — Salvage Value below assumes 0 lb of scrap. Confirm Steel Weight (defaults to Tare Weight for standard cars) before using this for settlement.";

export type MaterialWeights = {
  tareWeightLb: number;
  steelWeightLb: number;
  aluminumWeightLb: number;
  stainlessWeightLb: number;
  nonMetallicWeightLb: number;
};

export function materialWeightSum(w: MaterialWeights): number {
  return (
    (Number(w.steelWeightLb) || 0) +
    (Number(w.aluminumWeightLb) || 0) +
    (Number(w.stainlessWeightLb) || 0) +
    (Number(w.nonMetallicWeightLb) || 0)
  );
}

/** True when tare is set and at least one material weight is non-zero. */
export function hasMaterialComposition(w: MaterialWeights): boolean {
  if (!(Number(w.tareWeightLb) > 0)) return true;
  return materialWeightSum(w) > 0;
}

export function isMaterialCompositionMissing(w: MaterialWeights): boolean {
  return Number(w.tareWeightLb) > 0 && materialWeightSum(w) <= 0;
}

export function materialSumMismatchWarning(w: MaterialWeights, tolerance = 1): string | null {
  const tare = Number(w.tareWeightLb) || 0;
  if (!(tare > 0)) return null;
  const sum = materialWeightSum(w);
  if (sum <= 0) return null;
  if (Math.abs(sum - tare) <= tolerance) return null;
  return `Steel + Aluminum + Stainless + Non-Metallic (${sum.toLocaleString()} lb) doesn't match Tare Weight (${tare.toLocaleString()} lb) — check the breakdown.`;
}

export function materialGuardrailWarnings(w: MaterialWeights): string[] {
  if (isMaterialCompositionMissing(w)) return [MATERIAL_COMPOSITION_MISSING_WARNING];
  return [];
}

export function enrichDvResultWarnings<T extends { warnings: string[] }>(result: T, w: MaterialWeights): T {
  const extra = materialGuardrailWarnings(w);
  if (!extra.length) return result;
  const seen = new Set(result.warnings);
  const merged = [...result.warnings];
  for (const msg of extra) {
    if (!seen.has(msg)) {
      seen.add(msg);
      merged.push(msg);
    }
  }
  return { ...result, warnings: merged };
}

export function validateMaterialCompositionForSave(w: MaterialWeights): string | null {
  if (isMaterialCompositionMissing(w)) {
    return 'Material composition is required when Tare Weight is entered. Enter Steel Weight or click "Same as Tare Weight" for a standard carbon steel car.';
  }
  return null;
}
