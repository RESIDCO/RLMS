import type { Express } from "express";
import type { Server } from "http";
import {
  RIDER_DATE_KEYS, effectiveDateToTimestamp, ensureAccountForLessee, fetchAllRows,
  insertRiderSchema, listAllDirectoryLeasePeople, listCarsAssignedToRider,
  listContactsForRider, logActivity, moveCarsSchema, nullifyEmptyDateStrings,
  pointCurrentAssignmentAt, promoteLegacyRiderContacts, requireContactsWrite,
  requireUser, requireWrite, supabase
} from "../routes-deps";
import {
  errHandler
} from "../routes-lib";

export async function registerRoutesChunk04_p2(_httpServer: Server,
  app: Express,): Promise<void> {

  app.post("/api/contacts/promote-legacy", async (req, res) => {
    try {
      const writerId = await requireContactsWrite(req, res);
      if (!writerId) return;
      const riderId = Number((req.body as any)?.rider_id);
      res.json(await promoteLegacyRiderContacts({
        riderId: Number.isFinite(riderId) && riderId > 0 ? riderId : undefined,
        createdBy: writerId,
      }));
    } catch (err) { errHandler(res, err); }
  });

  // ---------- Rider Contacts ----------
  app.get("/api/riders/:id/cars", async (req, res) => {
    try {
      const riderId = Number(req.params.id);
      if (!Number.isFinite(riderId) || riderId <= 0) {
        return res.status(400).json({ message: "Invalid rider" });
      }
      const active = String(req.query.active ?? "active");
      res.json(await listCarsAssignedToRider(riderId, active));
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.get("/api/riders/:id/contacts", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const riderId = Number(req.params.id);
      if (!Number.isFinite(riderId) || riderId <= 0) {
        return res.status(400).json({ message: "Invalid rider" });
      }
      await promoteLegacyRiderContacts({ riderId });
      res.json(await listContactsForRider(riderId));
    } catch (err) { errHandler(res, err); }
  });

}
