import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, File, FileImage, FileText, Loader2, Paperclip, Trash2, Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { confirmDelete } from "@/components/ConfirmActionDialog";
import { formatAttachmentProvenance } from "@shared/attachment-source";

type AttRow = {
  id: number;
  entity_type: string;
  entity_id: number;
  file_name: string;
  file_size: number;
  mime_type: string;
  uploaded_by: string | null;
  uploaded_at: string;
  source_module?: string | null;
  target_label?: string;
};

type OlOpt = { id: number; label: string };

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

export function AccountTransitionDocuments({
  accountId,
  ols,
  canUpload,
}: {
  accountId: number;
  ols: OlOpt[];
  canUpload: boolean;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState("account");
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const qKey = ["/api/account-management/accounts", accountId, "attachments"] as const;

  const { data, isLoading } = useQuery<{ attachments: AttRow[] }>({
    queryKey: qKey,
    queryFn: () =>
      apiRequest("GET", `/api/account-management/accounts/${accountId}/attachments`).then((r) => r.json()),
    enabled: accountId > 0,
  });
  const attachments = data?.attachments ?? [];

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      if (target === "account") {
        form.append("entity_type", "account");
      } else {
        form.append("entity_type", "rider");
        form.append("entity_id", target);
      }
      const RENDER_API = (import.meta.env.VITE_API_BASE as string) || "";
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const headers: Record<string, string> = {};
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      const res = await fetch(`${RENDER_API}/api/account-management/accounts/${accountId}/attachments`, {
        method: "POST",
        headers,
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(err.error ?? err.message ?? "Upload failed");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qKey });
      toast({ title: "File uploaded", description: "Tagged as Account Transitions." });
    },
    onError: (err: Error) => {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/attachments/${id}`).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qKey });
      toast({ title: "Attachment deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    },
  });

  async function handleDownload(att: AttRow) {
    setDownloadingId(att.id);
    try {
      const res = await apiRequest("GET", `/api/attachments/${att.id}/download`);
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const isPdf = att.file_name.toLowerCase().endsWith(".pdf");
      if (isPdf) {
        window.open(blobUrl, "_blank", "noopener,noreferrer");
      } else {
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = att.file_name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    } catch {
      toast({ title: "Download failed", description: "Could not download file.", variant: "destructive" });
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <div className="rounded-xl border border-card-border bg-card p-4 space-y-3" data-testid="account-transition-documents">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Paperclip className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Documents</span>
          {attachments.length > 0 && (
            <Badge variant="secondary" className="text-xs px-1.5 py-0">
              {attachments.length}
            </Badge>
          )}
        </div>
        {canUpload && (
          <div className="flex flex-wrap items-center gap-2">
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger className="h-7 w-44 text-xs">
                <SelectValue placeholder="Attach to" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="account">This account</SelectItem>
                {ols.map((ol) => (
                  <SelectItem key={ol.id} value={String(ol.id)}>
                    {ol.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) uploadMutation.mutate(file);
              }}
              data-testid="account-transition-file-input"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1.5"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadMutation.isPending}
              data-testid="account-transition-upload-btn"
            >
              {uploadMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
              {uploadMutation.isPending ? "Uploading…" : "Attach document"}
            </Button>
          </div>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Files added here are permanently tagged Account Transitions, with the upload date, so they will not be
        mistaken for lease documents attached later on an OL.
      </p>
      {isLoading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading…
        </div>
      )}
      {!isLoading && attachments.length === 0 && (
        <p className="text-xs text-muted-foreground italic">No documents on this account or its OLs yet.</p>
      )}
      {attachments.length > 0 && (
        <div className="space-y-1.5">
          {attachments.map((att) => (
            <div
              key={att.id}
              className="flex items-center gap-2 rounded-md border border-border/50 bg-background/40 px-3 py-2"
            >
              {fileIcon(att.mime_type)}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate leading-tight">{att.file_name}</p>
                <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                  {att.target_label ? `${att.target_label} · ` : ""}
                  {formatBytes(att.file_size)} · {formatAttachmentProvenance(att.source_module, att.uploaded_at)}
                  {att.uploaded_by ? ` · ${att.uploaded_by}` : ""}
                </p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                onClick={() => handleDownload(att)}
                disabled={downloadingId === att.id}
                title="Download / view"
              >
                {downloadingId === att.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
              </Button>
              {canUpload && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 text-destructive hover:text-destructive"
                  onClick={async () => {
                    const ok = await confirmDelete({
                      title: `Delete "${att.file_name}"?`,
                      description: "This permanently removes the file from storage.",
                    });
                    if (ok) deleteMutation.mutate(att.id);
                  }}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
