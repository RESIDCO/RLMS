import type { Express } from "express";
import type { Server } from "http";
import {
  autoFleetStatusFromLegacyText, createContactOnRider, deleteCompanyContact,
  deriveActiveBool, deriveManagedCategory, getCompanyContact, insertRiderContactSchema,
  normalizeRow, normalizeStoredCarNumber, parseDateCell, parseIntCell, parseNumberCell,
  requireContactsDelete, requireContactsWrite, splitCarNumber,
  statusAlignedToActiveFlag, supabaseAdmin, updateCompanyContact
} from "../routes-deps";
import {
  errHandler
} from "../routes-lib";

export async function registerRoutesChunk05_p0(_httpServer: Server,
  app: Express,): Promise<void> {

  app.post("/api/riders/:id/contacts", async (req, res) => {
    try {
      const writerId = await requireContactsWrite(req, res);
      if (!writerId) return;
      const riderId = Number(req.params.id);
      if (!Number.isFinite(riderId) || riderId <= 0) {
        return res.status(400).json({ message: "Invalid rider" });
      }
      res.status(201).json(await createContactOnRider(riderId, (req.body ?? {}) as Record<string, unknown>, writerId));
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ message: err.message });
      errHandler(res, err);
    }
  });

  // POST /api/contacts — create a directory contact linked to a rider (rider_id in body)
  app.post("/api/contacts", async (req, res) => {
    try {
      const writerId = await requireContactsWrite(req, res);
      if (!writerId) return;
      const riderId = Number((req.body as any)?.rider_id);
      if (!Number.isFinite(riderId) || riderId <= 0) {
        return res.status(400).json({ message: "rider_id is required" });
      }
      res.status(201).json(await createContactOnRider(riderId, (req.body ?? {}) as Record<string, unknown>, writerId));
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ message: err.message });
      errHandler(res, err);
    }
  });

  app.patch("/api/contacts/:id", async (req, res) => {
    try {
      const writerId = await requireContactsWrite(req, res);
      if (!writerId) return;
      const id = Number(req.params.id);
      const { data: legacy } = await supabaseAdmin.from("rider_contacts").select("id").eq("id", id).maybeSingle();
      if (legacy) {
        const parsed = insertRiderContactSchema.partial().parse(req.body);
        const { data, error } = await supabaseAdmin
          .from("rider_contacts").update(parsed).eq("id", id).select().single();
        if (error) throw error;
        return res.json(data);
      }
      const row = await updateCompanyContact(id, (req.body ?? {}) as Record<string, unknown>);
      if (!row) return res.status(404).json({ message: "Contact not found" });
      res.json(row);
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ message: err.message });
      errHandler(res, err);
    }
  });

}
