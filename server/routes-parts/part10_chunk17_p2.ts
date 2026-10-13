import type { Express, Request, Response } from "express";
import type { Server } from "http";
import {
  createCompany, createCompanyContact, createContactLeaseLink, deleteCompany,
  deleteCompanyContact, deleteContactLeaseLink, getCompany, getCompanyContact,
  listCompanies, listCompanyContacts, listCompanyLeaseLinks, listContactLeaseLinks,
  listLeaseContactLinks, requireContactsDelete, requireContactsWrite, requireUser,
  requireWrite, supabaseAdmin, updateCompany, updateCompanyContact
} from "../routes-deps";
import {
  STORAGE_BUCKET, errHandler, upload
} from "../routes-lib";

export async function registerRoutesChunk17_p2(_httpServer: Server,
  app: Express,): Promise<void> {

  app.post("/api/leases/:id/contact-links", async (req: Request, res: Response) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const body = (req.body as any) ?? {};
      const contactId = Number(body.company_contact_id);
      res.status(201).json(await createContactLeaseLink(
        Number.isFinite(contactId) && contactId > 0 ? contactId : null,
        { master_lease_id: Number(req.params.id), relationship_note: body.relationship_note, company_id: body.company_id },
        writerId,
      ));
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ message: err.message });
      errHandler(res, err);
    }
  });

  app.delete("/api/leases/:id/contact-links/:linkId", async (req: Request, res: Response) => {
    try {
      if (!(await requireWrite(req, res))) return;
      await deleteContactLeaseLink(Number(req.params.linkId));
      res.json({ ok: true });
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/riders/:id/contact-links", async (req: Request, res: Response) => {
    try {
      if (!(await requireUser(req, res))) return;
      res.json(await listLeaseContactLinks({ riderId: Number(req.params.id) }));
    } catch (err) { errHandler(res, err); }
  });

  app.post("/api/riders/:id/contact-links", async (req: Request, res: Response) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const body = (req.body as any) ?? {};
      const contactId = Number(body.company_contact_id);
      res.status(201).json(await createContactLeaseLink(
        Number.isFinite(contactId) && contactId > 0 ? contactId : null,
        { rider_id: Number(req.params.id), relationship_note: body.relationship_note, company_id: body.company_id },
        writerId,
      ));
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ message: err.message });
      errHandler(res, err);
    }
  });

  app.delete("/api/riders/:id/contact-links/:linkId", async (req: Request, res: Response) => {
    try {
      if (!(await requireWrite(req, res))) return;
      await deleteContactLeaseLink(Number(req.params.linkId));
      res.json({ ok: true });
    } catch (err) { errHandler(res, err); }
  });

}
