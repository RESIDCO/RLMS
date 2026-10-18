import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiGet, downloadXlsx } from "@/lib/queryClient";
import { PasteSearchBar } from "@/pages/railcars/PasteSearchBar";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";

type LesseeRow = {
  master_lease_id: number;
  lessee: string;
  account_manager: string | null;
  ol_count: number;
  ea_count: number;
  cars: number;
  on_rent: number;
  off_rent: number;
  monthly_rent: number;
  next_expiration: string | null;
  cars_expiring_6mo: number;
  cars_expiring_12mo: number;
  issues: number;
};

type ListResp = {
  rows: LesseeRow[];
  total: number;
  page: number;
  pageSize: number;
  kpis: {
    cars: number;
    on_rent: number;
    off_rent: number;
    monthly_rent: number;
    expiring_6: number;
    expiring_12: number;
    issues: number;
  };
};

function usd(n: number) {
  return Number(n || 0).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function issueLabel(kind: string) {
  switch (kind) {
    case "ea_on_rent": return "EA-on-rent cars";
    case "unlinked": return "Active cars with no OL link";
    case "lessee_mismatch": return "Car lessee ≠ rider lessee";
    case "duplicates": return "Duplicate lessee name candidates";
    case "nonstandard": return "Non-standard codes (incl. FL)";
    case "past_exp": return "Past-expiration OLs with on-rent cars";
    case "rent_mismatch": return "Rent mismatch, car vs rider";
    case "placeholders": return "Placeholder lessees still holding cars";
    default: return kind;
  }
}

export default function LeaseMgmtHome() {
  const [, setLocation] = useLocation();
  const [tab, setTab] = useState<"lessees" | "issues">("lessees");
  const [q, setQ] = useState("");
  const [am, setAm] = useState("all");
  const [expiring, setExpiring] = useState("");
  const [hasEa, setHasEa] = useState(false);
  const [hasIssues, setHasIssues] = useState(false);
  const [page, setPage] = useState(1);
  const [pasteQ, setPasteQ] = useState<string | null>(null);
  const pageSize = 50;

  const search = pasteQ || q;
  const qs = new URLSearchParams();
  if (search) qs.set("q", search);
  if (am !== "all") qs.set("am", am);
  if (expiring) qs.set("expiring", expiring);
  if (hasEa) qs.set("has_ea", "1");
  if (hasIssues) qs.set("has_issues", "1");
  qs.set("page", String(page));
  qs.set("pageSize", String(pageSize));

  const { data, isLoading, isError, error, refetch } = useQuery<ListResp>({
    queryKey: ["/api/lease-mgmt/lessees", qs.toString()],
    queryFn: () => apiGet<ListResp>(`/api/lease-mgmt/lessees?${qs}`),
    placeholderData: keepPreviousData,
  });
  const { data: ams } = useQuery<string[]>({
    queryKey: ["/api/lease-mgmt/am-options"],
    queryFn: () => apiGet("/api/lease-mgmt/am-options"),
  });
  const { data: issues } = useQuery<Record<string, { count: number; rows: any[] }>>({
    queryKey: ["/api/lease-mgmt/issues"],
    queryFn: () => apiGet("/api/lease-mgmt/issues"),
    enabled: tab === "issues",
  });

  const kpis = data?.kpis;
  const rows = data?.rows ?? [];
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));

  const kpiTiles = useMemo(() => ([
    { id: "cars", label: "Cars", value: kpis?.cars ?? 0, onClick: () => { setHasIssues(false); setExpiring(""); setTab("lessees"); } },
    { id: "on_rent", label: "On rent", value: kpis?.on_rent ?? 0, onClick: () => { setHasIssues(false); setHasEa(false); setTab("lessees"); } },
    { id: "off_rent", label: "Off rent", value: kpis?.off_rent ?? 0, onClick: () => { setTab("lessees"); } },
    { id: "rent", label: "Monthly rent", value: usd(kpis?.monthly_rent ?? 0), onClick: () => { setTab("lessees"); } },
    { id: "e6", label: "Expiring 6 mo", value: kpis?.expiring_6 ?? 0, onClick: () => { setExpiring("6"); setHasIssues(false); setPage(1); setTab("lessees"); } },
    { id: "e12", label: "Expiring 12 mo", value: kpis?.expiring_12 ?? 0, onClick: () => { setExpiring("12"); setHasIssues(false); setPage(1); setTab("lessees"); } },
    { id: "issues", label: "Data issues", value: kpis?.issues ?? 0, onClick: () => { setTab("issues"); setHasIssues(true); } },
  ]), [kpis]);

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <PageHeader
        title="Lease Management"
        subtitle="Lessee → OL/EA → cars. Lessees with no assigned cars are hidden by default."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" asChild>
              <Link href="/lease-wizard">New lessee</Link>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link href="/leases-legacy">Legacy view</Link>
            </Button>
            <Button size="sm" variant="outline" onClick={() => downloadXlsx("/api/lease-mgmt/lessees/export", "RLMS_Lessees.xlsx")}>
              <Download className="h-4 w-4" /> Export
            </Button>
          </div>
        }
      />
      <div className="px-4 sm:px-8 py-4 flex-1 min-h-0 flex flex-col gap-4 overflow-hidden">
        {isError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-red-400">
            Couldn't load lessees — {(error as Error)?.message || "request failed"}.{" "}
            <button type="button" className="underline text-foreground" onClick={() => refetch()}>
              Retry
            </button>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {kpiTiles.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={t.onClick}
              className="rounded-md border border-border bg-card px-3 py-2 text-left min-w-[120px]"
            >
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{t.label}</div>
              <div className="font-mono-num text-sm font-semibold">{typeof t.value === "number" ? t.value.toLocaleString() : t.value}</div>
            </button>
          ))}
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "lessees" | "issues")} className="flex-1 min-h-0 flex flex-col">
          <TabsList>
            <TabsTrigger value="lessees">Lessees</TabsTrigger>
            <TabsTrigger value="issues">Data issues</TabsTrigger>
          </TabsList>
          <TabsContent value="lessees" className="mt-3 flex-1 min-h-0 flex flex-col gap-3">
            <PasteSearchBar
              unmatched={[]}
              matchedCount={pasteQ ? (data?.total ?? 0) : null}
              onClear={() => { setPasteQ(null); setPage(1); }}
              onMatch={(tokens) => { setPasteQ(tokens.join("\n")); setQ(""); setPage(1); }}
            />
            <div className="flex flex-wrap gap-2 items-center">
              <Input
                className="max-w-sm"
                placeholder="Search lessee, OL/EA, or car…"
                value={q}
                onChange={(e) => { setQ(e.target.value); setPasteQ(null); setPage(1); }}
              />
              <Select value={am} onValueChange={(v) => { setAm(v); setPage(1); }}>
                <SelectTrigger className="w-[140px]"><SelectValue placeholder="AM" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All AMs</SelectItem>
                  {(ams ?? []).map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={expiring || "all"} onValueChange={(v) => { setExpiring(v === "all" ? "" : v); setPage(1); }}>
                <SelectTrigger className="w-[160px]"><SelectValue placeholder="Expiring" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any expiration</SelectItem>
                  <SelectItem value="6">Expiring ≤6 mo</SelectItem>
                  <SelectItem value="12">Expiring ≤12 mo</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" variant={hasEa ? "default" : "outline"} onClick={() => { setHasEa((v) => !v); setPage(1); }}>Has EA</Button>
              <Button size="sm" variant={hasIssues ? "default" : "outline"} onClick={() => { setHasIssues((v) => !v); setPage(1); }}>Has issues</Button>
            </div>
            <div className="flex-1 min-h-0 overflow-auto border rounded-md">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card border-b">
                  <tr className="text-left text-xs text-muted-foreground">
                    {["Lessee","AM","OLs","EAs","Cars","On rent","Off rent","Monthly rent","Next exp.","Exp ≤6/≤12","Issues"].map((h) => (
                      <th key={h} className="px-3 py-2 font-medium whitespace-nowrap sticky top-0 bg-card">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {isError ? (
                    <tr><td className="px-3 py-6 text-red-400" colSpan={11}>Couldn't load lessees. See the error above.</td></tr>
                  ) : isLoading && !rows.length ? (
                    <tr><td className="px-3 py-6 text-muted-foreground" colSpan={11}>Loading…</td></tr>
                  ) : rows.map((r) => (
                    <tr key={r.master_lease_id} className="border-b hover:bg-muted/40">
                      <td className="px-3 py-2">
                        <button className="text-left hover:underline" onClick={() => setLocation(`/leases/lessee/${r.master_lease_id}`)}>{r.lessee}</button>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{r.account_manager ?? "—"}</td>
                      <td className="px-3 py-2 font-mono-num">{r.ol_count}</td>
                      <td className="px-3 py-2 font-mono-num">{r.ea_count}</td>
                      <td className="px-3 py-2 font-mono-num">{r.cars.toLocaleString()}</td>
                      <td className="px-3 py-2 font-mono-num">{r.on_rent.toLocaleString()}</td>
                      <td className="px-3 py-2 font-mono-num">{r.off_rent.toLocaleString()}</td>
                      <td className="px-3 py-2 font-mono-num">{usd(r.monthly_rent)}</td>
                      <td className="px-3 py-2 font-mono-num">{r.next_expiration ?? "—"}</td>
                      <td className="px-3 py-2 font-mono-num">{r.cars_expiring_6mo}/{r.cars_expiring_12mo}</td>
                      <td className="px-3 py-2 font-mono-num">{r.issues || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-2 items-center text-xs text-muted-foreground">
              <span>{(data?.total ?? 0).toLocaleString()} lessees · page {page} of {totalPages}</span>
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
              <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
            </div>
          </TabsContent>
          <TabsContent value="issues" className="mt-3 flex-1 min-h-0 overflow-auto">
            <div className="space-y-6">
              {Object.entries(issues ?? {}).filter(([k]) => k !== "duplicate_rows").map(([kind, pack]) => (
                <div key={kind} className="border rounded-md">
                  <div className="flex flex-wrap gap-2 items-center justify-between px-3 py-2 border-b bg-muted/30">
                    <div className="text-sm font-medium">{issueLabel(kind)} · {pack.count.toLocaleString()}{kind === "duplicates" ? ` groups / ${(issues as any).duplicate_rows ?? pack.rows.length} rows` : ""}</div>
                    <Button size="sm" variant="outline" onClick={() => downloadXlsx(`/api/lease-mgmt/issues/${kind}.csv`, `${kind}.csv`)}>
                      <Download className="h-4 w-4" /> CSV
                    </Button>
                  </div>
                  <div className="max-h-64 overflow-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-muted-foreground">
                          {pack.rows[0] ? Object.keys(pack.rows[0]).slice(0, 8).map((h) => <th key={h} className="px-2 py-1">{h}</th>) : <th className="px-2 py-1">None</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {pack.rows.slice(0, 40).map((row, i) => (
                          <tr key={i} className="border-t">
                            {Object.keys(pack.rows[0] ?? {}).slice(0, 8).map((h) => (
                              <td key={h} className={cn("px-2 py-1", h.includes("lessee") ? "" : "font-mono-num")}>{String(row[h] ?? "")}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {pack.rows.length > 40 ? <div className="px-2 py-2 text-muted-foreground">Showing 40 of {pack.rows.length}. Export CSV for the full list.</div> : null}
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
