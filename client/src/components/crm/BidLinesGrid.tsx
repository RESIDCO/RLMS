import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { GridColumnTh } from "@/components/GridColumnTh";
import { Paperclip } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { offerUndoToast } from "@/lib/undo";
import { useToast } from "@/hooks/use-toast";
import { useStoredGridLayout } from "@/hooks/use-stored-grid-layout";
import { cellTooltip } from "@/lib/grid-column-layout";
import { lineBidTotal } from "@shared/crm";
import { BID_LINE_COLUMNS, BID_LINE_PRICE_KEYS } from "@/components/crm/bid-grid-columns";

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

type LineColumn = {
  key: keyof BidLine;
  label: string;
  kind: "text" | "number" | "date" | "bool" | "outcome";
  wrap?: boolean;
};

const DATA_KIND: Record<string, LineColumn["kind"]> = {
  seller_deal_ref: "text",
  lessee_desc: "text",
  lessee_rating: "text",
  lessee_country: "text",
  aar_code: "text",
  car_type: "text",
  equipment_desc: "text",
  car_count: "number",
  avg_build_year: "number",
  commodity: "text",
  lease_rate: "number",
  lease_expiry: "date",
  purchase_option: "bool",
  include_in_bid: "bool",
  exclude_reason: "text",
  prelim_price_per_car: "number",
  final_price_per_car: "number",
  outcome: "outcome",
  market_price_per_car: "number",
  loss_reason: "text",
  notes: "text",
};

const PRICE_KEYS = new Set<string>(BID_LINE_PRICE_KEYS);

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
  calcByLine,
  onPriceLine,
}: {
  opportunityId: number;
  lines: BidLine[];
  canWrite: boolean;
  canSeePrices: boolean;
  parentIsWon: boolean;
  onWonLine: () => void;
  fileCounts?: Record<number, number>;
  onOpenFiles?: (lineId: number) => void;
  calcByLine?: Record<number, { verdict: string | null; bid: number | null }>;
  onPriceLine?: (lineId: number) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Draft[]>(() => lines.map(asDraft));
  const [deleted, setDeleted] = useState<number[]>([]);
  const hidden = useMemo(() => {
    const next = new Set<string>();
    if (!canSeePrices) {
      PRICE_KEYS.forEach((key) => next.add(key));
      next.add("_calc");
    }
    if (!canWrite) next.add("_actions");
    return next;
  }, [canSeePrices, canWrite]);
  const grid = useStoredGridLayout("bid-lines", BID_LINE_COLUMNS, hidden);
  useEffect(() => {
    setDrafts(lines.map(asDraft));
    setDeleted([]);
  }, [lines]);

  const totals = useMemo(() => {
    const cars = drafts.reduce((sum, line) => sum + (Number(line.car_count) || 0), 0);
    const dollars = drafts.reduce((sum, line) => sum + (lineBidTotal(line) ?? 0), 0);
    const priced = drafts.some((line) => lineBidTotal(line) != null);
    return { cars, dollars: priced ? dollars : null };
  }, [drafts]);
  const tableWidth = grid.columns.reduce((sum, column) => sum + grid.widthOf(column.key), 0);

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
            <Button type="button" size="sm" variant="outline" title="Add a blank deal line" onClick={() => setDrafts((rows) => [...rows, blankLine(rows.length)])}>Add line</Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              title="Copy the last line into a new row"
              disabled={drafts.length === 0}
              onClick={() => {
                const last = drafts[drafts.length - 1];
                if (!last) return;
                setDrafts((rows) => [...rows, { ...last, id: undefined, key: `copy-${Date.now()}`, seller_deal_ref: `${last.seller_deal_ref} copy`, sort_order: rows.length }]);
              }}
            >
              Duplicate line
            </Button>
            <Button type="button" size="sm" title="Save deal lines" disabled={save.isPending} onClick={() => save.mutate()}>Save lines</Button>
          </>
        ) : null}
        <Button type="button" size="sm" variant="ghost" title="Restore the default column order and widths for this grid" onClick={grid.reset}>
          Reset columns
        </Button>
      </div>
      <div className="border rounded-md overflow-auto">
        <table className="text-xs" style={{ tableLayout: "fixed", width: Math.max(480, tableWidth) }} data-testid="bid-lines-grid">
          <colgroup>
            {grid.columns.map((column) => (
              <col key={column.key} style={{ width: grid.widthOf(column.key) }} />
            ))}
          </colgroup>
          <thead className="text-muted-foreground border-b">
            <tr>
              {grid.columns.map((column) => (
                <GridColumnTh
                  key={column.key}
                  colKey={column.key}
                  width={grid.widthOf(column.key)}
                  minWidth={column.minWidth}
                  pinned={column.pinned}
                  className="px-2 py-2 text-left font-medium bg-background"
                  onResize={grid.onResize}
                  onMove={column.pinned ? undefined : grid.onMove}
                >
                  <span title={column.label || undefined}>{column.label}</span>
                </GridColumnTh>
              ))}
            </tr>
          </thead>
          <tbody>
            {drafts.map((line) => (
              <tr key={line.key} className="border-t align-top">
                {grid.columns.map((column) => {
                  if (column.key === "_total") {
                    return (
                      <td key={column.key} className="px-2 py-1 font-mono-num whitespace-normal break-words" title={canSeePrices ? formatTotal(lineBidTotal(line)) : undefined}>
                        {canSeePrices ? formatTotal(lineBidTotal(line)) : "—"}
                      </td>
                    );
                  }
                  if (column.key === "_calc") {
                    const calc = line.id ? calcByLine?.[line.id] : undefined;
                    const text = calc ? `${calc.verdict ?? "—"} · ${formatTotal(calc.bid)}` : "—";
                    return (
                      <td key={column.key} className="px-2 py-1 whitespace-normal break-words" data-testid={line.id ? `bid-line-calc-${line.id}` : undefined} title={text}>
                        {text}
                      </td>
                    );
                  }
                  if (column.key === "_actions") {
                    return (
                      <td key={column.key} className="px-1 py-1 whitespace-normal">
                        {onOpenFiles && line.id ? (
                          <button
                            type="button"
                            className="text-xs inline-flex items-center gap-1 mr-2 text-muted-foreground hover:text-foreground"
                            title="Files on this deal"
                            onClick={() => onOpenFiles(line.id!)}
                            data-testid={`bid-line-files-${line.id}`}
                          >
                            <Paperclip className="h-3 w-3" />
                            {fileCounts?.[line.id] ?? 0}
                          </button>
                        ) : null}
                        {onPriceLine && line.id ? (
                          <button
                            type="button"
                            className="text-xs mr-2 hover:underline"
                            title="Open the calculator for this line"
                            onClick={() => onPriceLine(line.id!)}
                            data-testid={`bid-line-price-${line.id}`}
                          >
                            Price this line
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="text-xs text-destructive hover:underline"
                          title="Remove this line"
                          onClick={() => {
                            if (line.id) setDeleted((ids) => [...ids, line.id!]);
                            setDrafts((rows) => rows.filter((row) => row.key !== line.key));
                          }}
                        >
                          Delete
                        </button>
                      </td>
                    );
                  }
                  const kind = DATA_KIND[column.key];
                  if (!kind) return <td key={column.key} />;
                  const dataColumn: LineColumn = { key: column.key as keyof BidLine, label: column.label, kind, wrap: column.wrap };
                  return (
                    <td key={column.key} className="px-1 py-1 align-top whitespace-normal">
                      <Cell column={dataColumn} line={line} disabled={!canWrite} onChange={(value) => update(line.key, dataColumn.key, value)} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t font-medium">
              {grid.columns.map((column, index) => {
                if (column.key === "car_count") {
                  return <td key={column.key} className="px-2 py-2 font-mono-num">{totals.cars.toLocaleString()}</td>;
                }
                if (column.key === "_total") {
                  return <td key={column.key} className="px-2 py-2 font-mono-num">{canSeePrices ? formatTotal(totals.dollars) : ""}</td>;
                }
                if (index === 0) return <td key={column.key} className="px-2 py-2">Totals</td>;
                return <td key={column.key} />;
              })}
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
  column: LineColumn;
  line: Draft;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const value = line[column.key];
  if (column.kind === "bool") {
    return (
      <input
        type="checkbox"
        title={column.label}
        checked={value === true}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked ? "true" : "false")}
      />
    );
  }
  if (column.kind === "outcome") {
    return (
      <select
        className="h-7 w-full rounded border border-input bg-background px-1"
        title={column.label}
        value={value == null ? "" : String(value)}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">—</option>
        <option value="won">Won</option>
        <option value="lost">Lost</option>
        <option value="passed">Passed</option>
        <option value="withdrawn">Withdrawn</option>
      </select>
    );
  }
  const text = value == null ? "" : String(value);
  const tip = cellTooltip(text);
  if (column.wrap) {
    if (disabled) {
      const shown = <div title={tip} className="whitespace-pre-wrap break-words px-1 py-0.5 min-h-7">{text || "—"}</div>;
      if (!tip) return shown;
      return (
        <Tooltip>
          <TooltipTrigger asChild>{shown}</TooltipTrigger>
          <TooltipContent className="max-w-sm whitespace-pre-wrap break-words">{tip}</TooltipContent>
        </Tooltip>
      );
    }
    const field = (
      <textarea
        title={tip}
        rows={Math.min(6, Math.max(2, Math.ceil(text.length / 42)))}
        className="w-full min-h-7 resize-y whitespace-pre-wrap break-words rounded border border-input bg-background px-1 py-0.5 leading-snug"
        value={text}
        onChange={(e) => onChange(e.target.value)}
      />
    );
    if (!tip) return field;
    return (
      <Tooltip>
        <TooltipTrigger asChild>{field}</TooltipTrigger>
        <TooltipContent className="max-w-sm whitespace-pre-wrap break-words">{tip}</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <input
      className="h-7 w-full rounded border border-input bg-background px-1"
      title={tip ?? column.label}
      type={column.kind === "date" ? "date" : column.kind === "number" ? "number" : "text"}
      value={text}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
