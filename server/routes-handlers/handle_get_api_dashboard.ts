import type { Request, Response } from "express";
import {
  aggregateOlEndDate, buildAssetReportExpirations, buildCarFallbackExpirations,
  carLeaseEndDate, carLesseeName, carOlCode, countActiveCarsByRiderId, countInProgram,
  countsAsLeasedForKpi, deriveFleetStatus, fetchAllRows, isLeasedFleetStatus,
  isOperatingFleetCar, isResidcoOwnedEntity, listAccountManagementOverview,
  parseIsoDateOnly, resolveGovernedExpiration, supabaseAdmin, turning50ByYear
} from "../routes-deps";
import {
  errHandler
} from "../routes-lib";
import { get_api_dashboard_SRC_0 } from "./get_api_dashboard_src_0";
import { get_api_dashboard_SRC_1 } from "./get_api_dashboard_src_1";
import { get_api_dashboard_SRC_2 } from "./get_api_dashboard_src_2";

export async function handle_get_api_dashboard(_req: Request, res: Response): Promise<void> {
  const __src = get_api_dashboard_SRC_0 + get_api_dashboard_SRC_1 + get_api_dashboard_SRC_2;
  const __deps: Record<string, unknown> = {
    aggregateOlEndDate,
    buildAssetReportExpirations,
    buildCarFallbackExpirations,
    carLeaseEndDate,
    carLesseeName,
    carOlCode,
    countActiveCarsByRiderId,
    countInProgram,
    countsAsLeasedForKpi,
    deriveFleetStatus,
    fetchAllRows,
    isLeasedFleetStatus,
    isOperatingFleetCar,
    isResidcoOwnedEntity,
    listAccountManagementOverview,
    parseIsoDateOnly,
    resolveGovernedExpiration,
    supabaseAdmin,
    turning50ByYear,
    errHandler,
  };
  const __keys = Object.keys(__deps);
  const __fn = new Function(
    "_req",
    "res",
    "__deps",
    "const { " + __keys.join(", ") + " } = __deps; return (async () => {\n" + __src + "\n})();",
  ) as (a: Request, b: Response, d: Record<string, unknown>) => Promise<void>;
  await __fn(_req, res, __deps);
}
