import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useRoute } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/lib/AuthContext";
import { cn } from "@/lib/utils";
import { formatCalendarDate } from "@shared/lease-authority";
import {
  COMMUNICATION_METHODS,
  COMMUNICATION_METHOD_LABEL,
  isFlaggedTransition,
} from "@shared/account-transitions";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { AccountTransitionDocuments } from "@/components/AccountTransitionDocuments";
import { displayAmAuthor } from "@/components/AmCommentThread";
import { InactiveFleetBadge } from "@/components/InactiveFleetBadge";
import { confirmDelete } from "@/components/ConfirmActionDialog";
import { accountListPath, readAccountMgmtListState } from "@/lib/account-mgmt-nav";

type RecordRow = {
  id: number;
  account_id: number;
  account_name: string;
  from_account_manager: string | null;
  to_account_manager: string | null;
  communication_method: string | null;
  status: "open" | "complete";
  flagged: boolean;
};

type ListPayload = {
  pills: { name: string; count: number }[];
  all_count: number;
  records: RecordRow[];
};

type AccountOpt = { id: number; name: string; account_manager: string | null };

type DetailPayload = {
  record: RecordRow & { completed_at: string | null };
  account: {
    id: number;
    name: string;
    notes: string | null;
    account_manager: string | null;
    ols: {
      id: number;
      rider_name: string;
      schedule_number: string | null;
      lease_number: string | null;
      expiration_date: string | null;
      status_tag: string | null;
      active_car_count: number;
      is_inactive: boolean;
    }[];
    counts: { mlas: number; ols: number; active_cars: number };
  };
  milestones: { id: number; label: string; done: boolean }[];
  comments: { id: number; author_email: string; body: string; created_at: string }[];
};

export default function AccountTransitionsPage() {
  const [match, params] = useRoute("/account-transitions/:id");
  if (match && params?.id) return <TransitionDetail id={Number(params.id)} />;
  return <TransitionList />;
}

function TransitionList() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { canEditAccountTransitions } = usePermissions();
  const qc = useQueryClient();
  const [am, setAm] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [pick, setPick] = useState("");

  const { data, isLoading } = useQuery<ListPayload>({
    queryKey: ["/api/account-transitions", am],
    queryFn: () => {
      const q = am ? `?am=${encodeURIComponent(am)}` : "";
      return apiRequest("GET", `/api/account-transitions${q}`).then((r) => r.json());
    },
  });
  const { data: accounts = [] } = useQuery<AccountOpt[]>({
    queryKey: ["/api/accounts"],
    queryFn: () => apiRequest("GET", "/api/accounts").then((r) => r.json()),
    enabled: addOpen,
  });

  const already = useMemo(() => new Set((data?.records ?? []).map((r) => r.account_id)), [data?.records]);

  const create = useMutation({
    mutationFn: async (account_id: number) => {
      const res = await apiRequest("POST", "/api/account-transitions", { account_id });
      return res.json() as Promise<{ id: number }>;
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["/api/account-transitions"] });
      setAddOpen(false);
      navigate(`/account-transitions/${row.id}`);
    },
    onError: (e: Error) => toast({ title: "Could not add account", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <PageHeader
        title="Account Transitions"
        subtitle="Handoff tracking — does not change Account Manager on the account"
        actions={
          <div className="flex items-center gap-2">
            <Link href={accountListPath(readAccountMgmtListState())} className="text-sm text-muted-foreground hover:text-foreground">
              Back to Account Management
            </Link>
            {canEditAccountTransitions && (
              <Button size="sm" onClick={() => setAddOpen(true)} data-testid="button-add-transition-account">
                <Plus className="h-4 w-4" /> Add Account
              </Button>
            )}
          </div>
        }
      />
      <div className="flex-1 min-h-0 overflow-auto px-4 sm:px-8 py-4 space-y-4">
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground mr-1">AM</span>
          <button
            type="button"
            className={cn(
              "h-7 px-3 rounded-full text-xs border",
              !am ? "bg-primary/15 border-primary/40 text-foreground" : "border-border text-muted-foreground",
            )}
            onClick={() => setAm(null)}
          >
            ALL{data ? ` · ${data.all_count}` : ""}
          </button>
          {(data?.pills ?? []).map((p) => (
            <button
              key={p.name}
              type="button"
              className={cn(
                "h-7 px-3 rounded-full text-xs border",
                am === p.name ? "bg-primary/15 border-primary/40 text-foreground" : "border-border text-muted-foreground",
              )}
              onClick={() => setAm(p.name)}
            >
              {p.name} · {p.count}
            </button>
          ))}
        </div>

        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <div className="rounded-xl border border-card-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left font-medium px-4 py-2">Account</th>
                  <th className="text-left font-medium px-4 py-2">Outgoing</th>
                  <th className="text-left font-medium px-4 py-2">Incoming</th>
                  <th className="text-left font-medium px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {(data?.records ?? []).map((r) => (
                  <tr key={r.id} className="border-t border-border hover:bg-muted/20">
                    <td className="px-4 py-2">
                      <Link href={`/account-transitions/${r.id}`} className="font-medium hover:underline">
                        {r.account_name}
                      </Link>
                      {!r.flagged && (
                        <span className="ml-2 text-[11px] text-muted-foreground">not flagged</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{r.from_account_manager || "—"}</td>
                    <td className="px-4 py-2">{r.to_account_manager || "—"}</td>
                    <td className="px-4 py-2 capitalize">{r.status}</td>
                  </tr>
                ))}
                {(data?.records ?? []).length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                      No transition records yet. Add an account to start a handoff.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Account</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Starts a handoff record. It is flagged into the percent-complete tile only after Incoming AM is set.
          </p>
          <Select value={pick} onValueChange={setPick}>
            <SelectTrigger>
              <SelectValue placeholder="Choose an account" />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={String(a.id)}>
                  {a.name}
                  {already.has(a.id) ? " (already in module)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            disabled={!pick || create.isPending}
            onClick={() => create.mutate(Number(pick))}
          >
            {create.isPending ? "Adding…" : "Add"}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TransitionDetail({ id }: { id: number }) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { canEditAccountTransitions, canDeleteAccountMgmtComments } = usePermissions();
  const canWrite = canEditAccountTransitions;
  const [fromAm, setFromAm] = useState<string | null>(null);
  const [toAm, setToAm] = useState<string | null>(null);
  const [method, setMethod] = useState<string | null>(null);
  const [milestoneDraft, setMilestoneDraft] = useState("");
  const [commentDraft, setCommentDraft] = useState("");

  const { data, isLoading } = useQuery<DetailPayload>({
    queryKey: ["/api/account-transitions", id],
    queryFn: () => apiRequest("GET", `/api/account-transitions/${id}`).then((r) => r.json()),
  });

  const rec = data?.record;
  const displayFrom = fromAm ?? rec?.from_account_manager ?? "";
  const displayTo = toAm ?? rec?.to_account_manager ?? "";
  const displayMethod = method ?? rec?.communication_method ?? "";

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiRequest("PATCH", `/api/account-transitions/${id}`, body).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/account-transitions"] });
      qc.invalidateQueries({ queryKey: ["/api/account-transitions/summary"] });
      toast({ title: "Saved" });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const addMs = useMutation({
    mutationFn: (label: string) => apiRequest("POST", `/api/account-transitions/${id}/milestones`, { label }),
    onSuccess: () => {
      setMilestoneDraft("");
      qc.invalidateQueries({ queryKey: ["/api/account-transitions", id] });
    },
    onError: (e: Error) => toast({ title: "Could not add milestone", description: e.message, variant: "destructive" }),
  });
  const patchMs = useMutation({
    mutationFn: ({ mid, done }: { mid: number; done: boolean }) =>
      apiRequest("PATCH", `/api/account-transitions/${id}/milestones/${mid}`, { done }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/account-transitions", id] }),
  });
  const delMs = useMutation({
    mutationFn: (mid: number) => apiRequest("DELETE", `/api/account-transitions/${id}/milestones/${mid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/account-transitions", id] }),
  });
  const postComment = useMutation({
    mutationFn: (body: string) => apiRequest("POST", `/api/account-transitions/${id}/comments`, { body }),
    onSuccess: () => {
      setCommentDraft("");
      qc.invalidateQueries({ queryKey: ["/api/account-transitions", id] });
    },
    onError: (e: Error) => toast({ title: "Could not post", description: e.message, variant: "destructive" }),
  });
  const delComment = useMutation({
    mutationFn: (cid: number) => apiRequest("DELETE", `/api/account-transitions/${id}/comments/${cid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/account-transitions", id] }),
  });

  if (isLoading || !data) {
    return (
      <div className="p-8">
        <Skeleton className="h-40 w-full max-w-xl" />
      </div>
    );
  }

  const acct = data.account;
  const flagged = isFlaggedTransition(displayTo);

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <PageHeader
        title={acct.name}
        subtitle="Account transition"
        actions={
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            onClick={() => navigate("/account-transitions")}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to transitions
          </button>
        }
      />
      <div className="flex-1 min-h-0 overflow-auto px-4 sm:px-8 py-5 space-y-6 max-w-5xl">
        <p className="text-xs text-muted-foreground">
          {acct.counts.mlas} MLA · {acct.counts.ols} OL · {acct.counts.active_cars} active cars
          {flagged ? "" : " · Set Incoming AM to flag this account in the completion tile."}
          {" "}Completing a handoff never changes the account’s Account Manager field.
        </p>

        <div className="grid sm:grid-cols-2 gap-4 max-w-xl">
          <div>
            <Label className="text-xs">Outgoing AM</Label>
            <Input
              value={displayFrom}
              disabled={!canWrite}
              onChange={(e) => setFromAm(e.target.value)}
              onBlur={() => canWrite && save.mutate({ from_account_manager: displayFrom })}
            />
          </div>
          <div>
            <Label className="text-xs">Incoming AM</Label>
            <Input
              value={displayTo}
              disabled={!canWrite}
              onChange={(e) => setToAm(e.target.value)}
              onBlur={() => canWrite && save.mutate({ to_account_manager: displayTo })}
            />
          </div>
          <div>
            <Label className="text-xs">Communication method</Label>
            <Select
              value={displayMethod || "none"}
              disabled={!canWrite}
              onValueChange={(v) => {
                const next = v === "none" ? null : v;
                setMethod(next);
                save.mutate({ communication_method: next });
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Not set" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not set</SelectItem>
                {COMMUNICATION_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {COMMUNICATION_METHOD_LABEL[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Status</Label>
            <Select
              value={rec.status}
              disabled={!canWrite}
              onValueChange={(v) => save.mutate({ status: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="complete">Complete</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">OLs (read-only)</div>
          <div className="rounded-xl border border-card-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left font-medium px-4 py-2">OL</th>
                  <th className="text-left font-medium px-4 py-2">MLA</th>
                  <th className="text-left font-medium px-4 py-2">Expires</th>
                  <th className="text-right font-medium px-4 py-2">Active cars</th>
                  <th className="text-left font-medium px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {acct.ols.map((ol) => (
                  <tr key={ol.id} className="border-t border-border">
                    <td className="px-4 py-2 font-mono-num">
                      {ol.schedule_number || ol.rider_name}
                      {ol.is_inactive ? (
                        <span className="ml-2">
                          <InactiveFleetBadge active={false} />
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground font-mono-num">{ol.lease_number || ""}</td>
                    <td className="px-4 py-2">{formatCalendarDate(ol.expiration_date)}</td>
                    <td className="px-4 py-2 text-right font-mono-num">{ol.active_car_count}</td>
                    <td className="px-4 py-2 capitalize">{ol.status_tag || "—"}</td>
                  </tr>
                ))}
                {acct.ols.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      No OLs on this account.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {acct.notes ? (
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Account notes</div>
            <p className="text-sm whitespace-pre-wrap">{acct.notes}</p>
          </div>
        ) : null}

        <AccountTransitionDocuments
          accountId={acct.id}
          ols={acct.ols.map((ol) => ({
            id: ol.id,
            label: String(ol.schedule_number || ol.rider_name || `OL ${ol.id}`),
          }))}
          canUpload={canWrite}
        />

        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Milestones</div>
          {(data.milestones ?? []).map((m) => (
            <div key={m.id} className="flex items-center gap-2">
              <Checkbox
                checked={m.done}
                disabled={!canWrite}
                onCheckedChange={(v) => patchMs.mutate({ mid: m.id, done: v === true })}
              />
              <span className={cn("text-sm", m.done && "line-through text-muted-foreground")}>{m.label}</span>
              {canWrite && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  onClick={async () => {
                    const ok = await confirmDelete({ title: `Remove “${m.label}”?` });
                    if (ok) delMs.mutate(m.id);
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          ))}
          {canWrite && (
            <div className="flex gap-2 max-w-md">
              <Input
                value={milestoneDraft}
                onChange={(e) => setMilestoneDraft(e.target.value)}
                placeholder="Add a custom milestone"
              />
              <Button
                size="sm"
                disabled={!milestoneDraft.trim() || addMs.isPending}
                onClick={() => addMs.mutate(milestoneDraft.trim())}
              >
                Add
              </Button>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Comments</div>
          {canWrite && (
            <div className="space-y-2 max-w-xl">
              <Textarea rows={2} className="text-xs" value={commentDraft} onChange={(e) => setCommentDraft(e.target.value)} placeholder="Add a handoff note" />
              <Button
                size="sm"
                disabled={!commentDraft.trim() || postComment.isPending}
                onClick={() => postComment.mutate(commentDraft.trim())}
              >
                Post
              </Button>
            </div>
          )}
          {(data.comments ?? []).map((c) => (
            <div key={c.id} className="rounded-md border border-border px-3 py-2 text-sm max-w-xl">
              <div className="text-[11px] text-muted-foreground">
                {displayAmAuthor(c.author_email)} · {formatCalendarDate(c.created_at)}
              </div>
              <div className="whitespace-pre-wrap mt-1">{c.body}</div>
              {canDeleteAccountMgmtComments && (
                <button
                  type="button"
                  className="text-[11px] text-destructive mt-1"
                  onClick={async () => {
                    const ok = await confirmDelete({ title: "Delete this comment?" });
                    if (ok) delComment.mutate(c.id);
                  }}
                >
                  Delete
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
