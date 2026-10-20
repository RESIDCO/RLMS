import { createHash } from "node:crypto";
import type { Express, Request, Response } from "express";
import multer from "multer";
import {
  assertBidUpload,
  bidImportOpportunityError,
  BidImportError,
  headerSignatureMaterial,
  parseBidWorkbook,
  replaceNeedsConfirm,
  sanitizeImportedLine,
  unacknowledgedBlocks,
  type BidColumnMapping,
  type BidHeaderFields,
  type ImportFlag,
} from "@shared/bid-import";
import { changeCaptureRow } from "@shared/crm";
import { requireWrite } from "./auth";
import { STORAGE_BUCKET, insertAttachmentRow } from "./attachments";
import { recordChange, withChangeGroup } from "./change-log";
import { opportunityFileInsertChange } from "./crm-bid-attachments";
import { commitBidImport, revertPlan, type ImportLogRow } from "./crm-bid-import-commit";
import { gridsFromCsv, gridsFromXlsx } from "./crm-bid-import-read";
import { buildBidImportTemplate } from "./crm-bid-import-template";
import { bidImportMacKey, fileSha256, signBidImportToken, verifyBidImportToken } from "./crm-bid-import-token";
import { CrmHttpError } from "./crm-error";
import { saveOpportunityLines } from "./crm-bid-lines";
import { supabaseAdmin } from "./supabase";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
});

function sendError(res: Response, err: unknown) {
  if (err instanceof CrmHttpError || err instanceof BidImportError) {
    return res.status(err.status).json({ message: err.message });
  }
  const code = err && typeof err === "object" && "code" in err ? String((err as { code?: string }).code) : "";
  if (code === "LIMIT_FILE_SIZE") return res.status(413).json({ message: "Bid sheets are limited to 20 MB" });
  const message = err instanceof Error ? err.message : String(err);
  console.error("[crm-bid-import]", message, err);
  return res.status(500).json({ message: "Bid import failed" });
}

function positiveId(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function readJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value.trim()) return fallback;
  return JSON.parse(value) as T;
}

async function loadOpportunity(id: number): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabaseAdmin.from("opportunities").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as Record<string, unknown> | null) ?? null;
}

function gateOpportunity(row: Record<string, unknown> | null): void {
  const problem = bidImportOpportunityError(row == null ? null : {
    flavor: row.flavor == null ? null : String(row.flavor),
    stage: row.stage == null ? null : String(row.stage),
    deleted_at: row.deleted_at == null ? null : String(row.deleted_at),
  });
  if (problem) throw new BidImportError(problem.status, problem.message);
}

async function existingLines(opportunityId: number): Promise<{
  id: number;
  seller_deal_ref: string;
  car_type: string | null;
  prelim_price_per_car: number | null;
  final_price_per_car: number | null;
  market_price_per_car: number | null;
  outcome: string | null;
}[]> {
  const { data, error } = await supabaseAdmin
    .from("opportunity_lines")
    .select("id, seller_deal_ref, car_type, prelim_price_per_car, final_price_per_car, market_price_per_car, outcome")
    .eq("opportunity_id", opportunityId)
    .is("deleted_at", null);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: Number(row.id),
    seller_deal_ref: String(row.seller_deal_ref ?? ""),
    car_type: row.car_type == null ? null : String(row.car_type),
    prelim_price_per_car: row.prelim_price_per_car == null ? null : Number(row.prelim_price_per_car),
    final_price_per_car: row.final_price_per_car == null ? null : Number(row.final_price_per_car),
    market_price_per_car: row.market_price_per_car == null ? null : Number(row.market_price_per_car),
    outcome: row.outcome == null ? null : String(row.outcome),
  }));
}

async function savedMapping(companyId: number | null, material: string): Promise<BidColumnMapping | null> {
  if (!companyId) return null;
  const signature = createHash("sha256").update(material).digest("hex");
  const { data, error } = await supabaseAdmin
    .from("crm_bid_import_mappings")
    .select("mapping")
    .eq("company_id", companyId)
    .eq("header_signature", signature)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data?.mapping || typeof data.mapping !== "object") return null;
  return data.mapping as BidColumnMapping;
}

function headerPatch(fields: Partial<BidHeaderFields> | null): Record<string, unknown> | null {
  if (!fields) return null;
  const out: Record<string, unknown> = {};
  const name = fields.offering_name ?? fields.title;
  if (typeof name === "string" && name.trim()) out.offering_name = name.trim();
  for (const key of ["received_date", "bid_due_prelim", "bid_due_final", "award_date"] as const) {
    const value = fields[key];
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

async function rollbackGroup(group: string): Promise<void> {
  const { data, error } = await supabaseAdmin.from("activity_log").select("table_name, row_pk, before, after, detail").eq("change_group", group);
  if (error) throw error;
  const rows: ImportLogRow[] = (data ?? []).map((row) => {
    const detail = row.detail && typeof row.detail === "object" ? row.detail as { op?: string } : {};
    const op: ImportLogRow["op"] = detail.op === "insert" || detail.op === "delete" || detail.op === "update" ? detail.op : "update";
    return {
      table_name: String(row.table_name ?? ""),
      row_pk: Number(row.row_pk),
      op,
      before: row.before && typeof row.before === "object" ? row.before as Record<string, unknown> : {},
      after: row.after && typeof row.after === "object" ? row.after as Record<string, unknown> : {},
    };
  }).filter((row) => row.table_name && Number.isFinite(row.row_pk));
  const plan = revertPlan(rows);
  for (const item of plan.deletes) {
    const { error: delErr } = await supabaseAdmin.from(item.table).delete().eq("id", item.id);
    if (delErr) throw delErr;
  }
  for (const item of plan.restores) {
    if (!Object.keys(item.values).length) continue;
    const { error: updErr } = await supabaseAdmin.from(item.table).update(item.values).eq("id", item.id);
    if (updErr) throw updErr;
  }
  const { error: logErr } = await supabaseAdmin.from("activity_log").delete().eq("change_group", group);
  if (logErr) throw logErr;
}

function withFile(req: Request, res: Response, next: (file: Express.Multer.File) => Promise<void>) {
  upload.single("file")(req, res, (err: unknown) => {
    if (err) {
      sendError(res, err);
      return;
    }
    const file = req.file;
    if (!file) {
      res.status(400).json({ message: "Choose an .xlsx or .csv file" });
      return;
    }
    void next(file).catch((failure) => sendError(res, failure));
  });
}

export function registerBidImportRoutes(app: Express) {
  app.get("/api/crm/bid-import/template.xlsx", async (req, res) => {
    try {
      const user = await requireWrite(req, res);
      if (!user) return;
      const body = await buildBidImportTemplate();
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", "attachment; filename=\"bid-sheet-template.xlsx\"");
      res.send(body);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/crm/opportunities/:id/bid-import/parse", (req, res) => {
    withFile(req, res, async (file) => {
      const user = await requireWrite(req, res);
      if (!user) return;
      const id = positiveId(req.params.id);
      if (!id) throw new BidImportError(400, "Invalid opportunity");
      const opportunity = await loadOpportunity(id);
      gateOpportunity(opportunity);
      assertBidUpload({ filename: file.originalname, byteLength: file.size, bytes: file.buffer });
      const grids = file.originalname.toLowerCase().endsWith(".csv")
        ? gridsFromCsv(file.buffer, file.originalname)
        : await gridsFromXlsx(file.buffer);
      const companyId = opportunity?.company_id == null ? null : Number(opportunity.company_id);
      const sheet = typeof req.body?.sheet === "string" ? req.body.sheet : null;
      let mapping = readJson<BidColumnMapping | null>(req.body?.mapping, null);
      const probe = parseBidWorkbook(grids, { sheet, today: new Date().toISOString().slice(0, 10) });
      if (!mapping) mapping = await savedMapping(companyId, probe.header_signature_material);
      const live = await existingLines(id);
      const proposal = parseBidWorkbook(grids, {
        sheet,
        mapping,
        existing: live,
        mode: "append",
        today: new Date().toISOString().slice(0, 10),
      });
      const key = bidImportMacKey(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "");
      const token = signBidImportToken({
        opportunity_id: id,
        file_sha256: fileSha256(file.buffer),
        file_name: file.originalname,
        size: file.size,
        actor: user,
        iat: Date.now(),
        stated_car_total: proposal.stated_car_total,
        header_signature: createHash("sha256").update(proposal.header_signature_material).digest("hex"),
      }, key);
      res.json({
        proposal: {
          lines: proposal.lines,
          header_fields: proposal.header_fields,
          mapping: proposal.mapping,
          flags: proposal.flags,
          columns: proposal.columns,
          price_columns: proposal.price_columns,
          stated_car_total: proposal.stated_car_total,
          car_total: proposal.car_total,
          sheet: proposal.sheet,
          header_row: proposal.header_row,
        },
        header_fields: proposal.header_fields,
        mapping: proposal.mapping,
        flags: proposal.flags,
        sheets: proposal.sheets,
        token,
      });
    });
  });

  app.post("/api/crm/opportunities/:id/bid-import/commit", (req, res) => {
    withFile(req, res, async (file) => {
      const user = await requireWrite(req, res);
      if (!user) return;
      const id = positiveId(req.params.id);
      if (!id) throw new BidImportError(400, "Invalid opportunity");
      const opportunity = await loadOpportunity(id);
      gateOpportunity(opportunity);
      assertBidUpload({ filename: file.originalname, byteLength: file.size, bytes: file.buffer });
      const key = bidImportMacKey(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "");
      const verified = verifyBidImportToken(String(req.body?.token ?? ""), key);
      if (!verified.ok) throw new BidImportError(400, verified.error);
      if (verified.payload.opportunity_id !== id) throw new BidImportError(400, "Import token is for a different opportunity");
      if (verified.payload.actor !== user) throw new BidImportError(400, "Import token is for a different user");
      if (verified.payload.file_sha256 !== fileSha256(file.buffer) || verified.payload.size !== file.size) {
        throw new BidImportError(400, "The file does not match the preview");
      }
      const mode = req.body?.mode === "replace" ? "replace" : "append";
      const edited = readJson<unknown[]>(req.body?.lines, []);
      if (!Array.isArray(edited) || !edited.length) throw new BidImportError(400, "Nothing to import");
      const lines = edited.map((line, index) => sanitizeImportedLine(line, index + 1));
      const live = await existingLines(id);
      const cars = lines.reduce((sum, line) => sum + line.car_count, 0);
      const flags: ImportFlag[] = [];
      if (verified.payload.stated_car_total != null && verified.payload.stated_car_total !== cars) {
        flags.push({
          id: "car_total",
          severity: "block",
          message: `Car total ${cars} does not match the stated total ${verified.payload.stated_car_total}`,
        });
      }
      const acknowledged = readJson<string[]>(req.body?.acknowledge, []);
      const blocked = unacknowledgedBlocks(flags, acknowledged);
      if (blocked.length) throw new BidImportError(400, blocked[0].message);
      if (mode === "replace" && replaceNeedsConfirm(live) && req.body?.replace_confirm !== "true" && req.body?.replace_confirm !== true) {
        throw new BidImportError(400, "Confirm replace because a line already has a price or an outcome");
      }
      const deleteIds = mode === "replace" ? live.map((line) => line.id) : [];
      if (mode === "append") {
        const taken = new Set(live.map((line) => line.seller_deal_ref.toLowerCase()));
        const clash = lines.find((line) => taken.has(line.seller_deal_ref.toLowerCase()));
        if (clash) throw new BidImportError(400, `Deal ${clash.seller_deal_ref} is already on this offering`);
      }
      const header = headerPatch(readJson<Partial<BidHeaderFields> | null>(req.body?.header_fields, null));
      const beforeHeader = opportunity ?? {};
      const result = await commitBidImport({
        opportunityId: id,
        actor: user,
        filename: file.originalname,
        mime: file.mimetype || "application/octet-stream",
        bytes: file.buffer,
        lines: lines.map((line) => ({
          seller_deal_ref: line.seller_deal_ref,
          lessee_desc: line.lessee_desc,
          lessee_rating: line.lessee_rating,
          lessee_country: line.lessee_country,
          car_count: line.car_count,
          equipment_desc: line.equipment_desc,
          car_type: line.car_type,
          aar_code: line.aar_code,
          avg_build_year: line.avg_build_year,
          commodity: line.commodity,
          lease_rate: line.lease_rate,
          lease_expiry: line.lease_expiry,
          purchase_option: line.purchase_option,
          notes: line.notes,
          sort_order: line.sort_order,
          include_in_bid: true,
        })),
        header,
        deleteIds,
      }, {
        upload: async (path, bytes, mime) => {
          const { error } = await supabaseAdmin.storage.from(STORAGE_BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
          if (error) throw error;
        },
        remove: async (path) => {
          await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([path]);
        },
        inGroup: (actor, fn) => withChangeGroup(actor, fn),
        saveLines: (opportunityId, body, actor) => saveOpportunityLines(opportunityId, body, actor).then(() => undefined),
        patchHeader: async (opportunityId, patch, actor) => {
          const { data, error } = await supabaseAdmin.from("opportunities").update(patch).eq("id", opportunityId).select("*").single();
          if (error) throw error;
          await recordChange({
            table: "opportunities",
            pk: opportunityId,
            before: changeCaptureRow(beforeHeader),
            after: changeCaptureRow(data as Record<string, unknown>),
            action: "update_opportunity",
            entity_type: "opportunity",
            entity_id: opportunityId,
            actor,
          });
        },
        attach: async (opts) => {
          const row = await insertAttachmentRow({
            entity_type: "opportunity",
            entity_id: opts.opportunityId,
            file_name: opts.name,
            file_size: opts.size,
            mime_type: opts.mime,
            storage_path: opts.path,
            uploaded_by: opts.actor,
            notes: null,
            source_module: "crm",
            doc_category: "bid_sheet",
            opportunity_line_id: null,
          });
          await recordChange({
            ...opportunityFileInsertChange(row as Record<string, unknown>, opts.actor),
            action: opts.action,
          });
        },
        rollback: async (group) => {
          await rollbackGroup(group);
        },
      });
      if (req.body?.remember_mapping === "true" || req.body?.remember_mapping === true) {
        const companyId = opportunity?.company_id == null ? null : Number(opportunity.company_id);
        if (!companyId) throw new BidImportError(400, "This opportunity has no company to remember a mapping for");
        const mapping = readJson<BidColumnMapping | null>(req.body?.mapping, null);
        if (mapping) {
          const signature = verified.payload.header_signature;
          const { data: existing, error: findErr } = await supabaseAdmin
            .from("crm_bid_import_mappings")
            .select("id")
            .eq("company_id", companyId)
            .eq("header_signature", signature)
            .is("deleted_at", null)
            .maybeSingle();
          if (findErr) throw findErr;
          if (existing?.id) {
            const { error } = await supabaseAdmin.from("crm_bid_import_mappings").update({ mapping, created_by: user }).eq("id", existing.id);
            if (error) throw error;
          } else {
            const { error } = await supabaseAdmin.from("crm_bid_import_mappings").insert({
              company_id: companyId,
              header_signature: signature,
              mapping,
              created_by: user,
            });
            if (error) throw error;
          }
        }
      }
      res.status(201).json({ change_group: result.change_group, message: result.message });
    });
  });
}

export { headerSignatureMaterial };
