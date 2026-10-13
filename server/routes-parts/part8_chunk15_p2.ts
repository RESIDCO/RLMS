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

export async function registerRoutesChunk15_p2(_httpServer: Server,
  app: Express,): Promise<void> {

  app.post("/api/programs", async (req, res) => {
    try {
      const userId = await requireWrite(req, res);
      if (!userId) return;
      const name = String(req.body.name ?? "").trim();
      if (!name) return res.status(400).json({ error: "Name is required" });
      const categoryId = Number(req.body.category_id);
      if (!Number.isFinite(categoryId) || categoryId <= 0) {
        return res.status(400).json({ error: "Category is required" });
      }
      const status = parseStatus(req.body.status, "open");
      const { data, error } = await supabase
        .from("programs")
        .insert({
          name,
          description: req.body.description || null,
          status,
          category_id: categoryId,
          tags: Array.isArray(req.body.tags) ? req.body.tags : null,
          entity: req.body.entity || null,
          account_manager: req.body.account_manager || null,
          account_id: req.body.account_id ? Number(req.body.account_id) : null,
          status_narrative: req.body.status_narrative || null,
          target_completion_date: req.body.target_completion_date || null,
          created_by: userId,
        })
        .select()
        .single();
      if (error) throw error;
      await logProgramActivity({ program_id: data.id, action: "created", actor: userId, detail: { name, status } });
      res.json(data);
    } catch (err) { errHandler(res, err); }
  });

}
