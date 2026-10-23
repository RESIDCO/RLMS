import type { Express, Request, Response } from "express";
import multer from "multer";
import { requireUser, requireWrite } from "./auth";
import { REMARK_CONFIRM, parseRemarkMatrix, parseRemarkText, type RemarkInputRow } from "@shared/remark-in-place";
import { appendNotesInGroup, normalizeAppendNote, withNoteReport } from "./append-note";
import { withChangeGroupResult } from "./change-log";
import { remarkFailure } from "./remark-apply";
import { applyRemarkInPlace, chooseRemarkItems, parseRemarkUpload, previewRemark } from "./remark-in-place";
import { resolvePriorMarkCars } from "./prior-marks";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

function errHandler(res: Response, err: unknown) {
  const status = Number((err as { status?: number })?.status) || 500;
  const message = err instanceof Error ? err.message : String(err);
  res.status(status).json({ message });
}

function parsedRows(body: { text?: unknown; rows?: unknown }): { ok: true; rows: RemarkInputRow[] } | { ok: false; error: string } {
  if (typeof body.text === "string" && body.text.trim()) return parseRemarkText(body.text);
  if (Array.isArray(body.rows)) return parseRemarkMatrix(body.rows as unknown[][]);
  return { ok: false, error: "Paste a list or upload a CSV/xlsx file" };
}

export function registerRemarkRoutes(app: Express) {
  app.post("/api/railcars/remark/preview", upload.single("file"), async (req: Request, res: Response) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      const file = req.file;
      const parsed = file?.buffer
        ? await parseRemarkUpload(file.buffer, file.originalname || "remark.xlsx")
        : parsedRows(req.body ?? {});
      if (!parsed.ok) return res.status(400).json({ message: parsed.error });
      const preview = await previewRemark(parsed.rows);
      res.json({ ok: true, dry_run: true, ...preview, input_rows: parsed.rows });
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.post("/api/railcars/remark/apply", async (req: Request, res: Response) => {
    try {
      const writerId = await requireWrite(req, res);
      if (!writerId) return;
      if (String(req.body?.confirm ?? "") !== REMARK_CONFIRM) {
        return res.status(400).json({ message: `Type ${REMARK_CONFIRM} to apply` });
      }
      const mode = req.body?.mode === "good" ? "good" : "all";
      const parsed = parsedRows(req.body ?? {});
      if (!parsed.ok) return res.status(400).json({ message: parsed.error });
      const preview = await previewRemark(parsed.rows);
      const selected = chooseRemarkItems(preview, mode);
      if (!selected.ok) return res.status(400).json({ message: selected.error, counts: preview.counts });
      const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
      const result = await applyRemarkInPlace({
        items: selected.items,
        reason,
        changedBy: req.authUser?.email ?? writerId,
        actor: writerId,
      });
      const failed = remarkFailure(result);
      if (failed) return res.status(failed.status).json(failed.body);
      const newIds = (result.results ?? [])
        .map((row) => Number(row.new_id))
        .filter((n) => Number.isFinite(n) && n > 0);
      const noted = normalizeAppendNote(req.body?.append_note)
        ? await withChangeGroupResult(writerId, async () =>
            appendNotesInGroup({
              entityType: "railcar",
              ids: newIds,
              note: req.body?.append_note,
              actor: writerId,
            }),
          )
        : null;
      res.json(withNoteReport({
        ok: true,
        undoable: true,
        change_group: result.change_group,
        applied: selected.items.length,
        results: result.results ?? [],
        counts: preview.counts,
        ...(noted ? { note_change_group: noted.change_group } : {}),
      }, req.body?.append_note, noted ?? { appended: [], skipped: [] }));
    } catch (err) {
      errHandler(res, err);
    }
  });

  // Read-only. Photo search and other callers turn an old mark into the current one.
  app.post("/api/railcars/resolve-prior-marks", async (req: Request, res: Response) => {
    try {
      const userId = await requireUser(req, res);
      if (!userId) return;
      const incoming = Array.isArray(req.body?.cars) ? req.body.cars.slice(0, 500) : [];
      const cars = await resolvePriorMarkCars(incoming);
      res.json({ ok: true, cars });
    } catch (err) {
      errHandler(res, err);
    }
  });
}
