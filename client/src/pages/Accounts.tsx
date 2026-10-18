import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import PageHeader from "@/components/PageHeader";
import ClearableSearchInput from "@/components/ClearableSearchInput";
import QuickProspectForm from "@/components/crm/QuickProspectForm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth, useCanEdit } from "@/lib/AuthContext";
import { apiGet } from "@/lib/queryClient";
import {
  accountDetailPath,
  readAccountBookState,
  readMeInitials,
  replaceAccountBookState,
  writeMeInitials,
  type AccountBookListState,
  type BookChip,
  type BookSegment,
} from "@/lib/account-mgmt-nav";
import { cn } from "@/lib/utils";
import {
  rentRollLabel,
  tierLabel,
  touchStatusClass,
  TIER_LABEL,
  TIER_VALUES,
  type AccountBookResponse,
  type AccountBookRow,
  type TouchStatus,
} from "@shared/account-mgmt";

type OwnerOption = { initials: string; full_name: string; sort_order: number };

const CHIPS: { id: BookChip; label: string }[] = [
  { id: "renewals", label: "Renewals ≤ 6 mo" },
  { id: "overdue", label: "Touch overdue" },
  { id: "never", label: "Never touched (tiered)" },
  { id: "handoffs", label: "Handoffs to me" },
  { id: "unowned", label: "Unowned clients" },
  { id: "untiered", label: "No tier" },
];

function money(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "—";
  return Number(value).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function chipCount(data: AccountBookResponse | undefined, chip: BookChip): number {
  if (!data) return 0;
  switch (chip) {
    case "renewals":
      return data.attention.renewals_6mo;
    case "overdue":
      return data.attention.touch_overdue;
    case "never":
      return data.attention.never_touched_tiered;
    case "handoffs":
      return data.attention.handoffs_incoming;
    case "unowned":
      return data.attention.unowned_clients.length;
    case "untiered":
      return data.attention.untiered;
    default: {
      const neverChip: never = chip;
      return neverChip;
    }
  }
}

function rowMatchesChip(row: AccountBookRow, chip: BookChip, me: string): boolean {
  switch (chip) {
    case "renewals":
      return row.renewal_riders_6mo > 0;
    case "overdue":
      return row.touch_status === "overdue";
    case "never":
      return row.touch_status === "never";
    case "handoffs":
      return Boolean(me) && row.incoming_owner === me;
    case "unowned":
      return row.effective_owner == null && row.kind === "client";
    case "untiered":
      return row.touch_status === "untiered";
    default: {
      const neverChip: never = chip;
      return neverChip;
    }
  }
}

function statusLabel(status: TouchStatus): string {
  switch (status) {
    case "overdue":
      return "Overdue";
    case "due_soon":
      return "Due soon";
    case "ok":
      return "On track";
    case "never":
      return "Never touched";
    case "untiered":
      return "No tier";
    default: {
      const neverStatus: never = status;
      return neverStatus;
    }
  }
}

export default function AccountsPage() {
  const canEdit = useCanEdit();
  const { role } = useAuth();
  const [, navigate] = useLocation();
  const initial = readAccountBookState();
  const [segment, setSegment] = useState<BookSegment>(initial.segment);
  const [owner, setOwner] = useState(initial.owner);
  const [tier, setTier] = useState(initial.tier);
  const [q, setQ] = useState(initial.q);
  const [chip, setChip] = useState<BookChip | null>(initial.chip);
  const [me, setMe] = useState(readMeInitials);
  const [prospectOpen, setProspectOpen] = useState(false);

  const state: AccountBookListState = { segment, owner, tier, q, chip };
  useEffect(() => {
    replaceAccountBookState(state);
  }, [segment, owner, tier, q, chip]);

  const queryOwner = chip === "unowned" ? "unowned" : segment === "mybook" ? me || "any" : owner;
  const querySegment = chip === "unowned" ? "client" : segment === "mybook" ? "mybook" : segment;
  const book = useQuery({
    queryKey: ["/api/accounts/book", querySegment, queryOwner, tier, q],
    queryFn: () => {
      const p = new URLSearchParams();
      p.set("segment", querySegment);
      p.set("owner", queryOwner || "any");
      if (tier && tier !== "any") p.set("tier", tier);
      if (q.trim()) p.set("q", q.trim());
      return apiGet<AccountBookResponse>(`/api/accounts/book?${p.toString()}`);
    },
    enabled: segment !== "mybook" || Boolean(me) || chip === "unowned",
  });
  const owners = useQuery({
    queryKey: ["/api/account-owners"],
    queryFn: () => apiGet<OwnerOption[]>("/api/account-owners"),
  });

  const rows = useMemo(() => {
    const list = book.data?.rows ?? [];
    if (!chip || chip === "unowned") return list;
    return list.filter((row) => rowMatchesChip(row, chip, me));
  }, [book.data?.rows, chip, me]);

  const snapshot = book.data?.rows.find((row) => row.rent_roll?.snapshot_month)?.rent_roll?.snapshot_month ?? null;
  const rentHint = rentRollLabel(snapshot);

  function chooseMe(value: string) {
    setMe(value);
    writeMeInitials(value);
  }

  function toggleChip(next: BookChip) {
    setChip((current) => (current === next ? null : next));
  }

  function exportCsv() {
    const headers = ["Account", "Owner", "Tier", "On-rent cars", "Rent/mo", "Next expiry", "Open opps", "Last touch", "Next touch due"];
    const lines = rows.map((row) => [
      row.name,
      row.incoming_owner ? `${row.owner_of_record ?? "—"} → ${row.incoming_owner}` : row.effective_owner ?? "",
      tierLabel(row.tier),
      row.on_rent_cars,
      canEdit && row.rent_roll ? row.rent_roll.total : "",
      row.next_expiry ?? "",
      row.open_opps,
      row.last_touch_at?.slice(0, 10) ?? "",
      row.next_touch_due ?? "",
    ]);
    const csv = [headers, ...lines]
      .map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "my-book.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const counts = book.data?.counts;

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <PageHeader
        title="My Book"
        subtitle="Clients, former clients, and prospects. Lease Management keeps the official owner."
        actions={
          <div className="flex flex-wrap gap-2">
            {canEdit ? (
              <Button size="sm" onClick={() => setProspectOpen(true)}>+ Prospect</Button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline">More</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => navigate("/account-transitions")}>Handoffs</DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate("/territory-map")}>Territory map</DropdownMenuItem>
                <DropdownMenuItem onClick={exportCsv}>Export CSV</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />
      <div className="flex-1 min-h-0 overflow-auto px-4 sm:px-8 py-4 space-y-4">
        <div className="flex flex-wrap gap-2 items-center">
          {(
            [
              ["mybook", "My Book"],
              ["client", `Clients${counts ? ` (${counts.client})` : ""}`],
              ["former", `Former${counts ? ` (${counts.former})` : ""}`],
              ["prospect", `Prospects${counts ? ` (${counts.prospect})` : ""}`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSegment(id)}
              className={cn(
                "h-8 px-3 rounded-full text-xs border",
                segment === id ? "bg-primary/15 border-primary/40 text-foreground" : "border-border text-muted-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <label className="text-xs text-muted-foreground">
            I am
            <select
              className="ml-2 h-8 rounded-md border border-input bg-background px-2 text-sm"
              value={me}
              onChange={(e) => chooseMe(e.target.value)}
            >
              <option value="">Choose initials</option>
              {(owners.data ?? []).map((row) => (
                <option key={row.initials} value={row.initials}>{row.initials} · {row.full_name}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted-foreground">
            Owner
            <select
              className="ml-2 h-8 rounded-md border border-input bg-background px-2 text-sm"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
            >
              <option value="any">Anyone</option>
              <option value="unowned">Unowned</option>
              {(owners.data ?? []).map((row) => (
                <option key={row.initials} value={row.initials}>{row.initials}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted-foreground">
            Tier
            <select
              className="ml-2 h-8 rounded-md border border-input bg-background px-2 text-sm"
              value={tier}
              onChange={(e) => setTier(e.target.value)}
            >
              <option value="any">Any tier</option>
              <option value="none">No tier</option>
              {TIER_VALUES.map((value) => (
                <option key={value} value={value}>{TIER_LABEL[value]}</option>
              ))}
            </select>
          </label>
          <ClearableSearchInput
            className="relative w-full max-w-sm"
            inputClassName="h-8"
            placeholder="Search accounts…"
            value={q}
            onChange={setQ}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {CHIPS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => toggleChip(item.id)}
              className={cn(
                "h-7 px-3 rounded-full text-xs border",
                chip === item.id ? "bg-amber-500/15 border-amber-500/40" : "border-border text-muted-foreground",
              )}
            >
              {item.label} · {chipCount(book.data, item.id)}
            </button>
          ))}
        </div>

        {segment === "mybook" && !me && chip !== "unowned" ? (
          <p className="text-sm text-muted-foreground">Choose “I am” to open My Book. Nothing is saved to the database.</p>
        ) : book.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : book.isError ? (
          <p className="text-sm text-destructive">{book.error instanceof Error ? book.error.message : "Could not load My Book"}</p>
        ) : (
          <div className="rounded-xl border border-card-border bg-card overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  {["Account", "Owner", "Tier", "On-rent cars", ...(canEdit ? ["Rent/mo"] : []), "Next expiry", "Open opps", "Last touch", "Next touch due"].map((label) => (
                    <th key={label} className="text-left font-medium px-3 py-2">
                      {label === "Rent/mo" ? (
                        <Tooltip>
                          <TooltipTrigger asChild><span>{label}</span></TooltipTrigger>
                          <TooltipContent>{rentHint}</TooltipContent>
                        </Tooltip>
                      ) : label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.account_id} className="border-t border-border">
                    <td className="px-3 py-2">
                      <Link href={accountDetailPath(row.account_id, state)} className="font-medium hover:underline">{row.name}</Link>
                    </td>
                    <td className="px-3 py-2">
                      {row.incoming_owner ? (
                        <span title={row.handoff_pct == null ? "Open handoff" : `Handoff ${row.handoff_pct}%`}>
                          {row.owner_of_record || "—"} → {row.incoming_owner}
                        </span>
                      ) : (
                        row.effective_owner || "—"
                      )}
                    </td>
                    <td className="px-3 py-2">{tierLabel(row.tier)}</td>
                    <td className="px-3 py-2 font-mono-num">{row.on_rent_cars}</td>
                    {canEdit ? (
                      <td className="px-3 py-2 font-mono-num">
                        {row.rent_roll ? money(row.rent_roll.total) : "—"}
                        {row.rent_roll && row.rent_roll.riders_without_summary > 0 ? (
                          <span title={`${row.rent_roll.riders_without_summary} OLs not in import`}> †</span>
                        ) : null}
                      </td>
                    ) : null}
                    <td className="px-3 py-2 font-mono-num">{row.next_expiry ?? "—"}</td>
                    <td className="px-3 py-2 font-mono-num">{row.open_opps}</td>
                    <td className="px-3 py-2 font-mono-num">{row.last_touch_at?.slice(0, 10) ?? "—"}</td>
                    <td className={cn("px-3 py-2 font-mono-num", touchStatusClass(row.touch_status))} title={statusLabel(row.touch_status)}>
                      {row.next_touch_due ?? statusLabel(row.touch_status)}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={canEdit ? 9 : 8} className="px-3 py-8 text-center text-muted-foreground">No accounts match.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
        {role ? null : <p className="text-xs text-muted-foreground">Sign in to work this book.</p>}
      </div>
      <Dialog open={prospectOpen} onOpenChange={setProspectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New prospect</DialogTitle>
          </DialogHeader>
          <QuickProspectForm
            initialName={q}
            onCancel={() => setProspectOpen(false)}
            onCreated={(created) => {
              setProspectOpen(false);
              navigate(`/accounts/${created.account_id}`);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
