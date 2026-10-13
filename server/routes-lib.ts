import type { Response } from "express";
import { ZodError } from "zod";
import multer from "multer";
import { supabase } from "./supabase";
import {
  calculateDv,
  type DvInputs,
  type DvReferenceData,
  type EquipmentType,
  type AbRateBasis,
  type AbItemInput,
} from "@shared/rule107";
import { enrichDvResultWarnings } from "@shared/dv-material-guardrails";


// Multer: store uploads in memory (files go straight to Supabase Storage)
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 52 * 1024 * 1024 }, // 50 MB
});

export const STORAGE_BUCKET = "rlms-attachments";

/* ==================================================================
 *  DV CALCULATOR (AAR Rule 107) — module helpers
 * ================================================================== */

export async function dvLoadReferenceData(): Promise<DvReferenceData> {
  const [cf, sq, cr] = await Promise.all([
    supabase.from("dv_cost_factors").select("year, factor").order("year", { ascending: true }),
    supabase.from("dv_salvage_quarters").select("quarter_code, steel_per_lb, aluminum_per_lb, stainless_per_lb, dismantling_per_gt").order("quarter_code", { ascending: true }),
    supabase.from("dv_car_dep_rates").select("equipment_type, annual_rate, max_depreciation, age_cutoff_years"),
  ]);
  if (cf.error) throw cf.error;
  if (sq.error) throw sq.error;
  if (cr.error) throw cr.error;
  return {
    costFactors: (cf.data || []).map((r: any) => ({ year: r.year, factor: r.factor })),
    salvageQuarters: (sq.data || []).map((r: any) => ({
      quarterCode: r.quarter_code,
      steelPerLb: Number(r.steel_per_lb),
      aluminumPerLb: Number(r.aluminum_per_lb),
      stainlessPerLb: r.stainless_per_lb == null ? null : Number(r.stainless_per_lb),
      dismantlingPerGt: Number(r.dismantling_per_gt),
    })),
    carDepRates: (cr.data || []).map((r: any) => ({
      equipmentType: r.equipment_type as EquipmentType,
      annualRate: Number(r.annual_rate),
      maxDepreciation: Number(r.max_depreciation),
      ageCutoffYears: r.age_cutoff_years,
    })),
  };
}

export function dvMaterialWeights(inputs: DvInputs) {
  return {
    tareWeightLb: inputs.tareWeightLb,
    steelWeightLb: inputs.steelWeightLb,
    aluminumWeightLb: inputs.aluminumWeightLb,
    stainlessWeightLb: inputs.stainlessWeightLb ?? 0,
    nonMetallicWeightLb: inputs.nonMetallicWeightLb,
  };
}

export function dvCalculateWithGuardrails(inputs: DvInputs, ref: DvReferenceData) {
  return enrichDvResultWarnings(calculateDv(inputs, ref), dvMaterialWeights(inputs));
}

export function dvParseInputs(body: any, abCodes: Map<string, { rate_basis: AbRateBasis; rate: number; max_depreciation: number }>): DvInputs {
  const abItems: AbItemInput[] = (body.abItems || []).map((it: any) => {
    const meta = abCodes.get((it.code || "").toUpperCase());
    const rateBasis: AbRateBasis = (it.rateBasis as AbRateBasis) || meta?.rate_basis || "ANNUAL";
    const rate = it.rate != null ? Number(it.rate) : Number(meta?.rate ?? 0);
    const maxDepreciation = it.maxDepreciation != null ? Number(it.maxDepreciation) : Number(meta?.max_depreciation ?? 0.9);
    return {
      code: String(it.code || "").toUpperCase(),
      value: Number(it.value) || 0,
      installDate: new Date(it.installDate),
      rateBasis,
      rate,
      max: maxDepreciation,
    };
  });
  return {
    incidentDate:       new Date(body.incidentDate),
    buildDate:          new Date(body.buildDate),
    originalCost:       Number(body.originalCost) || 0,
    tareWeightLb:       Number(body.tareWeightLb) || 0,
    steelWeightLb:      Number(body.steelWeightLb) || 0,
    aluminumWeightLb:   Number(body.aluminumWeightLb) || 0,
    stainlessWeightLb:  body.stainlessWeightLb != null ? Number(body.stainlessWeightLb) : 0,
    nonMetallicWeightLb: Number(body.nonMetallicWeightLb) || 0,
    equipmentType:      body.equipmentType as EquipmentType,
    abItems,
  };
}

// Freshness per AAR Office Manual Rule 107.E:
//   • Cost Factors — Rule 107.E.2 uses the factor for the year PRIOR to the
//     incident year (e.g. a 2026 incident uses the 2025 factor). Stale only if
//     the prior-year row is missing.
//   • Salvage Quarters — quarterly; the current-quarter row must exist.
//   • A&B Codes — reference-only; no fixed quarterly cadence, so not flagged.
export async function dvComputeFreshness() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const q = Math.floor(now.getUTCMonth() / 3) + 1;
  const quarterCode = year * 10 + q;
  const priorYear = year - 1;
  const [cfRes, sqRes] = await Promise.all([
    supabase.from("dv_cost_factors").select("year", { count: "exact", head: false }).eq("year", priorYear),
    supabase.from("dv_salvage_quarters").select("quarter_code", { count: "exact", head: false }).eq("quarter_code", quarterCode),
  ]);
  const stale: string[] = [];
  if (!cfRes.error && (cfRes.data?.length ?? 0) === 0) stale.push("cost_factors");
  if (!sqRes.error && (sqRes.data?.length ?? 0) === 0) stale.push("salvage_quarters");
  return {
    currentYear: year,
    currentQuarter: q,
    currentQuarterCode: quarterCode,
    currentQuarterLabel: `${year} Q${q}`,
    priorYear,
    staleTables: stale,
    isStale: stale.length > 0,
  };
}

export function errHandler(res: Response, err: unknown) {
  if (err instanceof ZodError) {
    const msg = err.issues[0]?.message || "Invalid input";
    return res.status(400).json({ message: msg });
  }
  // Handle Supabase StorageError and PostgrestError objects (have .message but aren't Error instances)
  let msg: string;
  if (err instanceof Error) {
    msg = err.message;
  } else if (err && typeof err === 'object' && 'message' in err) {
    msg = String((err as any).message);
  } else {
    msg = String(err);
  }
  console.error("[api]", msg, err);
  return res.status(500).json({ message: msg });
}

