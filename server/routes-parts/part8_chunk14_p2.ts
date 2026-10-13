import type { Express } from "express";
import type { Server } from "http";
import {
  addMilestone, addTransitionComment, assignTerritories, deleteMilestone,
  deleteTransitionComment, deleteTransitionRecord, generateBriefingPdf,
  getOrCreateBriefingForm, getTerritoryContacts, getTerritoryHistory, getTerritoryMap,
  getTransitionDetail, patchMilestone, patchTransitionRecord, requireAccountMgmtWrite,
  requireAdmin, requireUser, requireWrite, revertTerritoryChangeSet, saveBriefingForm
} from "../routes-deps";
import {
  errHandler
} from "../routes-lib";

export async function registerRoutesChunk14_p2(_httpServer: Server,
  app: Express,): Promise<void> {

  app.get("/api/territories/contacts", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      res.json(await getTerritoryContacts({
        relationship_type: typeof req.query.relationship_type === "string" ? req.query.relationship_type : undefined,
        priority_tier: typeof req.query.priority_tier === "string" ? req.query.priority_tier : undefined,
        pipeline_status: typeof req.query.pipeline_status === "string" ? req.query.pipeline_status : undefined,
        owner: typeof req.query.owner === "string" ? req.query.owner : undefined,
        q: typeof req.query.q === "string" ? req.query.q : undefined,
        linked_to_ol: req.query.linked_to_ol === "true" || req.query.linked_to_ol === "1",
        location_status: typeof req.query.location_status === "string" ? req.query.location_status : undefined,
        county: typeof req.query.county === "string" ? req.query.county : undefined,
        state: typeof req.query.state === "string" ? req.query.state : undefined,
      }));
    } catch (err) { errHandler(res, err); }
  });

}
