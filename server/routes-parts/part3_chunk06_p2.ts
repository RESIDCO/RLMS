import type { Express, Request, Response } from "express";
import type { Server } from "http";
import {
  RAILCAR_FINANCIAL_REFRESH_FIELDS, buildFinancialReview, buildVcfReview, fetchAllRows,
  fillBlankRiderMonthlyRent, governLeaseDates, normalizeSnapshotMonth, requireWrite,
  supabase, supabaseAdmin
} from "../routes-deps";
import {
  errHandler, upload
} from "../routes-lib";

export async function registerRoutesChunk06_p2(_httpServer: Server,
  app: Express,): Promise<void> {

  app.post("/api/import/financial/preview", async (req: Request, res: Response) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const { mainRows, rpsRows, snapshotMonth } = req.body as {
        mainRows?: unknown[][];
        rpsRows?: unknown[][];
        snapshotMonth?: string | null;
      };
      if (!Array.isArray(mainRows) && !Array.isArray(rpsRows)) {
        return res.status(400).json({ message: "Provide mainRows and/or rpsRows sheet matrices" });
      }

      // Active cars for reconciliation / refresh preview
      const activeCars: any[] = [];
      let from = 0;
      for (;;) {
        const { data, error } = await supabase
          .from("railcars")
          .select("id, rider_external_id, car_type, mechanical_designation, general_description, entity")
          .eq("active", true)
          .range(from, from + 999);
        if (error) throw error;
        const chunk = data ?? [];
        activeCars.push(...chunk);
        if (chunk.length < 1000) break;
        from += 1000;
      }

      const review = buildFinancialReview(
        mainRows ?? [],
        rpsRows ?? [],
        activeCars,
        snapshotMonth ?? null
      );

      const month = normalizeSnapshotMonth(review.snapshotMonth);
      let existingSnapshotRows = 0;
      if (month) {
        const { count, error: cErr } = await supabaseAdmin
          .from("rider_financial_summary")
          .select("id", { count: "exact", head: true })
          .eq("snapshot_month", month);
        if (cErr) throw cErr;
        existingSnapshotRows = count ?? 0;
      }

      res.json({
        ok: true,
        mode: "financial",
        productionWrite: false,
        snapshotMonth: month,
        snapshotMonthDetected: review.snapshotMonthDetected,
        existingSnapshotRows,
        qualifyingRows: review.qualifyingRows,
        qualifyingCarCount: review.qualifyingCarCount,
        mainRows: review.main.rows.length,
        rpsRows: review.rps.rows.length,
        skippedNonRail: review.skippedNonRail,
        flaggedCount: review.flaggedCount,
        flagged: review.flagged,
        unmatchedRiders: review.unmatchedRiders,
        activeCarsInRlms: review.activeCarsInRlms,
        fileVsActiveDelta: review.fileVsActiveDelta,
        fileNoCarMatchCount: review.fileNoCarMatches.length,
        fileNoCarMatches: review.fileNoCarMatches.slice(0, 50),
        carsNoFileMatch: review.carsNoFileMatch,
        refreshPreview: review.refreshPreview,
        matchPathStats: review.matchPathStats,
        assetFamilyMappingNotes: review.assetFamilyMappingNotes,
        joinRules: review.joinRules,
        railcarFieldsWritten: RAILCAR_FINANCIAL_REFRESH_FIELDS,
      });
    } catch (err) { errHandler(res, err); }
  });

  // Do-not-touch: accounts.account_manager, riders.account_manager (deprecated),
  // car_number, entity, active, lessee, rider assignment. Writes
  // rider_financial_summary + RAILCAR_FINANCIAL_REFRESH_FIELDS on railcars,
  // then governLeaseDates for OL expiration onto riders and cars.
  // fillBlankRiderMonthlyRent may fill blank riders.monthly_rent_per_car.
  // See docs/IMPORT_WRITE_BOUNDARIES.md.

}
