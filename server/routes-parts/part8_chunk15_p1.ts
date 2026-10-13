import type { Express } from "express";
import type { Server } from "http";
import {
  buildProgramReport, createAccount, createTerritoryOwner, getAccount, listAccounts,
  listCategories, listDirectoryPeopleForAccount, listPrograms,
  listRiderCarsForAccountMgmt, listStatusOptions, listTerritoryContacts,
  logProgramActivity, masterReportFilename, olProgramHistory, parseStatus,
  patchTerritoryOwner, requireAdmin, requireUser, requireWrite, resolveProgramCars,
  supabase, supabaseAdmin, updateAccount
} from "../routes-deps";
import {
  errHandler
} from "../routes-lib";

export async function registerRoutesChunk15_p1(_httpServer: Server,
  app: Express,): Promise<void> {

  app.get("/api/programs/status-options", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const categoryId = Number(req.query.category_id);
      if (!Number.isFinite(categoryId) || categoryId <= 0) {
        return res.status(400).json({ error: "category_id is required" });
      }
      res.json(await listStatusOptions(categoryId));
    } catch (err) { errHandler(res, err); }
  });

  app.post("/api/programs/resolve-cars", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const text = String(req.body.text ?? "");
      const programId = req.body.program_id != null ? Number(req.body.program_id) : null;
      res.json(await resolveProgramCars({ text, programId }));
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/programs/shops", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const { data, error } = await supabaseAdmin.from("shops").select("*").order("name");
      if (error) throw error;
      res.json(data ?? []);
    } catch (err) { errHandler(res, err); }
  });

  app.post("/api/programs/shops", async (req, res) => {
    try {
      if (!(await requireWrite(req, res))) return;
      const name = String(req.body.name ?? "").trim();
      if (!name) return res.status(400).json({ error: "Shop name is required" });
      const { data: existing } = await supabaseAdmin.from("shops").select("*").ilike("name", name).limit(1);
      if (existing && existing.length) return res.json(existing[0]);
      const { data, error } = await supabaseAdmin.from("shops").insert({
        name,
        location: req.body.location || null,
        shop_type: req.body.shop_type || null,
      }).select().single();
      if (error) throw error;
      res.json(data);
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/programs/scrap-yards", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const { data, error } = await supabaseAdmin.from("scrap_yards").select("*").order("name");
      if (error) throw error;
      res.json(data ?? []);
    } catch (err) { errHandler(res, err); }
  });

  app.post("/api/programs/scrap-yards", async (req, res) => {
    try {
      if (!(await requireWrite(req, res))) return;
      const name = String(req.body.name ?? "").trim();
      if (!name) return res.status(400).json({ error: "Scrap yard name is required" });
      const { data, error } = await supabaseAdmin.from("scrap_yards").insert({
        name,
        location: req.body.location || null,
      }).select().single();
      if (error) throw error;
      res.json(data);
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/programs/history", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const ol = String(req.query.ol ?? "").trim();
      if (!ol) return res.status(400).json({ error: "ol is required" });
      res.json(await olProgramHistory(ol));
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/programs/export", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const scopeAll = req.query.scope === "all" || req.query.all === "1" || req.query.all === "true";
      let ids = String(req.query.ids ?? "")
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0);
      if (scopeAll) {
        ids = (await listPrograms()).map((p: any) => Number(p.id));
      }
      const includeExited = scopeAll
        ? req.query.include_exited !== "0" && req.query.include_exited !== "false"
        : req.query.include_exited === "1" || req.query.include_exited === "true";
      const { buffer, filename } = await buildProgramReport({
        programIds: ids,
        includeExited,
        filename: scopeAll ? masterReportFilename() : undefined,
      });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/programs", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      res.json(await listPrograms());
    } catch (err) { errHandler(res, err); }
  });

}
