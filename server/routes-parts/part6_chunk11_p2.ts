import type { Express } from "express";
import type { Server } from "http";
import {
  carBuildYear, getAuthUser, requireUser, requireWrite, supabase
} from "../routes-deps";
import {
  dvCalculateWithGuardrails, dvLoadReferenceData, dvParseInputs, errHandler
} from "../routes-lib";

export async function registerRoutesChunk11_p2(_httpServer: Server,
  app: Express,): Promise<void> {

  app.post("/api/calculate", async (req, res) => {
    try {
      const writerId = await requireUser(req, res);
      if (!writerId) return;
      const ref = await dvLoadReferenceData();
      const { data: abData } = await supabase.from("dv_ab_codes").select("code, rate_basis, rate, max_depreciation");
      const abMap = new Map<string, { rate_basis: AbRateBasis; rate: number; max_depreciation: number }>();
      for (const r of abData || []) abMap.set(r.code, { rate_basis: r.rate_basis, rate: Number(r.rate), max_depreciation: Number(r.max_depreciation) });
      const inputs = dvParseInputs(req.body, abMap);
      const result = dvCalculateWithGuardrails(inputs, ref);
      res.json({ result, inputsEcho: req.body });
    } catch (err) { errHandler(res, err); }
  });

  // Calculations persistence \u2014 scoped to authenticated RLMS user (not anon visitor cookie)
  app.get("/api/calculations", async (req, res) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      const { data, error } = await supabase.from("dv_calculations")
        .select("*, dv_calculation_ab_items(*)").eq("visitor_id", user.id)
        .order("created_at", { ascending: false }).limit(200);
      if (error) throw error; res.json(data || []);
    } catch (err) { errHandler(res, err); }
  });
  app.get("/api/calculations/:id", async (req, res) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      const { data, error } = await supabase.from("dv_calculations")
        .select("*, dv_calculation_ab_items(*)").eq("id", req.params.id).eq("visitor_id", user.id).single();
      if (error) throw error; res.json(data);
    } catch (err) { errHandler(res, err); }
  });

}
