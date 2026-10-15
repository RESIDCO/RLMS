/**
 * §E Document / photo viewer — own window from Estimate Review, Bad Orders, Wreck.
 * Shot 03 layout + left category list / right preview (image, PDF, 500-byte, Office).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRoute } from "wouter";
import {
  Download,
  Eye,
  FileArchive,
  RotateCw,
  Save,
  Send,
  Trash2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/queryClient";
import RepairOwnerShell from "./RepairOwnerShell";
import { cn } from "@/lib/utils";

type DocRow = {
  id: string;
  kind: string;
  original_filename?: string | null;
  mime?: string | null;
  size?: number;
  uploaded_at?: string;
  created_at?: string;
  lifecycle_status?: string;
  category_code?: string | null;
  comment?: string | null;
  uploaded_by?: string | null;
  created_by?: string | null;
  uploaded_role?: string | null;
  deleted_at?: string | null;
  owner_only?: boolean;
  source_tag?: string | null;
  doc_revision?: number;
  group?: string;
  jic_photo?: boolean;
};

type CategoryBucket = { code: string; label: string; count: number };

type ChecklistItem = {
  key: string;
  label: string;
  required: boolean;
  present: boolean;
  count: number;
  min?: number;
  max?: number;
  missing: boolean;
};

type Permissions = {
  role: string;
  canAdd: boolean;
  canRemove: boolean;
  canRecategorize: boolean;
  canVoid: boolean;
  canRestore: boolean;
  canShowVoided: boolean;
  canZip: boolean;
  canAttachSendLessee: boolean;
};

type Scope = {
  eventId: string;
  estimateId: string | null;
  wreckEventId: string | null;
  carLabel: string;
  reason: string | null;
  estimateIdDisplay: string | null;
  statusName: string | null;
  boLifecycleStatus: string | null;
  badOrderId: string | null;
  recordType: string;
};

const CATEGORIES = [
  "Photograph",
  "estimate_pdf",
  "aar_500byte",
  "Invoice",
  "SDS",
  "Scope of Work",
  "JIC",
  "DDCT",
  "Other",
  "Undefined",
];

const UPLOADER_FILTERS = [
  { value: "", label: "All uploaders" },
  { value: "shop", label: "Shop" },
  { value: "owner", label: "Owner" },
  { value: "lessee", label: "Lessee" },
];

function fmtSize(n?: number) {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} kB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function previewKind(d: DocRow): "image" | "pdf" | "aar500" | "office" | "other" {
  const mime = String(d.mime ?? "").toLowerCase();
  const name = String(d.original_filename ?? d.kind ?? "").toLowerCase();
  const cat = String(d.category_code ?? d.group ?? "").toLowerCase();
  if (
    cat === "aar_500byte" ||
    cat === "data_file" ||
    d.kind === "aar_500byte" ||
    name.endsWith(".500") ||
    name.endsWith(".dat")
  ) {
    return "aar500";
  }
  if (mime.startsWith("image/") || /\.(jpe?g|png|gif|bmp|webp)$/i.test(name)) {
    return "image";
  }
  if (mime.includes("pdf") || name.endsWith(".pdf")) return "pdf";
  if (
    mime.includes("officedocument") ||
    mime.includes("msword") ||
    mime.includes("ms-excel") ||
    /\.(docx?|xlsx?|pptx?)$/i.test(name)
  ) {
    return "office";
  }
  return "other";
}

function roleFromUrl(): string {
  const hashQs = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
  return (
    hashQs.get("role") ||
    new URLSearchParams(window.location.search).get("role") ||
    "reviewer"
  );
}

function useViewerScope(): {
  estimateId?: string;
  eventId?: string;
  wreckEventId?: string;
} {
  const [, est] = useRoute("/repair/estimates/:id/documents");
  const [, ev] = useRoute("/repair/events/:id/documents");
  const [, wreck] = useRoute("/repair/wreck/:eventId/documents");
  if (est?.id) return { estimateId: est.id };
  if (ev?.id) return { eventId: ev.id };
  if (wreck?.eventId) return { wreckEventId: wreck.eventId };
  return {};
}

export default function EstimateDocuments() {
  const scopeIds = useViewerScope();
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [categories, setCategories] = useState<CategoryBucket[]>([]);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [scope, setScope] = useState<Scope | null>(null);
  const [perms, setPerms] = useState<Permissions | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [applyComment, setApplyComment] = useState("");
  const [applyCategory, setApplyCategory] = useState("Undefined");
  const [addComment, setAddComment] = useState("");
  const [addCategory, setAddCategory] = useState("Photograph");
  const [files, setFiles] = useState<FileList | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [role, setRole] = useState(roleFromUrl());
  const [showVoided, setShowVoided] = useState(false);
  const [filterCategory, setFilterCategory] = useState("");
  const [filterUploader, setFilterUploader] = useState("");
  const [filterSearch, setFilterSearch] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [aarPreview, setAarPreview] = useState<{
    lines: Array<{ lineNo: number; fields: Record<string, unknown>; rawLine: string }>;
    rawText?: string;
    decodeError?: string;
  } | null>(null);
  const [aarRaw, setAarRaw] = useState(false);
  const [leftCategory, setLeftCategory] = useState<string>("");

  const queryBase = useMemo(() => {
    const p = new URLSearchParams();
    if (scopeIds.estimateId) p.set("estimateId", scopeIds.estimateId);
    if (scopeIds.eventId) p.set("eventId", scopeIds.eventId);
    if (scopeIds.wreckEventId) p.set("wreckEventId", scopeIds.wreckEventId);
    p.set("role", role);
    if (showVoided) p.set("showVoided", "1");
    if (filterCategory) p.set("category", filterCategory);
    if (filterUploader) p.set("uploader", filterUploader);
    if (filterSearch) p.set("q", filterSearch);
    if (filterDateFrom) p.set("dateFrom", filterDateFrom);
    if (filterDateTo) p.set("dateTo", filterDateTo);
    return p;
  }, [
    scopeIds,
    role,
    showVoided,
    filterCategory,
    filterUploader,
    filterSearch,
    filterDateFrom,
    filterDateTo,
  ]);

  const load = useCallback(async () => {
    setError("");
    const res = await apiRequest(
      "GET",
      `/api/repair/documents/viewer?${queryBase.toString()}`,
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "load failed");
    setScope(data.scope ?? null);
    setDocs((data.documents ?? []) as DocRow[]);
    setCategories((data.categories ?? []) as CategoryBucket[]);
    setChecklist((data.checklist?.items ?? []) as ChecklistItem[]);
    setPerms(data.permissions ?? null);
    setRole(String(data.permissions?.role ?? role));
  }, [queryBase, role]);

  useEffect(() => {
    if (!scopeIds.estimateId && !scopeIds.eventId && !scopeIds.wreckEventId) return;
    void load().catch((e) =>
      setError(e instanceof Error ? e.message : "load failed"),
    );
  }, [load, scopeIds]);

  const selected = useMemo(
    () => docs.find((d) => d.id === selectedId) ?? null,
    [docs, selectedId],
  );

  const leftDocs = useMemo(() => {
    if (!leftCategory) return docs;
    return docs.filter(
      (d) =>
        String(d.group ?? "").toLowerCase() === leftCategory ||
        String(d.category_code ?? "").toLowerCase() === leftCategory,
    );
  }, [docs, leftCategory]);

  useEffect(() => {
    if (!selected || previewKind(selected) !== "aar500") {
      setAarPreview(null);
      return;
    }
    void (async () => {
      const res = await apiRequest(
        "GET",
        `/api/repair/documents/${selected.id}/aar-preview?role=${encodeURIComponent(role)}`,
      );
      const data = await res.json();
      if (!res.ok) {
        setAarPreview({ lines: [], decodeError: data.error || "decode failed" });
        return;
      }
      setAarPreview({
        lines: (data.lines ?? []).map(
          (l: { lineNo: number; fields: Record<string, unknown>; rawLine: string }) => ({
            lineNo: l.lineNo,
            fields: l.fields,
            rawLine: l.rawLine,
          }),
        ),
        rawText: data.rawText,
        decodeError: data.decodeError,
      });
    })();
  }, [selected, role]);

  function contentUrl(d: DocRow, download = false) {
    const p = new URLSearchParams({ role, audit: download ? "1" : "0" });
    if (download) p.set("download", "1");
    return `/api/repair/documents/${d.id}/content?${p.toString()}`;
  }

  async function voidDoc(d: DocRow) {
    if (!perms?.canVoid) {
      setError("Shop cannot delete, void, or recategorize attachments (add only)");
      return;
    }
    if (!confirm(`Void ${d.original_filename || d.kind}? (soft-delete / VOIDED)`)) return;
    const res = await apiRequest("POST", `/api/repair/documents/${d.id}/soft-delete`, {
      reason: "Owner void from document viewer",
      actorRole: role,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "void failed");
    setMsg("Document VOIDED");
    if (selectedId === d.id) setSelectedId(null);
    await load();
  }

  async function uploadFiles() {
    if (!scope || !files?.length) return;
    if (!perms?.canAdd) {
      setError("Not allowed to add documents");
      return;
    }
    setError("");
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("kind", addCategory);
        fd.append("category", addCategory);
        if (addComment) fd.append("comment", addComment);
        const res = await fetch(`/api/repair/events/${scope.eventId}/documents`, {
          method: "POST",
          body: fd,
          credentials: "include",
          headers: { "x-repair-role": role },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "upload failed");
      }
      setFiles(null);
      setAddComment("");
      setMsg("Upload complete");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "upload failed");
    }
  }

  async function applyToChecked() {
    if (!perms?.canRecategorize) {
      setError("Shop cannot delete, void, or recategorize attachments (add only)");
      return;
    }
    const ids = Object.entries(checked)
      .filter(([, v]) => v)
      .map(([id]) => id);
    if (!ids.length) {
      setError("Select files to apply");
      return;
    }
    for (const id of ids) {
      const res = await apiRequest("POST", `/api/repair/documents/${id}/recategorize`, {
        categoryCode: applyCategory,
        comment: applyComment || undefined,
        actorRole: role,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "recategorize failed");
      }
    }
    setMsg(`Applied category/comment to ${ids.length} file(s)`);
    await load();
  }

  async function downloadZip() {
    const ids = Object.entries(checked)
      .filter(([, v]) => v)
      .map(([id]) => id);
    const targets = ids.length ? ids : docs.map((d) => d.id);
    if (!targets.length) {
      setError("No documents to download");
      return;
    }
    const res = await fetch("/api/repair/documents/zip", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "x-repair-role": role,
      },
      body: JSON.stringify({
        documentIds: targets,
        eventId: scope?.eventId,
        estimateId: scope?.estimateId,
        actorRole: role,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "zip failed");
      return;
    }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `attachments-${targets.length}.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
    setMsg(`Downloaded zip (${targets.length} file(s))`);
  }

  async function attachSendLessee() {
    if (!perms?.canAttachSendLessee || !scope?.estimateId) {
      setError("Attach to Send Lessee requires owner role and an estimate");
      return;
    }
    const ids = Object.entries(checked)
      .filter(([, v]) => v)
      .map(([id]) => id);
    if (!ids.length) {
      setError("Select files to attach");
      return;
    }
    const res = await apiRequest("POST", "/api/repair/documents/attach-send-lessee", {
      estimateId: scope.estimateId,
      documentIds: ids,
      actorRole: role,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "attach failed");
    setMsg(`Attached ${ids.length} file(s) for Send Lessee`);
    if (data.sendLesseePath) {
      window.open(data.sendLesseePath, "_blank", "noopener,noreferrer");
    }
  }

  const canManage = Boolean(perms?.canVoid);

  return (
    <RepairOwnerShell>
      <div className="p-3 max-w-[1400px] mx-auto space-y-3">
        {/* Header — shot 03 */}
        <div className="flex items-start justify-between gap-3 border-b border-border pb-2">
          <div>
            <h1 className="text-lg font-semibold">File Attachments</h1>
            <div className="text-base font-bold tracking-tight">
              {scope?.carLabel || "—"}
            </div>
            <div className="text-sm text-muted-foreground">{scope?.reason || ""}</div>
            <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-4 gap-y-1">
              {scope?.badOrderId && <span>Bad Order ID: {scope.badOrderId.slice(0, 8)}</span>}
              {scope?.estimateIdDisplay && (
                <span>Estimate: {scope.estimateIdDisplay}</span>
              )}
              <span>
                {scope?.boLifecycleStatus || "—"}
                {scope?.statusName ? ` · ${scope.statusName}` : ""}
              </span>
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={() => window.close()}>
            <X className="h-4 w-4 mr-1" /> Close
          </Button>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {msg && <p className="text-sm text-foreground">{msg}</p>}

        {/* Required-docs checklist */}
        {checklist.length > 0 && (
          <div
            className={cn(
              "rounded-md border px-3 py-2 text-xs space-y-1",
              checklist.some((c) => c.missing)
                ? "border-amber-600/50 bg-amber-50 text-amber-950 dark:bg-amber-950/40 dark:text-amber-50"
                : "border-border bg-muted/40",
            )}
          >
            <div className="font-medium">Required documents</div>
            <ul className="space-y-0.5">
              {checklist.map((c) => (
                <li key={c.key} className="flex gap-2">
                  <span>{c.missing ? "⚠" : "✓"}</span>
                  <span>
                    {c.label}: {c.count}
                    {c.min != null ? ` / ${c.min}${c.max != null ? `–${c.max}` : "+"}` : ""}
                    {c.missing ? " — missing" : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-2 items-end text-xs">
          <div>
            <Label className="text-[10px]">Category</Label>
            <select
              className="mt-0.5 h-8 rounded border border-border bg-background px-2"
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
            >
              <option value="">All</option>
              {categories.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label} ({c.count})
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-[10px]">Uploader</Label>
            <select
              className="mt-0.5 h-8 rounded border border-border bg-background px-2"
              value={filterUploader}
              onChange={(e) => setFilterUploader(e.target.value)}
            >
              {UPLOADER_FILTERS.map((u) => (
                <option key={u.value || "all"} value={u.value}>
                  {u.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-[10px]">From</Label>
            <Input
              type="date"
              className="mt-0.5 h-8 w-[9.5rem]"
              value={filterDateFrom}
              onChange={(e) => setFilterDateFrom(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-[10px]">To</Label>
            <Input
              type="date"
              className="mt-0.5 h-8 w-[9.5rem]"
              value={filterDateTo}
              onChange={(e) => setFilterDateTo(e.target.value)}
            />
          </div>
          <div className="flex-1 min-w-[10rem]">
            <Label className="text-[10px]">Search file name</Label>
            <Input
              className="mt-0.5 h-8"
              value={filterSearch}
              onChange={(e) => setFilterSearch(e.target.value)}
              placeholder="File name…"
            />
          </div>
          {perms?.canShowVoided && (
            <label className="flex items-center gap-1.5 h-8 mt-4">
              <input
                type="checkbox"
                checked={showVoided}
                onChange={(e) => setShowVoided(e.target.checked)}
              />
              Show voided
            </label>
          )}
          {!canManage && (
            <span className="text-amber-700 dark:text-amber-400 mt-4">
              Role {role}: add only — void / recategorize blocked server-side.
            </span>
          )}
        </div>

        {/* Apply / Add — shot 03 */}
        <div className="grid md:grid-cols-2 gap-3">
          <div
            className={cn(
              "border border-border rounded-md p-3 space-y-2",
              !canManage && "opacity-50 pointer-events-none",
            )}
          >
            <div className="text-sm font-medium">Apply to Checked Files</div>
            <div>
              <Label className="text-xs">Comment</Label>
              <Input
                className="mt-1 h-8"
                value={applyComment}
                onChange={(e) => setApplyComment(e.target.value)}
                placeholder="Optional Comment"
              />
            </div>
            <div>
              <Label className="text-xs">Category</Label>
              <select
                className="mt-1 h-8 w-full rounded border border-border bg-background px-2 text-sm"
                value={applyCategory}
                onChange={(e) => setApplyCategory(e.target.value)}
              >
                {CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
            <Button
              size="sm"
              onClick={() => void applyToChecked().catch((e) => setError(String(e)))}
            >
              <Save className="h-3.5 w-3.5 mr-1" /> Apply
            </Button>
          </div>
          <div className="border border-border rounded-md p-3 space-y-2">
            <div className="text-sm font-medium">Add File(s)</div>
            <div>
              <Label className="text-xs">Comment</Label>
              <Input
                className="mt-1 h-8"
                value={addComment}
                onChange={(e) => setAddComment(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Category</Label>
              <select
                className="mt-1 h-8 w-full rounded border border-border bg-background px-2 text-sm"
                value={addCategory}
                onChange={(e) => setAddCategory(e.target.value)}
              >
                {CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <Input
                type="file"
                multiple
                className="h-9 text-xs flex-1 min-w-[12rem]"
                onChange={(e) => setFiles(e.target.files)}
              />
              <Button
                size="sm"
                onClick={() => void uploadFiles()}
                disabled={!files?.length || !perms?.canAdd}
              >
                <Upload className="h-3.5 w-3.5 mr-1" /> Upload Files
              </Button>
            </div>
          </div>
        </div>

        {/* Left category list + right preview */}
        <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-3 min-h-[28rem]">
          <div className="border border-border rounded-md overflow-hidden flex flex-col">
            <div className="flex gap-1 overflow-x-auto border-b border-border bg-muted/50 px-2 py-1 text-[11px]">
              <button
                type="button"
                className={cn(
                  "px-2 py-1 rounded shrink-0",
                  !leftCategory && "bg-background font-medium",
                )}
                onClick={() => setLeftCategory("")}
              >
                All ({docs.length})
              </button>
              {categories.map((c) => (
                <button
                  key={c.code}
                  type="button"
                  className={cn(
                    "px-2 py-1 rounded shrink-0",
                    leftCategory === c.code && "bg-background font-medium",
                  )}
                  onClick={() => setLeftCategory(c.code)}
                >
                  {c.label} ({c.count})
                </button>
              ))}
            </div>
            <div className="overflow-auto flex-1">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted text-left sticky top-0">
                    <th className="p-2">
                      <input
                        type="checkbox"
                        onChange={(e) => {
                          const next: Record<string, boolean> = {};
                          for (const d of leftDocs) next[d.id] = e.target.checked;
                          setChecked(next);
                        }}
                      />
                    </th>
                    <th className="p-2">View</th>
                    <th className="p-2">Save</th>
                    <th className="p-2">File Name</th>
                    <th className="p-2">Type</th>
                    <th className="p-2">Category</th>
                    <th className="p-2">Loaded By</th>
                    <th className="p-2">Load Date</th>
                    <th className="p-2">Size</th>
                    <th className="p-2">Rev</th>
                    <th className="p-2">Comment</th>
                    <th className="p-2">Del</th>
                  </tr>
                </thead>
                <tbody>
                  {leftDocs.map((d, i) => {
                    const name = d.original_filename || d.kind || d.id.slice(0, 8);
                    const ext = name.includes(".") ? name.split(".").pop() : "";
                    const voided =
                      Boolean(d.deleted_at) ||
                      String(d.lifecycle_status ?? "").toUpperCase() === "VOIDED";
                    return (
                      <tr
                        key={d.id}
                        className={cn(
                          "border-t border-border cursor-pointer",
                          i % 2 === 1 ? "bg-sky-50/50 dark:bg-slate-800/40" : "",
                          selectedId === d.id && "ring-1 ring-inset ring-sky-600",
                          voided && "opacity-60 line-through",
                        )}
                        onClick={() => {
                          setSelectedId(d.id);
                          setZoom(1);
                          setRotation(0);
                          setAarRaw(false);
                        }}
                      >
                        <td className="p-2" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={Boolean(checked[d.id])}
                            onChange={(e) =>
                              setChecked((prev) => ({
                                ...prev,
                                [d.id]: e.target.checked,
                              }))
                            }
                          />
                        </td>
                        <td className="p-2">
                          <Eye className="h-4 w-4 text-sky-700" />
                        </td>
                        <td className="p-2" onClick={(e) => e.stopPropagation()}>
                          <a href={contentUrl(d, true)} download title="Download">
                            <Download className="h-4 w-4 text-violet-700" />
                          </a>
                        </td>
                        <td className="p-2 font-medium">
                          <div>{name}</div>
                          {d.source_tag && (
                            <div className="text-[10px] text-muted-foreground font-normal">
                              {d.source_tag}
                            </div>
                          )}
                          {d.owner_only && (
                            <div className="text-[10px] text-amber-700">Owner only</div>
                          )}
                        </td>
                        <td className="p-2">{ext}</td>
                        <td className="p-2">{d.category_code || d.kind}</td>
                        <td className="p-2">
                          {d.uploaded_by || d.created_by || "—"}
                          {d.uploaded_role ? (
                            <span className="text-muted-foreground"> ({d.uploaded_role})</span>
                          ) : null}
                        </td>
                        <td className="p-2 whitespace-nowrap">
                          {d.uploaded_at || d.created_at
                            ? new Date(String(d.uploaded_at || d.created_at)).toDateString()
                            : "—"}
                        </td>
                        <td className="p-2">{fmtSize(d.size)}</td>
                        <td className="p-2">{d.doc_revision ?? 1}</td>
                        <td className="p-2">{d.comment || ""}</td>
                        <td className="p-2" onClick={(e) => e.stopPropagation()}>
                          {canManage && !voided ? (
                            <button
                              type="button"
                              title="Void (soft-delete)"
                              onClick={() =>
                                void voidDoc(d).catch((e) => setError(String(e)))
                              }
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </button>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {leftDocs.length === 0 && (
                    <tr>
                      <td colSpan={12} className="p-4 text-muted-foreground text-center">
                        No documents.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right preview */}
          <div className="border border-border rounded-md flex flex-col min-h-[28rem] bg-muted/20">
            {!selected ? (
              <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground p-4">
                Select a file to preview
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border text-xs">
                  <div className="font-medium truncate">
                    {selected.original_filename || selected.kind}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {previewKind(selected) === "image" && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
                        >
                          <ZoomIn className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
                        >
                          <ZoomOut className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          onClick={() => setRotation((r) => (r + 90) % 360)}
                        >
                          <RotateCw className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                    {previewKind(selected) === "aar500" && (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-7"
                        onClick={() => setAarRaw((v) => !v)}
                      >
                        {aarRaw ? "Field grid" : "Raw"}
                      </Button>
                    )}
                    <a href={contentUrl(selected, true)} download>
                      <Button size="sm" variant="secondary" className="h-7">
                        <Download className="h-3.5 w-3.5 mr-1" /> Download
                      </Button>
                    </a>
                  </div>
                </div>
                <div className="flex-1 overflow-auto p-2">
                  {previewKind(selected) === "image" && (
                    <div className="flex items-center justify-center min-h-full">
                      <img
                        src={contentUrl(selected)}
                        alt={selected.original_filename || "preview"}
                        style={{
                          transform: `scale(${zoom}) rotate(${rotation}deg)`,
                          transformOrigin: "center center",
                          maxWidth: "100%",
                        }}
                        className="transition-transform"
                      />
                    </div>
                  )}
                  {previewKind(selected) === "pdf" && (
                    <iframe
                      title="pdf"
                      src={contentUrl(selected)}
                      className="w-full h-[70vh] border border-border rounded bg-white"
                    />
                  )}
                  {previewKind(selected) === "office" && (
                    <div className="flex flex-col items-center justify-center gap-3 h-full text-sm p-6 text-center">
                      <p>
                        Office documents (Word / Excel / PowerPoint) cannot be previewed
                        inline. Download to open locally.
                      </p>
                      <a href={contentUrl(selected, true)} download>
                        <Button>
                          <Download className="h-4 w-4 mr-1" /> Download
                        </Button>
                      </a>
                    </div>
                  )}
                  {previewKind(selected) === "aar500" && (
                    <div className="space-y-2">
                      {aarPreview?.decodeError && (
                        <p className="text-xs text-destructive">{aarPreview.decodeError}</p>
                      )}
                      {aarRaw || !aarPreview?.lines?.length ? (
                        <pre className="text-[10px] whitespace-pre-wrap font-mono bg-background border border-border rounded p-2 max-h-[70vh] overflow-auto">
                          {aarPreview?.rawText || "Loading…"}
                        </pre>
                      ) : (
                        <div className="space-y-3 max-h-[70vh] overflow-auto">
                          {aarPreview.lines.map((line) => (
                            <div
                              key={line.lineNo}
                              className="border border-border rounded bg-background"
                            >
                              <div className="px-2 py-1 text-[10px] font-medium bg-muted">
                                Line {line.lineNo}
                              </div>
                              <table className="w-full text-[10px]">
                                <tbody>
                                  {Object.entries(line.fields).map(([k, v]) => (
                                    <tr key={k} className="border-t border-border">
                                      <td className="p-1 font-medium w-40 align-top">{k}</td>
                                      <td className="p-1 font-mono break-all">
                                        {v == null ? "—" : String(v)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {previewKind(selected) === "other" && (
                    <iframe
                      title="preview"
                      src={contentUrl(selected)}
                      className="w-full h-[70vh] border border-border rounded bg-white"
                    />
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap justify-center gap-3">
          <Button variant="secondary" onClick={() => window.close()}>
            <X className="h-4 w-4 mr-1" /> Close
          </Button>
          <Button onClick={() => void downloadZip()}>
            <FileArchive className="h-4 w-4 mr-1" /> Download zip
          </Button>
          {perms?.canAttachSendLessee && scope?.estimateId && (
            <Button
              variant="secondary"
              onClick={() =>
                void attachSendLessee().catch((e) => setError(String(e)))
              }
            >
              <Send className="h-4 w-4 mr-1" /> Attach to Send Lessee
            </Button>
          )}
        </div>
      </div>
    </RepairOwnerShell>
  );
}
