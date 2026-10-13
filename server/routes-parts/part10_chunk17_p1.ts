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

export async function registerRoutesChunk17_p1(_httpServer: Server,
  app: Express,): Promise<void> {

  app.post("/api/companies/:id/lease-links", async (req: Request, res: Response) => {
    try {
      const writerId = await requireContactsWrite(req, res);
      if (!writerId) return;
      const companyId = Number(req.params.id);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const contactId = Number(body.company_contact_id);
      res.status(201).json(await createContactLeaseLink(
        Number.isFinite(contactId) && contactId > 0 ? contactId : null,
        {
          master_lease_id: body.master_lease_id,
          rider_id: body.rider_id,
          relationship_note: body.relationship_note,
          company_id: Number.isFinite(contactId) && contactId > 0 ? null : companyId,
        },
        writerId,
      ));
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ message: err.message });
      errHandler(res, err);
    }
  });

  app.get("/api/companies/:id/lease-links", async (req: Request, res: Response) => {
    try {
      if (!(await requireUser(req, res))) return;
      res.json(await listCompanyLeaseLinks(Number(req.params.id)));
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/company-contacts", async (req: Request, res: Response) => {
    try {
      if (!(await requireUser(req, res))) return;
      res.json(await listCompanyContacts(req.query as Record<string, unknown>));
    } catch (err) { errHandler(res, err); }
  });

  app.post("/api/company-contacts", async (req: Request, res: Response) => {
    try {
      if (!(await requireContactsWrite(req, res))) return;
      res.status(201).json(await createCompanyContact((req.body ?? {}) as Record<string, unknown>));
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ message: err.message });
      errHandler(res, err);
    }
  });

  app.get("/api/company-contacts/:id", async (req: Request, res: Response) => {
    try {
      if (!(await requireUser(req, res))) return;
      const row = await getCompanyContact(Number(req.params.id));
      if (!row) return res.status(404).json({ message: "Contact not found" });
      res.json(row);
    } catch (err) { errHandler(res, err); }
  });

  app.patch("/api/company-contacts/:id", async (req: Request, res: Response) => {
    try {
      if (!(await requireContactsWrite(req, res))) return;
      const row = await updateCompanyContact(Number(req.params.id), (req.body ?? {}) as Record<string, unknown>);
      if (!row) return res.status(404).json({ message: "Contact not found" });
      res.json(row);
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ message: err.message });
      errHandler(res, err);
    }
  });

  app.delete("/api/company-contacts/:id", async (req: Request, res: Response) => {
    try {
      if (!(await requireContactsDelete(req, res))) return;
      await deleteCompanyContact(Number(req.params.id));
      res.json({ ok: true });
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/company-contacts/:id/lease-links", async (req: Request, res: Response) => {
    try {
      if (!(await requireUser(req, res))) return;
      res.json(await listContactLeaseLinks(Number(req.params.id)));
    } catch (err) { errHandler(res, err); }
  });

  app.post("/api/company-contacts/:id/lease-links", async (req: Request, res: Response) => {
    try {
      const writerId = await requireContactsWrite(req, res);
      if (!writerId) return;
      res.status(201).json(await createContactLeaseLink(Number(req.params.id), (req.body ?? {}) as Record<string, unknown>, writerId));
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ message: err.message });
      errHandler(res, err);
    }
  });

  app.delete("/api/contact-lease-links/:id", async (req: Request, res: Response) => {
    try {
      if (!(await requireContactsWrite(req, res))) return;
      await deleteContactLeaseLink(Number(req.params.id));
      res.json({ ok: true });
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/leases/:id/contact-links", async (req: Request, res: Response) => {
    try {
      if (!(await requireUser(req, res))) return;
      res.json(await listLeaseContactLinks({ masterLeaseId: Number(req.params.id) }));
    } catch (err) { errHandler(res, err); }
  });

}
