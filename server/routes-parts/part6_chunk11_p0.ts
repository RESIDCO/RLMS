import type { Express } from "express";
import type { Server } from "http";
import {
  carBuildYear, getAuthUser, requireUser, requireWrite, supabase
} from "../routes-deps";
import {
  dvCalculateWithGuardrails, dvLoadReferenceData, dvParseInputs, errHandler
} from "../routes-lib";

export async function registerRoutesChunk11_p0(_httpServer: Server,
  app: Express,): Promise<void> {

  app.get("/api/reference/cost-factors", async (_req, res) => {
    try {
      const { data, error } = await supabase.from("dv_cost_factors").select("*")
        .order("year", { ascending: true }).order("publication_q", { ascending: true });
      if (error) throw error; res.json(data);
    } catch (err) { errHandler(res, err); }
  });
  app.get("/api/reference/salvage", async (_req, res) => {
    try {
      const { data, error } = await supabase.from("dv_salvage_quarters").select("*").order("quarter_code", { ascending: false });
      if (error) throw error; res.json(data);
    } catch (err) { errHandler(res, err); }
  });
  app.get("/api/reference/ab-codes", async (_req, res) => {
    try {
      const { data, error } = await supabase.from("dv_ab_codes").select("*").order("code", { ascending: true });
      if (error) throw error; res.json(data);
    } catch (err) { errHandler(res, err); }
  });
  app.get("/api/reference/car-rates", async (_req, res) => {
    try {
      const { data, error } = await supabase.from("dv_car_dep_rates").select("*").order("display_name", { ascending: true });
      if (error) throw error; res.json(data);
    } catch (err) { errHandler(res, err); }
  });

  // Reference writes
  app.post("/api/reference/cost-factors", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const { year, factor, publication_q = 0, source = null } = req.body;
      const { data, error } = await supabase.from("dv_cost_factors")
        .upsert({ year, factor, publication_q, source }, { onConflict: "year,publication_q" }).select().single();
      if (error) throw error; res.json(data);
    } catch (err) { errHandler(res, err); }
  });
  app.post("/api/reference/salvage", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const { data, error } = await supabase.from("dv_salvage_quarters")
        .upsert(req.body, { onConflict: "quarter_code" }).select().single();
      if (error) throw error; res.json(data);
    } catch (err) { errHandler(res, err); }
  });
  app.post("/api/reference/ab-codes", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const row = { effective_from: "1970-01-01", ...req.body };
      const { data, error } = await supabase.from("dv_ab_codes")
        .upsert(row, { onConflict: "code,effective_from" }).select().single();
      if (error) throw error; res.json(data);
    } catch (err) { errHandler(res, err); }
  });
  app.post("/api/reference/car-rates", async (req, res) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const { data, error } = await supabase.from("dv_car_dep_rates")
        .upsert(req.body, { onConflict: "equipment_type" }).select().single();
      if (error) throw error; res.json(data);
    } catch (err) { errHandler(res, err); }
  });

  // Railcar lookup for DV auto-fill — distinct path so it doesn't collide with other /api/railcars routes.
  // Matching mirrors /api/search: whitespace tokens are AND'd across mark/number (so "OFOX 528345" works).
}
