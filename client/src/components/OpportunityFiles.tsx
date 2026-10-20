import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  OPP_DOC_CATEGORIES,
  attachmentDownloadHeaders,
  bidFileCategory,
  bidFileCategoryCounts,
  filterBidFiles,
  oppDocCategoryLabel,
  suggestCategory,
  type OppDocCategory,
} from "@shared/attachment-category";
import { apiRequest } from "@/lib/queryClient";
import { useCanEdit } from "@/lib/AuthContext";
import { supabase } from "@/lib/supabase";
import { offerUndoToast } from "@/lib/undo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { confirmDelete } from "@/components/ConfirmActionDialog";
import { useToast } from "@/hooks/use-toast";
import { formatAttachmentProvenance } from "@shared/attachment-source";
import { Download, File, FileImage, FileText, Loader2, Paperclip, Pencil, Trash2, Upload } from "lucide-react";

export type OpportunityFileLine = {
  id: number;
  label: string;
  deleted: boolean;
};

export type OpportunityAttachment = {
  id: number;
  entity_type: string;
  entity_id: number;
  file_name: string;
  file_size: number;
  mime_type: string;
  storage_path: string;
  uploaded_by: string | null;
  uploaded_at: string;
  notes: string | null;
  source_module?: string | null;
  doc_category?: string | null;
  opportunity_line_id?: number | null;
};

type DealFilter = "all" | "none" | number;

function initialDeal(lineId: number | null | undefined): DealFilter {
  if (lineId === undefined) return "all";
  if (lineId === null) return "none";
  return lineId;
}

function fileIcon(mime: string) {
  if (mime === "application/pdf") return <FileText className="h-4 w-4 text-red-400 shrink-0" />;
  if (mime.startsWith("image/")) return <FileImage className="h-4 w-4 text-blue-400 shrink-0" />;
  return <File className="h-4 w-4 text-muted-foreground shrink-0" />;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function saveAttachmentBlob(fileName: string, blob: Blob) {
  const headers = attachmentDownloadHeaders(fileName, blob.type || "application/octet-stream");
  const url = URL.createObjectURL(blob);
  if (headers.disposition === "inline") {
    window.open(url, "_blank", "noopener,noreferrer");
  } else {
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function dealBadge(line: OpportunityFileLine | undefined, lineId: number): string {
  if (!line) return `Deal ${lineId}`;
  return `Deal ${line.label}`;
}

export function OpportunityFilesView({
  attachments,
  lines,
  lineId,
  categories = true,
  canEdit,
  loading,
  compact = false,
  busy,
  onUpload,
  onPatch,
  onDelete,
  onDownload,
}: {
  attachments: OpportunityAttachment[];
  lines: OpportunityFileLine[];
  lineId?: number | null;
  categories?: boolean;
  canEdit: boolean;
  loading?: boolean;
  compact?: boolean;
  busy?: boolean;
  onUpload: (files: File[], category: OppDocCategory, line: number | null, notes: string) => Promise<void>;
  onPatch: (id: number, body: { doc_category?: OppDocCategory; opportunity_line_id?: number | null }) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onDownload: (att: OpportunityAttachment) => Promise<void>;
}) {
  const [category, setCategory] = useState<"all" | OppDocCategory>("all");
  const [deal, setDeal] = useState<DealFilter>(() => initialDeal(lineId));
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editing, setEditing] = useState<OpportunityAttachment | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  useEffect(() => {
    setDeal(initialDeal(lineId));
    setCategory("all");
  }, [lineId]);

  const dealScoped = filterBidFiles(attachments, { category: "all", line: deal });
  const counts = bidFileCategoryCounts(dealScoped);
  const shown = filterBidFiles(dealScoped, { category, line: "all" });
  const lineById = new Map(lines.map((line) => [line.id, line]));

  async function handleDelete(att: OpportunityAttachment) {
    const ok = await confirmDelete({
      title: `Delete "${att.file_name}"?`,
      description: "Removes the file from this bid. Use Undo on the toast if you need it back.",
    });
    if (ok) await onDelete(att.id);
  }

  return (
    <div className={compact ? "space-y-2" : "space-y-3"} data-testid="opportunity-files">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Paperclip className={compact ? "h-3.5 w-3.5 text-muted-foreground" : "h-4 w-4 text-muted-foreground"} />
          <span className={compact ? "text-xs font-medium text-muted-foreground uppercase tracking-wider" : "text-sm font-medium text-muted-foreground uppercase tracking-wider"}>
            Documents
          </span>
          {dealScoped.length > 0 && (
            <Badge variant="secondary" className="text-xs px-1.5 py-0">{dealScoped.length}</Badge>
          )}
        </div>
        {canEdit && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1.5"
            onClick={() => setUploadOpen(true)}
            disabled={busy}
            data-testid="attachment-upload-btn"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
            Attach File
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-muted-foreground flex items-center gap-2">
          Deal
          <select
            className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
            value={deal === "all" || deal === "none" ? deal : String(deal)}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "all" || value === "none") setDeal(value);
              else setDeal(Number(value));
            }}
            data-testid="bid-file-deal-filter"
          >
            <option value="all">All files</option>
            <option value="none">Offering only</option>
            {lines.map((line) => (
              <option key={line.id} value={String(line.id)}>
                {line.label}{line.deleted ? " (removed)" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      {categories && (
        <div className="flex flex-wrap gap-1" data-testid="bid-file-categories">
          <CategoryChip active={category === "all"} count={dealScoped.length} onClick={() => setCategory("all")}>
            All
          </CategoryChip>
          {OPP_DOC_CATEGORIES.map((item) => (
            <CategoryChip
              key={item.value}
              active={category === item.value}
              count={counts[item.value]}
              onClick={() => setCategory(item.value)}
            >
              {item.label}
            </CategoryChip>
          ))}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading…
        </div>
      )}
      {!loading && shown.length === 0 && (
        <p className="text-xs text-muted-foreground italic py-1">
          No documents attached.{canEdit ? " Click \"Attach File\" to upload." : ""}
        </p>
      )}
      {shown.length > 0 && (
        <div className="space-y-1.5">
          {shown.map((att) => {
            const pinned = att.opportunity_line_id == null ? undefined : lineById.get(att.opportunity_line_id);
            return (
              <div
                key={att.id}
                className="flex items-center gap-2 rounded-md border border-border/50 bg-card/50 px-3 py-2 group hover:border-border transition-colors"
                data-testid={`attachment-row-${att.id}`}
              >
                {fileIcon(att.mime_type)}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate leading-tight">{att.file_name}</p>
                  <div className="flex flex-wrap items-center gap-1 mt-1">
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{oppDocCategoryLabel(att.doc_category)}</Badge>
                    {att.opportunity_line_id != null && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {dealBadge(pinned, att.opportunity_line_id)}
                      </Badge>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                    {formatBytes(att.file_size)} · {formatAttachmentProvenance(att.source_module, att.uploaded_at)}
                    {att.uploaded_by ? ` · ${att.uploaded_by}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {canEdit && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      title="Change category or deal"
                      onClick={() => setEditing(att)}
                      data-testid={`attachment-edit-${att.id}`}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => {
                      setDownloadingId(att.id);
                      void onDownload(att).finally(() => setDownloadingId(null));
                    }}
                    disabled={downloadingId === att.id}
                    title="Download / view"
                    data-testid={`attachment-download-${att.id}`}
                  >
                    {downloadingId === att.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                  </Button>
                  {canEdit && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 text-destructive hover:text-destructive"
                      onClick={() => void handleDelete(att)}
                      disabled={busy}
                      title="Delete attachment"
                      data-testid={`attachment-delete-${att.id}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <UploadDialog
        open={uploadOpen}
        lines={lines}
        presetLineId={typeof deal === "number" && !lineById.get(deal)?.deleted ? deal : null}
        busy={busy}
        onOpenChange={setUploadOpen}
        onUpload={onUpload}
      />
      <EditDialog
        attachment={editing}
        lines={lines}
        busy={busy}
        onOpenChange={(open) => { if (!open) setEditing(null); }}
        onPatch={async (id, body) => {
          await onPatch(id, body);
          setEditing(null);
        }}
      />
    </div>
  );
}

function CategoryChip({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full px-2 py-1 text-xs border ${active ? "bg-primary text-primary-foreground border-primary" : "bg-muted/40 text-muted-foreground border-transparent"}`}
    >
      {children} <span className="tabular-nums">{count}</span>
    </button>
  );
}

function UploadDialog({
  open,
  lines,
  presetLineId,
  busy,
  onOpenChange,
  onUpload,
}: {
  open: boolean;
  lines: OpportunityFileLine[];
  presetLineId: number | null;
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  onUpload: (files: File[], category: OppDocCategory, line: number | null, notes: string) => Promise<void>;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [category, setCategory] = useState<OppDocCategory>("other");
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [line, setLine] = useState<string>("none");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    setFiles([]);
    setCategory("other");
    setCategoryTouched(false);
    setLine(presetLineId == null ? "none" : String(presetLineId));
    setNotes("");
  }, [open, presetLineId]);

  const liveLines = lines.filter((item) => !item.deleted);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Attach files</DialogTitle>
          <DialogDescription>Same category and deal for every file in this upload. One Undo removes the batch.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Files</span>
            <input
              type="file"
              multiple
              className="block w-full text-xs"
              accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx,.csv,.eml,.msg,.txt"
              data-testid="attachment-file-input"
              onChange={(event) => {
                const next = Array.from(event.target.files ?? []);
                setFiles(next);
                if (!categoryTouched && next[0]) setCategory(suggestCategory(next[0].name));
              }}
            />
          </label>
          {files.length > 0 && (
            <ul className="text-xs text-muted-foreground space-y-0.5">
              {files.map((file) => <li key={`${file.name}-${file.size}`}>{file.name}</li>)}
            </ul>
          )}
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Category</span>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={category}
              data-testid="bid-file-category"
              onChange={(event) => {
                const value = event.target.value;
                if (!isCategory(value)) return;
                setCategoryTouched(true);
                setCategory(value);
              }}
            >
              {OPP_DOC_CATEGORIES.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Attach to</span>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={line}
              data-testid="bid-file-attach-to"
              onChange={(event) => setLine(event.target.value)}
            >
              <option value="none">Whole offering</option>
              {liveLines.map((item) => (
                <option key={item.id} value={String(item.id)}>{item.label}</option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Notes</span>
            <textarea
              className="w-full min-h-[64px] rounded-md border border-input bg-background px-2 py-1 text-sm"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            type="button"
            disabled={busy || files.length === 0}
            data-testid="bid-file-upload-submit"
            onClick={() => {
              const lineId = line === "none" ? null : Number(line);
              void onUpload(files, category, lineId, notes).then(() => onOpenChange(false)).catch(() => undefined);
            }}
          >
            Upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({
  attachment,
  lines,
  busy,
  onOpenChange,
  onPatch,
}: {
  attachment: OpportunityAttachment | null;
  lines: OpportunityFileLine[];
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  onPatch: (id: number, body: { doc_category?: OppDocCategory; opportunity_line_id?: number | null }) => Promise<void>;
}) {
  const [category, setCategory] = useState<OppDocCategory>("other");
  const [line, setLine] = useState("none");

  useEffect(() => {
    if (!attachment) return;
    setCategory(bidFileCategory(attachment));
    setLine(attachment.opportunity_line_id == null ? "none" : String(attachment.opportunity_line_id));
  }, [attachment]);

  const options = lines.filter((item) => !item.deleted || item.id === attachment?.opportunity_line_id);

  return (
    <Dialog open={attachment != null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>File details</DialogTitle>
          <DialogDescription>{attachment?.file_name}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Category</span>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={category}
              data-testid="bid-file-edit-category"
              onChange={(event) => {
                if (isCategory(event.target.value)) setCategory(event.target.value);
              }}
            >
              {OPP_DOC_CATEGORIES.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Attach to</span>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={line}
              data-testid="bid-file-edit-line"
              onChange={(event) => setLine(event.target.value)}
            >
              <option value="none">Whole offering</option>
              {options.map((item) => (
                <option key={item.id} value={String(item.id)}>
                  {item.label}{item.deleted ? " (removed)" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            type="button"
            disabled={busy || attachment == null}
            onClick={() => {
              if (!attachment) return;
              const nextLine = line === "none" ? null : Number(line);
              const body: { doc_category?: OppDocCategory; opportunity_line_id?: number | null } = {};
              if (category !== bidFileCategory(attachment)) body.doc_category = category;
              if (nextLine !== (attachment.opportunity_line_id ?? null)) body.opportunity_line_id = nextLine;
              if (!Object.keys(body).length) {
                onOpenChange(false);
                return;
              }
              void onPatch(attachment.id, body);
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function isCategory(value: string): value is OppDocCategory {
  return OPP_DOC_CATEGORIES.some((item) => item.value === value);
}

export function opportunityFilesQueryKey(entityId: number) {
  return [`/api/attachments/opportunity/${entityId}`];
}

export function OpportunityFilesPanel({
  entityId,
  lines = [],
  lineId,
  categories = true,
  compact = false,
  readOnly = false,
}: {
  entityId: number;
  lines?: OpportunityFileLine[];
  lineId?: number | null;
  categories?: boolean;
  compact?: boolean;
  readOnly?: boolean;
}) {
  const canEdit = useCanEdit() && !readOnly;
  const qc = useQueryClient();
  const { toast } = useToast();
  const qKey = opportunityFilesQueryKey(entityId);
  const query = useQuery<OpportunityAttachment[]>({
    queryKey: qKey,
    queryFn: () => apiRequest("GET", `/api/attachments/opportunity/${entityId}`).then((res) => res.json()),
    enabled: entityId > 0,
  });

  const upload = useMutation({
    mutationFn: async (input: { files: File[]; category: OppDocCategory; line: number | null; notes: string }) => {
      const form = new FormData();
      for (const file of input.files) form.append("files", file);
      form.append("doc_category", input.category);
      if (input.line != null) form.append("opportunity_line_id", String(input.line));
      if (input.notes.trim()) form.append("notes", input.notes.trim());
      const base = (import.meta.env.VITE_API_BASE as string) || "";
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = {};
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      const res = await fetch(`${base}/api/attachments/opportunity/${entityId}`, { method: "POST", headers, body: form });
      const body = await res.json().catch(() => ({ error: "Upload failed" }));
      if (!res.ok) throw new Error(body.error ?? body.message ?? "Upload failed");
      return body;
    },
    onSuccess: (body) => {
      offerUndoToast(body);
      void qc.invalidateQueries({ queryKey: qKey });
    },
    onError: (err: Error) => toast({ title: "Upload failed", description: err.message, variant: "destructive" }),
  });

  const patch = useMutation({
    mutationFn: async (input: { id: number; body: { doc_category?: OppDocCategory; opportunity_line_id?: number | null } }) => {
      const res = await apiRequest("PATCH", `/api/attachments/${input.id}`, input.body);
      return res.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qKey });
    },
    onError: (err: Error) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/attachments/${id}`);
      return res.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qKey });
    },
    onError: (err: Error) => toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });

  return (
    <OpportunityFilesView
      attachments={query.data ?? []}
      lines={lines}
      lineId={lineId}
      categories={categories}
      canEdit={canEdit}
      loading={query.isLoading}
      compact={compact}
      busy={upload.isPending || patch.isPending || remove.isPending}
      onUpload={(files, category, line, notes) => upload.mutateAsync({ files, category, line, notes }).then(() => undefined)}
      onPatch={(id, body) => patch.mutateAsync({ id, body }).then(() => undefined)}
      onDelete={(id) => remove.mutateAsync(id).then(() => undefined)}
      onDownload={async (att) => {
        const res = await apiRequest("GET", `/api/attachments/${att.id}/download`);
        const blob = await res.blob();
        saveAttachmentBlob(att.file_name, blob);
      }}
    />
  );
}
