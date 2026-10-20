import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { GridColumnTh } from "@/components/GridColumnTh";
import { useToast } from "@/hooks/use-toast";
import { useStoredGridLayout } from "@/hooks/use-stored-grid-layout";
import { cellTooltip } from "@/lib/grid-column-layout";
import { apiUpload, downloadXlsx } from "@/lib/queryClient";
import { offerUndoToast } from "@/lib/undo";
import { BID_IMPORT_COLUMNS } from "@/components/crm/bid-grid-columns";
import {
  replaceNeedsConfirm,
  type BidColumnMapping,
  type BidHeaderFields,
  type CellConfidence,
  type ImportFlag,
  type MappedColumn,
  type ProposedLine,
} from "@shared/bid-import";

type SheetInfo = { name: string; matches: number };

type ParseBody = {
  proposal: {
    lines: ProposedLine[];
    header_fields: BidHeaderFields;
    mapping: BidColumnMapping;
    flags: ImportFlag[];
    columns: MappedColumn[];
    price_columns: { index: number; header: string }[];
    stated_car_total: number | null;
    car_total: number;
    sheet: string;
  };
  sheets: SheetInfo[];
  token: string;
};

const HEADER_FIELDS: { key: keyof BidHeaderFields; label: string }[] = [
  { key: "offering_name", label: "Offering name" },
  { key: "title", label: "Title" },
  { key: "seller", label: "Seller" },
  { key: "received_date", label: "Received" },
  { key: "bid_due_prelim", label: "Preliminary deadline" },
  { key: "bid_due_final", label: "Final deadline" },
  { key: "award_date", label: "Award" },
];

export default function BidImportDialog({
  opportunityId,
  existingLines,
}: {
  opportunityId: number;
  existingLines: { prelim_price_per_car: number | null; final_price_per_car: number | null; market_price_per_car: number | null; outcome: string | null }[];
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParseBody | null>(null);
  const [lines, setLines] = useState<ProposedLine[]>([]);
  const [header, setHeader] = useState<BidHeaderFields | null>(null);
  const [mode, setMode] = useState<"append" | "replace">("append");
  const [replaceConfirm, setReplaceConfirm] = useState(false);
  const [remember, setRemember] = useState(false);
  const [acked, setAcked] = useState<Set<string>>(new Set());
  const grid = useStoredGridLayout("bid-import-preview", BID_IMPORT_COLUMNS);
  const needsConfirm = replaceNeedsConfirm(existingLines);
  const tableWidth = grid.columns.reduce((sum, column) => sum + grid.widthOf(column.key), 0);
  const carTotal = lines.reduce((sum, line) => sum + (Number(line.car_count) || 0), 0);
  const flags = useMemo(() => {
    const base = parsed?.proposal.flags ?? [];
    const stated = parsed?.proposal.stated_car_total;
    if (stated == null || stated === carTotal) return base.filter((flag) => flag.id !== "car_total");
    const next = base.filter((flag) => flag.id !== "car_total");
    next.unshift({
      id: "car_total",
      severity: "block",
      message: `Car total ${carTotal.toLocaleString()} does not match the stated total ${stated.toLocaleString()}`,
    });
    return next;
  }, [parsed, carTotal]);
  const blocked = flags.filter((flag) => flag.severity === "block" && !acked.has(flag.id));

  const parse = useMutation({
    mutationFn: async (input: { file: File; sheet?: string }) => {
      const form = new FormData();
      form.set("file", input.file);
      if (input.sheet) form.set("sheet", input.sheet);
      const res = await apiUpload(`/api/crm/opportunities/${opportunityId}/bid-import/parse`, form);
      return res.json() as Promise<ParseBody>;
    },
    onSuccess: (body) => {
      setParsed(body);
      setLines(body.proposal.lines);
      setHeader(body.proposal.header_fields);
      setAcked(new Set());
      setReplaceConfirm(false);
    },
    onError: (err: Error) => toast({ title: "Could not read that bid sheet", description: err.message, variant: "destructive" }),
  });

  const commit = useMutation({
    mutationFn: async () => {
      if (!file || !parsed) throw new Error("Parse a bid sheet first");
      const form = new FormData();
      form.set("file", file);
      form.set("token", parsed.token);
      form.set("lines", JSON.stringify(lines));
      form.set("header_fields", JSON.stringify(header ?? {}));
      form.set("mapping", JSON.stringify(parsed.proposal.mapping));
      form.set("mode", mode);
      form.set("replace_confirm", replaceConfirm ? "true" : "false");
      form.set("remember_mapping", remember ? "true" : "false");
      form.set("acknowledge", JSON.stringify(Array.from(acked)));
      const res = await apiUpload(`/api/crm/opportunities/${opportunityId}/bid-import/commit`, form);
      return res.json();
    },
    onSuccess: (result) => {
      offerUndoToast(result);
      if (remember && result && typeof result === "object" && (result as { mapping_saved?: boolean }).mapping_saved === false) {
        toast({ title: "Lines imported", description: "The column mapping was not saved." });
      }
      void qc.invalidateQueries({ queryKey: ["/api/opportunities", opportunityId, "bid"] });
      void qc.invalidateQueries({ queryKey: ["/api/opportunities/bids"] });
      setOpen(false);
    },
    onError: (err: Error) => toast({ title: "Import failed", description: err.message, variant: "destructive" }),
  });

  function updateLine(index: number, key: string, value: string) {
    setLines((rows) => rows.map((row, rowIndex) => {
      if (rowIndex !== index) return row;
      const next = { ...row, confidence: { ...row.confidence }, sources: { ...row.sources } };
      delete next.confidence[key];
      delete next.sources[key];
      if (key === "car_count" || key === "avg_build_year") {
        const n = Number(value);
        if (key === "car_count") next.car_count = Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
        else next.avg_build_year = value.trim() && Number.isFinite(n) ? Math.trunc(n) : null;
      } else if (key === "lease_rate") {
        const n = Number(value);
        next.lease_rate = value.trim() && Number.isFinite(n) ? n : null;
      } else if (key === "purchase_option") {
        next.purchase_option = value === "" ? null : value === "true";
      } else if (key === "seller_deal_ref") {
        next.seller_deal_ref = value;
      } else {
        const text = value.trim() ? value : null;
        Object.assign(next, { [key]: text });
      }
      return next;
    }));
  }

  return (
    <>
      <Button type="button" size="sm" variant="outline" title="Read an Excel or CSV bid sheet into this offering" onClick={() => setOpen(true)}>
        Import from bid sheet
      </Button>
      <button
        type="button"
        className="text-sm text-primary hover:underline"
        title="Download a blank workbook that re-imports with high confidence"
        onClick={() => {
          downloadXlsx("/api/crm/bid-import/template.xlsx", "bid-sheet-template.xlsx").catch((err: Error) => {
            toast({ title: "Could not download the template", description: err.message, variant: "destructive" });
          });
        }}
      >
        Download Excel template
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Import from bid sheet</DialogTitle>
            <DialogDescription>Preview the lines, edit anything that looks wrong, then confirm. Prices are not imported.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label title="xlsx or csv, up to 20 MB" className="block">
              <span className="text-sm">Bid sheet</span>
              <input
                className="mt-1 block w-full text-sm"
                type="file"
                accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                title="Drop or choose an .xlsx or .csv file"
                onChange={(event) => {
                  const next = event.target.files?.[0] ?? null;
                  setFile(next);
                  setParsed(null);
                  setLines([]);
                  if (next) parse.mutate({ file: next });
                }}
              />
            </Label>
            {parsed ? (
              <>
                <label className="block text-sm" title="Which worksheet to read">
                  Sheet
                  <select
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2"
                    value={parsed.proposal.sheet}
                    onChange={(event) => {
                      if (file) parse.mutate({ file, sheet: event.target.value });
                    }}
                  >
                    {parsed.sheets.map((sheet) => (
                      <option key={sheet.name} value={sheet.name}>{sheet.name} ({sheet.matches} headers)</option>
                    ))}
                  </select>
                </label>
                <div className="text-xs text-muted-foreground" title="How each column was matched">
                  {parsed.proposal.columns.filter((column) => column.field).map((column) => `${column.header} → ${column.field} (${column.confidence})`).join(" · ") || "No columns mapped"}
                  {parsed.proposal.price_columns.length ? ` · Price column detected (${parsed.proposal.price_columns.map((column) => column.header).join(", ")}), not imported` : ""}
                </div>
                <div className="grid sm:grid-cols-3 gap-2">
                  {HEADER_FIELDS.map((field) => (
                    <label key={field.key} className="text-xs" title={field.label}>
                      {field.label}
                      <input
                        className="mt-1 h-8 w-full rounded border border-input bg-background px-1"
                        value={header?.[field.key] ?? ""}
                        onChange={(event) => setHeader((current) => ({ ...(current ?? emptyHeader()), [field.key]: event.target.value || null }))}
                      />
                    </label>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span title={`${lines.length} lines, ${carTotal.toLocaleString()} cars`}>{lines.length} lines · {carTotal.toLocaleString()} cars</span>
                  <Button type="button" size="sm" variant="ghost" title="Restore the default preview column order and widths" onClick={grid.reset}>Reset columns</Button>
                </div>
                {flags.length ? (
                  <ul className="space-y-1 text-sm">
                    {flags.map((flag) => (
                      <li key={flag.id} className="flex items-start gap-2">
                        {flag.severity === "block" ? (
                          <Checkbox
                            checked={acked.has(flag.id)}
                            title="Acknowledge this before confirming"
                            onCheckedChange={(checked) => {
                              setAcked((current) => {
                                const next = new Set(current);
                                if (checked === true) next.add(flag.id);
                                else next.delete(flag.id);
                                return next;
                              });
                            }}
                          />
                        ) : <span className="mt-1 h-2 w-2 rounded-full bg-amber-500" title="Warning" />}
                        <span>{flag.message}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="border rounded-md overflow-auto max-h-[420px]">
                  <table className="text-xs" style={{ tableLayout: "fixed", width: Math.max(640, tableWidth) }} data-testid="bid-import-preview">
                    <colgroup>
                      {grid.columns.map((column) => <col key={column.key} style={{ width: grid.widthOf(column.key) }} />)}
                    </colgroup>
                    <thead className="text-muted-foreground border-b">
                      <tr>
                        {grid.columns.map((column) => (
                          <GridColumnTh
                            key={column.key}
                            colKey={column.key}
                            width={grid.widthOf(column.key)}
                            minWidth={column.minWidth}
                            className="px-2 py-2 text-left font-medium bg-background"
                            onResize={grid.onResize}
                            onMove={grid.onMove}
                            isolateResizeDrag
                          >
                            <span title={column.label}>{column.label}</span>
                          </GridColumnTh>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line, index) => (
                        <tr key={`${line.sort_order}-${index}`} className="border-t align-top">
                          {grid.columns.map((column) => {
                            const raw = (line as unknown as Record<string, unknown>)[column.key];
                            const text = raw == null ? "" : String(raw);
                            const confidence = line.confidence[column.key] as CellConfidence | undefined;
                            const source = line.sources[column.key];
                            return (
                              <td key={column.key} className="px-1 py-1 align-top">
                                <div className="flex items-start gap-1">
                                  {confidence ? <ConfidenceDot level={confidence} source={source} /> : null}
                                  <PreviewCell
                                    wrap={column.wrap === true}
                                    kind={column.key === "purchase_option" ? "bool" : column.key === "car_count" || column.key === "avg_build_year" || column.key === "lease_rate" ? "number" : column.key === "lease_expiry" ? "date" : "text"}
                                    label={column.label}
                                    value={column.key === "purchase_option" ? (line.purchase_option == null ? "" : line.purchase_option ? "true" : "false") : text}
                                    onChange={(value) => updateLine(index, column.key, value)}
                                  />
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap gap-4 text-sm">
                  <label className="inline-flex items-center gap-2" title="Add these lines after the ones already saved">
                    <input type="radio" name="bid-import-mode" checked={mode === "append"} onChange={() => setMode("append")} />
                    Append
                  </label>
                  <label className="inline-flex items-center gap-2" title="Replace the current lines with this sheet">
                    <input type="radio" name="bid-import-mode" checked={mode === "replace"} onChange={() => setMode("replace")} />
                    Replace
                  </label>
                  {mode === "replace" && needsConfirm ? (
                    <label className="inline-flex items-center gap-2" title="A saved line already has a price or an outcome">
                      <Checkbox checked={replaceConfirm} onCheckedChange={(checked) => setReplaceConfirm(checked === true)} />
                      Replace lines that already have a price or outcome
                    </label>
                  ) : null}
                  <label className="inline-flex items-center gap-2" title="Reuse this column mapping the next time this seller's sheet has the same headers">
                    <Checkbox checked={remember} onCheckedChange={(checked) => setRemember(checked === true)} />
                    Remember for this seller
                  </label>
                </div>
              </>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              title="Write the preview lines onto this offering"
              disabled={!parsed || parse.isPending || commit.isPending || blocked.length > 0 || (mode === "replace" && needsConfirm && !replaceConfirm) || lines.length === 0}
              onClick={() => commit.mutate()}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function emptyHeader(): BidHeaderFields {
  return {
    offering_name: null,
    seller: null,
    received_date: null,
    bid_due_prelim: null,
    bid_due_final: null,
    award_date: null,
    title: null,
  };
}

function ConfidenceDot({ level, source }: { level: CellConfidence; source?: string }) {
  const color = level === "high" ? "bg-emerald-500" : level === "medium" ? "bg-amber-500" : "bg-rose-500";
  const tip = source ? `${level} confidence from ${source}` : `${level} confidence`;
  return <span className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${color}`} title={tip} />;
}

function PreviewCell({
  wrap,
  kind,
  label,
  value,
  onChange,
}: {
  wrap: boolean;
  kind: "text" | "number" | "date" | "bool";
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  if (kind === "bool") {
    return (
      <select className="h-7 w-full rounded border border-input bg-background px-1" title={label} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">—</option>
        <option value="true">Y</option>
        <option value="false">N</option>
      </select>
    );
  }
  const tip = cellTooltip(value);
  if (wrap) {
    const field = (
      <textarea
        title={tip}
        rows={Math.min(6, Math.max(2, Math.ceil(value.length / 42)))}
        className="w-full min-h-7 resize-y whitespace-pre-wrap break-words rounded border border-input bg-background px-1 py-0.5 leading-snug"
        value={value}
        onChange={(event) => onChange(event.target.value)}
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
      title={tip ?? label}
      type={kind === "date" ? "date" : kind === "number" ? "number" : "text"}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
