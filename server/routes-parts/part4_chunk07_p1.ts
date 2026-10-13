import type { Express, Request, Response } from "express";
import type { Server } from "http";
import {
  MissingExpiryEstimateColumnsError, RAILCAR_FINANCIAL_REFRESH_FIELDS,
  applyCarFinancialsFromSummary, buildExistingCarKeySet, buildFinancialReview,
  classifyAcquisitionRows, fetchAllRows, fillBlankRiderMonthlyRent,
  financialRowToDbPayload, governLeaseDates, loadFinancialSummaryRows,
  mergeFinancialRowsByUniqueKey, normalizeSnapshotMonth,
  probeEstimatedLeaseExpiryColumns, requireWrite, skipReasonLabel, supabaseAdmin
} from "../routes-deps";
import {
  errHandler
} from "../routes-lib";

export async function registerRoutesChunk07_p1(_httpServer: Server,
  app: Express,): Promise<void> {

  app.post("/api/import/acquisitions/preview", async (req: Request, res: Response) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const { rows } = req.body as { rows?: Record<string, string>[] };
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: "No rows provided" });
      }
      const review = await classifyAcquisitionUpload(rows);
      res.json({
        ok: true,
        total: review.total,
        new_count: review.new_count,
        skipped_exists: review.skipped_exists,
        skipped_invalid: review.skipped_invalid,
        skipped: review.skipped,
      });
    } catch (err) {
      const msg = String((err as any)?.message ?? err ?? "");
      if (/acquisition_batch|needs_completion|purchase_price/i.test(msg) && /does not exist|schema cache/i.test(msg)) {
        return res.status(503).json({ message: ACQUISITION_SCHEMA_HINT });
      }
      errHandler(res, err);
    }
  });

}
