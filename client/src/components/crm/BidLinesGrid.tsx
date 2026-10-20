import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Paperclip } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { offerUndoToast } from "@/lib/undo";
import { useToast } from "@/hooks/use-toast";
import { lineBidTotal } from "@shared/crm";

export type BidLine = {
  id?: number;
  seller_deal_ref: string;
  lessee_desc: string | null;
  lessee_rating: string | null;
  lessee_country: string | null;
  aar_code: string | null;
  car_type: string | null;
  equipment_desc: string | null;
  car_count: number;
  avg_build_year: number | null;
  commodity: string | null;
  lease_rate: number | null;
  lease_expiry: string | null;
  purchase_option: boolean | null;
  include_in_bid: boolean;
  exclude_reason: string | null;
  prelim_price_per_car: number | null;
  final_price_per_car: number | null;
  outcome: string | null;
  market_price_per_car: number | null;
  winner_company_id: number | null;
  loss_reason: string | null;
  notes: string | null;
  sort_order: number;
  total?: number | null;
};

type Draft = BidLine & { key: string };

const COLUMNS: Array<{ key: keyof BidLine; label: string; kind: "text" | "number" | "date" | "bool" | "outcome" }> = [
  { key: "seller_deal_ref", label: "Deal #", kind: "text" },
  { key: "lessee_desc", label: "Lessee", kind: "text" },
  { key: "lessee_rating", label: "Rating", kind: "text" },
  { key: "lessee_country", label: "Country", kind: "text" },
  { key: "aar_code", label: "AAR", kind: "text" },
  { key: "car_type", label: "Car type", kind: "text" },
  { key: "car_count", label: "Cars", kind: "number" },
  { key: "avg_build_year", label: "Avg build", kind: "number" },
  { key: "commodity", label: "Commodity", kind: "text" },
  { key: "lease_rate", label: "Lease rate", kind: "number" },
  { key: "lease_expiry", label: "Expiry", kind: "date" },
  { key: "purchase_option", label: "Purchase option", kind: "bool" },
  { key: "include_in_bid", label: "Bid?", kind: "bool" },
  { key: "exclude_reason", label: "Exclude reason", kind: "text" },
  { key: "prelim_price_per_car", label: "Prelim $/car", kind: "number" },
  { key: "final_price_per_car", label: "Final $/car", kind: "number" },
  { key: "outcome", label: "Outcome", kind: "outcome" },
  { key: "market_price_per_car", label: "Winning $/car", kind: "number" },
  { key: "loss_reason", label: "Loss reason", kind: "text" },
];

const PRICE_KEYS = new Set(["prelim_price_per_car", "final_price_per_car", "market_price_per_car"]);

function blankLine(sort: number): Draft {
  return {
    key: `new-${sort}-${Date.now()}`,
    seller_deal_ref: "",
    lessee_desc: null,
    lessee_rating: null,
    lessee_country: null,
    aar_code: null,
    car_type: null,
    equipment_desc: null,
    car_count: 0,
    avg_build_year: null,
    commodity: null,
    lease_rate: null,
    lease_expiry: null,
    purchase_option: null,
    include_in_bid: true,
    exclude_reason: null,
    prelim_price_per_car: null,
    final_price_per_car: null,
    outcome: null,
    market_price_per_car: null,
    winner_company_id: null,
    loss_reason: null,
    notes: null,
    sort_order: sort,
  };
}

function asDraft(line: BidLine, index: number): Draft {
  return { ...line, key: line.id ? `id-${line.id}` : `row-${index}` };
}

export default function BidLinesGrid({
  opportunityId,
  lines,
  canWrite,
  canSeePrices,
  parentIsWon,
  onWonLine,
  fileCounts,
  onOpenFiles,
}: {
  opportunityId: number;
  lines: BidLine[];
  canWrite: boolean;
  canSeePrices: boolean;
  parentIsWon: boolean;
  onWonLine: () => void;
  fileCounts?: Record<number, number>;
  onOpenFiles?: (lineId: number) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Draft[]>(() => lines.map(asDraft));
  const [deleted, setDeleted] = useState<number[]>([]);
  useEffect(() => {
    setDrafts(lines.map(asDraft));
    setDeleted([]);
  }, [lines]);

  const columns = COLUMNS.filter((column) => canSeePrices || !PRICE_KEYS.has(column.key));
  const totals = useMemo(() => {
    const cars = drafts.reduce((sum, line) => sum + (Number(line.car_count) || 0), 0);
    const dollars = drafts.reduce((sum, line) => sum + (lineBidTotal(line) ?? 0), 0);
    const priced = drafts.some((line) => lineBidTotal(line) != null);
    return { cars, dollars: priced ? dollars : null };
  }, [drafts]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        lines: drafts.map((line, index) => ({ ...line, sort_order: index })),
        delete_ids: deleted,
      };
      const res = await apiRequest("POST", `/api/opportunities/${opportunityId}/lines/batch`, payload);
      return res.json();
    },
    onSuccess: (result) => {
      offerUndoToast(result);
      if (!parentIsWon && drafts.some((line) => line.outcome === "won")) onWonLine();
      void qc.invalidateQueries({ queryKey: ["/api/opportunities", opportunityId, "bid"] });
      void qc.invalidateQueries({ queryKey: ["/api/opportunities/bids"] });
    },
    onError: (err: Error) => toast({ title: "Could not save lines", description: err.message, variant: "destructive" }),
  });

  function update(key: string, field: keyof BidLine, value: string) {
    setDrafts((rows) => rows.map((row) => (row.key === key ? { ...row, [field]: coerce(field, value) } : row)));
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {canWrite ? (
          <>
            <Button type="button" size="sm" variant="outline" onClick={() => setDrafts((rows) => [...rows, blankLine(rows.length)])}>Add line</Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={drafts.length === 0}
              onClick={() => {
                const last = drafts[drafts.length - 1];
                if (!last) return;
                setDrafts((rows) => [...rows, { ...last, id: undefined, key: `copy-${Date.now()}`, seller_deal_ref: `${last.seller_deal_ref} copy`, sort_order: rows.length }]);
              }}
            >
              Duplicate line
            </Button>
            <Button type="button" size="sm" disabled={save.isPending} onClick={() => save.mutate()}>Save lines</Button>
          </>
        ) : null}
      </div>
      <div className="border rounded-md overflow-auto">
        <table className="w-full text-xs min-w-[1400px]">
          <thead className="text-muted-foreground border-b">
            <tr>
              {columns.map((column) => <th key={column.key} className="px-2 py-2 text-left font-medium whitespace-nowrap">{column.label}</th>)}
              <th className="px-2 py-2 text-left font-medium">Total</th>
              {canWrite ? <th className="px-2 py-2" /> : null}
            </tr>
          </thead>
          <tbody>
            {drafts.map((line) => (
              <tr key={line.key} className="border-t">
                {columns.map((column) => (
                  <td key={column.key} className="px-1 py-1">
                    <Cell column={column} line={line} disabled={!canWrite} onChange={(value) => update(line.key, column.key, value)} />
                  </td>
                ))}
                <td className="px-2 py-1 font-mono-num whitespace-nowrap">{canSeePrices ? formatTotal(lineBidTotal(line)) : "—"}</td>
                {canWrite ? (
                  <td className="px-1 py-1 whitespace-nowrap">
                    {onOpenFiles && line.id ? (
                      <button
                        type="button"
                        className="text-xs inline-flex items-center gap-1 mr-2 text-muted-foreground hover:text-foreground"
                        onClick={() => onOpenFiles(line.id!)}
                        data-testid={`bid-line-files-${line.id}`}
                      >
                        <Paperclip className="h-3 w-3" />
                        {fileCounts?.[line.id] ?? 0}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="text-xs text-destructive hover:underline"
                      onClick={() => {
                        if (line.id) setDeleted((ids) => [...ids, line.id!]);
                        setDrafts((rows) => rows.filter((row) => row.key !== line.key));
                      }}
                    >
                      Delete
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t font-medium">
              <td className="px-2 py-2" colSpan={Math.max(1, columns.findIndex((column) => column.key === "car_count"))}>Totals</td>
              <td className="px-2 py-2 font-mono-num">{totals.cars.toLocaleString()}</td>
              <td colSpan={columns.length} className="px-2 py-2 font-mono-num">{canSeePrices ? formatTotal(totals.dollars) : ""}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function formatTotal(value: number | null): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function coerce(field: keyof BidLine, value: string): string | number | boolean | null {
  if (field === "include_in_bid" || field === "purchase_option") return value === "true";
  if (field === "car_count" || field === "avg_build_year" || field === "sort_order") {
    if (!value.trim()) return field === "car_count" ? 0 : null;
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  }
  if (field === "lease_rate" || field === "prelim_price_per_car" || field === "final_price_per_car" || field === "market_price_per_car") {
    if (!value.trim()) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (field === "outcome") return value || null;
  return value.trim() ? value : null;
}

function Cell({
  column,
  line,
  disabled,
  onChange,
}: {
  column: { key: keyof BidLine; kind: "text" | "number" | "date" | "bool" | "outcome" };
  line: Draft;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const value = line[column.key];
  if (column.kind === "bool") {
    return (
      <input type="checkbox" checked={value === true} disabled={disabled} onChange={(e) => onChange(e.target.checked ? "true" : "false")} />
    );
  }
  if (column.kind === "outcome") {
    return (
      <select className="h-7 rounded border border-input bg-background px-1" value={value == null ? "" : String(value)} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        <option value="won">Won</option>
        <option value="lost">Lost</option>
        <option value="passed">Passed</option>
        <option value="withdrawn">Withdrawn</option>
      </select>
    );
  }
  const text = value == null ? "" : String(value);
  return (
    <input
      className="h-7 w-full min-w-[72px] rounded border border-input bg-background px-1"
      type={column.kind === "date" ? "date" : column.kind === "number" ? "number" : "text"}
      value={text}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
