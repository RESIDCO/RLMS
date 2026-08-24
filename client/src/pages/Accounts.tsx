import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRoute } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import PageHeader from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import ClearableSearchInput from "@/components/ClearableSearchInput";
import { useToast } from "@/hooks/use-toast";
import { useCanEdit } from "@/lib/AuthContext";
import { Building2, Plus } from "lucide-react";
import { accountPath, programPath } from "@/lib/browse-nav";

type AccountListRow = {
  id: number;
  name: string;
  notes: string | null;
  account_managers: string;
  program_count: number;
};

type AccountDetail = {
  id: number;
  name: string;
  notes: string | null;
  account_managers: string;
  programs: { id: number; name: string; status: string | null; account_manager: string | null }[];
};

export default function AccountsPage() {
  const [match, params] = useRoute("/accounts/:id");
  if (match && params?.id) return <AccountDetailView id={Number(params.id)} />;
  return <AccountListView />;
}

function AccountListView() {
  const { toast } = useToast();
  const canEdit = useCanEdit();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const { data: accounts = [], isLoading } = useQuery<AccountListRow[]>({
    queryKey: ["/api/accounts"],
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter((a) => {
      const blob = `${a.name} ${a.account_managers} ${a.notes ?? ""}`.toLowerCase();
      return blob.includes(q);
    });
  }, [accounts, search]);

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <PageHeader
        title="Account Management"
        subtitle="Customers and prospects — one row per account"
        actions={
          canEdit ? (
            <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="button-new-account">
              <Plus className="h-4 w-4" /> New Account
            </Button>
          ) : undefined
        }
      />
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden px-4 sm:px-8 py-4 gap-3">
        <ClearableSearchInput
          className="relative w-full max-w-sm"
          inputClassName="h-9"
          placeholder="Search accounts…"
          value={search}
          onChange={setSearch}
        />
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <div className="flex-1 min-h-0 overflow-auto rounded-xl border border-card-border bg-card">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left font-medium px-4 py-2">Name</th>
                  <th className="text-left font-medium px-4 py-2">OL account managers</th>
                  <th className="text-left font-medium px-4 py-2 hidden sm:table-cell">Programs</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => (
                  <tr key={a.id} className="border-t border-border hover:bg-muted/20">
                    <td className="px-4 py-2">
                      <Link href={accountPath(a.id)} className="font-medium text-foreground hover:underline">
                        {a.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{a.account_managers || ""}</td>
                    <td className="px-4 py-2 text-muted-foreground hidden sm:table-cell">{a.program_count || ""}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-10 text-center text-muted-foreground">
                      No accounts match.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <NewAccountDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          toast({ title: "Account created" });
        }}
      />
    </div>
  );
}

function AccountDetailView({ id }: { id: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const canEdit = useCanEdit();
  const { data, isLoading } = useQuery<AccountDetail>({
    queryKey: ["/api/accounts", id],
    queryFn: () => apiRequest("GET", `/api/accounts/${id}`).then((r) => r.json()),
  });
  const [name, setName] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const displayName = name ?? data?.name ?? "";
  const displayNotes = notes ?? data?.notes ?? "";

  const save = useMutation({
    mutationFn: () =>
      apiRequest("PATCH", `/api/accounts/${id}`, {
        name: displayName,
        notes: displayNotes,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/accounts"] });
      toast({ title: "Account saved" });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  if (isLoading || !data) {
    return (
      <div className="p-8">
        <Skeleton className="h-32 w-full max-w-xl" />
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <PageHeader
        title={data.name}
        subtitle="Account"
        actions={
          <Link href="/accounts" className="text-sm text-muted-foreground hover:text-foreground">
            All accounts
          </Link>
        }
      />
      <div className="flex-1 min-h-0 overflow-auto px-4 sm:px-8 py-5 space-y-6 max-w-3xl">
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Name</Label>
            <Input value={displayName} readOnly={!canEdit} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Notes</Label>
            <Textarea
              rows={3}
              value={displayNotes}
              readOnly={!canEdit}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          {canEdit && (
            <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          )}
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">OL account managers</div>
          <p className="text-sm">{data.account_managers || ""}</p>
          <p className="text-xs text-muted-foreground mt-1">
            Reporting only — set on each rider in Lease Management.
          </p>
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Linked programs</div>
          {data.programs.length === 0 ? (
            <p className="text-sm text-muted-foreground">None yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {data.programs.map((p) => (
                <li key={p.id}>
                  <Link href={programPath(p.id)} className="hover:underline">
                    {p.name}
                  </Link>
                  {p.account_manager ? (
                    <span className="text-muted-foreground"> · {p.account_manager}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
          Additional account detail — contacts, history, and performance tracking — coming soon.
        </div>
      </div>
    </div>
  );
}

function NewAccountDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");

  const save = useMutation({
    mutationFn: () => apiRequest("POST", "/api/accounts", { name: name.trim(), notes: notes.trim() || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/accounts"] });
      setName("");
      setNotes("");
      onCreated();
    },
    onError: (e: Error) => toast({ title: "Could not create account", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4" /> New Account
          </DialogTitle>
          <DialogDescription>Prospects do not need an OL or MLA yet.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer or prospect name" />
          </div>
          <div>
            <Label className="text-xs">Notes (optional)</Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={!name.trim() || save.isPending}>
              {save.isPending ? "Creating…" : "Create"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
