import { useEffect, useMemo, useState } from "react";
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
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { matchesSearchQuery } from "@/lib/search-match";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/lib/AuthContext";
import { cn } from "@/lib/utils";
import { formatCalendarDate } from "@shared/lease-authority";
import {
  COMMUNICATION_METHODS,
  COMMUNICATION_METHOD_LABEL,
  accountHandoffPct,
  displayTransitionAm,
  handoffScoreParts,
  isFlaggedTransition,
  methodListTag,
} from "@shared/account-transitions";
import { ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react";
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
  flagged?: boolean;
  pct_complete?: number;
  meeting_scheduled: boolean;
  meeting_date: string | null;
  communication_completed: boolean;
  communication_completed_date: string | null;
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
  milestones: { id: number; label: string; done: boolean; milestone_date: string | null }[];
  comments: { id: number; author_email: string; body: string; created_at: string }[];
};

type RecordDraft = {
  from_account_manager: string;
  to_account_manager: string;
  communication_method: string | null;
  status: "open" | "complete";
  meeting_scheduled: boolean;
  meeting_date: string;
  communication_completed: boolean;
  communication_completed_date: string;
};

function isoDate(v: string | null | undefined) {
  return v ? String(v).slice(0, 10) : "";
}

function recordToDraft(rec: RecordRow): RecordDraft {
  return {
    from_account_manager: rec.from_account_manager ?? "",
    to_account_manager: rec.to_account_manager ?? "",
    communication_method: rec.communication_method ?? null,
    status: rec.status,
    meeting_scheduled: Boolean(rec.meeting_scheduled),
    meeting_date: isoDate(rec.meeting_date),
    communication_completed: Boolean(rec.communication_completed),
    communication_completed_date: isoDate(rec.communication_completed_date),
  };
}

function displayMeetingDate(v: string | null | undefined) {
  const s = isoDate(v);
  if (!s) return "Not scheduled";
  const label = formatCalendarDate(s);
  return label === "—" ? "Not scheduled" : label;
}

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
  const [acctQ, setAcctQ] = useState("");

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
  const filteredAccounts = useMemo(() => {
    const q = acctQ.trim();
    const list = q ? accounts.filter((a) => matchesSearchQuery([a.name], q)) : accounts;
    return [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }, [accounts, acctQ]);

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
            <table className="w-full table-fixed text-sm">
              <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left font-medium px-2 py-1.5">Account</th>
                  <th className="text-left font-medium px-2 py-1.5 w-[7.5rem]">Method</th>
                  <th className="text-left font-medium px-2 py-1.5 w-[6.75rem]">Outgoing</th>
                  <th className="text-left font-medium px-2 py-1.5 w-[6.75rem]">Incoming</th>
                  <th className="text-left font-medium px-2 py-1.5 w-[6.75rem]">Meeting Date</th>
                  <th className="text-right font-medium px-2 py-1.5 w-12">%</th>
                  <th className="text-left font-medium px-2 py-1.5 w-[5.5rem]">Status</th>
                </tr>
              </thead>
              <tbody>
                {(data?.records ?? []).map((r) => {
                  const tag = methodListTag(r.communication_method);
                  const pct = r.pct_complete ?? accountHandoffPct(r);
                  return (
                  <tr key={r.id} className="border-t border-border hover:brightness-110" style={tag?.rowStyle}>
                    <td className="px-2 py-1.5 min-w-0">
                      <Link
                        href={`/account-transitions/${r.id}`}
                        className="block truncate font-medium hover:underline"
                        title={r.account_name}
                      >
                        {r.account_name}
                      </Link>
                      {!r.flagged && (
                        <span className="text-[10px] text-muted-foreground">not flagged</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      {tag ? (
                        <span className="inline-flex max-w-full truncate rounded border border-border/50 px-1.5 py-0.5 text-[10px] font-medium leading-none">
                          {tag.label}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap truncate" title={displayTransitionAm(r.from_account_manager)}>
                      {displayTransitionAm(r.from_account_manager)}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap truncate" title={displayTransitionAm(r.to_account_manager)}>
                      {displayTransitionAm(r.to_account_manager)}
                    </td>
                    <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap truncate" title={displayMeetingDate(r.meeting_date)}>
                      {displayMeetingDate(r.meeting_date)}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono-num tabular-nums">{pct}%</td>
                    <td className="px-2 py-1.5 capitalize whitespace-nowrap">{r.status}</td>
                  </tr>
                  );
                })}
                {(data?.records ?? []).length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-2 py-10 text-center text-muted-foreground">
                      No transition records yet. Add an account to start a handoff.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) {
            setPick("");
            setAcctQ("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Account</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Starts a handoff record. It is flagged into the percent-complete tile only after Incoming AM is set.
          </p>
          <Command shouldFilter={false} className="rounded-md border border-border">
            <CommandInput
              placeholder="Search accounts…"
              value={acctQ}
              onValueChange={setAcctQ}
              autoFocus
            />
            <CommandList className="max-h-64">
              <CommandEmpty>No accounts match</CommandEmpty>
              <CommandGroup>
                {filteredAccounts.map((a) => (
                  <CommandItem
                    key={a.id}
                    value={`${a.id} ${a.name}`}
                    onSelect={() => setPick(String(a.id))}
                  >
                    <span className={cn("truncate", pick === String(a.id) && "font-medium")}>
                      {a.name}
                      {already.has(a.id) ? " (already in module)" : ""}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
          {pick ? (
            <p className="text-xs text-muted-foreground">
              Selected: {accounts.find((a) => String(a.id) === pick)?.name ?? pick}
            </p>
          ) : null}
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
  const { data, isLoading } = useQuery<DetailPayload>({
    queryKey: ["/api/account-transitions", id],
    queryFn: () => apiRequest("GET", `/api/account-transitions/${id}`).then((r) => r.json()),
  });
  if (isLoading || !data) {
    return (
      <div className="p-8">
        <Skeleton className="h-40 w-full max-w-xl" />
      </div>
    );
  }
  return <TransitionDetailForm key={id} id={id} payload={data} />;
}

function TransitionDetailForm({ id, payload }: { id: number; payload: DetailPayload }) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { canEditAccountTransitions, canDeleteAccountMgmtComments } = usePermissions();
  const canWrite = canEditAccountTransitions;
  const data = payload;
  const [draft, setDraft] = useState(() => recordToDraft(payload.record));
  const [baseline, setBaseline] = useState(() => JSON.stringify(recordToDraft(payload.record)));
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [milestoneDraft, setMilestoneDraft] = useState("");
  const [commentDraft, setCommentDraft] = useState("");
  const dirty = JSON.stringify(draft) !== baseline;

  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);

  function goBack() {
    if (dirty && !window.confirm("You have unsaved changes. Leave anyway?")) return;
    navigate("/account-transitions");
  }

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiRequest("PATCH", `/api/account-transitions/${id}`, body).then((r) => r.json()),
    onSuccess: (row: RecordRow) => {
      const nextDraft = recordToDraft(row);
      setDraft(nextDraft);
      setBaseline(JSON.stringify(nextDraft));
      setSaveError(null);
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 2500);
      qc.setQueryData<DetailPayload>(["/api/account-transitions", id], (old) =>
        old ? { ...old, record: { ...old.record, ...row } } : old,
      );
      qc.setQueriesData<ListPayload>({ queryKey: ["/api/account-transitions"] }, (old) => {
        if (!old || !("records" in old) || !Array.isArray(old.records)) return old;
        return {
          ...old,
          records: old.records.map((r) =>
            r.id === row.id
              ? {
                  ...r,
                  ...row,
                  account_name: r.account_name,
                  flagged: isFlaggedTransition(row.to_account_manager),
                  pct_complete: accountHandoffPct(row),
                }
              : r,
          ),
        };
      });
      qc.invalidateQueries({ queryKey: ["/api/account-transitions/summary"] });
    },
    onError: (e: Error) => {
      setSaveError(e.message || "Save failed");
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    },
  });

  function onSave() {
    setJustSaved(false);
    setSaveError(null);
    save.mutate({
      from_account_manager: draft.from_account_manager,
      to_account_manager: draft.to_account_manager,
      communication_method: draft.communication_method,
      status: draft.status,
      meeting_scheduled: draft.meeting_scheduled,
      meeting_date: draft.meeting_date || null,
      communication_completed: draft.communication_completed,
      communication_completed_date: draft.communication_completed_date || null,
    });
  }

  const addMs = useMutation({
    mutationFn: (label: string) => apiRequest("POST", `/api/account-transitions/${id}/milestones`, { label }),
    onSuccess: () => {
      setMilestoneDraft("");
      qc.invalidateQueries({ queryKey: ["/api/account-transitions", id] });
    },
    onError: (e: Error) => toast({ title: "Could not add milestone", description: e.message, variant: "destructive" }),
  });
  const patchMs = useMutation({
    mutationFn: (payloadMs: { mid: number; done?: boolean; milestone_date?: string | null }) => {
      const body: Record<string, unknown> = {};
      if (payloadMs.done !== undefined) body.done = payloadMs.done;
      if (payloadMs.milestone_date !== undefined) body.milestone_date = payloadMs.milestone_date;
      return apiRequest("PATCH", `/api/account-transitions/${id}/milestones/${payloadMs.mid}`, body);
    },
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

  const acct = data.account;
  const flagged = isFlaggedTransition(draft.to_account_manager);
  const score = handoffScoreParts({
    to_account_manager: draft.to_account_manager,
    meeting_scheduled: draft.meeting_scheduled,
    communication_completed: draft.communication_completed,
  });
  const breakdown = [
    score.incoming ? "Incoming AM set" : "Incoming AM not set",
    score.meeting ? "Meeting scheduled" : "Meeting not yet scheduled",
    score.communication ? "Communication completed" : "Communication not yet completed",
  ].join(" · ");

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <PageHeader
        title={acct.name}
        subtitle="Account transition"
        actions={
          <div className="flex items-center gap-2">
            {canWrite && (
              <Button size="sm" disabled={!dirty || save.isPending} onClick={onSave} data-testid="button-save-transition">
                {save.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  "Save"
                )}
              </Button>
            )}
            {justSaved && !dirty ? <span className="text-xs text-emerald-500">Saved</span> : null}
            <button
              type="button"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
              onClick={goBack}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to transitions
            </button>
          </div>
        }
      />
      <div className="flex-1 min-h-0 overflow-auto px-4 sm:px-8 py-5 space-y-6 max-w-5xl">
        {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}
        <p className="text-xs text-muted-foreground">
          {acct.counts.mlas} MLA · {acct.counts.ols} OL · {acct.counts.active_cars} active cars
          {flagged ? "" : " · Set Incoming AM to flag this account in the completion tile."}
          {" "}Completing a handoff never changes the account’s Account Manager field.
        </p>

        <div className="grid sm:grid-cols-2 gap-4 max-w-xl">
          <div>
            <Label className="text-xs">Outgoing AM</Label>
            <Input
              value={draft.from_account_manager}
              placeholder="Not assigned"
              disabled={!canWrite}
              onChange={(e) => setDraft((d) => ({ ...d, from_account_manager: e.target.value }))}
            />
          </div>
          <div>
            <Label className="text-xs">Incoming AM</Label>
            <Input
              value={draft.to_account_manager}
              placeholder="Not assigned"
              disabled={!canWrite}
              onChange={(e) => setDraft((d) => ({ ...d, to_account_manager: e.target.value }))}
            />
          </div>
          <div>
            <Label className="text-xs">Communication method</Label>
            <Select
              value={draft.communication_method || "none"}
              disabled={!canWrite}
              onValueChange={(v) => setDraft((d) => ({ ...d, communication_method: v === "none" ? null : v }))}
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
              value={draft.status}
              disabled={!canWrite}
              onValueChange={(v) => setDraft((d) => ({ ...d, status: v as "open" | "complete" }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="complete">Complete</SelectItem>
              </SelectContent>
            </Select>
            <div className="mt-2">
              <div className="flex items-center gap-2">
                <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: `${score.pct}%` }} />
                </div>
                <span className="text-sm font-mono-num font-medium w-10 text-right">{score.pct}%</span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">{breakdown}</p>
            </div>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4 max-w-xl">
          <div className="space-y-2">
            <Label className="text-xs">Meeting Scheduled</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Checkbox
                checked={draft.meeting_scheduled}
                disabled={!canWrite}
                onCheckedChange={(v) => setDraft((d) => ({ ...d, meeting_scheduled: v === true }))}
              />
              <Input
                type="date"
                className="h-8 w-[11.5rem] text-xs"
                value={draft.meeting_date}
                disabled={!canWrite}
                onChange={(e) => setDraft((d) => ({ ...d, meeting_date: e.target.value }))}
                aria-label="Date of meeting"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Communication Completed</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Checkbox
                checked={draft.communication_completed}
                disabled={!canWrite}
                onCheckedChange={(v) => setDraft((d) => ({ ...d, communication_completed: v === true }))}
              />
              <Input
                type="date"
                className="h-8 w-[11.5rem] text-xs"
                value={draft.communication_completed_date}
                disabled={!canWrite}
                onChange={(e) => setDraft((d) => ({ ...d, communication_completed_date: e.target.value }))}
                aria-label="Communication completed date"
              />
            </div>
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
          {(data.milestones ?? []).map((m) => {
            const dateIso = m.milestone_date ? String(m.milestone_date).slice(0, 10) : "";
            const dateLabel = dateIso ? formatCalendarDate(dateIso) : "";
            return (
            <div key={m.id} className="flex flex-wrap items-center gap-2">
              <Checkbox
                checked={m.done}
                disabled={!canWrite}
                onCheckedChange={(v) => patchMs.mutate({ mid: m.id, done: v === true })}
              />
              <span className={cn("text-sm", m.done && "text-muted-foreground")}>
                {m.label}
                {dateLabel ? ` — ${dateLabel}` : ""}
                {m.done ? " ✓" : ""}
              </span>
              {canWrite ? (
                <Input
                  type="date"
                  className="h-8 w-[11.5rem] text-xs"
                  value={dateIso}
                  onChange={(e) => patchMs.mutate({ mid: m.id, milestone_date: e.target.value || null })}
                  aria-label={`${m.label} date`}
                />
              ) : null}
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
            );
          })}
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
