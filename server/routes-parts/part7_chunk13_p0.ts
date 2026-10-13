import type { Express, Request, Response } from "express";
import type { Server } from "http";
import {
  ACCOUNT_TRANSITIONS_SOURCE, createRiderAccountComment, createTransitionRecord,
  deleteRiderAccountComment, getAuthUser, insertAttachmentRow, isStatusTag,
  listAccountManagementOverview, listAccountScopedAttachments,
  listRiderAccountComments, listTransitionRecords, listTransitionSummary,
  patchRiderStatusTag, requireAccountMgmtWrite, requireAdmin, requireUser,
  requireWrite, riderBelongsToAccount, supabase, supabaseAdmin
} from "../routes-deps";
import {
  STORAGE_BUCKET, errHandler, upload
} from "../routes-lib";

export async function registerRoutesChunk13_p0(_httpServer: Server,
  app: Express,): Promise<void> {

  app.get("/api/invoices/export/csv", async (req, res) => {
    try {
      const { data, error } = await supabase.from("invoices").select("*").order("due_date", { ascending: true });
      if (error) throw error;
      const rows = data ?? [];
      const headers = ["Invoice #","Lessee","Vendor","Amount","Amount Paid","Balance","Invoice Date","Due Date","Paid Date","Status","Disputed","Repair Description","Notes","Last Communication","Next Follow-up","PDF URL"];
      const escape = (v: any) => v == null ? "" : `"${String(v).replace(/"/g, '""')}"`;
      const csvRows = rows.map(r => [
        escape(r.invoice_number), escape(r.lessee_name), escape(r.vendor_name),
        r.amount ?? "", r.amount_paid ?? "", ((r.amount ?? 0) - (r.amount_paid ?? 0)).toFixed(2),
        r.invoice_date ?? "", r.due_date ?? "", r.paid_date ?? "",
        escape(r.status), r.is_disputed ? "Yes" : "No",
        escape(r.repair_description), escape(r.notes),
        r.last_communication_date ?? "", r.next_followup_date ?? "",
        escape(r.pdf_url),
      ].join(","));
      const csv = [headers.join(","), ...csvRows].join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", 'attachment; filename="ap-report.csv"');
      res.send(csv);
    } catch (err) { errHandler(res, err); }
  });

  // POST /api/invoices/import-csv — bulk import from CSV
  app.post("/api/invoices/import-csv", upload.single("file"), async (req, res) => {
    try {
      const userId = await requireWrite(req, res);
      if (!userId) return;
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      const text = req.file.buffer.toString("utf-8");
      const lines = text.split(/\r?\n/).filter(Boolean);
      if (lines.length < 2) return res.status(400).json({ error: "CSV must have header + data rows" });
      const parse = (s: string) => s.replace(/^["|']+|["|']+$/g, "").trim();
      const headers = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/[^a-z0-9]/g, "_"));
      const toInsert: Record<string, any>[] = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",");
        const row: Record<string, any> = {};
        headers.forEach((h, idx) => { row[h] = parse(cols[idx] ?? ""); });
        const inv: Record<string, any> = {
          invoice_number: row["invoice__"] || row["invoice_number"] || `IMP-${Date.now()}-${i}`,
          lessee_name: row["lessee"] || row["lessee_name"] || "Unknown",
          vendor_name: row["vendor"] || row["vendor_name"] || null,
          amount: parseFloat(row["amount"]) || null,
          amount_paid: parseFloat(row["amount_paid"]) || 0,
          invoice_date: row["invoice_date"] || null,
          due_date: row["due_date"] || null,
          status: row["status"] || "unpaid",
          repair_description: row["repair_description"] || row["description"] || null,
          notes: row["notes"] || null,
          created_by: userId,
        };
        toInsert.push(inv);
      }
      const { data, error } = await supabase.from("invoices").insert(toInsert).select();
      if (error) throw error;
      res.json({ inserted: (data ?? []).length });
    } catch (err) { errHandler(res, err); }
  });

  // ── ACCOUNTS ─────────────────────────────────────────────────────────────────

  app.get("/api/account-management/overview", async (req, res) => {
    try {
      if (!(await requireUser(req, res))) return;
      const am = typeof req.query.account_manager === "string" ? req.query.account_manager : "";
      const includeInactive =
        req.query.include_inactive === "1" ||
        req.query.include_inactive === "true";
      res.json(await listAccountManagementOverview(am.trim() || null, { includeInactive }));
    } catch (err) { errHandler(res, err); }
  });

  app.patch("/api/account-management/riders/:riderId/status-tag", async (req, res) => {
    try {
      if (!(await requireAccountMgmtWrite(req, res))) return;
      const riderId = Number(req.params.riderId);
      if (!Number.isFinite(riderId) || riderId <= 0) {
        return res.status(400).json({ message: "Invalid rider" });
      }
      const raw = req.body?.status_tag;
      const statusTag = raw === null || raw === "" ? null : raw;
      if (statusTag != null && !isStatusTag(statusTag)) {
        return res.status(400).json({ message: "status_tag must be good, watch, or risk" });
      }
      const row = await patchRiderStatusTag(riderId, statusTag);
      if (!row) return res.status(404).json({ message: "Rider not found" });
      res.json(row);
    } catch (err) { errHandler(res, err); }
  });

}
