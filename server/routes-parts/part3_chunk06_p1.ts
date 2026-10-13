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

export async function registerRoutesChunk06_p1(_httpServer: Server,
  app: Express,): Promise<void> {

  app.post("/api/import/vcf/preview", async (req: Request, res: Response) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const { rows } = req.body as { rows: any[] };
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: "No rows provided" });
      }

      const existingKeys = new Set<string>();
      const { data: existing, error: eErr } = await supabase
        .from("railcars")
        .select("car_initial, car_number, reporting_marks");
      if (eErr) throw eErr;
      for (const r of existing ?? []) {
        const initial = String((r as any).car_initial || (r as any).reporting_marks || "")
          .trim()
          .toUpperCase();
        const num = String((r as any).car_number ?? "").trim();
        if (initial || num) existingKeys.add(`${initial}|${num}`);
      }

      const review = buildVcfReview(rows, existingKeys);
      // Omit full cars[] from response (can be 30k+) — keep summary + flags for UI.
      res.json({
        ok: true,
        mode: "vcf",
        existingCarsInDb: existingKeys.size,
        totalRows: review.totalRows,
        distinctCars: review.distinctCars,
        newCars: review.newCars,
        updatedCars: review.updatedCars,
        multipleActiveCount: review.multipleActiveCount,
        multipleActiveCars: review.multipleActiveCars,
        badActiveCount: review.badActiveCount,
        badActiveValues: review.badActiveValues,
        unmappedManagedCategoryCount: review.unmappedManagedCategoryCount,
        unmappedManagedCategories: review.unmappedManagedCategories,
        // Sample of needs-review cars for UI (full list is multipleActiveCars)
        needsReviewSample: review.cars.filter((c) => c.needsReview).slice(0, 50).map((c) => ({
          car_initial: c.car_initial,
          car_number: c.car_number,
          periodCount: c.periodCount,
          activePeriodCount: c.activePeriodCount,
        })),
      });
    } catch (err) { errHandler(res, err); }
  });

  // VCF commit — gated. Requires confirmProductionImport === true after Bruce review.
  // Not used for the non-prod gate run; kept ready for the signed-off production load.
  // Do-not-touch: accounts.account_manager, riders.account_manager (deprecated),
  // railcar_assignments, railcars.current_assignment_id (Phase 2).
  // VCF writes railcars + assignment_history + car_number_history. Open history
  // periods match car+rider+start (null vs filled ASSIGNMENT_ID is the same
  // period). Manual / already-inactive cars skip assignment_history writes.
  // See docs/IMPORT_WRITE_BOUNDARIES.md and docs/VCF_CLOSEOUT_PHASE1.md.

  // ---------- Financial Data Refresh (Asset Report) — §3 preview / gated commit ----------
}
