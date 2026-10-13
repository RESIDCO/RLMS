import type { Express, Request, Response } from "express";
import type { Server } from "http";
import {
  applyDedupAction, backfillAgentAndFamilyCandidates, carProgramHistory,
  commitMarkContacts, dedupSummary, directoryFacets, directorySearch,
  linkLesseeCompanyToLease, linkUniqueUnmatchedLesseeCompanies, listDedupCandidates,
  listLeaseLinkGaps, previewMarkContacts, requireContactsWrite, requireUser,
  requireWrite, unmatchedLesseeExportCsv
} from "../routes-deps";
import {
  errHandler
} from "../routes-lib";

export async function registerRoutesChunk18(
  _httpServer: Server,
  app: Express,
): Promise<void> {
  app.post("/api/directory-lease-gaps/apply-unique", async (req: Request, res: Response) => {
    try {
      const writerId = await requireContactsWrite(req, res);
      if (!writerId) return;
      res.json(await linkUniqueUnmatchedLesseeCompanies(writerId));
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ message: err.message });
      errHandler(res, err);
    }
  });

  app.post("/api/directory-lease-gaps/link", async (req: Request, res: Response) => {
    try {
      const writerId = await requireContactsWrite(req, res);
      if (!writerId) return;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const masterLeaseId = Number(body.master_lease_id);
      const lessee = String(body.lessee ?? "");
      res.json(await linkLesseeCompanyToLease(masterLeaseId, lessee, writerId));
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ message: err.message });
      errHandler(res, err);
    }
  });

  app.get("/api/directory-lease-gaps/export", async (req: Request, res: Response) => {
    try {
      if (!(await requireUser(req, res))) return;
      const csv = await unmatchedLesseeExportCsv();
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=\"unmatched-lessees.csv\"");
      res.send(csv);
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/directory-lease-gaps", async (req: Request, res: Response) => {
    try {
      if (!(await requireUser(req, res))) return;
      const limit = Number(req.query.limit);
      const otherOffset = Number(req.query.other_offset);
      res.json(await listLeaseLinkGaps(
        Number.isFinite(limit) ? limit : 80,
        Number.isFinite(otherOffset) ? otherOffset : 0,
      ));
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/directory-dedup", async (req: Request, res: Response) => {
    try {
      if (!(await requireUser(req, res))) return;
      res.json(await listDedupCandidates(req.query as Record<string, unknown>));
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/directory-dedup/summary", async (req: Request, res: Response) => {
    try {
      if (!(await requireUser(req, res))) return;
      res.json(await dedupSummary());
    } catch (err) { errHandler(res, err); }
  });

  app.post("/api/directory-dedup/backfill", async (req: Request, res: Response) => {
    try {
      if (!(await requireWrite(req, res))) return;
      res.json(await backfillAgentAndFamilyCandidates());
    } catch (err) { errHandler(res, err); }
  });

  app.post("/api/directory-dedup/:id", async (req: Request, res: Response) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      res.json(await applyDedupAction(Number(req.params.id), (req.body ?? {}) as Record<string, unknown>, writerId));
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ message: err.message });
      errHandler(res, err);
    }
  });

  app.get("/api/directory-search", async (req: Request, res: Response) => {
    try {
      if (!(await requireUser(req, res))) return;
      res.json(await directorySearch(req.query as Record<string, unknown>));
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/directory-facets", async (_req: Request, res: Response) => {
    try {
      if (!(await requireUser(_req, res))) return;
      res.json(await directoryFacets());
    } catch (err) { errHandler(res, err); }
  });

  app.get("/api/railcars/:id/programs", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      res.json(await carProgramHistory(Number(req.params.id)));
    } catch (err) { errHandler(res, err); }
  });


  app.post("/api/import/mark-contacts/preview", async (req: Request, res: Response) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const { rows } = req.body as { rows: Record<string, unknown>[] };
      if (!Array.isArray(rows) || rows.length === 0)
        return res.status(400).json({ message: "No rows provided" });
      const preview = await previewMarkContacts(rows);
      const { companies: _omit, ...rest } = preview;
      res.json(rest);
    } catch (err) { errHandler(res, err); }
  });

  app.post("/api/import/mark-contacts/commit", async (req: Request, res: Response) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const { rows } = req.body as { rows: Record<string, unknown>[] };
      if (!Array.isArray(rows) || rows.length === 0)
        return res.status(400).json({ message: "No rows provided" });
      const result = await commitMarkContacts(rows);
      res.json(result);
    } catch (err) { errHandler(res, err); }
  });
}
