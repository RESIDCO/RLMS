import type { Express, Request, Response } from "express";
import multer from "multer";
import { requireUser, requireWrite } from "./auth";
import { supabaseAdmin } from "./supabase";
import { REMARK_CONFIRM, paddedCarNumber, parseRemarkMatrix, parseRemarkText, type RemarkInputRow } from "@shared/remark-in-place";
import { applyRemarkInPlace, chooseRemarkItems, parseRemarkUpload, previewRemark } from "./remark-in-place";

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
      if (result.ok === false) {
        const status = Array.isArray(result.conflicts) && result.conflicts.length ? 409 : 400;
        return res.status(status).json({
          message: String(result.error ?? "Remark failed"),
          conflicts: result.conflicts ?? null,
        });
      }
      res.json({
        ok: true,
        undoable: true,
        change_group: result.change_group,
        applied: selected.items.length,
        results: result.results ?? [],
        counts: preview.counts,
      });
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
      const cars: Array<{ mark: string; number: string; formerly: string | null }> = [];
      for (const raw of incoming) {
        const mark = String(raw?.mark ?? "").trim().toUpperCase();
        const number = paddedCarNumber(raw?.number);
        if (!mark || !number) continue;
        const { data, error } = await supabaseAdmin
          .from("car_number_history")
          .select("railcar_id, old_car_initial, old_car_number")
          .eq("old_car_initial", mark)
          .eq("old_car_number", number)
          .limit(5);
        if (error) throw error;
        const ids = [...new Set((data ?? []).map((row) => Number(row.railcar_id)).filter((id) => id > 0))];
        if (ids.length !== 1) {
          cars.push({ mark, number, formerly: null });
          continue;
        }
        const car = await supabaseAdmin
          .from("railcars")
          .select("id, reporting_marks, car_initial, car_number")
          .eq("id", ids[0])
          .maybeSingle();
        if (car.error) throw car.error;
        const currentMark = String(car.data?.car_initial || car.data?.reporting_marks || "").trim().toUpperCase();
        const currentNumber = paddedCarNumber(car.data?.car_number);
        if (!currentMark || !currentNumber || (currentMark === mark && currentNumber === number)) {
          cars.push({ mark, number, formerly: null });
          continue;
        }
        cars.push({ mark: currentMark, number: currentNumber, formerly: `formerly ${mark} ${number}` });
      }
      res.json({ ok: true, cars });
    } catch (err) {
      errHandler(res, err);
    }
  });
}
