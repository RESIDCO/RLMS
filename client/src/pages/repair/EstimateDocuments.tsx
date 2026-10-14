/**
 * Document / photo viewer (§D / shot 03) — opened in a new window from
 * Estimate Review "N Document(s) found".
 */
import { useEffect, useMemo, useState } from "react";
import { useRoute } from "wouter";
import {
  Download,
  Eye,
  Save,
  Trash2,
  Upload,
  X,
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
  deleted_at?: string | null;
};

const CATEGORIES = ["Photograph", "SDS", "Scope of Work", "Other", "Undefined"];

function fmtSize(n?: number) {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} kB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function EstimateDocuments() {
  const [, params] = useRoute("/repair/estimates/:id/documents");
  const estimateId = params?.id ?? "";
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [ctx, setCtx] = useState<{
    car: string;
    reason: string | null;
    estimateIdDisplay: string;
    statusName: string;
    boLifecycleStatus: string | null;
    eventId: string;
  } | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [applyComment, setApplyComment] = useState("");
  const [applyCategory, setApplyCategory] = useState("Undefined");
  const [addComment, setAddComment] = useState("");
  const [addCategory, setAddCategory] = useState("Photograph");
  const [files, setFiles] = useState<FileList | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState("");

  async function load() {
    setError("");
    const res = await apiRequest("GET", `/api/repair/estimates/${estimateId}/review`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "load failed");
    const c = data.context;
    setCtx(
      c
        ? {
            car: `${c.carInitial} ${c.carNumber}`,
            reason: c.badOrderReason,
            estimateIdDisplay: c.estimateIdDisplay,
            statusName: c.statusName,
            boLifecycleStatus: c.boLifecycleStatus,
            eventId: c.eventId,
          }
        : null,
    );
    const list = (data.documents ?? []) as DocRow[];
    setDocs(list.filter((d) => !d.deleted_at));
  }

  useEffect(() => {
    if (!estimateId) return;
    void load().catch((e) =>
      setError(e instanceof Error ? e.message : "load failed"),
    );
  }, [estimateId]);

  const activeDocs = useMemo(
    () =>
      docs.filter(
        (d) => String(d.lifecycle_status ?? "ACTIVE").toUpperCase() !== "VOIDED",
      ),
    [docs],
  );

  async function viewDoc(d: DocRow) {
    setPreviewName(d.original_filename || d.kind);
    setPreviewUrl(`/api/repair/documents/${d.id}/content`);
  }

  function downloadDoc(d: DocRow) {
    const a = document.createElement("a");
    a.href = `/api/repair/documents/${d.id}/content`;
    a.download = d.original_filename || "document";
    a.target = "_blank";
    a.click();
  }

  async function voidDoc(d: DocRow) {
    if (!confirm(`Void ${d.original_filename || d.kind}? (soft-delete / VOIDED)`)) return;
    const res = await apiRequest("POST", `/api/repair/documents/${d.id}/soft-delete`, {
      reason: "Owner void from document viewer",
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "void failed");
    setMsg("Document VOIDED");
    await load();
  }

  async function uploadFiles() {
    if (!ctx || !files?.length) return;
    setError("");
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("kind", addCategory);
        fd.append("category", addCategory);
        if (addComment) fd.append("comment", addComment);
        const res = await fetch(`/api/repair/events/${ctx.eventId}/documents`, {
          method: "POST",
          body: fd,
          credentials: "include",
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
    const ids = Object.entries(checked)
      .filter(([, v]) => v)
      .map(([id]) => id);
    if (!ids.length) {
      setError("Select files to apply");
      return;
    }
    // Best-effort: mark shared / category via existing share endpoint when present
    for (const id of ids) {
      await apiRequest("POST", `/api/repair/documents/${id}/share`, {
        shared: true,
        categoryCode: applyCategory,
        comment: applyComment || undefined,
      }).catch(() => undefined);
    }
    setMsg(`Applied category/comment to ${ids.length} file(s)`);
    await load();
  }

  function downloadSelected() {
    const ids = Object.entries(checked)
      .filter(([, v]) => v)
      .map(([id]) => id);
    const targets = ids.length
      ? activeDocs.filter((d) => ids.includes(d.id))
      : activeDocs;
    for (const d of targets) downloadDoc(d);
  }

  return (
    <RepairOwnerShell>
      <div className="p-4 max-w-5xl mx-auto space-y-3">
        <div className="flex items-start justify-between gap-3 border-b border-border pb-2">
          <div>
            <h1 className="text-lg font-semibold">File Attachments</h1>
            <div className="text-sm font-medium">
              {ctx?.car}{" "}
              <span className="text-muted-foreground font-normal">
                {ctx?.reason || ""}
              </span>
            </div>
            <div className="text-xs text-muted-foreground mt-1 space-x-3">
              <span>Estimate: {ctx?.estimateIdDisplay}</span>
              <span>Status: {ctx?.boLifecycleStatus || "—"} / {ctx?.statusName}</span>
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={() => window.close()}>
            <X className="h-4 w-4 mr-1" /> Close window
          </Button>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {msg && <p className="text-sm text-foreground">{msg}</p>}

        <div className="grid md:grid-cols-2 gap-3">
          <div className="border border-border rounded-md p-3 space-y-2">
            <div className="text-sm font-medium">Apply to Checked Files</div>
            <div>
              <Label className="text-xs">Comment</Label>
              <Input
                className="mt-1 h-8"
                value={applyComment}
                onChange={(e) => setApplyComment(e.target.value)}
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
            <Button size="sm" onClick={() => void applyToChecked()}>
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
            <Input
              type="file"
              multiple
              className="h-9 text-xs"
              onChange={(e) => setFiles(e.target.files)}
            />
            <Button size="sm" onClick={() => void uploadFiles()} disabled={!files?.length}>
              <Upload className="h-3.5 w-3.5 mr-1" /> Upload Files
            </Button>
          </div>
        </div>

        <div className="overflow-auto border border-border rounded-md">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted text-left">
                <th className="p-2">
                  <input
                    type="checkbox"
                    onChange={(e) => {
                      const next: Record<string, boolean> = {};
                      for (const d of activeDocs) next[d.id] = e.target.checked;
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
                <th className="p-2">File Size</th>
                <th className="p-2">Comment</th>
                <th className="p-2">Del</th>
              </tr>
            </thead>
            <tbody>
              {activeDocs.map((d, i) => {
                const name = d.original_filename || d.kind || d.id.slice(0, 8);
                const ext = name.includes(".") ? name.split(".").pop() : "";
                return (
                  <tr
                    key={d.id}
                    className={cn(
                      "border-t border-border",
                      i % 2 === 1 ? "bg-sky-50/50 dark:bg-slate-800/40" : "",
                    )}
                  >
                    <td className="p-2">
                      <input
                        type="checkbox"
                        checked={Boolean(checked[d.id])}
                        onChange={(e) =>
                          setChecked((prev) => ({ ...prev, [d.id]: e.target.checked }))
                        }
                      />
                    </td>
                    <td className="p-2">
                      <button type="button" onClick={() => void viewDoc(d)} title="View">
                        <Eye className="h-4 w-4 text-sky-700" />
                      </button>
                    </td>
                    <td className="p-2">
                      <button type="button" onClick={() => downloadDoc(d)} title="Download">
                        <Download className="h-4 w-4 text-violet-700" />
                      </button>
                    </td>
                    <td className="p-2 font-medium">{name}</td>
                    <td className="p-2">{ext}</td>
                    <td className="p-2">{d.category_code || d.kind}</td>
                    <td className="p-2">{d.uploaded_by || d.created_by || "—"}</td>
                    <td className="p-2 whitespace-nowrap">
                      {d.uploaded_at || d.created_at
                        ? new Date(String(d.uploaded_at || d.created_at)).toDateString()
                        : "—"}
                    </td>
                    <td className="p-2">{fmtSize(d.size)}</td>
                    <td className="p-2">{d.comment || ""}</td>
                    <td className="p-2">
                      <button
                        type="button"
                        title="Void (soft-delete)"
                        onClick={() => void voidDoc(d).catch((e) => setError(String(e)))}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {activeDocs.length === 0 && (
                <tr>
                  <td colSpan={11} className="p-4 text-muted-foreground text-center">
                    No documents.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex justify-center gap-3">
          <Button variant="secondary" onClick={() => window.close()}>
            <X className="h-4 w-4 mr-1" /> Close
          </Button>
          <Button onClick={downloadSelected}>
            <Download className="h-4 w-4 mr-1" /> Download
          </Button>
        </div>

        {previewUrl && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-background border border-border rounded-md w-full max-w-4xl max-h-[90vh] overflow-auto p-3 space-y-2">
              <div className="flex justify-between items-center">
                <h3 className="font-medium text-sm">{previewName}</h3>
                <Button size="sm" variant="ghost" onClick={() => setPreviewUrl(null)}>
                  Close
                </Button>
              </div>
              <iframe title="preview" src={previewUrl} className="w-full h-[70vh] border border-border rounded" />
            </div>
          </div>
        )}
      </div>
    </RepairOwnerShell>
  );
}
