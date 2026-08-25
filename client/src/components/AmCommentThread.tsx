import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { confirmDelete } from "@/components/ConfirmActionDialog";
import { useToast } from "@/hooks/use-toast";
import { formatCalendarDate } from "@shared/lease-authority";

export type AmComment = {
  id: number;
  rider_id: number;
  author_email: string;
  body: string;
  created_at: string;
};

export type AmNoteSummary = {
  author_email: string;
  created_at: string;
  body: string;
  count: number;
};

export function formatAmNoteSnippet(note: AmNoteSummary | null | undefined, max = 80): string {
  if (!note) return "";
  const author = displayAmAuthor(note.author_email);
  const date = formatCalendarDate(note.created_at);
  const snippet = String(note.body ?? "").replace(/\s+/g, " ").trim();
  const cut = snippet.length > max ? `${snippet.slice(0, max).trim()}…` : snippet;
  const extra = note.count > 1 ? ` (${note.count} notes)` : "";
  return `${author} · ${date} — ${cut}${extra}`;
}

export function displayAmAuthor(email: string): string {
  const t = String(email ?? "").trim();
  if (!t) return "Unknown";
  const local = t.split("@")[0];
  return local || t;
}

function formatAmWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return formatCalendarDate(iso);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function AmCommentThread({
  riderId,
  canCompose,
  canDelete,
  compact,
}: {
  riderId: number;
  canCompose: boolean;
  canDelete: boolean;
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [draft, setDraft] = useState("");
  const qk = ["/api/account-management/riders", riderId, "comments"] as const;
  const { data, isLoading } = useQuery<{ comments: AmComment[] }>({
    queryKey: qk,
    queryFn: () =>
      apiRequest("GET", `/api/account-management/riders/${riderId}/comments`).then((r) => r.json()),
    enabled: Number.isFinite(riderId) && riderId > 0,
  });
  const comments = data?.comments ?? [];

  const post = useMutation({
    mutationFn: (body: string) =>
      apiRequest("POST", `/api/account-management/riders/${riderId}/comments`, { body }),
    onSuccess: () => {
      setDraft("");
      qc.invalidateQueries({ queryKey: qk });
      qc.invalidateQueries({ queryKey: ["/api/accounts"] });
      qc.invalidateQueries({ queryKey: ["/api/railcars"] });
    },
    onError: (e: Error) => toast({ title: "Could not post note", description: e.message, variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/account-management/comments/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk });
      qc.invalidateQueries({ queryKey: ["/api/accounts"] });
      qc.invalidateQueries({ queryKey: ["/api/railcars"] });
    },
    onError: (e: Error) => toast({ title: "Could not delete note", description: e.message, variant: "destructive" }),
  });

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      {canCompose && (
        <div className="space-y-2">
          <Textarea
            rows={2}
            className="text-xs"
            placeholder="Add a note"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <Button
            size="sm"
            disabled={!draft.trim() || post.isPending}
            onClick={() => post.mutate(draft.trim())}
          >
            {post.isPending ? "Posting…" : "Post"}
          </Button>
        </div>
      )}
      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading notes…</p>
      ) : comments.length === 0 ? (
        <p className="text-xs text-muted-foreground">No Account Management notes yet.</p>
      ) : (
        <ul className="space-y-2">
          {comments.map((c) => (
            <li key={c.id} className="rounded-md border border-border/60 bg-muted/10 px-2.5 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="text-[11px] text-muted-foreground">
                  <span className="text-foreground font-medium" title={c.author_email}>
                    {displayAmAuthor(c.author_email)}
                  </span>
                  {" · "}
                  {formatAmWhen(c.created_at)}
                </div>
                {canDelete && (
                  <button
                    type="button"
                    className="text-[10px] uppercase tracking-wide text-muted-foreground hover:text-destructive"
                    disabled={del.isPending}
                    onClick={async () => {
                      const ok = await confirmDelete({
                        title: "Delete this note?",
                        description: `Posted by ${c.author_email} on ${formatAmWhen(c.created_at)}. This cannot be undone.`,
                      });
                      if (ok) del.mutate(c.id);
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
              <p className="text-xs mt-1 whitespace-pre-wrap">{c.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
