/**
 * RlmsRule107Calculator — read-only provider interface for Rule 107 DV.
 * Phase 1 wreck build: stub / no-op adapter only. Do NOT wire a live DV service.
 * Pure math remains in shared/rule107.ts for later swap.
 */
import type { DvInputs, DvResult } from "@shared/rule107";

export type Rule107CalcRequest = {
  wreckEventId: string;
  inputs: Partial<DvInputs> & {
    originalCostCents?: number | null;
    incidentDate?: Date | string | null;
    buildDate?: Date | string | null;
  };
};

export type Rule107CalcResponse = {
  ok: boolean;
  wired: boolean;
  message: string;
  result?: DvResult;
  /** Inconsistent-tolerant: missing Umler fields do not hard-fail. */
  warnings: string[];
};

export interface RlmsRule107Calculator {
  /** Whether a live DV backend is connected. Always false in Phase 1 stub. */
  isWired(): boolean;
  /** Optional future Umler/RLMS read — stub returns incomplete. */
  fetchUmlerHints?(carMark: string, carNumber: string): Promise<{
    originalCostCents: number | null;
    buildDate: string | null;
    abItems: unknown[];
    incomplete: boolean;
  }>;
  calculate(req: Rule107CalcRequest): Promise<Rule107CalcResponse>;
}

/** Phase 1 stub — never calls external DV HTTP. */
export class StubRlmsRule107Calculator implements RlmsRule107Calculator {
  isWired() {
    return false;
  }

  async fetchUmlerHints(_carMark: string, _carNumber: string) {
    return {
      originalCostCents: null,
      buildDate: null,
      abItems: [],
      incomplete: true,
    };
  }

  async calculate(req: Rule107CalcRequest): Promise<Rule107CalcResponse> {
    const warnings: string[] = [];
    if (req.inputs.originalCostCents == null && (req.inputs as { originalCost?: number }).originalCost == null) {
      warnings.push("Original cost blank (Umler field; inconsistent-tolerant)");
    }
    return {
      ok: true,
      wired: false,
      message:
        "RlmsRule107Calculator unwired — owner enters DV worksheet by hand; shared/rule107.ts available for later swap",
      warnings,
    };
  }
}

let _provider: RlmsRule107Calculator = new StubRlmsRule107Calculator();

export function getRule107Calculator(): RlmsRule107Calculator {
  return _provider;
}

export function setRule107Calculator(p: RlmsRule107Calculator) {
  _provider = p;
}
