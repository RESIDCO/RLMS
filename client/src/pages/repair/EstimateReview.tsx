/**
 * Owner Estimate Review (§D) — repairSMART-style compact header, RS line grid,
 * owner-only actions (no Submit for approval / no completed-date entry).
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import {
  ChevronDown,
  FileText,
  Lock,
  Pencil,
  RefreshCw,
  Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import {
  EstimateDataFile,
  type EstimateLine,
  type HeaderEdit,
  type HeaderFieldDef,
  type DocRow,
} from "./EstimateDataFile";
import RepairOwnerShell from "./RepairOwnerShell";
import { WorkspaceBanner } from "./WorkspaceTitle";
import { cn } from "@/lib/utils";

type ReviewContext = {
  estimateId: string;
  eventId: string;
  statusCode: string;
  statusName: string;
  locked: boolean;
  billingCategory: string;
  shopDisplay: string;
  carInitial: string;
  carNumber: string;
  estimateIdDisplay: string;
  entityCode: string | null;
  splc: string | null;
  assignment: string | null;
  road: string | null;
  dcRoad: string | null;
  carType: string | null;
  kindOfCar: string | null;
  detailSource: string | null;
  invoiceNumber: string | null;
  createdAt: string | null;
  accountDate: string | null;
  approvalRequiredAt: string | null;
  approvedAt: string | null;
  repairDate: string | null;
  yardArrival: string | null;
  targetDate: string | null;
  outboundDate: string | null;
  badOrderId: string | null;
  badOrderReason: string | null;
  currentRevision: number;
};

type RevBlock = {
  revision: {
    id: string;
    rev_no: number;
    action: string;
    new_status: string | null;
    comment: string | null;
    labor: number;
    material: number;
    total: number;
    total_display?: string;
    action_at?: string;
    actor_name?: string;
    header?: Record<string, unknown>;
  };
  lines: EstimateLine[];
};

type MenuKey = "estimate" | "view" | "export" | "issues" | null;

const BILLING_CATEGORIES = [
  "Bad Order",
  "Program",
  "Lease Return",
  "Wreck",
  "Other",
];

const CAR_LOCK_WHY =
  "Car initial and number are locked. Wrong car → void this estimate and have the shop resubmit under the correct car (audited).";

function Field({
  label,
  value,
  mono,
  onEdit,
  canEdit,
  locked,
  lockWhy,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
  onEdit?: () => void;
  canEdit?: boolean;
  locked?: boolean;
  lockWhy?: string;
}) {
  return (
    <div className="group/field text-xs leading-snug flex items-start gap-1 min-w-0">
      <div className="min-w-0 flex-1">
        <span className="text-muted-foreground">{label}: </span>
        <span className={cn("font-medium break-words", mono && "font-mono")}>
          {value || "—"}
        </span>
      </div>
      {locked ? (
        <span
          className="shrink-0 p-0.5 text-muted-foreground"
          title={lockWhy || CAR_LOCK_WHY}
        >
          <Lock className="h-3 w-3" aria-label="Locked" />
        </span>
      ) : canEdit && onEdit ? (
        <button
          type="button"
          className="opacity-0 group-hover/field:opacity-100 focus:opacity-100 shrink-0 p-0.5 rounded hover:bg-muted text-muted-foreground"
          title={`Edit ${label}`}
          onClick={onEdit}
        >
          <Pencil className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );
}

export default function EstimateReview() {
  const [, params] = useRoute("/repair/estimates/:id");
  const estimateId = params?.id ?? "";
  const [blocks, setBlocks] = useState<RevBlock[]>([]);
  const [ctx, setCtx] = useState<ReviewContext | null>(null);
  const [compare, setCompare] = useState<{
    from: number;
    to: number;
    added: number;
    removed: number;
    changed: number;
    totalsDeltaCents?: number;
  } | null>(null);
  const [compareDetail, setCompareDetail] = useState<{
    added: unknown[];
    removed: unknown[];
    changed: Array<{ left: unknown; right: unknown; deltas: Record<string, unknown> }>;
    leftTotals?: { totalCents: number };
    rightTotals?: { totalCents: number };
  } | null>(null);
  const [header, setHeader] = useState<Record<string, unknown>>({});
  const [headerFields, setHeaderFields] = useState<HeaderFieldDef[]>([]);
  const [headerEdits, setHeaderEdits] = useState<HeaderEdit[]>([]);
  const [documents, setDocuments] = useState<DocRow[]>([]);
  const [documentCount, setDocumentCount] = useState(0);
  const [canPencil, setCanPencil] = useState(false);
  const [needsAdjustment, setNeedsAdjustment] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [menu, setMenu] = useState<MenuKey>(null);
  const [billingCategory, setBillingCategory] = useState("Bad Order");
  const [showCompare, setShowCompare] = useState(false);
  const [cmpFrom, setCmpFrom] = useState<number | "">("");
  const [cmpTo, setCmpTo] = useState<number | "">("");
  const [showIssues, setShowIssues] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [showRollback, setShowRollback] = useState(false);
  const [issueLine, setIssueLine] = useState<EstimateLine | null>(null);
  const [issueBody, setIssueBody] = useState("");
  const [comments, setComments] = useState<
    Array<{ id: string; body: string; author: string; created_at: string; line_id?: string }>
  >([]);
  const [pencilOpen, setPencilOpen] = useState(false);

  async function load(fromRev?: number, toRev?: number) {
    setError("");
    try {
      const qs = new URLSearchParams();
      if (fromRev != null) qs.set("fromRev", String(fromRev));
      if (toRev != null) qs.set("toRev", String(toRev));
      const q = qs.toString() ? `?${qs}` : "";
      const res = await apiRequest("GET", `/api/repair/estimates/${estimateId}/review${q}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load review");
      setBlocks(data.revisions ?? []);
      setCompare(data.compare ?? null);
      setCompareDetail(data.compareDetail ?? null);
      setHeader(data.header ?? {});
      setHeaderFields(data.headerFields ?? []);
      setHeaderEdits(data.headerEdits ?? []);
      setDocuments(data.documents ?? []);
      setDocumentCount(Number(data.documentCount ?? data.documents?.length ?? 0));
      setCanPencil(Boolean(data.canPencilEdit));
      setNeedsAdjustment(Boolean(data.needsAdjustment));
      setCtx(data.context ?? null);
      setBillingCategory(data.context?.billingCategory || "Bad Order");
      setComments(data.comments ?? []);
      if (data.revisions?.length >= 2 && cmpFrom === "" && cmpTo === "") {
        setCmpFrom(Number(data.revisions[data.revisions.length - 2].revision.rev_no));
        setCmpTo(Number(data.revisions[data.revisions.length - 1].revision.rev_no));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load review");
    }
  }

  useEffect(() => {
    if (estimateId) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimateId]);

  const latest = blocks[blocks.length - 1];
  const statusBanner = useMemo(() => {
    if (!latest) return null;
    const when = latest.revision.action_at
      ? new Date(latest.revision.action_at).toLocaleString()
      : "";
    return `Revision #${latest.revision.rev_no}${when ? ` ${when}` : ""}${
      latest.revision.comment ? ` — ${latest.revision.comment}` : ""
    }${latest.revision.actor_name ? ` by ${latest.revision.actor_name}` : ""}`;
  }, [latest]);

  async function act(path: string, body?: Record<string, unknown>) {
    setMsg("");
    setError("");
    setMenu(null);
    try {
      const res = await apiRequest("POST", `/api/repair/estimates/${estimateId}/${path}`, {
        comment: note || undefined,
        ...body,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || path);
      setMsg(`${path}: ok`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : path);
    }
  }

  async function saveBilling() {
    setMsg("");
    setError("");
    try {
      const res = await apiRequest(
        "POST",
        `/api/repair/estimates/${estimateId}/billing-category`,
        { billingCategory },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "billing category failed");
      setMsg(`Billing category saved: ${data.billingCategory}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "billing category failed");
    }
  }

  async function exportBrc(format: "csv" | "json" = "csv") {
    setMenu(null);
    setMsg("");
    setError("");
    try {
      const res = await apiRequest("POST", "/api/repair/estimates/brc-export", {
        estimateIds: [estimateId],
        format,
      });
      if (format === "csv") {
        const text = await res.text();
        if (!res.ok) throw new Error("BRC export failed");
        const blob = new Blob([text], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `brc-${estimateId.slice(0, 8)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        setMsg("BRC Excel/CSV downloaded");
      } else {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "BRC export failed");
        const blob = new Blob([JSON.stringify(data, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `brc-${estimateId.slice(0, 8)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        setMsg("BRC PDF/JSON payload downloaded");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "export failed");
    }
  }

  async function export500() {
    setMenu(null);
    try {
      const res = await apiRequest("POST", "/api/repair/estimates/export-aar", {
        estimateIds: [estimateId],
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "500 export failed");
      const file = data.files?.[0];
      if (!file) throw new Error("No 500-byte content");
      const blob = new Blob([file.content], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.filename || "estimate.500";
      a.click();
      URL.revokeObjectURL(url);
      setMsg("500-byte file downloaded");
    } catch (e) {
      setError(e instanceof Error ? e.message : "500 export failed");
    }
  }

  async function runCompare() {
    if (cmpFrom === "" || cmpTo === "") return;
    await load(Number(cmpFrom), Number(cmpTo));
    setShowCompare(true);
    setMenu(null);
  }

  async function postIssue() {
    if (!ctx || !issueBody.trim()) return;
    setError("");
    try {
      const res = await apiRequest("POST", `/api/repair/events/${ctx.eventId}/comments`, {
        estimateId,
        lineId: issueLine?.id,
        body: issueBody,
        issue: issueLine ? `Line ${issueLine.line_no}` : undefined,
        notify: false,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "comment failed");
      setIssueBody("");
      setIssueLine(null);
      setMsg("Issue/comment saved");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "comment failed");
    }
  }

  function openDocuments() {
    window.open(
      `#/repair/estimates/${estimateId}/documents`,
      `estimate-docs-${estimateId}`,
      "noopener,noreferrer,width=1100,height=800",
    );
  }

  const titleCar = ctx
    ? `${ctx.carInitial} ${ctx.carNumber}`.trim()
    : estimateId.slice(0, 8);

  return (
    <RepairOwnerShell>
      <div className="repair-estimate-review min-h-full">
        <div className="sticky top-[var(--repair-nav-h,2.75rem)] z-20">
          <WorkspaceBanner
            pageTitle={`Estimate Review · ${titleCar}`}
            right={
              <div className="flex items-center gap-3 shrink-0">
                <Link href="/repair" className="underline text-white/90 hover:text-white text-xs">
                  Back to Estimates History
                </Link>
                <button
                  type="button"
                  className="p-1 rounded hover:bg-white/10"
                  title="Refresh"
                  onClick={() => void load()}
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
              </div>
            }
          />
        </div>

        <div className="px-4 py-3 space-y-3 max-w-[1400px]">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {msg && <p className="text-sm text-foreground">{msg}</p>}

          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2 border border-border rounded-md bg-muted/30 px-2 py-1.5">
            {(
              [
                ["estimate", "Estimate"],
                ["view", "View"],
                ["export", "Export"],
                ["issues", "Issues"],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="relative">
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-8 gap-1"
                  onClick={() => setMenu(menu === key ? null : key)}
                >
                  {label}
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
                {menu === key && (
                  <div className="absolute left-0 top-full mt-1 z-30 min-w-[14rem] rounded-md border border-border bg-background shadow-md py-1 text-sm">
                    {key === "estimate" && (
                      <>
                        <MenuItem
                          onClick={() => void act("approve")}
                          label="Approve"
                        />
                        <MenuItem
                          onClick={() => {
                            setShowReject(true);
                            setMenu(null);
                          }}
                          label="Reject / Request Revision"
                        />
                        <MenuItem
                          href={`#/repair/estimates/${estimateId}/send-lessee`}
                          label="Send Lessee Responsibility"
                          onClick={() => setMenu(null)}
                        />
                        <MenuItem
                          href={`#/repair/estimates/${estimateId}/responsibilities`}
                          label="Update Responsibilities"
                          onClick={() => setMenu(null)}
                        />
                        <MenuItem
                          onClick={() => {
                            setShowRollback(true);
                            setMenu(null);
                          }}
                          label="Rollback"
                        />
                      </>
                    )}
                    {key === "view" && (
                      <>
                        <MenuItem
                          onClick={() => {
                            setShowCompare(true);
                            setMenu(null);
                          }}
                          label="Review & Compare"
                        />
                        <MenuItem
                          onClick={() => {
                            setMoreOpen(true);
                            setMenu(null);
                          }}
                          label="More header detail"
                        />
                      </>
                    )}
                    {key === "export" && (
                      <>
                        <MenuItem onClick={() => void exportBrc("csv")} label="BRC Excel / CSV" />
                        <MenuItem onClick={() => void exportBrc("json")} label="BRC PDF / JSON" />
                        <MenuItem onClick={() => void export500()} label="500-byte file" />
                      </>
                    )}
                    {key === "issues" && (
                      <MenuItem
                        onClick={() => {
                          setShowIssues(true);
                          setIssueLine(null);
                          setMenu(null);
                        }}
                        label="Issues / comments"
                      />
                    )}
                  </div>
                )}
              </div>
            ))}

            <div className="flex-1 text-center text-xs text-muted-foreground px-2 min-w-[12rem]">
              {statusBanner}
            </div>

            <button
              type="button"
              className="inline-flex items-center gap-1.5 text-sm text-sky-700 dark:text-sky-400 underline"
              onClick={openDocuments}
            >
              <FileText className="h-4 w-4" />
              {documentCount} Document(s) found
            </button>

            <div className="flex items-center gap-1 ml-auto">
              <Label className="text-xs whitespace-nowrap">Billing Category</Label>
              <select
                className="h-8 rounded border border-border bg-background px-2 text-xs"
                value={billingCategory}
                onChange={(e) => setBillingCategory(e.target.value)}
              >
                {BILLING_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <Button size="icon" variant="ghost" className="h-8 w-8" title="Save" onClick={() => void saveBilling()}>
                <Save className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Compact header — no absolute pencil over car # */}
          {ctx && (
            <section className="border border-border rounded-md bg-background px-4 py-3">
              <div className="flex flex-wrap items-start gap-3 mb-2">
                <div className="text-center flex-1 min-w-[10rem]">
                  <div className="text-base font-semibold">{ctx.shopDisplay}</div>
                  {ctx.entityCode && (
                    <div className="text-xs text-muted-foreground">Entity {ctx.entityCode}</div>
                  )}
                </div>
                <div className="text-right font-semibold tracking-wide shrink-0 pr-1">
                  {ctx.carInitial} {ctx.carNumber}
                </div>
              </div>

              <div className="grid gap-x-6 gap-y-1 md:grid-cols-3">
                <div className="space-y-0.5">
                  <Field label="Estimate ID" value={ctx.estimateIdDisplay} mono />
                  <Field label="Status" value={ctx.statusName} />
                  <Field label="SPLC" value={ctx.splc} canEdit={canPencil} onEdit={() => { setPencilOpen(true); setMoreOpen(true); }} />
                  <Field label="Assignment" value={ctx.assignment} canEdit={canPencil} onEdit={() => { setPencilOpen(true); setMoreOpen(true); }} />
                  <Field label="Detail Source" value={ctx.detailSource} canEdit={canPencil} onEdit={() => { setPencilOpen(true); setMoreOpen(true); }} />
                </div>
                <div className="space-y-0.5">
                  <Field
                    label="Car Initial"
                    value={ctx.carInitial}
                    locked
                    lockWhy={CAR_LOCK_WHY}
                  />
                  <Field
                    label="Car Number"
                    value={ctx.carNumber}
                    locked
                    lockWhy={CAR_LOCK_WHY}
                  />
                  <Field label="Car Type" value={ctx.carType} canEdit={canPencil} onEdit={() => { setPencilOpen(true); setMoreOpen(true); }} />
                  <Field label="Kind of Car" value={ctx.kindOfCar} canEdit={canPencil} onEdit={() => { setPencilOpen(true); setMoreOpen(true); }} />
                  <Field label="Road" value={ctx.road} canEdit={canPencil} onEdit={() => { setPencilOpen(true); setMoreOpen(true); }} />
                  <Field label="DC Road" value={ctx.dcRoad} canEdit={canPencil} onEdit={() => { setPencilOpen(true); setMoreOpen(true); }} />
                  <Field label="Invoice" value={ctx.invoiceNumber} canEdit={canPencil} onEdit={() => { setPencilOpen(true); setMoreOpen(true); }} />
                </div>
                <div className="space-y-0.5">
                  <Field label="Created" value={ctx.createdAt} />
                  <Field label="Account Date" value={ctx.accountDate} canEdit={canPencil} onEdit={() => { setPencilOpen(true); setMoreOpen(true); }} />
                  <Field label="Approval Reqd" value={ctx.approvalRequiredAt} />
                  <Field label="Approved" value={ctx.approvedAt} />
                  <Field label="Repair Date" value={ctx.repairDate} canEdit={canPencil} onEdit={() => { setPencilOpen(true); setMoreOpen(true); }} />
                  <Field label="Yard Arrival" value={ctx.yardArrival} canEdit={canPencil} onEdit={() => { setPencilOpen(true); setMoreOpen(true); }} />
                  <Field label="Target Date" value={ctx.targetDate} canEdit={canPencil} onEdit={() => { setPencilOpen(true); setMoreOpen(true); }} />
                  <Field label="Outbound Date" value={ctx.outboundDate} />
                  <div className="text-xs">
                    <span className="text-muted-foreground">Bad Order Reason: </span>
                    {ctx.badOrderId ? (
                      <Link
                        href="/repair/bad-orders"
                        className="text-sky-700 dark:text-sky-400 underline font-medium"
                      >
                        {ctx.badOrderReason || "Bad Order"}
                      </Link>
                    ) : (
                      <span className="font-medium">{ctx.badOrderReason || "—"}</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2 items-center">
                {canPencil && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setPencilOpen(true);
                      setMoreOpen(true);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5 mr-1" />
                    Edit header
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setMoreOpen((v) => !v)}
                >
                  {moreOpen ? "Hide" : "More"} header detail
                  <ChevronDown
                    className={cn("ml-1 h-3.5 w-3.5 transition", moreOpen && "rotate-180")}
                  />
                </Button>
                {needsAdjustment && (
                  <span className="text-xs text-amber-700 dark:text-amber-400">
                    Post-Approved — pencil / corrections use Adjustment for Approval.
                  </span>
                )}
                {latest && (
                  <span className="text-xs text-muted-foreground ml-auto tabular-nums">
                    Rev {latest.revision.rev_no} · Total{" "}
                    {(latest.revision as { total_money?: string }).total_money ??
                      `$${latest.revision.total_display ?? Number(latest.revision.total).toFixed(2)}`}
                    <span className="block text-[10px] opacity-80">
                      {(latest.revision as { total_cents?: number }).total_cents ?? ""}¢
                    </span>
                  </span>
                )}
              </div>

              {moreOpen && (
                <div className="mt-3 border-t border-border pt-3">
                  <EstimateDataFile
                    estimateId={estimateId}
                    header={header}
                    headerFields={headerFields}
                    headerEdits={pencilOpen ? headerEdits : []}
                    lines={[]}
                    documents={[]}
                    canPencilEdit={canPencil}
                    readOnly={false}
                    hideLines
                    hideAttachments
                    hideAudit={!pencilOpen}
                    onHeaderChanged={load}
                  />
                </div>
              )}
            </section>
          )}

          {latest && (
            <EstimateDataFile
              estimateId={estimateId}
              header={header}
              headerFields={headerFields}
              headerEdits={[]}
              lines={latest.lines}
              documents={[]}
              canPencilEdit={false}
              readOnly={false}
              hideHeader
              hideAttachments
              hideAudit
              onLineIssueClick={(l) => {
                setIssueLine(l);
                setShowIssues(true);
              }}
            />
          )}

          {!latest && !error && (
            <p className="text-sm text-muted-foreground">No revisions yet for this estimate.</p>
          )}
        </div>

        {/* Reject dialog */}
        {showReject && (
          <Modal title="Reject / Request Revision" onClose={() => setShowReject(false)}>
            <Label htmlFor="rej">Comment (sent to shop)</Label>
            <Textarea
              id="rej"
              className="mt-1"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="flex gap-2 mt-3 justify-end">
              <Button variant="ghost" onClick={() => setShowReject(false)}>
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  await act("request-revision");
                  setShowReject(false);
                }}
              >
                Request revision
              </Button>
            </div>
          </Modal>
        )}

        {showRollback && (
          <Modal title="Rollback completed date" onClose={() => setShowRollback(false)}>
            <p className="text-sm mb-2">
              Audited rollback of completed/outbound date. Owner does not set completed dates —
              only rollback when needed.
            </p>
            <Label htmlFor="rb">Comment</Label>
            <Textarea
              id="rb"
              className="mt-1"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="flex gap-2 mt-3 justify-end">
              <Button variant="ghost" onClick={() => setShowRollback(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={async () => {
                  await act("rollback-complete", { actorRole: "reviewer" });
                  setShowRollback(false);
                }}
              >
                Rollback
              </Button>
            </div>
          </Modal>
        )}

        {showCompare && (
          <Modal title="Review & Compare" onClose={() => setShowCompare(false)} wide>
            <div className="flex flex-wrap gap-3 items-end mb-3">
              <div>
                <Label>From revision</Label>
                <select
                  className="mt-1 h-9 rounded border border-border bg-background px-2 text-sm block"
                  value={cmpFrom}
                  onChange={(e) => setCmpFrom(Number(e.target.value))}
                >
                  {blocks.map((b) => (
                    <option key={b.revision.id} value={b.revision.rev_no}>
                      Rev {b.revision.rev_no}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>To revision</Label>
                <select
                  className="mt-1 h-9 rounded border border-border bg-background px-2 text-sm block"
                  value={cmpTo}
                  onChange={(e) => setCmpTo(Number(e.target.value))}
                >
                  {blocks.map((b) => (
                    <option key={b.revision.id} value={b.revision.rev_no}>
                      Rev {b.revision.rev_no}
                    </option>
                  ))}
                </select>
              </div>
              <Button onClick={() => void runCompare()}>Compare</Button>
            </div>
            {compare && (
              <div className="text-sm space-y-2">
                <p>
                  r{compare.from} → r{compare.to}:{" "}
                  <strong>{compare.added}</strong> added,{" "}
                  <strong>{compare.removed}</strong> removed,{" "}
                  <strong>{compare.changed}</strong> changed
                  {compare.totalsDeltaCents != null && (
                    <>
                      {" "}
                      · totals Δ $
                      {(compare.totalsDeltaCents / 100).toFixed(2)}
                    </>
                  )}
                </p>
                {compareDetail && (
                  <div className="grid md:grid-cols-2 gap-3 text-xs max-h-80 overflow-auto">
                    <DiffCol title="Added" items={compareDetail.added} />
                    <DiffCol title="Removed" items={compareDetail.removed} />
                    <div className="md:col-span-2 border border-border rounded p-2">
                      <div className="font-medium mb-1">Changed</div>
                      {compareDetail.changed.length === 0 ? (
                        <p className="text-muted-foreground">None</p>
                      ) : (
                        <ul className="space-y-1">
                          {compareDetail.changed.map((c, i) => (
                            <li key={i} className="font-mono">
                              {JSON.stringify(c.deltas)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </Modal>
        )}

        {showIssues && (
          <Modal title="Issues / comments" onClose={() => setShowIssues(false)}>
            {issueLine && (
              <p className="text-xs text-muted-foreground mb-2">
                Line {issueLine.line_no} · {issueLine.aar_job_code} · Resp {issueLine.resp_code}
              </p>
            )}
            <Textarea
              rows={3}
              placeholder="Comment / issue"
              value={issueBody}
              onChange={(e) => setIssueBody(e.target.value)}
            />
            <div className="flex gap-2 mt-2 justify-end">
              <Button variant="ghost" onClick={() => setShowIssues(false)}>
                Close
              </Button>
              <Button onClick={() => void postIssue()} disabled={!issueBody.trim()}>
                Save
              </Button>
            </div>
            <ul className="mt-3 max-h-48 overflow-auto text-xs space-y-2 border-t border-border pt-2">
              {comments.map((c) => (
                <li key={c.id}>
                  <span className="font-medium">{c.author}</span>{" "}
                  <span className="text-muted-foreground">
                    {new Date(c.created_at).toLocaleString()}
                    {c.line_id ? " · line" : ""}
                  </span>
                  <div>{c.body}</div>
                </li>
              ))}
              {comments.length === 0 && (
                <li className="text-muted-foreground">No comments yet.</li>
              )}
            </ul>
          </Modal>
        )}
      </div>
    </RepairOwnerShell>
  );
}

function MenuItem({
  label,
  onClick,
  href,
}: {
  label: string;
  onClick?: () => void;
  href?: string;
}) {
  if (href) {
    return (
      <a
        href={href}
        className="block px-3 py-1.5 hover:bg-muted whitespace-nowrap"
        onClick={onClick}
      >
        {label}
      </a>
    );
  }
  return (
    <button
      type="button"
      className="block w-full text-left px-3 py-1.5 hover:bg-muted whitespace-nowrap"
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className={cn(
          "bg-background border border-border rounded-md shadow-lg p-4 space-y-2 max-h-[90vh] overflow-auto",
          wide ? "w-full max-w-3xl" : "w-full max-w-md",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold text-sm">{title}</h3>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}

function DiffCol({ title, items }: { title: string; items: unknown[] }) {
  return (
    <div className="border border-border rounded p-2">
      <div className="font-medium mb-1">
        {title} ({items.length})
      </div>
      {items.length === 0 ? (
        <p className="text-muted-foreground">None</p>
      ) : (
        <ul className="space-y-1 font-mono">
          {items.slice(0, 40).map((it, i) => {
            const row = it as { line_no?: number; aar_job_code?: string; resp_code?: string };
            return (
              <li key={i}>
                #{row.line_no} {row.aar_job_code} R{row.resp_code}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
