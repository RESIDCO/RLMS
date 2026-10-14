/**
 * Shared Data File header + RS line grid + totals + attachments for
 * internal estimate review and lessee estimate (read-only mode).
 */
import { useEffect, useId, useMemo, useState } from "react";
import { AlertCircle, FileCode2, Flag, Lock, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { closeHover, openHover, subscribeHover } from "./codeHoverBus";

type HeaderMode = "LOCK" | "EDIT_AUDIT" | "FREE";

function formatDisplayMoney(cents: number): string {
  const n = Math.trunc(cents) / 100;
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${n < 0 ? "-" : ""}$${abs}`;
}

export type HeaderFieldDef = {
  key: string;
  label: string;
  group: string;
  mode?: HeaderMode;
  lockWhy?: string;
};

export type EstimateLine = {
  id?: string;
  line_no: number;
  display_line_no?: string;
  aar_job_code: string | null;
  qualifier?: string | null;
  why_made?: string | null;
  condition_code?: string | null;
  resp_code: string | null;
  labor: number;
  material: number;
  total: number;
  repair_category: string | null;
  sub_category?: string | null;
  aar_component_id?: string | null;
  ddct_incident_id?: string | null;
  location_on_car?: string | null;
  quantity?: string | null;
  removed_job_code?: string | null;
  removed_qualifier?: string | null;
  description?: string | null;
  machine_priceable?: string | null;
  raw_line?: string | null;
  labor_display?: string;
  material_display?: string;
  amount_display?: string;
  labor_money?: string;
  material_money?: string;
  amount_money?: string;
  labor_cents?: number;
  material_cents?: number;
  total_cents?: number;
  labor_cents_label?: string;
  material_cents_label?: string;
  amount_cents_label?: string;
  component_id_flag?: boolean;
  has_comment?: boolean;
};

export type HeaderEdit = {
  id: string;
  field_key: string;
  old_value: string | null;
  new_value: string | null;
  reason: string;
  actor: string;
  edited_at: string;
};

export type DocRow = {
  id: string;
  kind: string;
  original_filename?: string | null;
  mime?: string | null;
  size?: number;
  uploaded_at?: string;
  lifecycle_status?: string;
  category_code?: string | null;
  comment?: string | null;
  deleted_at?: string | null;
};

function moneyCell(opts: {
  dollars?: number | string;
  display?: string;
  money?: string;
  cents?: number;
  centsLabel?: string;
}) {
  const cents =
    opts.cents != null
      ? Math.trunc(opts.cents)
      : Math.round(Number(opts.dollars ?? 0) * 100);
  const dollars =
    opts.money && opts.money.includes(",")
      ? opts.money
      : formatDisplayMoney(cents);
  const centsLabel =
    opts.centsLabel ??
    (opts.cents != null ? String(opts.cents) : String(cents));
  return (
    <div className="leading-tight">
      <div className="tabular-nums">{dollars}</div>
      {centsLabel !== "" ? (
        <div className="text-[9px] text-muted-foreground tabular-nums">{centsLabel}¢</div>
      ) : null}
    </div>
  );
}

function CodeHover({
  kind,
  code,
  qualifier,
  children,
}: {
  kind: string;
  code?: string | null;
  qualifier?: string | null;
  children: React.ReactNode;
}) {
  const id = useId();
  const [tip, setTip] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  useEffect(() => subscribeHover((a) => setActive(a === id)), [id]);
  useEffect(() => {
    // Qualifier lookup may use job as code + empty/"00" qualifier → "No qualifier"
    const isQual = kind === "qualifier" || kind === "removed_qualifier";
    if (!active || (!code && !isQual)) return;
    let cancelled = false;
    const qs = new URLSearchParams({ kind, code: code ?? "" });
    if (isQual || qualifier != null) qs.set("qualifier", qualifier ?? "");
    void apiRequest("GET", `/api/repair/ref/lookup?${qs}`)
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        const cat = [data.category, data.sub_category].filter(Boolean).join(" / ");
        setTip(
          data.found
            ? `${data.description}${cat ? ` · ${cat}` : ""}`
            : data.description || "Not in reference table",
        );
      })
      .catch(() => {
        if (!cancelled) setTip("Not in reference table");
      });
    return () => {
      cancelled = true;
    };
  }, [active, kind, code, qualifier]);
  const isQual = kind === "qualifier" || kind === "removed_qualifier";
  if (!code && !isQual) return <>{children}</>;
  return (
    <span
      className="relative cursor-help border-b border-dotted border-muted-foreground/50"
      tabIndex={0}
      onMouseEnter={() => openHover(id)}
      onMouseLeave={() => closeHover(id)}
      onFocus={() => openHover(id)}
      onBlur={() => closeHover(id)}
    >
      {children}
      {active && tip ? (
        <span
          role="tooltip"
          className="pointer-events-none absolute z-20 left-0 top-full mt-1 max-w-[16rem] rounded border border-border bg-popover px-2 py-1 text-[10px] text-popover-foreground shadow-md whitespace-normal"
        >
          {tip}
        </span>
      ) : null}
    </span>
  );
}

type Props = {
  estimateId?: string;
  header: Record<string, unknown>;
  headerFields: HeaderFieldDef[];
  headerEdits?: HeaderEdit[];
  lines: EstimateLine[];
  documents?: DocRow[];
  /** When true: hide pencil + admin; show approve/dispute only for ownRespCodes */
  readOnly?: boolean;
  canPencilEdit?: boolean;
  ownRespCodes?: string[];
  onHeaderChanged?: () => void;
  onDecideLine?: (line: EstimateLine, decision: "APPROVE" | "DISPUTE") => void;
  /** Hide full header block (owner page uses compact header separately). */
  hideHeader?: boolean;
  hideLines?: boolean;
  hideAttachments?: boolean;
  hideAudit?: boolean;
  onLineIssueClick?: (line: EstimateLine) => void;
};

export function EstimateDataFile(props: Props) {
  const {
    estimateId,
    header,
    headerFields,
    headerEdits = [],
    lines,
    documents = [],
    readOnly = false,
    canPencilEdit = false,
    ownRespCodes = [],
    onHeaderChanged,
    onDecideLine,
    hideHeader = false,
    hideLines = false,
    hideAttachments = false,
    hideAudit = false,
    onLineIssueClick,
  } = props;

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editReason, setEditReason] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [rawPreview, setRawPreview] = useState<string | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, HeaderFieldDef[]>();
    for (const f of headerFields) {
      const g = map.get(f.group) ?? [];
      g.push(f);
      map.set(f.group, g);
    }
    return Array.from(map.entries());
  }, [headerFields]);

  const totals = useMemo(() => {
    let labor = 0;
    let material = 0;
    for (const l of lines) {
      labor +=
        l.labor_cents != null
          ? Math.trunc(Number(l.labor_cents))
          : Math.round(Number(l.labor ?? 0) * 100);
      material +=
        l.material_cents != null
          ? Math.trunc(Number(l.material_cents))
          : Math.round(Number(l.material ?? 0) * 100);
    }
    const total = labor + material;
    return {
      laborCents: labor,
      materialCents: material,
      totalCents: total,
      labor: formatDisplayMoney(labor),
      material: formatDisplayMoney(material),
      total: formatDisplayMoney(total),
    };
  }, [lines]);

  async function savePencil() {
    if (!estimateId || !editingKey) return;
    setErr("");
    setMsg("");
    try {
      const res = await apiRequest("POST", `/api/repair/estimates/${estimateId}/header-edit`, {
        fieldKey: editingKey,
        newValue: editValue,
        reason: editReason,
        actorRole: "reviewer",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Header edit failed");
      setMsg(`Header ${editingKey} updated (audited).`);
      setEditingKey(null);
      setEditReason("");
      onHeaderChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Header edit failed");
    }
  }

  return (
    <div className="space-y-4">
      {err && <p className="text-sm text-destructive">{err}</p>}
      {msg && <p className="text-sm text-foreground">{msg}</p>}

      {!hideHeader && (
        <section className="space-y-3 border border-border rounded-md p-4">
          <h2 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
            Data File header
          </h2>
          <p className="text-xs text-muted-foreground">
            Full 500-byte header block (billing road, source code, shop, car, dates, invoice /
            account fields).
            {!readOnly && canPencilEdit
              ? " Use the pencil to edit a field — each change requires a reason and is audited."
              : null}
          </p>
          {groups.map(([group, fields]) => (
            <div key={group} className="space-y-2">
              <h3 className="text-xs font-medium text-muted-foreground pt-2">{group}</h3>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {fields.map((f) => {
                  const val = header[f.key];
                  const display = val == null || val === "" ? "—" : String(val);
                  const isEditing = editingKey === f.key;
                  const mode: HeaderMode = f.mode ?? "EDIT_AUDIT";
                  const locked = mode === "LOCK";
                  const lockWhy =
                    f.lockWhy ||
                    `${f.label} is locked. Wrong key → void and shop resubmit (audited).`;
                  const needsReason = mode !== "FREE";
                  return (
                    <div
                      key={f.key}
                      className="flex items-start gap-2 border-b border-border/60 pb-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          {f.label}
                        </div>
                        {!isEditing && (
                          <div className="text-sm font-medium truncate" title={display}>
                            {display}
                          </div>
                        )}
                        {isEditing && (
                          <div className="space-y-2 mt-1">
                            <Input
                              className="h-8 text-sm"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                            />
                            {needsReason ? (
                              <Textarea
                                className="text-xs"
                                rows={2}
                                placeholder="Reason for change (required)"
                                value={editReason}
                                onChange={(e) => setEditReason(e.target.value)}
                              />
                            ) : (
                              <Textarea
                                className="text-xs"
                                rows={2}
                                placeholder="Optional note (still audited)"
                                value={editReason}
                                onChange={(e) => setEditReason(e.target.value)}
                              />
                            )}
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                onClick={savePencil}
                                disabled={needsReason && !editReason.trim()}
                              >
                                Save
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setEditingKey(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                      {!readOnly && canPencilEdit && !isEditing && locked && (
                        <span
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground"
                          title={lockWhy}
                        >
                          <Lock className="h-3.5 w-3.5" aria-label="Locked" />
                        </span>
                      )}
                      {!readOnly && canPencilEdit && !isEditing && !locked && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 shrink-0"
                          title={`Edit ${f.label}`}
                          onClick={() => {
                            setEditingKey(f.key);
                            setEditValue(val == null ? "" : String(val));
                            setEditReason(mode === "FREE" ? "Free edit" : "");
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      )}

      {!hideAudit && !readOnly && headerEdits.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">Header audit log</h2>
          <div className="overflow-auto border border-border rounded-md max-h-40">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="p-2">When</th>
                  <th className="p-2">Field</th>
                  <th className="p-2">Old → New</th>
                  <th className="p-2">Reason</th>
                  <th className="p-2">User</th>
                </tr>
              </thead>
              <tbody>
                {headerEdits.map((e) => (
                  <tr key={e.id} className="border-t border-border">
                    <td className="p-2 whitespace-nowrap">
                      {new Date(e.edited_at).toLocaleString()}
                    </td>
                    <td className="p-2">{e.field_key}</td>
                    <td className="p-2">
                      {e.old_value ?? "—"} → {e.new_value ?? "—"}
                    </td>
                    <td className="p-2">{e.reason}</td>
                    <td className="p-2">{e.actor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {!hideLines && (
      <section className="space-y-2">
        <div className="overflow-auto border border-border rounded-md">
          <table className="w-full text-[11px] border-collapse">
            <thead>
              <tr className="bg-[#8b1e1e] text-white text-left">
                <th className="p-1.5 w-7" title="Issue / comment" />
                <th className="p-1.5">Item</th>
                <th className="p-1.5">Loc</th>
                <th className="p-1.5">Qnty</th>
                <th className="p-1.5">C</th>
                <th className="p-1.5">AJOB</th>
                <th className="p-1.5">QA</th>
                <th className="p-1.5 min-w-[10rem]">Description</th>
                <th className="p-1.5">WM</th>
                <th className="p-1.5">RJOB</th>
                <th className="p-1.5">QR</th>
                <th className="p-1.5">R</th>
                <th className="p-1.5 text-right">Labor</th>
                <th className="p-1.5 text-right">Material</th>
                <th className="p-1.5 text-right">Amount</th>
                <th className="p-1.5">Component Id</th>
                <th className="p-1.5">500</th>
                <th className="p-1.5">PM</th>
                {readOnly && onDecideLine ? <th className="p-1.5">Your action</th> : null}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, idx) => {
                const own = ownRespCodes.includes(String(l.resp_code));
                return (
                  <tr
                    key={l.id ?? l.line_no}
                    className={cn(
                      "border-t border-border",
                      idx % 2 === 1 ? "bg-orange-50/70 dark:bg-slate-800/40" : "bg-background",
                    )}
                  >
                    <td className="p-1 text-center">
                      <button
                        type="button"
                        className={cn(
                          "inline-flex h-5 w-5 items-center justify-center rounded-full",
                          l.has_comment
                            ? "bg-amber-500 text-white"
                            : "bg-amber-400/80 text-white",
                        )}
                        title="Issue / comment"
                        onClick={() => onLineIssueClick?.(l)}
                      >
                        <AlertCircle className="h-3 w-3" />
                      </button>
                    </td>
                    <td className="p-1.5 tabular-nums">
                      {l.display_line_no ?? l.line_no}
                    </td>
                    <td className="p-1.5">
                      <CodeHover kind="location" code={l.location_on_car}>
                        {l.location_on_car ?? ""}
                      </CodeHover>
                    </td>
                    <td className="p-1.5 tabular-nums">{l.quantity ?? ""}</td>
                    <td className="p-1.5">
                      <CodeHover kind="condition" code={l.condition_code}>
                        {l.condition_code ?? ""}
                      </CodeHover>
                    </td>
                    <td className="p-1.5 font-mono">
                      <CodeHover kind="job" code={l.aar_job_code} qualifier={l.qualifier}>
                        {l.aar_job_code ?? ""}
                      </CodeHover>
                    </td>
                    <td className="p-1.5">
                      <CodeHover
                        kind="qualifier"
                        code={l.aar_job_code}
                        qualifier={l.qualifier ?? ""}
                      >
                        {l.qualifier ?? ""}
                      </CodeHover>
                    </td>
                    <td className="p-1.5 uppercase max-w-[14rem] truncate" title={l.description ?? ""}>
                      {l.description ||
                        [l.repair_category, l.sub_category].filter(Boolean).join(" / ") ||
                        ""}
                    </td>
                    <td className="p-1.5">
                      <CodeHover kind="why_made" code={l.why_made}>
                        {l.why_made ?? ""}
                      </CodeHover>
                    </td>
                    <td className="p-1.5 font-mono">
                      <CodeHover kind="job" code={l.removed_job_code}>
                        {l.removed_job_code ?? ""}
                      </CodeHover>
                    </td>
                    <td className="p-1.5">
                      <CodeHover
                        kind="removed_qualifier"
                        code={l.removed_job_code}
                        qualifier={l.removed_qualifier ?? ""}
                      >
                        {l.removed_qualifier ?? ""}
                      </CodeHover>
                    </td>
                    <td className="p-1.5 font-semibold">
                      <CodeHover kind="responsibility" code={l.resp_code}>
                        {l.resp_code ?? ""}
                      </CodeHover>
                    </td>
                    <td className="p-1.5 text-right">
                      {moneyCell({
                        dollars: l.labor,
                        display: l.labor_display,
                        money: l.labor_money,
                        cents: l.labor_cents,
                        centsLabel: l.labor_cents_label,
                      })}
                    </td>
                    <td className="p-1.5 text-right">
                      {moneyCell({
                        dollars: l.material,
                        display: l.material_display,
                        money: l.material_money,
                        cents: l.material_cents,
                        centsLabel: l.material_cents_label,
                      })}
                    </td>
                    <td className="p-1.5 text-right font-medium">
                      {moneyCell({
                        dollars: l.total,
                        display: l.amount_display,
                        money: l.amount_money,
                        cents: l.total_cents,
                        centsLabel: l.amount_cents_label,
                      })}
                    </td>
                    <td className="p-1.5 text-[10px]">
                      <span className="inline-flex items-center gap-0.5">
                        {l.component_id_flag ? (
                          <span title="Component Id required" className="inline-flex">
                            <Flag className="h-3 w-3 text-red-600" />
                          </span>
                        ) : null}
                        {l.aar_component_id ?? ""}
                      </span>
                    </td>
                    <td className="p-1.5">
                      {l.raw_line ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-0.5 text-emerald-700 dark:text-emerald-400"
                          title="View raw 500-byte record"
                          onClick={() => setRawPreview(String(l.raw_line))}
                        >
                          <FileCode2 className="h-3.5 w-3.5" />
                          <span className="font-semibold">500</span>
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="p-1.5 text-center">
                      {l.machine_priceable === "Y" || l.machine_priceable === "D" ? (
                        <span className="text-emerald-700 font-semibold" title="Price Master">
                          $
                        </span>
                      ) : (
                        ""
                      )}
                    </td>
                    {readOnly && onDecideLine ? (
                      <td className="p-1.5">
                        {own ? (
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => onDecideLine(l, "APPROVE")}
                            >
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => onDecideLine(l, "DISPUTE")}
                            >
                              Dispute
                            </Button>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-[#8b1e1e] text-white font-semibold">
                <td className="p-1.5" colSpan={12}>
                  Totals
                </td>
                <td className="p-1.5 text-right">
                  <div className="tabular-nums">{totals.labor}</div>
                  <div className="text-[9px] opacity-80">{totals.laborCents}¢</div>
                </td>
                <td className="p-1.5 text-right">
                  <div className="tabular-nums">{totals.material}</div>
                  <div className="text-[9px] opacity-80">{totals.materialCents}¢</div>
                </td>
                <td className="p-1.5 text-right">
                  <div className="tabular-nums">{totals.total}</div>
                  <div className="text-[9px] opacity-80">{totals.totalCents}¢</div>
                </td>
                <td colSpan={readOnly && onDecideLine ? 4 : 3} />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
      )}

      {rawPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-w-3xl w-full bg-background border border-border rounded-md p-4 space-y-3 shadow-lg">
            <h3 className="text-sm font-semibold">Raw 500-byte record</h3>
            <pre className="text-[10px] overflow-auto max-h-64 whitespace-pre-wrap break-all font-mono bg-muted/40 p-2 rounded">
              {rawPreview}
            </pre>
            <Button size="sm" variant="secondary" onClick={() => setRawPreview(null)}>
              Close
            </Button>
          </div>
        </div>
      )}

      {!hideAttachments && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">Attachments</h2>
          {documents.length === 0 ? (
            <p className="text-xs text-muted-foreground">No attachments.</p>
          ) : (
            <ul className="text-xs space-y-1">
              {documents.map((d) => (
                <li key={d.id} className="flex gap-2">
                  <span className="font-medium">
                    {d.original_filename || d.kind || d.id.slice(0, 8)}
                  </span>
                  <span className="text-muted-foreground">{d.kind}</span>
                  {d.lifecycle_status === "VOIDED" && (
                    <span className="text-destructive">VOIDED</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
