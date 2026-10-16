/**
 * §F Lessee screen — login-free signed link.
 * RESIDCO brand, BRC header (4 cols), Resp 6 lines, matching total,
 * §E viewer (granted only), Resp6 downloads, Accept/Reject whole estimate.
 *
 * Accept/Reject must never fail silently: loading lock, visible errors,
 * success banner with ET time + name, page read-only after decide.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  EstimateDataFile,
  type EstimateLine,
  type HeaderFieldDef,
  type DocRow,
} from "./EstimateDataFile";

function formatDisplayMoney(cents: number): string {
  const n = Math.trunc(cents) / 100;
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${n < 0 ? "-" : ""}$${abs}`;
}

function formatEt(iso: string | null | undefined): string {
  if (!iso) {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date());
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(d);
}

function dash(v: unknown): string {
  if (v == null) return "—";
  const s = String(v).trim();
  return s === "" ? "—" : s;
}

/** Compact BRC header fields for the lessee 4-col block (not 500-byte Data File). */
const BRC_LESSEE_HEADER_FIELDS: HeaderFieldDef[] = [
  { key: "estimateIdShort", label: "Estimate ID", group: "Estimate" },
  { key: "status", label: "Status", group: "Estimate" },
  { key: "invoice", label: "Invoice", group: "Estimate" },
  { key: "assignment", label: "Assignment", group: "Estimate" },
  { key: "carInitial", label: "Car Initial", group: "Car" },
  { key: "carNumber", label: "Car Number", group: "Car" },
  { key: "carType", label: "Car Type", group: "Car" },
  { key: "kindOfCar", label: "Kind of Car", group: "Car" },
  { key: "shopName", label: "Shop", group: "Shop" },
  { key: "shopCityState", label: "Shop City/State", group: "Shop" },
  { key: "road", label: "Road", group: "Shop" },
  { key: "splc", label: "SPLC", group: "Shop" },
  { key: "repairDate", label: "Repair Date", group: "Dates" },
  { key: "yardArrival", label: "Yard Arrival", group: "Dates" },
  { key: "outboundDate", label: "Outbound", group: "Dates" },
  { key: "created", label: "Created", group: "Dates" },
];

type PendingDecision = "APPROVE" | "REJECT" | null;

type HttpError = Error & { status?: number };

function httpError(status: number, message: string): HttpError {
  const e = new Error(message) as HttpError;
  e.status = status;
  return e;
}

export default function LesseeApproval() {
  const [, params] = useRoute("/repair/lessee/:token");
  const token = params?.token ?? "";
  const [error, setError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [done, setDone] = useState("");
  const [car, setCar] = useState("");
  const [shopDisplay, setShopDisplay] = useState("");
  const [workspace, setWorkspace] = useState("RESIDCO");
  const [ownLines, setOwnLines] = useState<EstimateLine[]>([]);
  const [ownResp, setOwnResp] = useState<string[]>(["6"]);
  const [totalCents, setTotalCents] = useState(0);
  const [amountMoney, setAmountMoney] = useState("$0.00");
  const [header, setHeader] = useState<Record<string, unknown>>({});
  const [headerFields, setHeaderFields] = useState<HeaderFieldDef[]>(
    BRC_LESSEE_HEADER_FIELDS,
  );
  const [documents, setDocuments] = useState<DocRow[]>([]);
  const [comment, setComment] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [canDecide, setCanDecide] = useState(true);
  const [dueEt, setDueEt] = useState<string | null>(null);
  const [decisionMeta, setDecisionMeta] = useState<{
    decision?: string | null;
    decidedAt?: string | null;
    respondentName?: string | null;
    respondentEmail?: string | null;
    comment?: string | null;
  } | null>(null);
  const [downloads, setDownloads] = useState<{
    pdf?: { filename: string; url: string };
    data500?: { filename: string; url: string };
  }>({});
  const [pending, setPending] = useState<PendingDecision>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  const applyView = useCallback((data: Record<string, unknown>) => {
    const event = (data.event ?? {}) as {
      car_mark?: string;
      car_number?: string;
    };
    setCar(`${event.car_mark ?? ""} ${event.car_number ?? ""}`.trim());
    setShopDisplay(String(data.shopDisplay ?? ""));
    setWorkspace(String(data.workspaceTitle ?? "RESIDCO"));
    const own = (data.lines ?? []) as EstimateLine[];
    setOwnLines(own);
    setOwnResp((data.ownRespCodes as string[]) ?? ["6"]);
    const brc = (data.brcHeader ?? null) as Record<string, unknown> | null;
    if (brc && typeof brc === "object") {
      setHeader({
        ...brc,
        shopName: brc.shopName ?? data.shopName,
        shopCityState: brc.shopCityState ?? data.shopCityState,
      });
      setHeaderFields(BRC_LESSEE_HEADER_FIELDS);
    } else {
      setHeader((data.header as Record<string, unknown>) ?? {});
      setHeaderFields(
        (data.headerFields as HeaderFieldDef[]) ?? BRC_LESSEE_HEADER_FIELDS,
      );
    }
    setDocuments((data.documents as DocRow[]) ?? []);
    const cents =
      data.amountPresentedCents != null
        ? Math.trunc(Number(data.amountPresentedCents))
        : own.reduce(
            (s, l) =>
              s +
              (l.total_cents != null
                ? Math.trunc(Number(l.total_cents))
                : Math.round(Number(l.total ?? 0) * 100)),
            0,
          );
    setTotalCents(cents);
    setAmountMoney(String(data.amountMoney ?? formatDisplayMoney(cents)));
    setCanDecide(data.canDecide !== false);
    const closedMessage =
      typeof data.closedMessage === "string" && data.closedMessage.trim()
        ? data.closedMessage.trim()
        : null;
    const approval = (data.approval ?? null) as {
      decision?: string | null;
      decidedAt?: string | null;
      decidedAtEt?: string | null;
      respondentName?: string | null;
      respondentEmail?: string | null;
      comment?: string | null;
      responseDueAtEt?: string | null;
      status?: string | null;
    } | null;
    setDueEt(approval?.responseDueAtEt ?? null);
    setDecisionMeta(
      approval
        ? {
            decision: approval.decision ?? null,
            decidedAt: approval.decidedAt ?? null,
            respondentName: approval.respondentName ?? null,
            respondentEmail: approval.respondentEmail ?? null,
            comment: approval.comment ?? null,
          }
        : null,
    );
    setDownloads((data.downloads as typeof downloads) ?? {});
    const status = String(approval?.status ?? "");
    const isManual =
      status.includes("MANUAL") ||
      status === "APPROVED_MANUAL" ||
      status === "REJECTED_MANUAL";
    if (data.canDecide === false && closedMessage && isManual) {
      setDone(closedMessage);
    } else if (approval?.decision === "APPROVED") {
      const when = approval.decidedAtEt || formatEt(approval.decidedAt);
      const who = approval.respondentName || "lessee";
      setDone(`Accepted on ${when} by ${who}. Thank you.`);
    } else if (approval?.decision === "REJECTED") {
      const when = approval.decidedAtEt || formatEt(approval.decidedAt);
      const who = approval.respondentName || "lessee";
      setDone(`Rejected on ${when} by ${who}. This link is now read-only.`);
    } else if (data.canDecide === false && closedMessage) {
      setDone(closedMessage);
    }
  }, []);

  const loadView = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    setErrorStatus(null);
    try {
      const r = await fetch(`/api/repair/lessee/${token}`, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      });
      let data: Record<string, unknown> = {};
      try {
        data = await r.json();
      } catch {
        data = {};
      }
      if (!r.ok) {
        throw httpError(
          r.status,
          String(data.error || `Failed to load (${r.status})`),
        );
      }
      applyView(data);
    } catch (e) {
      const err = e as HttpError;
      setErrorStatus(err.status ?? null);
      setError(err instanceof Error ? err.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [token, applyView]);

  useEffect(() => {
    void loadView();
  }, [loadView]);

  function openConfirm(decision: "APPROVE" | "REJECT") {
    setError("");
    setErrorStatus(null);
    if (!name.trim() || !email.trim().includes("@")) {
      setError("Name and email are required.");
      setErrorStatus(400);
      return;
    }
    if (decision === "REJECT" && !comment.trim()) {
      setError("Reject requires a comment.");
      setErrorStatus(400);
      return;
    }
    setPending(decision);
  }

  async function confirmDecide() {
    if (!pending || submitting) return;
    const decision = pending;
    setSubmitting(true);
    setError("");
    setErrorStatus(null);
    try {
      const res = await fetch(`/api/repair/lessee/${token}/decide`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          decision,
          comment: comment.trim() || undefined,
          name: name.trim(),
          email: email.trim(),
        }),
      });
      let data: Record<string, unknown> = {};
      try {
        data = await res.json();
      } catch {
        data = {};
      }
      if (!res.ok) {
        throw httpError(
          res.status,
          String(data.error || `Decision failed (${res.status})`),
        );
      }
      const approval = (data.approval ?? {}) as {
        decided_at?: string;
        decidedAt?: string;
        respondent_name?: string;
        respondentName?: string;
      };
      const when =
        (data.decidedAtEt as string | undefined) ||
        formatEt(approval.decided_at ?? approval.decidedAt);
      const who =
        name.trim() ||
        approval.respondent_name ||
        approval.respondentName ||
        "lessee";
      setDone(
        decision === "APPROVE"
          ? `Accepted on ${when} by ${who}. Thank you.`
          : `Rejected on ${when} by ${who}. This link is now read-only.`,
      );
      setCanDecide(false);
      setDecisionMeta({
        decision: decision === "APPROVE" ? "APPROVED" : "REJECTED",
        decidedAt: approval.decided_at ?? approval.decidedAt ?? null,
        respondentName: who,
        respondentEmail: email.trim(),
        comment: comment.trim() || null,
      });
      setPending(null);
      // Re-fetch so page matches server (send/revision + read-only)
      void loadView();
    } catch (e) {
      const err = e as HttpError;
      const status = err.status;
      let msg = err instanceof Error ? err.message : "Decision failed";
      if (status === 400) msg = msg || "Bad request (400)";
      else if (status === 401) msg = msg || "Invalid or expired link (401)";
      else if (status === 409)
        msg = msg || "A response was already recorded";
      else if (!status) msg = `Network error: ${msg}`;
      setError(msg);
      setErrorStatus(status ?? null);
      // Keep dialog open on error so the lessee can retry / see the message
    } finally {
      setSubmitting(false);
    }
  }

  const readOnlyPage = !canDecide || Boolean(done);

  return (
    <div className="min-h-screen repair-page-bg pb-28">
      <header className="repair-brand-bar px-4 py-3 shadow-sm">
        <div className="max-w-6xl mx-auto flex flex-wrap items-end justify-between gap-2">
          <div>
            <div className="text-2xl font-bold tracking-[0.08em]">{workspace}</div>
            <div className="text-sm text-white/90 mt-0.5">
              Lessee responsibility review
            </div>
          </div>
          <div className="text-right text-sm">
            {car ? <div className="font-semibold">Car {car}</div> : null}
            {shopDisplay ? (
              <div className="text-white/90">{shopDisplay}</div>
            ) : null}
            {dueEt && canDecide ? (
              <div className="text-xs text-white/80 mt-1">Respond by {dueEt}</div>
            ) : null}
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-4">
        {loading ? (
          <p className="text-sm text-slate-700" role="status">
            Loading estimate…
          </p>
        ) : null}

        {error ? (
          <div
            role="alert"
            className="rounded-md border border-red-600 bg-red-50 px-3 py-2 text-sm text-red-800 font-medium"
          >
            {errorStatus != null ? `[${errorStatus}] ` : null}
            {error}
          </div>
        ) : null}

        {done ? (
          <div
            role="status"
            className="rounded-md border border-emerald-700 bg-emerald-50 px-3 py-2 text-sm text-emerald-950 font-medium"
          >
            {done}
            {decisionMeta?.comment ? (
              <div className="mt-1 text-xs font-normal text-emerald-900">
                Comment: {decisionMeta.comment}
              </div>
            ) : null}
          </div>
        ) : null}

        {!loading ? (
          <EstimateDataFile
            header={header}
            headerFields={headerFields}
            lines={ownLines}
            documents={documents}
            readOnly
            canPencilEdit={false}
            ownRespCodes={ownResp}
            presentation="brcLessee"
            hideTotalsFooter
            hideAttachments
            hideAudit
          />
        ) : null}

        <div className="flex flex-wrap gap-3 text-sm items-center border border-slate-300 rounded-md bg-white px-3 py-2 text-slate-900">
          {downloads.pdf?.url ? (
            <a
              className="underline text-sky-900"
              href={downloads.pdf.url}
              download={downloads.pdf.filename}
            >
              Download {downloads.pdf.filename}
            </a>
          ) : null}
          {downloads.data500?.url ? (
            <a
              className="underline text-sky-900"
              href={downloads.data500.url}
              download={downloads.data500.filename}
            >
              Download {downloads.data500.filename}
            </a>
          ) : null}
          {token ? (
            <Link
              href={`/repair/lessee/${token}/documents`}
              className="underline text-sky-900"
            >
              Open File Attachments
            </Link>
          ) : null}
        </div>

        {canDecide && !done ? (
          <div className="border border-slate-300 rounded-md bg-white p-4 space-y-3 text-slate-900">
            <p className="text-sm font-semibold">
              Accept or Reject the whole estimate
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs text-slate-700">Your name</label>
                <Input
                  className="mt-1 bg-white text-slate-900 border-slate-400"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Full name"
                  autoComplete="name"
                  disabled={submitting}
                />
              </div>
              <div>
                <label className="text-xs text-slate-700">Your email</label>
                <Input
                  className="mt-1 bg-white text-slate-900 border-slate-400"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  type="email"
                  placeholder="name@company.com"
                  autoComplete="email"
                  disabled={submitting}
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-700">
                Comment (required to Reject)
              </label>
              <Textarea
                className="mt-1 text-sm bg-white text-slate-900 border-slate-400"
                rows={2}
                placeholder="Comment (required to Reject)"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                disabled={submitting}
              />
            </div>
          </div>
        ) : null}

        {readOnlyPage && decisionMeta?.decision ? (
          <div className="text-xs text-slate-700">
            Decision at top of page. Fields:{" "}
            {dash(decisionMeta.respondentName)}
            {decisionMeta.respondentEmail
              ? ` <${decisionMeta.respondentEmail}>`
              : ""}
            .
          </div>
        ) : null}
      </div>

      {/* Sticky footer: total + Accept/Reject */}
      <div className="fixed bottom-0 inset-x-0 z-40 border-t border-slate-300 bg-white/95 backdrop-blur px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.08)]">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-slate-900">
            Resp 6 total{" "}
            <strong className="tabular-nums text-base">{amountMoney}</strong>
            <span className="sr-only"> ({totalCents} cents)</span>
          </div>
          {canDecide && !done ? (
            <div className="flex flex-wrap gap-2">
              <Button
                className="bg-emerald-700 hover:bg-emerald-800 text-white"
                disabled={submitting || loading}
                onClick={() => openConfirm("APPROVE")}
              >
                {submitting && pending === "APPROVE" ? "Submitting…" : "Accept"}
              </Button>
              <Button
                variant="outline"
                className="border-slate-500 text-slate-900"
                disabled={submitting || loading}
                onClick={() => openConfirm("REJECT")}
              >
                {submitting && pending === "REJECT" ? "Submitting…" : "Reject"}
              </Button>
            </div>
          ) : (
            <div className="text-sm font-medium text-slate-800">
              {done ? "Response recorded — read-only" : null}
            </div>
          )}
        </div>
      </div>

      <AlertDialog
        open={pending != null}
        onOpenChange={(open) => {
          // Do not dismiss while submitting — prevents silent cancel of in-flight POST
          if (!open && !submitting) setPending(null);
        }}
      >
        <AlertDialogContent className="bg-white text-slate-900">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending === "APPROVE" ? "Confirm Accept" : "Confirm Reject"}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-700">
              {pending === "APPROVE"
                ? `Accept Resp 6 total ${amountMoney} for car ${car || "—"} as ${name.trim()} <${email.trim()}>? Your name, email, IP, and send version will be logged.`
                : `Reject Resp 6 for car ${car || "—"} as ${name.trim()} <${email.trim()}> with your comment? Your name, email, IP, and send version will be logged.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && pending ? (
            <div
              role="alert"
              className="rounded border border-red-600 bg-red-50 px-2 py-1.5 text-sm text-red-800"
            >
              {errorStatus != null ? `[${errorStatus}] ` : null}
              {error}
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
            {/* Use plain Button — AlertDialogAction auto-closes and raced submitting=false → silent failure */}
            <Button
              disabled={submitting}
              className="repair-brand-fill"
              onClick={(e) => {
                e.preventDefault();
                void confirmDecide();
              }}
            >
              {submitting ? "Submitting…" : "Confirm"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
