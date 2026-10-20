import type { Express, Request, Response } from "express";
import { INACTIVATE_CONFIRM } from "@shared/inactivate-cars";
import { requireWrite } from "./auth";
import { applyInactivate, previewInactivate } from "./inactivate-cars";

function errHandler(res: Response, err: unknown) {
  const status = Number((err as { status?: number })?.status) || 500;
  const message = err instanceof Error ? err.message : String(err);
  res.status(status).json({ message });
}

function idsOf(body: { ids?: unknown }): number[] {
  return Array.isArray(body.ids) ? body.ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0) : [];
}

export function registerInactivateRoutes(app: Express) {
  app.post("/api/railcars/inactivate/preview", async (req: Request, res: Response) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const closeAssignment = req.body?.close_assignment === true;
      const preview = await previewInactivate(idsOf(req.body ?? {}), { closeAssignment });
      res.json({ ok: true, dry_run: true, ...preview });
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.post("/api/railcars/inactivate/apply", async (req: Request, res: Response) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      if (String(req.body?.confirm ?? "") !== INACTIVATE_CONFIRM) {
        return res.status(400).json({ message: `Type ${INACTIVATE_CONFIRM} to apply` });
      }
      const mode = req.body?.mode === "good" ? "good" : "all";
      const result = await applyInactivate({
        ids: idsOf(req.body ?? {}),
        mode,
        reason: typeof req.body?.reason === "string" ? req.body.reason : "",
        closeAssignment: req.body?.close_assignment === true,
        endDate: typeof req.body?.end_date === "string" ? req.body.end_date : null,
        actor: writerId,
        changedBy: req.authUser?.email ?? writerId,
        appendNote: req.body?.append_note,
      });
      res.json({ ...result, undoable: true });
    } catch (err) {
      errHandler(res, err);
    }
  });
}
