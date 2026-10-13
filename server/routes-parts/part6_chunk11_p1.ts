import type { Express } from "express";
import type { Server } from "http";
import {
  carBuildYear, getAuthUser, requireUser, requireWrite, supabase
} from "../routes-deps";
import {
  dvCalculateWithGuardrails, dvLoadReferenceData, dvParseInputs, errHandler
} from "../routes-lib";

export async function registerRoutesChunk11_p1(_httpServer: Server,
  app: Express,): Promise<void> {

  app.get("/api/dv/railcars", async (req, res) => {
    try {
      const raw = String(req.query.q || "").trim();
      const tokens = raw
        .toLowerCase()
        .split(/[\s,]+/)
        .map((t) => t.replace(/[()]/g, "").trim())
        .filter(Boolean);

      const DV_CAR_SELECT = `
          id, car_initial, car_number, reporting_marks, tare_weight_lbs,
          built_year, build_year, build_date, oec, railinc_oec, oac, nbv,
          car_type, mechanical_designation
        `;

      let rows: any[] = [];
      if (tokens.length === 0) {
        // Empty query: small browse list only (picker still requires typing to find a specific car).
        const { data, error } = await supabase
          .from("railcars")
          .select(DV_CAR_SELECT)
          .order("reporting_marks", { ascending: true })
          .order("car_number", { ascending: true })
          .limit(50);
        if (error) throw error;
        rows = data || [];
      } else {
        // Tokenize like header /api/search (AND across mark/number). Push both mark and number
        // into SQL when present — PostgREST caps a single page at ~1000 rows, so mark-only
        // prefilter + in-memory AND misses high car numbers in large fleets (e.g. OFOX 528345).
        const safe = (t: string) => t.replace(/[%_,]/g, "");
        const markTok = tokens.map(safe).find((t) => /[a-z]/i.test(t));
        const numTok = tokens.map(safe).find((t) => /\d/.test(t));
        const lead = safe(tokens[0]);

        let q = supabase.from("railcars").select(DV_CAR_SELECT);
        if (markTok && numTok) {
          q = q
            .or(
              [
                `reporting_marks.ilike.%${markTok}%`,
                `car_initial.ilike.%${markTok}%`,
              ].join(","),
            )
            .ilike("car_number", `%${numTok}%`);
        } else if (numTok && !markTok) {
          q = q.ilike("car_number", `%${numTok}%`);
        } else {
          q = q.or(
            [
              `reporting_marks.ilike.%${lead}%`,
              `car_number.ilike.%${lead}%`,
              `car_initial.ilike.%${lead}%`,
            ].join(","),
          );
        }

        const { data, error } = await q
          .order("reporting_marks", { ascending: true })
          .order("car_number", { ascending: true })
          .limit(1000);
        if (error) throw error;

        const blobOf = (c: any) =>
          [
            c.car_number,
            c.reporting_marks,
            c.car_initial,
            `${c.reporting_marks ?? ""}${c.car_number ?? ""}`,
            `${c.car_initial ?? ""}${c.car_number ?? ""}`,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();

        rows = (data || [])
          .map((c: any) => {
            const blob = blobOf(c);
            if (!tokens.every((t) => blob.includes(t))) return null;
            const phrase = tokens.join(" ");
            const score = blob.includes(phrase) ? 0 : 1;
            return { c, score };
          })
          .filter(Boolean)
          .sort(
            (a: any, b: any) =>
              a.score - b.score ||
              String(a.c.reporting_marks ?? "").localeCompare(String(b.c.reporting_marks ?? "")) ||
              String(a.c.car_number ?? "").localeCompare(String(b.c.car_number ?? "")),
          )
          .slice(0, 50)
          .map((x: any) => x.c);
      }

      const ids = rows.map((r: any) => r.id);
      let abByCar = new Map<number, any[]>();
      if (ids.length) {
        const { data: abRows, error: abErr } = await supabase
          .from("railcar_ab_items")
          .select("railcar_id, seq, code, amount, sign, signed_amount, application_date")
          .in("railcar_id", ids);
        if (abErr) throw abErr;
        for (const it of abRows || []) {
          const list = abByCar.get(it.railcar_id) ?? [];
          list.push(it);
          abByCar.set(it.railcar_id, list);
        }
      }

      const { data: abData } = await supabase
        .from("dv_ab_codes")
        .select("code, rate_basis, rate, max_depreciation");
      const abMeta = new Map(
        (abData || []).map((r: any) => [r.code, r]),
      );

      res.json(rows.map((r: any) => {
        const initial = r.car_initial || r.reporting_marks || "";
        const items = [...(abByCar.get(r.id) ?? [])]
          .sort((a: any, b: any) => Number(a.seq) - Number(b.seq))
          .map((it: any) => {
            const meta = abMeta.get(it.code);
            return {
              seq: it.seq,
              code: it.code,
              amount: Number(it.amount),
              sign: it.sign,
              signed_amount: Number(it.signed_amount),
              application_date: it.application_date,
              rate_basis: meta?.rate_basis ?? null,
              rate: meta != null ? Number(meta.rate) : null,
              max_depreciation: meta != null ? Number(meta.max_depreciation) : null,
            };
          });
        return {
          ...r,
          car_initial: initial,
          built_year: carBuildYear(r),
          railcar_ab_items: items,
        };
      }));
    } catch (err) { errHandler(res, err); }
  });

  // Pure-engine calc (no persist) — all roles (Viewer carve-out for DV)
}
