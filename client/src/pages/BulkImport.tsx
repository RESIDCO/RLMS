import { useRef, useState } from "react";
import { useCanEdit } from "@/lib/AuthContext";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
import { queryClient } from "@/lib/queryClient";

// ── Types ─────────────────────────────────────────────────────────────────────
// Loose shape — server returns the full normalized row alongside derived fields.
// We only render a small subset; everything else flows back to /api/import/commit
// untouched, so this is intentionally permissive.
interface PreviewRow {
  _row: number;
  car_number: string;
  reporting_marks: string | null;
  car_type: string | null;
  status: string;
  fleet_name: string | null;
  rider_name: string | null;
  rider_id: number | null;
  notes: string | null;
  entity: string | null;
  managed_category: string | null;
  description: string | null;
  mechanical_designation: string | null;
  build_year: number | null;
  capacity_cf: number | null;
  lining: string | null;
  oec: number | null;
  nbv: number | null;
  oac: number | null;
  // RESIDCO extended
  rider_external_id: string | null;
  lessee_name: string | null;
  active_status: string | null;
  active: boolean;
  data_source: string | null;
  assignment_label: string | null;
  lease_type: string | null;
  lease_start_date: string | null;
  lease_end_date: string | null;
  lease_expiry: string | null;
  monthly_rent_per_car: number | null;
  monthly_depr_per_car: number | null;
  total_bv_rider: number | null;
  cars_on_rider_ar: number | null;
  commodity_family: string | null;
  commodity: string | null;
  dot_code: string | null;
  comment_event_note: string | null;
  is_dupe: boolean;
  is_batch_dupe?: boolean;
  errors: string[];
  warnings: string[];
  valid: boolean;
}

interface PreviewResult {
  total: number;
  valid: number;
  valid_with_warnings: number;
  dupes: number;
  errors: number;
  preview: PreviewRow[];
}

interface CommitResult {
  ok: boolean;
  imported: number;
  assigned: number;
  skipped: number;
}

interface VcfReviewResult {
  ok: boolean;
  mode: "vcf";
  existingCarsInDb: number;
  totalRows: number;
  distinctCars: number;
  newCars: number;
  updatedCars: number;
  multipleActiveCount: number;
  multipleActiveCars: Array<{
    car_initial: string;
    car_number: string;
    activePeriodCount: number;
    assignment_ids: string[];
    start_dates: string[];
  }>;
  badActiveCount: number;
  badActiveValues: Array<{ raw: string; count: number; sampleRows: number[] }>;
  unmappedManagedCategoryCount: number;
  unmappedManagedCategories: Array<{ raw: string; count: number }>;
}

function looksLikeVcf(rows: Record<string, string>[]): boolean {
  if (!rows.length) return false;
  const keys = Object.keys(rows[0]).map((k) => k.toLowerCase().replace(/[^a-z0-9]+/g, ""));
  const has = (s: string) => keys.includes(s);
  return has("carinitial") && has("carnumber") && has("active") && (has("assignmentid") || has("assignment"));
}

// ── CSV parser (client-side, no library needed for simple cases) ───────────────
function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map((line) => {
    // Simple CSV split — handles basic quoted fields
    const values: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; }
      else if (ch === "," && !inQ) { values.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    values.push(cur.trim());
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = (values[i] ?? "").replace(/^"|"$/g, ""); });
    return obj;
  });
}

// ── XLSX parser via SheetJS (loaded from CDN lazily) ─────────────────────────
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
  const preferred =
    wb.SheetNames.find((n: string) => /^V_VALID_CARS$/i.test(n)) ||
    wb.SheetNames.find((n: string) => /valid.?car/i.test(n)) ||
    wb.SheetNames[0];
  const ws = wb.Sheets[preferred];
  return XLSX.utils.sheet_to_json(ws, { defval: "" }) as Record<string, string>[];
}

type WorkbookParse =
  | { kind: "vcf" | "master"; rows: Record<string, string>[] }
  | { kind: "financial"; mainRows: unknown[][]; rpsRows: unknown[][]; sheetNames: string[] };

function looksLikeAssetReport(sheetNames: string[]): boolean {
  const joined = sheetNames.join(" | ").toLowerCase();
  return /residco.*deal/.test(joined) && /rps.*deal/.test(joined);
}

async function parseWorkbook(file: File): Promise<WorkbookParse> {
  await loadXLSX();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  if (looksLikeAssetReport(wb.SheetNames)) {
    const mainName =
      wb.SheetNames.find((n: string) => /residco/i.test(n) && /deal/i.test(n)) || wb.SheetNames[0];
    const rpsName =
      wb.SheetNames.find((n: string) => /rps/i.test(n) && /deal/i.test(n)) || wb.SheetNames[1];
    const mainRows = XLSX.utils.sheet_to_json(wb.Sheets[mainName], { header: 1, defval: null }) as unknown[][];
    const rpsRows = XLSX.utils.sheet_to_json(wb.Sheets[rpsName], { header: 1, defval: null }) as unknown[][];
    return { kind: "financial", mainRows, rpsRows, sheetNames: [mainName, rpsName] };
  }
  const preferred =
    wb.SheetNames.find((n: string) => /^V_VALID_CARS$/i.test(n)) ||
    wb.SheetNames.find((n: string) => /valid.?car/i.test(n)) ||
    wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[preferred], { defval: "" }) as Record<string, string>[];
  return { kind: looksLikeVcf(rows) ? "vcf" : "master", rows };
}

interface FinancialReviewResult {
  ok: boolean;
  mode: "financial";
  snapshotMonth: string | null;
  snapshotMonthDetected: boolean;
  qualifyingRows: number;
  qualifyingCarCount: number;
  mainRows: number;
  rpsRows: number;
  skippedNonRail: number;
  flaggedCount: number;
  flagged: Array<{ entity: string; rider_id: string; asset: string; count_cars: number; reason: string; lessee: string | null }>;
  activeCarsInRlms: number;
  fileVsActiveDelta: number;
  fileNoCarMatchCount: number;
  fileNoCarMatches: Array<{ rider_id: string; car_type: string; entity: string; count_cars: number }>;
  carsNoFileMatch: {
    total: number;
    coal: number;
    mainRps: number;
    sampleMainRps: Array<{ id: number; rider_external_id: string | null; car_type: string | null; mapped_asset: string | null; entity: string | null }>;
  };
  refreshPreview: { carsMatched: number; carsUnmatched: number; multiBatchRiderTypes: number };
}

// ── Status badge ──────────────────────────────────────────────────────────────
function RowStatus({ row }: { row: PreviewRow }) {
  if (row.errors.length > 0)
    return <span className="text-[10px] text-red-400 font-medium uppercase">Error</span>;
  if (row.warnings.length > 0)
    return <span className="text-[10px] text-yellow-400 font-medium uppercase">Warning</span>;
  return <span className="text-[10px] text-emerald-400 font-medium uppercase">Ready</span>;
}

// ── CSV escape helper ────────────────────────────────────────────────────────────
function escCsv(v: string | number | null | undefined) {
  const s = String(v ?? "");
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

// ── Error report download ───────────────────────────────────────────────────────────
function downloadErrorReport(rows: PreviewRow[], sourceFileName: string) {
  const problemRows = rows.filter((r) => r.errors.length > 0 || r.warnings.length > 0);
  if (problemRows.length === 0) return;

  const headers = ["Row #", "Reporting Marks", "Car Number", "Issue Type", "Issue Details"];
  const dataRows: string[][] = [];

  for (const row of problemRows) {
    for (const err of row.errors) {
      dataRows.push([
        String(row._row),
        row.reporting_marks ?? "(blank)",
        row.car_number || "(blank)",
        "Error",
        err,
      ]);
    }
    for (const warn of row.warnings) {
      dataRows.push([
        String(row._row),
        row.reporting_marks ?? "(blank)",
        row.car_number || "(blank)",
        "Warning",
        warn,
      ]);
    }
  }

  const csv = [
    headers.map(escCsv).join(","),
    ...dataRows.map((r) => r.map(escCsv).join(",")),
  ].join("\n");

  const baseName = sourceFileName.replace(/\.[^.]+$/, "");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${baseName}-error-report.csv`;
  a.click();
}

// ── Template download ─────────────────────────────────────────────────────────
// Headers match the RESIDCO Master Car List workbook 1:1 so an operator can
// upload the source file directly. Internal aliases (snake_case) are also
// accepted by the server-side header normaliser.
function downloadTemplate() {
  const header = [
    "Car Number",
    "Rider ID",
    "Lessee",
    "Entity",
    "Active",
    "Data Source",
    "Car Type",
    "Description",
    "Assignment",
    "Lease Type",
    "Start Date",
    "End Date",
    "Lease Expiry",
    "NBV Per Car ($)",
    "OEC Per Car ($)",
    "Monthly Rent P/C ($)",
    "Monthly Depr P/C ($)",
    "Total BV — Rider ($)",
    "Cars on Rider (AR)",
    "Commodity Family",
    "Commodity",
    "Build Year",
    "Lining",
    "Mech Desig.",
    "DOT Code",
    "Comment / Event Note",
  ].map((h) => `"${h}"`).join(",");
  const example = [
    "HWCX99001", "EA1503", "COVIA", "Main", "Active", "VCF_ONLY",
    "C214", "5800 cf Covered Hoppers", "EA1503 - COVIA Active", "Net Lease",
    "2015-05-15", "2026-03-16", "2026-03-16",
    "85000", "125000", "650", "275",
    "", "", "Industrial Sand", "Frac Sand", "2010", "Epoxy", "LO", "",
    "Cleaned & returned to LBWR storage",
  ].map((v) => `"${v}"`).join(",");
  const blob = new Blob([header + "\n" + example], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "residco-master-car-list-template.csv";
  a.click();
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function BulkImportPage() {
  const canEdit = useCanEdit();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [vcfReview, setVcfReview] = useState<VcfReviewResult | null>(null);
  const [finReview, setFinReview] = useState<FinancialReviewResult | null>(null);
  const [finPayload, setFinPayload] = useState<{ mainRows: unknown[][]; rpsRows: unknown[][] } | null>(null);
  const [committed, setCommitted] = useState<CommitResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [rawRows, setRawRows] = useState<PreviewRow[]>([]);
  const [vcfRawRows, setVcfRawRows] = useState<Record<string, string>[]>([]);

  async function handleFile(file: File) {
    setPreview(null);
    setVcfReview(null);
    setFinReview(null);
    setFinPayload(null);
    setCommitted(null);
    setFileName(file.name);
    setLoading(true);
    try {
      if (file.name.endsWith(".csv") || file.name.endsWith(".txt")) {
        const text = await file.text();
        const rows = parseCSV(text);
        if (rows.length === 0) throw new Error("No data rows found in file.");
        if (looksLikeVcf(rows)) {
          setVcfRawRows(rows);
          const res = await fetch("/api/import/vcf/preview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rows }),
          });
          if (!res.ok) throw new Error(await res.text());
          setVcfReview(await res.json());
        } else {
          const res = await fetch("/api/import/preview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rows }),
          });
          if (!res.ok) throw new Error(await res.text());
          const result: PreviewResult = await res.json();
          setPreview(result);
          setRawRows(result.preview);
        }
      } else {
        const parsed = await parseWorkbook(file);
        if (parsed.kind === "financial") {
          setFinPayload({ mainRows: parsed.mainRows, rpsRows: parsed.rpsRows });
          const res = await fetch("/api/import/financial/preview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mainRows: parsed.mainRows, rpsRows: parsed.rpsRows }),
          });
          if (!res.ok) throw new Error(await res.text());
          const result: FinancialReviewResult = await res.json();
          setFinReview(result);
          toast({
            title: "Asset Report review ready",
            description: `${result.qualifyingCarCount.toLocaleString()} rail cars in file · ${result.refreshPreview.carsMatched.toLocaleString()} active cars would match`,
          });
        } else if (parsed.kind === "vcf") {
          setVcfRawRows(parsed.rows);
          const res = await fetch("/api/import/vcf/preview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rows: parsed.rows }),
          });
          if (!res.ok) throw new Error(await res.text());
          setVcfReview(await res.json());
          toast({ title: "Valid Car File review ready" });
        } else {
          if (parsed.rows.length === 0) throw new Error("No data rows found in file.");
          const res = await fetch("/api/import/preview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rows: parsed.rows }),
          });
          if (!res.ok) throw new Error(await res.text());
          const result: PreviewResult = await res.json();
          setPreview(result);
          setRawRows(result.preview);
        }
      }
    } catch (e: any) {
      toast({ title: "Parse error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function handleCommit() {
    if (!rawRows.length) return;
    setLoading(true);
    try {
      const res = await fetch("/api/import/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: rawRows }),
      });
      if (!res.ok) throw new Error(await res.text());
      const result: CommitResult = await res.json();
      setCommitted(result);
      setPreview(null);
      queryClient.invalidateQueries({ queryKey: ["/api/railcars"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: `Imported ${result.imported} railcars successfully` });
    } catch (e: any) {
      toast({ title: "Import failed", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  const displayRows = showAll ? rawRows : rawRows.slice(0, 50);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <PageHeader
        title="Bulk Import"
        subtitle="Upload a Valid Car File, Asset Report (Financial Refresh), or Master Car List workbook"
      />

      {/* Success state */}
      {committed && (
        <div className="mt-6 rounded-lg border border-umler-teal/30 bg-umler-teal/10 p-6 text-center">
          <CheckCircle2 className="h-10 w-10 text-emerald-400 mx-auto mb-3" />
          <div className="text-lg font-semibold text-foreground">{committed.imported} railcars imported</div>
          <div className="text-sm text-muted-foreground mt-1">{committed.assigned} cars assigned to riders</div>
          {committed.skipped > 0 && (
            <div className="text-sm text-amber-400 mt-1">{committed.skipped} rows were skipped due to errors or duplicates</div>
          )}
          <Button className="mt-4" variant="secondary" onClick={() => { setCommitted(null); setFileName(null); setRawRows([]); setVcfReview(null); setVcfRawRows([]); setFinReview(null); setFinPayload(null); }}>
            Import another file
          </Button>
        </div>
      )}

      {!committed && (
        <>
          {/* Drop zone */}
          <div
            className={cn(
              "mt-6 rounded-lg border-2 border-dashed border-border bg-card hover:border-primary/50 transition-colors cursor-pointer text-center p-10",
              loading && "opacity-60 pointer-events-none"
            )}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f) handleFile(f);
            }}
          >
            <FileSpreadsheet className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <div className="text-sm font-medium text-foreground">
              {fileName ? fileName : "Drop a CSV or Excel file here"}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              or click to browse · .csv, .xlsx, .xls · V_VALID_CARS sheet preferred when present
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx,.xls,.txt"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
            />
          </div>

          {loading && (
            <div className="mt-6 space-y-2">
              <Skeleton className="h-8 w-1/3" />
              <Skeleton className="h-48 w-full" />
            </div>
          )}

          {/* §2.3 Valid Car File review */}
          {vcfReview && !loading && (
            <div className="mt-6 space-y-4">
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
                <div className="text-sm font-semibold text-foreground">Valid Car File — §2.3 review (dry-run)</div>
                <div className="text-xs text-muted-foreground mt-1">
                  No production write yet. Bruce must sign off on these counts before commit.
                  {vcfRawRows.length > 0 ? ` · ${vcfRawRows.length.toLocaleString()} sheet rows uploaded` : null}
                </div>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <StatChip icon={<FileSpreadsheet className="h-3.5 w-3.5" />} label="Rows processed" value={vcfReview.totalRows} />
                <StatChip icon={<CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />} label="Distinct cars" value={vcfReview.distinctCars} color="emerald" />
                <StatChip icon={<Info className="h-3.5 w-3.5" />} label="New cars" value={vcfReview.newCars} />
                <StatChip icon={<Info className="h-3.5 w-3.5" />} label="Updated cars" value={vcfReview.updatedCars} />
                <StatChip
                  icon={<AlertTriangle className={`h-3.5 w-3.5 ${vcfReview.multipleActiveCount > 0 ? "text-amber-400" : "text-muted-foreground"}`} />}
                  label="Double-active flags"
                  value={vcfReview.multipleActiveCount}
                  color={vcfReview.multipleActiveCount > 0 ? "amber" : undefined}
                />
              </div>

              {vcfReview.multipleActiveCount > 0 && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
                  <div className="text-sm font-medium text-foreground mb-2">
                    Multiple simultaneously-active assignment rows ({vcfReview.multipleActiveCount})
                  </div>
                  <div className="overflow-auto max-h-64">
                    <table className="w-full text-xs">
                      <thead className="text-muted-foreground">
                        <tr>
                          <th className="text-left py-1 pr-3">Mark</th>
                          <th className="text-left py-1 pr-3">Number</th>
                          <th className="text-left py-1 pr-3">Active periods</th>
                          <th className="text-left py-1 pr-3">Assignment IDs</th>
                          <th className="text-left py-1">Start dates</th>
                        </tr>
                      </thead>
                      <tbody>
                        {vcfReview.multipleActiveCars.map((c) => (
                          <tr key={`${c.car_initial}-${c.car_number}`} className="border-t border-border/60">
                            <td className="py-1.5 pr-3 font-mono">{c.car_initial}</td>
                            <td className="py-1.5 pr-3 font-mono">{c.car_number}</td>
                            <td className="py-1.5 pr-3">{c.activePeriodCount}</td>
                            <td className="py-1.5 pr-3 font-mono">{c.assignment_ids.join(", ")}</td>
                            <td className="py-1.5 font-mono">{c.start_dates.join(", ")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="rounded-lg border border-border bg-card p-4 text-xs">
                  <div className="font-medium text-foreground mb-1">ACTIVE parse issues</div>
                  {vcfReview.badActiveCount === 0 ? (
                    <div className="text-emerald-400">None — all ACTIVE values were -1 or 0</div>
                  ) : (
                    <ul className="space-y-1 text-amber-300">
                      {vcfReview.badActiveValues.map((v) => (
                        <li key={v.raw}>“{v.raw}” × {v.count} (rows {v.sampleRows.join(", ")})</li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="rounded-lg border border-border bg-card p-4 text-xs">
                  <div className="font-medium text-foreground mb-1">MANAGED_CATEGORY unmapped</div>
                  {vcfReview.unmappedManagedCategoryCount === 0 ? (
                    <div className="text-emerald-400">None — all values matched the canonical table</div>
                  ) : (
                    <ul className="space-y-1 text-amber-300">
                      {vcfReview.unmappedManagedCategories.map((v) => (
                        <li key={v.raw}>“{v.raw}” × {v.count}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <div className="text-xs text-muted-foreground">
                Production commit stays locked until Bruce signs off. Existing cars in DB: {vcfReview.existingCarsInDb.toLocaleString()}.
              </div>
            </div>
          )}

          {/* §3.5 Financial / Asset Report review */}
          {finReview && !loading && (
            <div className="mt-6 space-y-4">
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
                <div className="text-sm font-semibold text-foreground">Asset Report — §3.5 reconciliation (dry-run)</div>
                <div className="text-xs text-muted-foreground mt-1">
                  No production write yet. Snapshot month: {finReview.snapshotMonth ?? "not detected"}.
                  {finPayload ? ` · Main ${finReview.mainRows} + RPS ${finReview.rpsRows} qualifying rows` : null}
                </div>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <StatChip icon={<FileSpreadsheet className="h-3.5 w-3.5" />} label="Qualifying rows" value={finReview.qualifyingRows} />
                <StatChip icon={<CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />} label="Cars in file (rail)" value={finReview.qualifyingCarCount} color="emerald" />
                <StatChip icon={<Info className="h-3.5 w-3.5" />} label="Active cars in RLMS" value={finReview.activeCarsInRlms} />
                <StatChip icon={<Info className="h-3.5 w-3.5" />} label="File − RLMS delta" value={finReview.fileVsActiveDelta} />
                <StatChip icon={<CheckCircle2 className="h-3.5 w-3.5" />} label="Would match" value={finReview.refreshPreview.carsMatched} color="emerald" />
                <StatChip
                  icon={<AlertTriangle className={`h-3.5 w-3.5 ${finReview.flaggedCount ? "text-amber-400" : "text-muted-foreground"}`} />}
                  label="Flagged non-car"
                  value={finReview.flaggedCount}
                  color={finReview.flaggedCount ? "amber" : undefined}
                />
              </div>

              {finReview.flaggedCount > 0 && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
                  <div className="text-sm font-medium mb-2">Flagged (not imported as rail) — {finReview.flaggedCount}</div>
                  <ul className="text-xs space-y-1 max-h-40 overflow-auto">
                    {finReview.flagged.map((f, i) => (
                      <li key={`${f.rider_id}-${f.asset}-${i}`}>
                        <span className="font-mono">{f.rider_id}</span> · {f.asset} × {f.count_cars} — {f.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div className="rounded-lg border border-border bg-card p-4">
                  <div className="font-medium text-foreground mb-1">File rider+type with no matching active car</div>
                  <div className="text-muted-foreground mb-2">{finReview.fileNoCarMatchCount} combinations</div>
                  <ul className="space-y-1 max-h-48 overflow-auto">
                    {finReview.fileNoCarMatches.slice(0, 20).map((f) => (
                      <li key={`${f.rider_id}-${f.car_type}-${f.entity}`}>
                        <span className="font-mono">{f.rider_id}</span> · {f.car_type} ({f.entity}) × {f.count_cars}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-lg border border-border bg-card p-4">
                  <div className="font-medium text-foreground mb-1">Active cars with no file match</div>
                  <div className="text-muted-foreground mb-2">
                    {finReview.carsNoFileMatch.total.toLocaleString()} total · Coal {finReview.carsNoFileMatch.coal.toLocaleString()} (expected) · Main/RPS {finReview.carsNoFileMatch.mainRps.toLocaleString()}
                  </div>
                  <ul className="space-y-1 max-h-48 overflow-auto">
                    {finReview.carsNoFileMatch.sampleMainRps.slice(0, 15).map((c) => (
                      <li key={c.id}>
                        <span className="font-mono">{c.rider_external_id}</span> · {c.car_type} → {c.mapped_asset ?? "?"} ({c.entity})
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="text-xs text-muted-foreground">
                Skipped non-Rail (Air/Power): {finReview.skippedNonRail}. Multi-batch rider+types: {finReview.refreshPreview.multiBatchRiderTypes}.
                Production commit stays locked until Bruce signs off.
              </div>
            </div>
          )}

          {/* Template download + column guide */}
          <div className="mt-4 flex items-start gap-3 p-4 rounded-lg border border-border bg-card/60">
            <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="text-xs text-muted-foreground space-y-1 w-full">
              <div className="font-medium text-foreground">Expected columns (RESIDCO Master Car List workbook)</div>
              <div className="text-[11px] text-muted-foreground mb-1">
                Header names are case- and punctuation-insensitive ("Mech Desig.", "Mechanical Designation", and "mech_designation" all map to the same field).
                Valid Car File uploads skip this guide and use the §2.3 review above.
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-0.5">
                {[
                  ["Car Number", "Required · unique, e.g. TFOX88031"],
                  ["Rider ID", "Optional · free-text OL / rider code e.g. EA1503 (new codes are created on import)"],
                  ["Lessee", "Optional · current lessee/operator"],
                  ["Entity", "Optional · Main → MAIN, Rail Partners Select → RPS, Coal → COAL"],
                  ["Active", "Optional · Active / Inactive (drives `active` boolean)"],
                  ["Data Source", "Optional · e.g. VCF_ONLY"],
                  ["Car Type", "Optional · e.g. C214"],
                  ["Description", "Optional · e.g. 5800 cf Covered Hoppers"],
                  ["Assignment", "Optional · free-text assignment label"],
                  ["Lease Type", "Optional · e.g. Net Lease, IDLE"],
                  ["Start Date", "Optional · YYYY-MM-DD or M/D/YYYY"],
                  ["End Date", "Optional · YYYY-MM-DD or M/D/YYYY"],
                  ["Lease Expiry", "Optional · YYYY-MM-DD"],
                  ["NBV Per Car ($)", "Optional · numeric, $ and commas allowed"],
                  ["OEC Per Car ($)", "Optional · numeric"],
                  ["Monthly Rent P/C ($)", "Optional · numeric"],
                  ["Monthly Depr P/C ($)", "Optional · numeric"],
                  ["Total BV — Rider ($)", "Optional · numeric (rider-level, retained per-row)"],
                  ["Cars on Rider (AR)", "Optional · integer"],
                  ["Commodity Family", "Optional"],
                  ["Commodity", "Optional"],
                  ["Build Year", "Optional · 4-digit year"],
                  ["Lining", "Optional · e.g. Epoxy, Rubber"],
                  ["Mech Desig.", "Optional · AAR mechanical designation (e.g. LO)"],
                  ["DOT Code", "Optional · DOT specification"],
                  ["Comment / Event Note", "Optional · free text"],
                ].map(([col, desc]) => (
                  <div key={col}>
                    <span className="font-mono text-foreground">{col}</span>
                    <span className="text-muted-foreground"> — {desc}</span>
                  </div>
                ))}
              </div>
              <div className="mt-2 text-[11px] text-muted-foreground">
                Rider / OL is free text in the file — existing codes link when present; new codes are created on import (not limited to the current rider list).
              </div>
              <button onClick={downloadTemplate} className="mt-2 text-primary underline-offset-2 hover:underline">
                Download template CSV
              </button>
            </div>
          </div>

          {/* Master Car List preview */}
          {preview && !loading && !vcfReview && (
            <div className="mt-6 space-y-4">
              {/* Summary badges */}
              <div className="flex items-center gap-3 flex-wrap">
                <StatChip icon={<FileSpreadsheet className="h-3.5 w-3.5" />} label="Total rows" value={preview.total} />
                <StatChip icon={<CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />} label="Ready" value={preview.valid} color="emerald" />
                {preview.valid_with_warnings > 0 && (
                  <StatChip icon={<AlertTriangle className="h-3.5 w-3.5 text-yellow-400" />} label="With warnings" value={preview.valid_with_warnings} color="yellow" />
                )}
                {preview.dupes > 0 && (
                  <StatChip icon={<AlertTriangle className="h-3.5 w-3.5 text-amber-400" />} label="Duplicates (skip)" value={preview.dupes} color="amber" />
                )}
                {preview.errors > 0 && (
                  <StatChip icon={<XCircle className="h-3.5 w-3.5 text-red-400" />} label="Errors (skip)" value={preview.errors} color="red" />
                )}
                {/* Error report download — shown whenever any row has issues */}
                {(preview.errors > 0 || preview.dupes > 0 || preview.valid_with_warnings > 0) && (
                  <button
                    onClick={() => downloadErrorReport(rawRows, fileName ?? "import")}
                    className="ml-auto flex items-center gap-1.5 text-xs text-primary hover:underline underline-offset-2"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download error report
                  </button>
                )}
              </div>

              {/* Row table */}
              <div className="rounded-lg border border-border bg-card overflow-hidden">
                <div className="overflow-auto max-h-[480px]">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 text-muted-foreground sticky top-0 z-10">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">#</th>
                        <th className="px-3 py-2 text-left font-medium">Marks</th>
                        <th className="px-3 py-2 text-left font-medium">Car Number</th>
                        <th className="px-3 py-2 text-left font-medium">Type</th>
                        <th className="px-3 py-2 text-left font-medium">Status</th>
                        <th className="px-3 py-2 text-left font-medium">Lessee</th>
                        <th className="px-3 py-2 text-left font-medium">Rider</th>
                        <th className="px-3 py-2 text-left font-medium">State</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayRows.map((row) => (
                        <tr
                          key={row._row}
                          className={cn(
                            "border-t border-border",
                            row.errors.length > 0 && "bg-red-500/5",
                            row.is_dupe && "bg-amber-500/5",
                            row.warnings.length > 0 && row.valid && "bg-yellow-500/5"
                          )}
                        >
                          <td className="px-3 py-2 text-muted-foreground">{row._row}</td>
                          <td className="px-3 py-2 text-muted-foreground">{row.reporting_marks ?? "—"}</td>
                          <td className="px-3 py-2 font-mono font-medium">{row.car_number || <span className="text-red-400 italic">missing</span>}</td>
                          <td className="px-3 py-2 text-muted-foreground">{row.car_type ?? "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground">{row.status}</td>
                          <td className="px-3 py-2">{row.fleet_name ?? "—"}</td>
                          <td className="px-3 py-2">{row.rider_name ?? "—"}</td>
                          <td className="px-3 py-2 min-w-[180px]">
                            <div className="space-y-0.5">
                              <RowStatus row={row} />
                              {row.errors.map((e, i) => (
                                <div key={`e${i}`} className="text-[10px] text-red-400 leading-snug">{e}</div>
                              ))}
                              {row.warnings.map((w, i) => (
                                <div key={`w${i}`} className="text-[10px] text-yellow-400 leading-snug">{w}</div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {rawRows.length > 50 && (
                  <div className="border-t border-border px-4 py-2 text-center">
                    <button
                      onClick={() => setShowAll((s) => !s)}
                      className="text-xs text-primary flex items-center gap-1 mx-auto hover:underline"
                    >
                      {showAll ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      {showAll ? "Show less" : `Show all ${rawRows.length} rows`}
                    </button>
                  </div>
                )}
              </div>

              {/* Commit */}
              <div className="flex items-center gap-3 justify-end">
                <span className="text-xs text-muted-foreground">
                  {preview.valid + (preview.valid_with_warnings ?? 0)} of {preview.total} rows will be imported
                  {(preview.errors > 0 || preview.dupes > 0) && (
                    <span className="text-red-400"> · {preview.errors + preview.dupes} skipped</span>
                  )}
                </span>
                <Button variant="secondary" onClick={() => { setPreview(null); setFileName(null); setRawRows([]); }}>
                  Cancel
                </Button>
                <Button
                  onClick={handleCommit}
                  disabled={(preview.valid + (preview.valid_with_warnings ?? 0)) === 0 || loading || !canEdit}
                >
                  {!canEdit ? "View only" : loading ? "Importing…" : `Import ${preview.valid + (preview.valid_with_warnings ?? 0)} railcars`}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatChip({
  icon, label, value, color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color?: "emerald" | "yellow" | "amber" | "red";
}) {
  const COLOR_CLS: Record<string, string> = {
    emerald: "border-umler-teal/20 bg-umler-teal/10 text-umler-teal",
    yellow:  "border-umler-amber/20 bg-umler-amber/10 text-umler-amber",
    amber:   "border-umler-amber/20 bg-umler-amber/10 text-umler-amber",
    red:     "border-umler-signal/20 bg-umler-signal/10 text-umler-signal",
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
