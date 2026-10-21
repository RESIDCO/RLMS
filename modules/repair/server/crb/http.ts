/**
 * HTTP routes for §I CRB staging. Local review only.
 */
import type { Express, Request, Response } from "express";
import multer from "multer";
import { reauditInvoice, uploadCrbFile } from "./ingest";
import {
  cloneAuditRule,
  createOverride,
  createStandingException,
  decideCar,
  getCrbCar,
  getCrbInvoice,
  listAuditRules,
  listCrbFiles,
  listCrbInvoices,
  listUnmatchedBillerHeaders,
  listStandingExceptions,
  markInvoicesReviewed,
  nextUndecidedCar,
  rejectLine,
  saveCorrection,
  setInvoiceStatus,
  updateAuditRule,
  upsertBillerHeader,
} from "./review";
import {
  generatePackage,
  markPackageFiled,
  recordPackageResponse,
  type PackageType,
} from "./packages";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function actorFrom(req: Request): string {
  return String(req.headers["x-repair-actor"] || "crb-user");
}

function guard(req: Request, res: Response): boolean {
  if (process.env.REPAIR_DEV_BYPASS_AUTH === "1") return true;
  res.status(501).json({ error: "Auth not wired; set REPAIR_DEV_BYPASS_AUTH=1 for local" });
  return false;
}

function send(res: Response, result: { ok: boolean; error?: string; status?: number | string }) {
  if (!result.ok) {
    const code = typeof result.status === "number" ? result.status : 400;
    return res.status(code).json({ error: result.error });
  }
  return res.json(result);
}

type Severity = "INFO" | "WARN" | "HARD_STOP";

function asSeverity(value: unknown): Severity | undefined | null {
  if (value == null || value === "") return undefined;
  const raw = String(value);
  if (raw === "INFO" || raw === "WARN" || raw === "HARD_STOP") return raw;
  return null;
}

const PACKAGE_TYPES = new Set<PackageType>([
  "RETURN_UNPAID_HEADER",
  "RETURN_UNPAID_LINES",
  "PAID_EXCEPTION_LETTER_n",
  "REBUTTAL_DR_JR",
  "RULE122_PACKET",
]);

export function registerCrbRoutes(app: Express): void {
  app.get("/api/repair/crb/files", async (req, res) => {
    if (!guard(req, res)) return;
    res.json({ files: await listCrbFiles() });
  });

  app.post("/api/repair/crb/files", upload.single("file"), async (req, res) => {
    if (!guard(req, res)) return;
    const file = req.file;
    if (!file) return res.status(400).json({ error: "file is required" });
    try {
      const result = await uploadCrbFile({
        filename: file.originalname || "upload.txt",
        bytes: file.buffer,
        actor: actorFrom(req),
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "upload failed" });
    }
  });

  app.get("/api/repair/crb/invoices", async (req, res) => {
    if (!guard(req, res)) return;
    const q = req.query;
    const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
    const invoices = await listCrbInvoices({
      biller: q.biller ? String(q.biller) : undefined,
      billedParty: q.billedParty ? String(q.billedParty) : undefined,
      accountMonth: q.accountMonth ? String(q.accountMonth) : undefined,
      status: q.status ? String(q.status) : undefined,
      hasExceptions: q.hasExceptions === "1",
      hardStops: q.hardStops === "1",
      minCents: num(q.minCents),
      maxCents: num(q.maxCents),
      dueSoon: q.dueSoon === "1",
    });
    const unmatchedHeaders = await listUnmatchedBillerHeaders();
    res.json({ invoices, unmatchedHeaders });
  });

  app.post("/api/repair/crb/invoices/mark-reviewed", async (req, res) => {
    if (!guard(req, res)) return;
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
    send(res, await markInvoicesReviewed(ids, actorFrom(req)));
  });

  app.get("/api/repair/crb/invoices/:id", async (req, res) => {
    if (!guard(req, res)) return;
    const invoice = await getCrbInvoice(String(req.params.id));
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });
    res.json(invoice);
  });

  app.post("/api/repair/crb/invoices/:id/status", async (req, res) => {
    if (!guard(req, res)) return;
    const status = String(req.body?.status ?? "");
    if (status !== "APPROVED" && status !== "RETURN_UNPAID" && status !== "APPROVED_WITH_EXCEPTIONS") {
      return res.status(400).json({ error: "status must be APPROVED, RETURN_UNPAID, or APPROVED_WITH_EXCEPTIONS" });
    }
    send(
      res,
      await setInvoiceStatus({
        invoiceId: String(req.params.id),
        status,
        actor: actorFrom(req),
        monthBucketId: req.body?.monthBucketId ? String(req.body.monthBucketId) : null,
      }),
    );
  });

  app.post("/api/repair/crb/invoices/:id/packages", async (req, res) => {
    if (!guard(req, res)) return;
    const type = String(req.body?.type ?? "") as PackageType;
    if (!PACKAGE_TYPES.has(type)) return res.status(400).json({ error: "Unknown package type" });
    send(res, await generatePackage({ invoiceId: String(req.params.id), type, actor: actorFrom(req) }));
  });

  app.post("/api/repair/crb/invoices/:id/reaudit", async (req, res) => {
    if (!guard(req, res)) return;
    await reauditInvoice(String(req.params.id), actorFrom(req));
    res.json({ ok: true });
  });

  app.get("/api/repair/crb/cars/:id", async (req, res) => {
    if (!guard(req, res)) return;
    const car = await getCrbCar(String(req.params.id));
    if (!car) return res.status(404).json({ error: "Car not found" });
    res.json(car);
  });

  app.post("/api/repair/crb/cars/:id/decide", async (req, res) => {
    if (!guard(req, res)) return;
    const decision = String(req.body?.decision ?? "");
    if (decision !== "APPROVED" && decision !== "OVERRIDDEN" && decision !== "REJECTED") {
      return res.status(400).json({ error: "decision must be APPROVED, OVERRIDDEN, or REJECTED" });
    }
    send(
      res,
      await decideCar({
        carId: String(req.params.id),
        decision,
        reason: req.body?.reason ? String(req.body.reason) : undefined,
        actor: actorFrom(req),
      }),
    );
  });

  app.post("/api/repair/crb/lines/:id/reject", async (req, res) => {
    if (!guard(req, res)) return;
    send(
      res,
      await rejectLine({
        lineId: String(req.params.id),
        reason: String(req.body?.reason ?? ""),
        actor: actorFrom(req),
      }),
    );
  });

  app.post("/api/repair/crb/overrides", async (req, res) => {
    if (!guard(req, res)) return;
    const scope = String(req.body?.scope ?? "");
    if (scope !== "LINE" && scope !== "CAR" && scope !== "INVOICE" && scope !== "BILLER") {
      return res.status(400).json({ error: "scope must be LINE, CAR, INVOICE, or BILLER" });
    }
    send(
      res,
      await createOverride({
        scope,
        targetId: String(req.body?.targetId ?? ""),
        findingId: req.body?.findingId ? String(req.body.findingId) : null,
        reason: String(req.body?.reason ?? ""),
        actor: actorFrom(req),
      }),
    );
  });

  app.post("/api/repair/crb/corrections", async (req, res) => {
    if (!guard(req, res)) return;
    const scope = String(req.body?.scope ?? "");
    if (scope !== "CAR" && scope !== "LINE") {
      return res.status(400).json({ error: "scope must be CAR or LINE" });
    }
    send(
      res,
      await saveCorrection({
        scope,
        id: String(req.body?.id ?? ""),
        field: String(req.body?.field ?? ""),
        value: String(req.body?.value ?? ""),
        reason: String(req.body?.reason ?? ""),
        actor: actorFrom(req),
      }),
    );
  });

  app.post("/api/repair/crb/biller-headers", upload.single("file"), async (req, res) => {
    if (!guard(req, res)) return;
    send(
      res,
      await upsertBillerHeader({
        billingParty: String(req.body?.billingParty ?? ""),
        invoiceNumber: String(req.body?.invoiceNumber ?? ""),
        accountMonth: String(req.body?.accountMonth ?? ""),
        invoiceDate: req.body?.invoiceDate ? String(req.body.invoiceDate) : null,
        receivedDate: req.body?.receivedDate ? String(req.body.receivedDate) : null,
        totalCents: req.body?.totalCents == null || req.body.totalCents === "" ? null : Number(req.body.totalCents),
        carCount: req.body?.carCount == null || req.body.carCount === "" ? null : Number(req.body.carCount),
        attachmentName: req.file?.originalname ?? null,
        attachment: req.file?.buffer ?? null,
        actor: actorFrom(req),
      }),
    );
  });

  app.get("/api/repair/crb/next-car", async (req, res) => {
    if (!guard(req, res)) return;
    const next = await nextUndecidedCar(req.query.after ? String(req.query.after) : null);
    res.json({ next });
  });

  app.post("/api/repair/crb/packages/:id/filed", async (req, res) => {
    if (!guard(req, res)) return;
    send(
      res,
      await markPackageFiled({
        packageId: String(req.params.id),
        filedAt: String(req.body?.filedAt ?? new Date().toISOString().slice(0, 10)),
        actor: actorFrom(req),
      }),
    );
  });

  app.post("/api/repair/crb/packages/:id/response", async (req, res) => {
    if (!guard(req, res)) return;
    const code = String(req.body?.code ?? "");
    if (code !== "A" && code !== "P" && code !== "D") {
      return res.status(400).json({ error: "code must be A, P, or D" });
    }
    send(
      res,
      await recordPackageResponse({
        packageId: String(req.params.id),
        code,
        responseAt: String(req.body?.responseAt ?? new Date().toISOString().slice(0, 10)),
        actor: actorFrom(req),
        cbaNo: req.body?.cbaNo ? String(req.body.cbaNo) : null,
        cbaAmountCents: req.body?.cbaAmountCents == null ? null : Number(req.body.cbaAmountCents),
        cbaDate: req.body?.cbaDate ? String(req.body.cbaDate) : null,
      }),
    );
  });

  app.get("/api/repair/admin/audit-rules", async (req, res) => {
    if (!guard(req, res)) return;
    res.json({ rules: await listAuditRules(), standing: await listStandingExceptions() });
  });

  app.post("/api/repair/admin/audit-rules/:id", async (req, res) => {
    if (!guard(req, res)) return;
    const severity = asSeverity(req.body?.severity);
    if (severity === null) {
      return res.status(400).json({ error: "severity must be INFO, WARN, or HARD_STOP" });
    }
    send(
      res,
      await updateAuditRule({
        id: String(req.params.id),
        params: req.body?.params,
        enabled: req.body?.enabled == null ? undefined : Boolean(req.body.enabled),
        severity,
        actor: actorFrom(req),
      }),
    );
  });

  app.post("/api/repair/admin/audit-rules/:id/clone", async (req, res) => {
    if (!guard(req, res)) return;
    const severity = asSeverity(req.body?.severity);
    if (severity === null) {
      return res.status(400).json({ error: "severity must be INFO, WARN, or HARD_STOP" });
    }
    send(
      res,
      await cloneAuditRule({
        id: String(req.params.id),
        effectiveFrom: String(req.body?.effectiveFrom ?? ""),
        params: req.body?.params,
        severity,
        enabled: req.body?.enabled == null ? undefined : Boolean(req.body.enabled),
        actor: actorFrom(req),
      }),
    );
  });

  app.post("/api/repair/admin/standing-exceptions", async (req, res) => {
    if (!guard(req, res)) return;
    send(
      res,
      await createStandingException({
        ruleCode: String(req.body?.ruleCode ?? ""),
        reason: String(req.body?.reason ?? ""),
        actor: actorFrom(req),
        biller: req.body?.biller ? String(req.body.biller) : null,
        repairingParty: req.body?.repairingParty ? String(req.body.repairingParty) : null,
        leaseId: req.body?.leaseId ? String(req.body.leaseId) : null,
        lesseeId: req.body?.lesseeId ? String(req.body.lesseeId) : null,
        carMark: req.body?.carMark ? String(req.body.carMark) : null,
        carNumberFrom: req.body?.carNumberFrom ? String(req.body.carNumberFrom) : null,
        carNumberTo: req.body?.carNumberTo ? String(req.body.carNumberTo) : null,
        jobCode: req.body?.jobCode ? String(req.body.jobCode) : null,
        effectiveFrom: String(req.body?.effectiveFrom ?? "2026-01-01"),
        effectiveTo: req.body?.effectiveTo ? String(req.body.effectiveTo) : null,
      }),
    );
  });
}
