import { useRef, useState } from "react";
import { Link } from "wouter";
import { useCanEdit } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  Info,
  Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { FLEET_STATUSES, type FleetStatus } from "@shared/fleet-status";
import { todayIsoDateOnly } from "@shared/lease-authority";
import {
  ACQUISITION_TEMPLATE_HEADERS,
  parseAcquisitionPrice,
} from "@shared/acquisition-import";

type AcqSkipped = {
  row: number;
  marks: string;
  car_number: string;
  skip_reason: string;
  skip_label: string;
};

type AcqReview = {
  total: number;
  new_count: number;
  skipped_exists: number;
  skipped_invalid: number;
  skipped: AcqSkipped[];
};

type AcqCommit = {
  inserted: number;
  skipped_exists: number;
  skipped_invalid: number;
  batch: {
    id: number;
    label: string;
    acquisition_date: string;
    entity: string;
    car_count: number;
  } | null;
};

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map((line) => {
    const values: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') inQ = !inQ;
      else if (ch === "," && !inQ) {
        values.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    values.push(cur.trim());
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = (values[i] ?? "").replace(/^"|"$/g, "");
    });
    return obj;
  });
}

declare const XLSX: any;

async function loadXLSX(): Promise<void> {
  if (typeof XLSX !== "undefined") return;
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    s.onload = () => resolve();
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function parseXLSX(file: File): Promise<Record<string, string>[]> {
  await loadXLSX();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: "" }) as Record<string, string>[];
}

function downloadTemplate() {
  const csv = ACQUISITION_TEMPLATE_HEADERS.join(",") + "\n";
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "new-acquisitions-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function downloadSkipped(skipped: AcqSkipped[]) {
  const header = "Row,Marks,Car Number,Reason";
  const body = skipped
    .map((s) =>
      [s.row, s.marks, s.car_number, `"${String(s.skip_label ?? s.skip_reason).replace(/"/g, '""')}"`].join(","),
    )
    .join("\n");
  const blob = new Blob([`${header}\n${body}\n`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "new-acquisitions-skipped.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function StatChip({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color?: "emerald" | "yellow" | "amber" | "red";
}) {
  const COLOR_CLS: Record<string, string> = {
    emerald: "border-umler-teal/20 bg-umler-teal/10 text-umler-teal",
    yellow: "border-umler-amber/20 bg-umler-amber/10 text-umler-amber",
    amber: "border-umler-amber/20 bg-umler-amber/10 text-umler-amber",
    red: "border-umler-signal/20 bg-umler-signal/10 text-umler-signal",
  };
  const colorCls = (color && COLOR_CLS[color]) || "border-border bg-card text-muted-foreground";
  return (
    <div className={cn("flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium", colorCls)}>
      {icon}
      <span className="tabular-nums font-semibold">{value}</span>
      <span className="text-[11px] opacity-80">{label}</span>
    </div>
  );
}

export default function AcquisitionImportSection() {
  const canEdit = useCanEdit();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([]);
  const [loading, setLoading] = useState(false);
  const [review, setReview] = useState<AcqReview | null>(null);
  const [committed, setCommitted] = useState<AcqCommit | null>(null);
  const [showSkipped, setShowSkipped] = useState(false);

  const [label, setLabel] = useState("");
  const [acquisitionDate, setAcquisitionDate] = useState(todayIsoDateOnly);
  const [entity, setEntity] = useState<"Main" | "RPS" | "Coal">("Main");
  const [defaultPrice, setDefaultPrice] = useState("");
  const [rentalStatus, setRentalStatus] = useState<FleetStatus>("Idle");

  function resetFile() {
    setFileName(null);
    setRawRows([]);
    setReview(null);
    setShowSkipped(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleFile(file: File) {
    setLoading(true);
    setReview(null);
    setCommitted(null);
    try {
      const rows = file.name.toLowerCase().endsWith(".csv")
        ? parseCSV(await file.text())
        : await parseXLSX(file);
      if (!rows.length) {
        toast({ title: "No data rows found", variant: "destructive" });
        return;
      }
      setFileName(file.name);
      setRawRows(rows);
      const res = await apiRequest("POST", "/api/import/acquisitions/preview", { rows });
      const json = (await res.json()) as AcqReview;
      setReview(json);
    } catch (e: any) {
      toast({ title: "Could not preview file", description: e.message, variant: "destructive" });
      resetFile();
    } finally {
      setLoading(false);
    }
  }

  async function handleCommit() {
    if (!review || review.new_count === 0) return;
    if (!label.trim()) {
      toast({ title: "Batch label is required", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/import/acquisitions/commit", {
        rows: rawRows,
        label: label.trim(),
        acquisition_date: acquisitionDate,
        entity,
        default_purchase_price: parseAcquisitionPrice(defaultPrice),
        default_rental_status: rentalStatus,
      });
      const json = (await res.json()) as AcqCommit;
      setCommitted(json);
      setReview(null);
      queryClient.invalidateQueries({ queryKey: ["/api/railcars"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/acquisition-batches"] });
    } catch (e: any) {
      toast({ title: "Import failed", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  if (committed) {
    return (
      <section className="rounded-xl border border-card-border bg-card shadow-card p-5" data-testid="section-acquisition-import">
        <div className="rounded-lg border border-umler-teal/30 bg-umler-teal/10 p-6" data-testid="acq-commit-report">
          <CheckCircle2 className="h-8 w-8 text-emerald-400 mb-3" />
          <div className="text-lg font-semibold text-foreground">
            {committed.inserted.toLocaleString()} new car{committed.inserted === 1 ? "" : "s"} loaded
            {committed.batch?.label ? ` into batch “${committed.batch.label}”` : ""}
          </div>
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
            <div>
              Inserted: <span className="font-mono-num">{committed.inserted}</span>
            </div>
            <div>
              Already existed: <span className="font-mono-num">{committed.skipped_exists}</span>
            </div>
            <div>
              Invalid / in-file dupes: <span className="font-mono-num">{committed.skipped_invalid}</span>
            </div>
          </div>
          <div className="text-xs text-muted-foreground mt-3">
            Existing cars were not updated. Financials (NBV, OEC, rent, depreciation) were not written.
          </div>
          <div className="flex flex-wrap gap-2 mt-4">
            {committed.batch?.id && committed.inserted > 0 && (
              <Button asChild>
                <Link href={`/railcars?batch=${committed.batch.id}`}>
                  View these {committed.inserted.toLocaleString()} cars
                </Link>
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => {
                setCommitted(null);
                resetFile();
              }}
            >
              Import another acquisition batch
            </Button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-card-border bg-card shadow-card p-5" data-testid="section-acquisition-import">
      <header className="mb-4">
        <h2 className="text-base font-semibold">New Acquisitions (Small-Batch Onboarding)</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Inserts brand-new cars only — never matches or updates an existing car. Use this to get a freshly-purchased
          batch into the Fleet Registry fast; fill in lessee, rider, and financials later as that data becomes available.
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
        <div className="sm:col-span-2">
          <Label htmlFor="acq-batch-label">Batch label</Label>
          <Input
            id="acq-batch-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Aug 2026 – 100 Covered Hopper Buy"
            data-testid="acq-batch-label"
          />
        </div>
        <div>
          <Label htmlFor="acq-date">Acquisition date</Label>
          <Input
            id="acq-date"
            type="date"
            value={acquisitionDate}
            onChange={(e) => setAcquisitionDate(e.target.value)}
            data-testid="acq-date"
          />
        </div>
        <div>
          <Label>Entity</Label>
          <Select value={entity} onValueChange={(v) => setEntity(v as "Main" | "RPS" | "Coal")}>
            <SelectTrigger data-testid="acq-entity">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Main">Main</SelectItem>
              <SelectItem value="RPS">RPS</SelectItem>
              <SelectItem value="Coal">Coal</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="acq-default-price">Default purchase price per car ($)</Label>
          <Input
            id="acq-default-price"
            inputMode="decimal"
            value={defaultPrice}
            onChange={(e) => setDefaultPrice(e.target.value)}
            placeholder="Optional"
            data-testid="acq-default-price"
          />
        </div>
        <div>
          <Label>Default Rental Status</Label>
          <Select value={rentalStatus} onValueChange={(v) => setRentalStatus(v as FleetStatus)}>
            <SelectTrigger data-testid="acq-rental-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FLEET_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div
        className={cn(
          "rounded-lg border-2 border-dashed border-umler-steel/40 bg-umler-steel/5 hover:border-umler-steel/70 transition-colors cursor-pointer text-center p-10",
          loading && "opacity-60 pointer-events-none",
        )}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f) handleFile(f);
        }}
        data-testid="acq-dropzone"
      >
        <FileSpreadsheet className="h-10 w-10 text-umler-steel mx-auto mb-3" />
        <div className="text-sm font-medium text-foreground">
          {fileName ? fileName : "Drop a New Acquisitions file here"}
        </div>
        <div className="text-xs text-muted-foreground mt-1">.csv / .xlsx · 5 columns · insert-only</div>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />
      </div>

      <div className="mt-4 flex items-start gap-3 p-4 rounded-lg border border-border bg-card/60">
        <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
        <div className="text-xs text-muted-foreground space-y-1 w-full">
          <div className="font-medium text-foreground">Expected columns (New Acquisitions)</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-0.5">
            {[
              ["Marks", "Required · reporting marks, e.g. OFOX"],
              ["Car Number", "Required · unique with Marks"],
              ["Car Type", "Optional · e.g. C113"],
              ["Purchase Price ($)", "Optional · overrides the batch default for this car"],
              ["Notes", "Optional · free text"],
            ].map(([col, desc]) => (
              <div key={col}>
                <span className="font-mono text-foreground">{col}</span>
                <span className="text-muted-foreground"> — {desc}</span>
              </div>
            ))}
          </div>
          <Button variant="ghost" size="sm" className="mt-2 h-7 px-2 text-xs" onClick={downloadTemplate}>
            <Download className="h-3.5 w-3.5 mr-1" />
            Download template CSV
          </Button>
        </div>
      </div>

      {review && (
        <div className="mt-5 space-y-4">
          <div className="rounded-lg border border-border bg-background/60 p-4 text-xs space-y-1">
            <div className="font-medium text-foreground">Batch</div>
            <div>
              Label: <span className="text-foreground">{label.trim() || "—"}</span>
            </div>
            <div>
              Entity: <span className="text-foreground">{entity}</span>
              {" · "}
              Date: <span className="text-foreground">{acquisitionDate}</span>
              {" · "}
              Rental status: <span className="text-foreground">{rentalStatus}</span>
            </div>
            {defaultPrice.trim() && (
              <div>
                Default price: <span className="text-foreground">${defaultPrice.trim()}</span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <StatChip icon={<Info className="h-3.5 w-3.5" />} label="rows in file" value={review.total} />
            <StatChip icon={<CheckCircle2 className="h-3.5 w-3.5" />} label="new cars" value={review.new_count} color="emerald" />
            <StatChip icon={<AlertTriangle className="h-3.5 w-3.5" />} label="already exist" value={review.skipped_exists} color="amber" />
            <StatChip icon={<XCircle className="h-3.5 w-3.5" />} label="invalid / dupes" value={review.skipped_invalid} color="red" />
          </div>

          {review.skipped.length > 0 && (
            <div>
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setShowSkipped((v) => !v)}
              >
                {showSkipped ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                {review.skipped.length} skipped row{review.skipped.length === 1 ? "" : "s"}
              </button>
              {showSkipped && (
                <div className="mt-2 max-h-48 overflow-auto rounded-md border border-border text-xs">
                  <table className="w-full">
                    <thead>
                      <tr className="text-left text-muted-foreground">
                        <th className="px-2 py-1">Row</th>
                        <th className="px-2 py-1">Marks</th>
                        <th className="px-2 py-1">Number</th>
                        <th className="px-2 py-1">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {review.skipped.slice(0, 200).map((s) => (
                        <tr key={`${s.row}-${s.marks}-${s.car_number}`} className="border-t border-border">
                          <td className="px-2 py-1 font-mono-num">{s.row}</td>
                          <td className="px-2 py-1 font-mono">{s.marks || "—"}</td>
                          <td className="px-2 py-1 font-mono">{s.car_number || "—"}</td>
                          <td className="px-2 py-1">{s.skip_label}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <Button variant="ghost" size="sm" className="mt-1 h-7 px-2 text-xs" onClick={() => downloadSkipped(review.skipped)}>
                <Download className="h-3.5 w-3.5 mr-1" />
                Download skipped rows
              </Button>
            </div>
          )}

          <div className="flex items-center gap-3 justify-end">
            <Button
              variant="secondary"
              onClick={resetFile}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCommit}
              disabled={review.new_count === 0 || loading || !canEdit || !label.trim()}
              data-testid="acq-commit"
            >
              {!canEdit
                ? "View only"
                : loading
                  ? "Loading…"
                  : `Load ${review.new_count} new car${review.new_count === 1 ? "" : "s"} into batch ‘${label.trim() || "…"}’?`}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
