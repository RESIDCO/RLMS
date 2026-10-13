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

export async function registerRoutesChunk06_p0(_httpServer: Server,
  app: Express,): Promise<void> {

  app.post("/api/import/preview", async (req: Request, res: Response) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const { rows } = req.body as { rows: any[] };
      if (!Array.isArray(rows) || rows.length === 0)
        return res.status(400).json({ message: "No rows provided" });

      // Fetch existing (reporting_marks + car_number) pairs for dupe detection.
      // The DB enforces uniqueness on the combination, not car_number alone, so
      // we must key on the same shape the import will write.
      const existing = await fetchAllRows((from, to) =>
        supabase
          .from("railcars")
          .select("car_number, reporting_marks")
          .order("id", { ascending: true })
          .range(from, to)
      );
      const dupeKey = (marks: string | null | undefined, num: string | null | undefined) =>
        `${(marks ?? "").trim().toUpperCase()}|${(num ?? "").trim().toUpperCase()}`;
      const existingNums = new Set(
        existing.map((r: any) => dupeKey(r.reporting_marks, r.car_number))
      );

      // Fetch riders for name matching (suggestions / existing link only — new OL codes are allowed)
      const riders = await fetchAllRows((from, to) =>
        supabase
          .from("riders")
          .select("id, rider_name")
          .order("id", { ascending: true })
          .range(from, to)
      );
      const riderMap = new Map<string, number>();
      for (const r of riders) riderMap.set(r.rider_name.trim().toUpperCase(), r.id);

      // Track in-batch duplicates (marks+number repeated within the same upload)
      const seenInBatch = new Set<string>();

      const preview = rows.map((row, idx) => {
        const built = buildRailcarFromRow(row);

        const key = built.car_number ? dupeKey(built.reporting_marks, built.car_number) : "";
        const isDbDupe = !!built.car_number && existingNums.has(key);
        const isBatchDupe = !!built.car_number && seenInBatch.has(key);
        if (built.car_number) seenInBatch.add(key);

        const riderId = built.rider_name ? (riderMap.get(built.rider_name.toUpperCase()) ?? null) : null;
        const riderUnknown = !!built.rider_name && riderId === null;

        const errors: string[] = [];
        const warnings: string[] = [];

        if (!built.car_number) errors.push("Missing car_number — required field");
        if (isDbDupe) errors.push("Car number already exists in the system — duplicate will be skipped");
        if (isBatchDupe) errors.push("Car number is duplicated within this file — only the first occurrence will be imported");

        // New OL/rider codes are expected — commit creates the rider when Lessee/MLA context exists.
        if (riderUnknown)
          warnings.push(`Rider/OL "${built.rider_name}" is new — will be created on import when Lessee is present`);
        if (built.entity && !["Main", "Rail Partners Select", "Coal"].includes(built.entity))
          warnings.push(`entity "${built.entity}" is unrecognised — expected "Main", "Rail Partners Select" or "Coal"; managed_category will fall back to entity value`);

        const isValid = errors.length === 0;
        return {
          _row: idx + 1,
          ...built,
          rider_id: riderId,
          is_dupe: isDbDupe,
          is_batch_dupe: isBatchDupe,
          errors,
          warnings,
          valid: isValid,
        };
      });

      res.json({
        total: rows.length,
        valid: preview.filter((r) => r.valid && r.warnings.length === 0).length,
        valid_with_warnings: preview.filter((r) => r.valid && r.warnings.length > 0).length,
        dupes: preview.filter((r) => r.is_dupe || r.is_batch_dupe).length,
        errors: preview.filter((r) => !r.valid).length,
        preview,
      });
    } catch (err) { errHandler(res, err); }
  });


  // ---------- Valid Car File (V_VALID_CARS) — assignment-grouped preview (§2 / §2.3) ----------
  // Dry-run review only unless a separate commit endpoint is used after Bruce sign-off.
}
