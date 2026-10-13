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

export async function registerRoutesChunk07_p0(_httpServer: Server,
  app: Express,): Promise<void> {

  app.post("/api/import/financial/commit", async (req: Request, res: Response) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const { mainRows, rpsRows, snapshotMonth, confirmReplace } = req.body as {
        mainRows?: unknown[][];
        rpsRows?: unknown[][];
        snapshotMonth?: string | null;
        confirmReplace?: boolean;
      };

      const month = normalizeSnapshotMonth(snapshotMonth);
      if (!month) {
        return res.status(400).json({ message: "snapshot_month is required — confirm or override it before committing." });
      }

      const { count: existingCount, error: existErr } = await supabaseAdmin
        .from("rider_financial_summary")
        .select("id", { count: "exact", head: true })
        .eq("snapshot_month", month);
      if (existErr) throw existErr;
      if ((existingCount ?? 0) > 0 && !confirmReplace) {
        return res.status(409).json({
          message: `${month} already has ${existingCount} rows. Set confirmReplace: true to replace that month only.`,
          snapshotMonth: month,
          existingSnapshotRows: existingCount,
        });
      }

      const colProbe = await supabaseAdmin.from("railcars").select("id, financial_snapshot_month").limit(1);
      if (colProbe.error) {
        if (/financial_snapshot_month/i.test(colProbe.error.message)) {
          return res.status(503).json({
            message:
              "railcars.financial_snapshot_month is missing. Run migrations/20260814_financial_snapshot_month.sql in the Supabase SQL editor, then retry. Nothing was written.",
          });
        }
        throw colProbe.error;
      }
      try {
        await probeEstimatedLeaseExpiryColumns(supabaseAdmin);
      } catch (probeErr) {
        if (probeErr instanceof MissingExpiryEstimateColumnsError) {
          return res.status(503).json({ message: probeErr.message });
        }
        throw probeErr;
      }

      const activeCars: any[] = [];
      let from = 0;
      for (;;) {
        const { data, error } = await supabaseAdmin
          .from("railcars")
          .select("id, rider_external_id, car_type, mechanical_designation, general_description, entity, nbv, oec, monthly_rent_per_car, monthly_depr_per_car, financial_snapshot_month")
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
        month
      );
      if (!review.snapshotMonth) {
        return res.status(400).json({ message: "snapshot_month required — detect failed; pass snapshotMonth explicitly" });
      }

      // Replace this month only — other months stay. Never append/duplicate.
      const { error: delErr } = await supabaseAdmin
        .from("rider_financial_summary")
        .delete()
        .eq("snapshot_month", month);
      if (delErr) throw delErr;

      const allRows = mergeFinancialRowsByUniqueKey([...review.main.rows, ...review.rps.rows]);
      const BATCH = 100;
      let inserted = 0;
      for (let i = 0; i < allRows.length; i += BATCH) {
        const slice = allRows.slice(i, i + BATCH).map(financialRowToDbPayload);
        const { error } = await supabaseAdmin.from("rider_financial_summary").insert(slice);
        if (error) throw error;
        inserted += slice.length;
      }

      // Recompute cars from the latest month that matches each car (not only this file).
      const summaryRows = await loadFinancialSummaryRows(supabaseAdmin);
      const {
        carsUpdated,
        carsUnchanged,
        carsLeftBlank: leftBlank,
        coalSkipped,
      } = await applyCarFinancialsFromSummary(supabaseAdmin, activeCars, summaryRows);

      const leaseGovernance = await governLeaseDates(supabaseAdmin);
      const riderRentRollup = await fillBlankRiderMonthlyRent();

      console.log("[financial-refresh]", JSON.stringify({
        snapshotMonth: month,
        summaryRowsDeleted: existingCount ?? 0,
        summaryRowsWritten: inserted,
        carsUpdated,
        carsUnchanged,
        carsLeftBlank: leftBlank,
        coalSkipped,
        unmatchedRiders: review.unmatchedRiders.length,
        railcarFieldsWritten: RAILCAR_FINANCIAL_REFRESH_FIELDS,
        leaseGovernance,
        riderRentRollup,
      }));

      res.json({
        ok: true,
        snapshotMonth: month,
        summaryRowsDeleted: existingCount ?? 0,
        summaryRowsWritten: inserted,
        carsUpdated,
        carsUnchanged,
        carsLeftBlank: leftBlank,
        coalSkipped,
        flaggedCount: review.flaggedCount,
        qualifyingRows: review.qualifyingRows,
        qualifyingCarCount: review.qualifyingCarCount,
        skippedNonRail: review.skippedNonRail,
        mainRows: review.main.rows.length,
        rpsRows: review.rps.rows.length,
        unmatchedRiders: review.unmatchedRiders,
        fileNoCarMatchCount: review.fileNoCarMatches.length,
        activeCarsInRlms: review.activeCarsInRlms,
        railcarFieldsWritten: RAILCAR_FINANCIAL_REFRESH_FIELDS,
        leaseGovernance,
        riderRentRollup,
      });
    } catch (err) { errHandler(res, err); }
  });

  function summarizeAcquisition(classified: AcquisitionParsedRow[]) {
    const toInsert = classified.filter((r) => !r.skip_reason);
    const skippedExists = classified.filter((r) => r.skip_reason === "already_exists");
    const skippedInvalid = classified.filter((r) => r.skip_reason === "missing_identity" || r.skip_reason === "duplicate_in_file");
    const skipped = classified
      .filter((r) => r.skip_reason)
      .map((r) => ({
        row: r.row,
        marks: r.marks,
        car_number: r.car_number,
        skip_reason: r.skip_reason,
        skip_label: skipReasonLabel(r.skip_reason),
      }));
    return {
      total: classified.length,
      new_count: toInsert.length,
      skipped_exists: skippedExists.length,
      skipped_invalid: skippedInvalid.length,
      skipped,
      to_insert: toInsert,
    };
  }

  async function classifyAcquisitionUpload(rows: Record<string, string>[]) {
    const existing = await fetchAllRows<{
      car_number: string | null;
      reporting_marks: string | null;
      car_initial: string | null;
    }>((from, to) =>
      supabaseAdmin
        .from("railcars")
        .select("car_number, reporting_marks, car_initial")
        .order("id", { ascending: true })
        .range(from, to)
    );
    const classified = classifyAcquisitionRows(rows, buildExistingCarKeySet(existing));
    return summarizeAcquisition(classified);
  }

  const ACQUISITION_SCHEMA_HINT =
    "Acquisition tables are missing. Run migrations/20260817_acquisition_batches.sql in the Supabase SQL editor, then retry. Nothing was written.";

}
