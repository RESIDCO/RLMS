import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/queryClient";
import { formatWinRate } from "@shared/crm";

type Summary = {
  offerings_bid: number;
  offerings_passed: number;
  lines_won: number;
  lines_lost: number;
  lines_passed: number;
  win_rate: number | null;
  dollars_bid: number | null;
  dollars_won: number | null;
};

function money(value: number | null): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

export default function BidHistoryCard({ yearDefault }: { yearDefault: number }) {
  const [seller, setSeller] = useState("");
  const [aar, setAar] = useState("");
  const [year, setYear] = useState(String(yearDefault));
  const params = new URLSearchParams();
  if (seller.trim()) params.set("seller", seller.trim());
  if (aar.trim()) params.set("aar", aar.trim());
  if (year.trim()) params.set("year", year.trim());
  const qs = params.toString();
  const summary = useQuery({
    queryKey: ["/api/opportunities/bids/summary", qs],
    queryFn: () => apiGet<Summary>(`/api/opportunities/bids/summary${qs ? `?${qs}` : ""}`),
  });
  const row = summary.data;
  return (
    <section className="border rounded-md p-3 space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <h2 className="text-sm font-semibold mr-2">Bid history</h2>
        <label className="text-xs text-muted-foreground">
          Seller company id
          <input className="mt-1 block h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground" value={seller} onChange={(e) => setSeller(e.target.value)} />
        </label>
        <label className="text-xs text-muted-foreground">
          AAR prefix
          <input className="mt-1 block h-8 w-24 rounded-md border border-input bg-background px-2 text-sm text-foreground" value={aar} onChange={(e) => setAar(e.target.value)} placeholder="C214" />
        </label>
        <label className="text-xs text-muted-foreground">
          Year
          <input className="mt-1 block h-8 w-24 rounded-md border border-input bg-background px-2 text-sm text-foreground" value={year} onChange={(e) => setYear(e.target.value)} />
        </label>
      </div>
      {summary.isLoading ? <p className="text-sm text-muted-foreground">Loading history…</p> : null}
      {summary.isError ? <p className="text-sm text-destructive">Bid history is available to editors and admins.</p> : null}
      {row ? (
        <div className="flex flex-wrap gap-4 text-sm">
          <Stat label="Offerings bid" value={String(row.offerings_bid)} />
          <Stat label="Lines won / lost" value={`${row.lines_won} / ${row.lines_lost}`} />
          <Stat label="Win rate" value={formatWinRate(row.win_rate)} />
          <Stat label="Passed lines" value={String(row.lines_passed)} />
          <Stat label="Passed offerings" value={String(row.offerings_passed)} />
          <Stat label="$ bid" value={money(row.dollars_bid)} />
          <Stat label="$ won" value={money(row.dollars_won)} />
        </div>
      ) : null}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="font-mono-num">{value}</div>
    </div>
  );
}
