import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useCanEdit } from "@/lib/AuthContext";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Paperclip, Upload, Trash2, FileText, FileImage, File, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { confirmDelete } from "@/components/ConfirmActionDialog";

type Doc = {
  id: number;
  file_name: string;
  file_url?: string;
  document_category: string;
  file_size_bytes?: number | null;
  uploaded_at: string;
};

function fmtBytes(n: number | null | undefined) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function ProgramDocsPanel({
  listUrl,
  uploadUrl,
  deleteUrl,
  categories,
  compact,
}: {
  listUrl: string;
  uploadUrl: string;
  deleteUrl: (id: number) => string;
  categories: { value: string; label: string }[];
  compact?: boolean;
}) {
  const canEdit = useCanEdit();
  const qc = useQueryClient();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState(categories[0]?.value ?? "other");

  const { data: docs = [], isLoading } = useQuery<Doc[]>({
    queryKey: [listUrl],
    queryFn: () => apiRequest("GET", listUrl).then((r) => r.json()),
  });

  const uploadMut = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      form.append("document_category", category);
      const RENDER_API = (import.meta.env.VITE_API_BASE as string) || "";
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = {};
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      const res = await fetch(`${RENDER_API}${uploadUrl}`, { method: "POST", headers, body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(err.error ?? "Upload failed");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [listUrl] });
      toast({ title: "Uploaded" });
    },
    onError: (e: Error) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", deleteUrl(id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [listUrl] });
      toast({ title: "Document removed" });
    },
  });

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      {canEdit && (
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {categories.map((c) => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()} disabled={uploadMut.isPending}>
            {uploadMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            Upload
          </Button>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadMut.mutate(f);
              e.target.value = "";
            }}
          />
        </div>
      )}
      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : docs.length === 0 ? (
        <p className="text-xs text-muted-foreground italic flex items-center gap-1.5">
          <Paperclip className="h-3.5 w-3.5" /> No documents yet.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {docs.map((d) => {
            const ext = d.file_name.split(".").pop()?.toLowerCase();
            const icon = ext === "pdf" ? <FileText className="h-4 w-4 text-red-400 shrink-0" /> : ["jpg","jpeg","png","gif","webp"].includes(ext ?? "") ? <FileImage className="h-4 w-4 text-blue-400 shrink-0" /> : <File className="h-4 w-4 text-muted-foreground shrink-0" />;
            return (
              <li key={d.id} className="flex items-center gap-2 rounded-md border border-border/60 px-2.5 py-1.5 text-xs">
                {icon}
                <a href={d.file_url} target="_blank" rel="noreferrer" className="flex-1 min-w-0 truncate hover:underline">
                  {d.file_name}
                </a>
                <span className="text-muted-foreground uppercase tracking-wider">{d.document_category}</span>
                <span className="text-muted-foreground font-mono-num">{fmtBytes(d.file_size_bytes)}</span>
                {canEdit && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    aria-label={`Delete ${d.file_name}`}
                    onClick={async () => {
                      const ok = await confirmDelete({
                        title: `Delete ${d.file_name}?`,
                        description: "This removes the file from this program.",
                      });
                      if (ok) deleteMut.mutate(d.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
