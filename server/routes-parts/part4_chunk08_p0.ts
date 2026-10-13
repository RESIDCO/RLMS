import type { Express, Request, Response } from "express";
import type { Server } from "http";
import {
  parseAcquisitionEntity, parseAcquisitionPrice, parseSearchScope, requireAdmin,
  requireWrite, resolveBatchRentalStatus, runGlobalSearch, supabase, supabaseAdmin
} from "../routes-deps";
import {
  errHandler
} from "../routes-lib";

export async function registerRoutesChunk08_p0(_httpServer: Server,
  app: Express,): Promise<void> {

  app.post("/api/import/acquisitions/commit", async (req: Request, res: Response) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const body = req.body as {
        rows?: Record<string, string>[];
        label?: string;
        acquisition_date?: string;
        entity?: string;
        default_purchase_price?: unknown;
        default_rental_status?: unknown;
      };
      const rows = Array.isArray(body.rows) ? body.rows : [];
      if (rows.length === 0) {
        return res.status(400).json({ message: "No rows provided" });
      }
      const label = String(body.label ?? "").trim();
      if (!label) return res.status(400).json({ message: "Batch label is required" });
      const acquisition_date = String(body.acquisition_date ?? "").trim().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(acquisition_date)) {
        return res.status(400).json({ message: "Acquisition date is required (YYYY-MM-DD)" });
      }
      const entity = parseAcquisitionEntity(String(body.entity ?? ""));
      if (!entity) {
        return res.status(400).json({ message: "Entity must be Main, RPS, or Coal" });
      }
      const default_purchase_price = parseAcquisitionPrice(body.default_purchase_price);
      const default_rental_status = resolveBatchRentalStatus(body.default_rental_status);

      const review = await classifyAcquisitionUpload(rows);
      if (review.new_count === 0) {
        return res.json({
          ok: true,
          inserted: 0,
          skipped_exists: review.skipped_exists,
          skipped_invalid: review.skipped_invalid,
          batch: null,
        });
      }

      const { data: batch, error: batchErr } = await supabaseAdmin
        .from("acquisition_batches")
        .insert({
          label,
          acquisition_date,
          entity,
          default_purchase_price,
          default_rental_status,
          created_by: String(writerId),
          car_count: 0,
        })
        .select("id, label, acquisition_date, entity, default_rental_status")
        .single();
      if (batchErr) {
        const msg = String(batchErr.message ?? "");
        if (/acquisition_batches/i.test(msg) && /does not exist|schema cache/i.test(msg)) {
          return res.status(503).json({ message: ACQUISITION_SCHEMA_HINT });
        }
        throw batchErr;
      }

      const payloads = review.to_insert.map((r) => ({
        reporting_marks: r.marks,
        car_initial: r.marks,
        car_number: r.car_number,
        car_type: r.car_type,
        notes: r.notes,
        comment_event_note: r.notes,
        entity,
        fleet_status: default_rental_status,
        fleet_status_source: "manual",
        active: true,
        active_status: "Active",
        status: "Active/In-Service",
        acquisition_batch_id: batch.id,
        acquisition_date,
        purchase_price: r.purchase_price ?? default_purchase_price,
        needs_completion: true,
      }));

      let inserted = 0;
      const CHUNK = 100;
      for (let i = 0; i < payloads.length; i += CHUNK) {
        const slice = payloads.slice(i, i + CHUNK);
        const { data, error } = await supabaseAdmin.from("railcars").insert(slice).select("id");
        if (error) {
          if (String(error.code) === "23505" || /duplicate|unique/i.test(error.message ?? "")) {
            for (const row of slice) {
              const one = await supabaseAdmin.from("railcars").insert(row).select("id");
              if (one.error) {
                if (String(one.error.code) === "23505" || /duplicate|unique/i.test(one.error.message ?? "")) continue;
                throw one.error;
              }
              inserted += one.data?.length ?? 0;
            }
            continue;
          }
          throw error;
        }
        inserted += data?.length ?? 0;
      }

      await supabaseAdmin
        .from("acquisition_batches")
        .update({ car_count: inserted })
        .eq("id", batch.id);

      res.json({
        ok: true,
        inserted,
        skipped_exists: review.skipped_exists,
        skipped_invalid: review.skipped_invalid,
        batch: { ...batch, car_count: inserted },
      });
    } catch (err) {
      const msg = String((err as any)?.message ?? err ?? "");
      if (/acquisition_batch|needs_completion|purchase_price/i.test(msg) && /does not exist|schema cache/i.test(msg)) {
        return res.status(503).json({ message: ACQUISITION_SCHEMA_HINT });
      }
      errHandler(res, err);
    }
  });

  // ---------- Cleanup test/sample railcars (admin-only, dry-run by default) ----------
  // GET /api/admin/cleanup-test-railcars                 → preview candidates only (no DB writes)
  // POST /api/admin/cleanup-test-railcars { confirm: true } → snapshot to railcars_test_quarantine
  //                                                          and DELETE matching rows
  // The predicate matches obvious markers only; see migrations/cleanup_test_railcars.sql
  // for the canonical SQL implementation. The Node path mirrors that predicate via
  // simple ilike/regex queries so an operator can run it without psql access.
  // Mirrors migrations/cleanup_test_railcars.sql predicate. Kept conservative
  // so legitimate cars aren't accidentally matched.
  async function findTestRailcarCandidates(): Promise<any[]> {
    const { data, error } = await supabase
      .from("railcars")
      .select("id, car_number, reporting_marks, car_type, entity, managed_category, status, notes, general_description")
      .order("car_number", { ascending: true });
    if (error) throw error;
    const all = data ?? [];
    const startsWithMarker = /^(TEST|SAMPLE|DEMO|FAKE|DUMMY|PLACEHOLDER|FOO|BAR|EXAMPLE|XXX+|ZZZ+)/i;
    const tokenMarker = /\b(TEST|SAMPLE|DEMO|FAKE|DUMMY|PLACEHOLDER)\b/i;
    const marksMarkers = new Set(["TEST", "SAMP", "DEMO", "XXXX", "ZZZZ", "DUMM", "FAKE"]);
    const textHas = (s: string | null | undefined, needles: string[]) => {
      if (!s) return false;
      const lower = s.toLowerCase();
      return needles.some((n) => lower.includes(n));
    };
    const NEEDLES = ["[test data]", "test record", "sample data", "placeholder", "do not use", "demo data"];
    return all.filter((r: any) => {
      const cn = String(r.car_number ?? "");
      if (startsWithMarker.test(cn) || tokenMarker.test(cn)) return true;
      if (r.reporting_marks && marksMarkers.has(String(r.reporting_marks).toUpperCase())) return true;
      if (textHas(r.notes, NEEDLES)) return true;
      if (textHas(r.general_description, NEEDLES)) return true;
      return false;
    });
  }

}
