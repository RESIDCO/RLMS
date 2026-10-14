/**
 * OWNER_UI §A — Estimates History landing `/#/repair`
 * Layout matched to docs/repair/screenshots/01-estimates-history.png
 * Estimate Review page is unchanged — car/estimate link opens it.
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { Paperclip, Check, X, Trash2, Search, RotateCcw } from "lucide-react";

type Shop = {
  id: string;
  reporting_mark: string;
  name: string;
  city?: string | null;
  state?: string | null;
  display_label?: string;
};

type GridRow = {
  estimate_id: string;
  event_id: string;
  estimate_label: string;
  car_mark: string;
  car_number: string;
  status_code: string;
  status_name: string;
  total_display: string;
  total_cents: number;
  issues: string;
  attachment_count: number;
  shop_display: string | null;
  yard_arrived_at: string | null;
  approval_requested_at: string | null;
  approved_at: string | null;
  terminated_at: string | null;
  target_outbound_at: string | null;
  actual_outbound_at: string | null;
  invoice_no: string | null;
  bad_order_reason: string | null;
  ctc: string | null;
  assignment: string | null;
  wreck: string;
  dispo_reqd: string;
  lease_type: string | null;
  resp6_email_at: string | null;
};

type Summary = {
  estimates: number;
  cars: number;
  clients: number;
  totalCostDisplay: string;
  perEstimateDisplay: string;
  perCarDisplay: string;
  perClientDisplay: string;
};

type SavedView = {
  id: string;
  name: string;
  statuses: string[];
  shopId: string;
  carMark: string;
  carNumber: string;
  from: string;
  to: string;
  dateField: string;
  sortBy: string;
  sortDir: "asc" | "desc";
  groupBy: string;
  pageSize: number;
};

const ACTIONABLE = [
  "AWAITING_APPROVAL",
  "REVISION_REQUESTED",
  "ADJUSTMENT_FOR_APPROVAL",
  "AWAITING_TERMINATE",
];

const ALL_STATUSES = [
  { code: "AWAITING_APPROVAL", label: "Awaiting Approval" },
  { code: "REVISION_REQUESTED", label: "Revision Requested" },
  { code: "ADJUSTMENT_FOR_APPROVAL", label: "Adjustment for Approval" },
  { code: "AWAITING_TERMINATE", label: "Awaiting Terminate" },
  { code: "APPROVED", label: "Approved" },
  { code: "COMPLETED", label: "Completed" },
  { code: "TERMINATED", label: "Terminated" },
  { code: "QUEUED", label: "Queued" },
  { code: "VOIDED", label: "Voided" },
  { code: "AWAITING_DELETE", label: "Awaiting Delete" },
];

const DATE_FIELDS = [
  { value: "ignore", label: "Ignore Date Range" },
  { value: "yard_arrival", label: "Arrived At Yard" },
  { value: "approval_requested", label: "Approval Requested" },
  { value: "approved", label: "Approved" },
  { value: "outbound_target", label: "Outbound Target" },
  { value: "outbound_date", label: "Outbound Date" },
  { value: "created", label: "Created" },
  { value: "terminated", label: "Terminated" },
];

const VIEWS_KEY = "repair.estimatesHistory.views";

function loadViews(): SavedView[] {
  try {
    const raw = localStorage.getItem(VIEWS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveViews(views: SavedView[]) {
  localStorage.setItem(VIEWS_KEY, JSON.stringify(views));
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) {
    // date-only YYYY-MM-DD
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
    if (m) return `${Number(m[2])}/${Number(m[3])}/${m[1].slice(2)}`;
    return String(v);
  }
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}

function money(display: string | undefined): string {
  if (!display) return "$0.00";
  const n = Number(display);
  if (!Number.isFinite(n)) return `$${display}`;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function statusClass(code: string): string {
  switch (code) {
    case "AWAITING_APPROVAL":
      return "text-amber-700 font-medium";
    case "REVISION_REQUESTED":
      return "text-yellow-800 font-medium";
    case "ADJUSTMENT_FOR_APPROVAL":
      return "text-orange-600 font-semibold";
    case "AWAITING_TERMINATE":
      return "text-rose-700 font-medium";
    case "APPROVED":
      return "text-emerald-700 font-medium";
    case "COMPLETED":
      return "text-slate-700";
    case "TERMINATED":
    case "VOIDED":
      return "text-red-700";
    default:
      return "text-foreground";
  }
}

function isOutboundOverdue(target: string | null): boolean {
  if (!target) return false;
  const d = new Date(target);
  if (Number.isNaN(d.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}

export default function RepairHome() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [rows, setRows] = useState<GridRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const [shopId, setShopId] = useState("all");
  const [statuses, setStatuses] = useState<string[]>([...ACTIONABLE]);
  const [carMark, setCarMark] = useState("");
  const [carNumber, setCarNumber] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [dateField, setDateField] = useState("ignore");
  const [sortBy, setSortBy] = useState("created");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [groupBy, setGroupBy] = useState("none");
  const [pageSize, setPageSize] = useState(500);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [views, setViews] = useState<SavedView[]>([]);
  const [activeView, setActiveView] = useState("default");
  const [showCreateFilter, setShowCreateFilter] = useState(false);
  const [viewAutoApproval, setViewAutoApproval] = useState(false);

  useEffect(() => {
    setViews(loadViews());
    apiRequest("GET", "/api/repair/shops")
      .then((r) => r.json())
      .then((d) => setShops(d.shops ?? []))
      .catch(() => undefined);
  }, []);

  const buildQuery = useCallback(() => {
    const qs = new URLSearchParams();
    if (statuses.length) qs.set("status", statuses.join(","));
    if (shopId && shopId !== "all") qs.set("shopId", shopId);
    if (carMark.trim()) qs.set("carMark", carMark.trim());
    if (carNumber.trim()) qs.set("carNumber", carNumber.trim());
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    if (dateField) qs.set("dateField", dateField);
    qs.set("limit", String(pageSize));
    qs.set("offset", String((page - 1) * pageSize));
    qs.set("sortBy", sortBy);
    qs.set("sortDir", sortDir);
    if (statuses.includes("QUEUED") || statuses.includes("VOIDED")) {
      qs.set("includeShopDraft", "1");
      qs.set("includeHidden", "1");
    }
    return qs.toString();
  }, [
    statuses,
    shopId,
    carMark,
    carNumber,
    from,
    to,
    dateField,
    pageSize,
    page,
    sortBy,
    sortDir,
  ]);

  const loadGrid = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiRequest("GET", `/api/repair/estimates/grid?${buildQuery()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load estimates");
      setRows(data.rows ?? []);
      setSummary(data.summary ?? null);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load estimates");
      setRows([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);

  useEffect(() => {
    loadGrid();
  }, [loadGrid]);

  function toggleStatus(code: string) {
    setPage(1);
    setStatuses((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  }

  function resetFilters() {
    setShopId("all");
    setStatuses([...ACTIONABLE]);
    setCarMark("");
    setCarNumber("");
    setFrom("");
    setTo("");
    setDateField("ignore");
    setSortBy("created");
    setSortDir("desc");
    setGroupBy("none");
    setPage(1);
    setActiveView("default");
  }

  function applyView(id: string) {
    setActiveView(id);
    if (id === "default") {
      resetFilters();
      return;
    }
    const v = views.find((x) => x.id === id);
    if (!v) return;
    setStatuses(v.statuses);
    setShopId(v.shopId || "all");
    setCarMark(v.carMark);
    setCarNumber(v.carNumber);
    setFrom(v.from);
    setTo(v.to);
    setDateField(v.dateField);
    setSortBy(v.sortBy);
    setSortDir(v.sortDir);
    setGroupBy(v.groupBy);
    setPageSize(v.pageSize);
    setPage(1);
  }

  function saveCurrentView() {
    const name = window.prompt("View name");
    if (!name?.trim()) return;
    const next: SavedView = {
      id: `v-${Date.now()}`,
      name: name.trim(),
      statuses: [...statuses],
      shopId,
      carMark,
      carNumber,
      from,
      to,
      dateField,
      sortBy,
      sortDir,
      groupBy,
      pageSize,
    };
    const updated = [...views.filter((v) => v.name !== next.name), next];
    setViews(updated);
    saveViews(updated);
    setActiveView(next.id);
  }

  function manageViews() {
    if (!views.length) {
      window.alert("No saved views yet. Use Save view first.");
      return;
    }
    const names = views.map((v, i) => `${i + 1}. ${v.name}`).join("\n");
    const pick = window.prompt(
      `Saved views:\n${names}\n\nEnter number to delete, or Cancel.`,
    );
    if (!pick) return;
    const idx = Number(pick) - 1;
    if (idx < 0 || idx >= views.length) return;
    const updated = views.filter((_, i) => i !== idx);
    setViews(updated);
    saveViews(updated);
    if (activeView === views[idx].id) setActiveView("default");
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function toggleSelectAll() {
    if (selected.size === rows.length) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.estimate_id)));
  }

  async function bulkApprove() {
    setMsg("");
    setError("");
    const ids = [...selected];
    if (!ids.length) {
      setError("Select one or more estimates");
      return;
    }
    const res = await apiRequest("POST", "/api/repair/estimates/bulk-approve", {
      estimateIds: ids,
    });
    const data = await res.json();
    setMsg(`Approved ${data.approved ?? 0}; failed ${data.failed ?? 0}`);
    await loadGrid();
  }

  async function getBrc() {
    setMsg("");
    setError("");
    const ids = [...selected];
    if (!ids.length) {
      setError("Select one or more estimates");
      return;
    }
    const res = await apiRequest("POST", "/api/repair/estimates/brc-export", {
      estimateIds: ids,
    });
    const blob = await res.blob();
    downloadBlob(blob, "brc-detail.csv");
    setMsg("BRC detail downloaded");
  }

  async function exportExcelSelection() {
    // Excel of current grid (or selection if any)
    await exportGrid("csv");
  }

  async function export500() {
    setMsg("");
    setError("");
    const ids = selected.size ? [...selected] : rows.map((r) => r.estimate_id);
    if (!ids.length) {
      setError("No estimates to export");
      return;
    }
    const res = await apiRequest("POST", "/api/repair/estimates/export-aar", {
      estimateIds: ids,
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "500-byte export failed");
      return;
    }
    const files = data.files ?? [];
    if (!files.length) {
      setMsg("No 500-byte content for selection");
      return;
    }
    for (const f of files) {
      downloadBlob(
        new Blob([f.content], { type: "text/plain" }),
        f.filename || "estimate-500.txt",
      );
    }
    setMsg(`Exported ${files.length} 500-byte file(s)`);
  }

  async function validateSelected() {
    setMsg("");
    setError("");
    const ids = selected.size ? [...selected] : rows.map((r) => r.estimate_id);
    if (!ids.length) {
      setError("No estimates to validate");
      return;
    }
    const res = await apiRequest("POST", "/api/repair/estimates/bulk-validate", {
      estimateIds: ids,
    });
    const data = await res.json();
    const okCount = (data.results ?? []).filter((r: { ok?: boolean }) => r.ok).length;
    setMsg(`Validated ${okCount}/${(data.results ?? []).length}`);
  }

  async function exportGrid(format: "csv" | "excel") {
    const qs = buildQuery();
    const res = await apiRequest("GET", `/api/repair/estimates/grid/export?${qs}`);
    const blob = await res.blob();
    downloadBlob(blob, format === "excel" ? "estimates-grid.csv" : "estimates-grid.csv");
    setMsg("Grid exported");
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const grouped = useMemo(() => {
    if (groupBy === "none") return [{ key: "", rows }];
    const map = new Map<string, GridRow[]>();
    for (const r of rows) {
      let key = "";
      if (groupBy === "status") key = r.status_name;
      else if (groupBy === "shop") key = r.shop_display || "(no shop)";
      else if (groupBy === "wreck") key = r.wreck;
      else key = "";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return [...map.entries()].map(([key, groupRows]) => ({ key, rows: groupRows }));
  }, [rows, groupBy]);

  const totalPages = Math.max(1, Math.ceil((summary?.estimates ?? rows.length) / pageSize) || 1);
  const statusLabel = statuses
    .map((c) => ALL_STATUSES.find((s) => s.code === c)?.label ?? c)
    .join("; ");

  const tankDocComplete = rows.filter((r) => r.attachment_count > 0).length;

  return (
    <div className="min-h-screen bg-[#f3f4f6] text-sm">
      <div className="bg-[#8B1E1E] text-white px-4 py-2 flex items-center justify-between">
        <div className="font-semibold tracking-wide">
          Residco — Main — Default :: Estimates History
        </div>
        <button
          type="button"
          className="text-white/90 hover:text-white text-xs underline"
          onClick={() => loadGrid()}
        >
          Refresh
        </button>
      </div>

      <div className="p-3 space-y-3">
        <div className="flex flex-wrap gap-2 items-center text-xs">
          <Label className="text-xs">Views</Label>
          <Select value={activeView} onValueChange={applyView}>
            <SelectTrigger className="h-8 w-[220px] bg-white">
              <SelectValue placeholder="Default action queue" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Default action queue</SelectItem>
              {views.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" variant="outline" size="sm" className="h-8" onClick={saveCurrentView}>
            Save view
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-8" onClick={manageViews}>
            Manage views
          </Button>
        </div>

        <div className="grid gap-3 xl:grid-cols-[1.2fr_1fr_0.9fr]">
          {/* Search */}
          <fieldset className="border border-slate-300 bg-white rounded p-3 space-y-2">
            <legend className="px-1 text-xs font-semibold text-slate-700">Search</legend>
            <div className="grid gap-2">
              <div className="grid gap-1">
                <Label className="text-xs">Shop</Label>
                <Select value={shopId} onValueChange={(v) => { setShopId(v); setPage(1); }}>
                  <SelectTrigger className="h-8 bg-white">
                    <SelectValue placeholder="--- All Shop Locations ---" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">--- All Shop Locations ---</SelectItem>
                    {shops.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.display_label || s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1">
                  <Label className="text-xs">Initials</Label>
                  <Input
                    className="h-8"
                    value={carMark}
                    onChange={(e) => { setCarMark(e.target.value.toUpperCase()); setPage(1); }}
                  />
                </div>
                <div className="grid gap-1">
                  <Label className="text-xs">Number</Label>
                  <Input
                    className="h-8"
                    value={carNumber}
                    onChange={(e) => { setCarNumber(e.target.value); setPage(1); }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1">
                  <Label className="text-xs">Date Range</Label>
                  <div className="flex gap-1">
                    <Input
                      type="date"
                      className="h-8"
                      value={from}
                      onChange={(e) => { setFrom(e.target.value); setPage(1); }}
                    />
                    <Input
                      type="date"
                      className="h-8"
                      value={to}
                      onChange={(e) => { setTo(e.target.value); setPage(1); }}
                    />
                  </div>
                </div>
                <div className="grid gap-1">
                  <Label className="text-xs">Date Range Filter</Label>
                  <Select value={dateField} onValueChange={(v) => { setDateField(v); setPage(1); }}>
                    <SelectTrigger className="h-8 bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DATE_FIELDS.map((f) => (
                        <SelectItem key={f.value} value={f.value}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-1">
                <Label className="text-xs">Status</Label>
                <div className="flex gap-2 items-start">
                  <div className="flex-1 border rounded bg-slate-50 p-2 max-h-28 overflow-auto text-xs space-y-1">
                    <div className="text-slate-600 mb-1 truncate" title={statusLabel}>
                      {statusLabel || "(none)"}
                    </div>
                    {ALL_STATUSES.map((s) => (
                      <label key={s.code} className="flex items-center gap-2 cursor-pointer">
                        <Checkbox
                          checked={statuses.includes(s.code)}
                          onCheckedChange={() => toggleStatus(s.code)}
                        />
                        <span>{s.label}</span>
                      </label>
                    ))}
                  </div>
                  <div className="flex flex-col gap-1">
                    <Button type="button" size="icon" className="h-8 w-8" onClick={() => loadGrid()}>
                      <Search className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="h-8 w-8 text-red-600"
                      onClick={resetFilters}
                    >
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </fieldset>

          {/* Apply to Checked */}
          <fieldset className="border border-slate-300 bg-white rounded p-3 space-y-2">
            <legend className="px-1 text-xs font-semibold text-slate-700">
              Apply to Checked Estimates
            </legend>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" className="h-8 border-blue-500 text-blue-700" onClick={bulkApprove}>
                Approve
              </Button>
              <Button type="button" variant="outline" className="h-8" onClick={getBrc}>
                Get BRC
              </Button>
              <Button type="button" variant="outline" className="h-8" onClick={exportExcelSelection}>
                Excel
              </Button>
              <Button type="button" variant="outline" className="h-8" onClick={export500}>
                500
              </Button>
              <Button type="button" variant="outline" className="h-8 text-red-700" onClick={validateSelected}>
                Validate
              </Button>
            </div>
            <label className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={viewAutoApproval}
                onCheckedChange={(v) => setViewAutoApproval(Boolean(v))}
              />
              View Auto Approval Queue
            </label>
            <div className="text-xs text-slate-600">
              Tank Car Doc Complete ({tankDocComplete} estimates)
            </div>
          </fieldset>

          {/* Summary */}
          <fieldset className="border border-slate-300 bg-white rounded p-3">
            <legend className="px-1 text-xs font-semibold text-slate-700">Summary</legend>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-xs">
              <dt>Estimates:</dt>
              <dd className="text-right font-medium">{summary?.estimates ?? 0}</dd>
              <dt># of cars:</dt>
              <dd className="text-right font-medium">{summary?.cars ?? 0}</dd>
              <dt># of clients:</dt>
              <dd className="text-right font-medium">{summary?.clients ?? 0}</dd>
              <dt>Total Cost ($):</dt>
              <dd className="text-right font-medium">{money(summary?.totalCostDisplay)}</dd>
              <dt>$ per estimate:</dt>
              <dd className="text-right font-medium">{money(summary?.perEstimateDisplay)}</dd>
              <dt>$ per car:</dt>
              <dd className="text-right font-medium">{money(summary?.perCarDisplay)}</dd>
              <dt>$ per client:</dt>
              <dd className="text-right font-medium">{money(summary?.perClientDisplay)}</dd>
            </dl>
          </fieldset>
        </div>

        {error ? (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
            {error}
          </div>
        ) : null}
        {msg ? (
          <div className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">
            {msg}
          </div>
        ) : null}

        {/* Paging / export */}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span>
            Page {page} of {totalPages} ({summary?.estimates ?? rows.length} items)
          </span>
          <Button type="button" variant="ghost" size="sm" className="h-7" disabled={page <= 1} onClick={() => setPage(1)}>
            « First
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-7" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            ‹ Prev
          </Button>
          <span>Select Page: {page}</span>
          <Button type="button" variant="ghost" size="sm" className="h-7" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next ›
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-7" disabled={page >= totalPages} onClick={() => setPage(totalPages)}>
            Last »
          </Button>
          <Label className="text-xs ml-2">Items per page</Label>
          <Select
            value={String(pageSize)}
            onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}
          >
            <SelectTrigger className="h-7 w-[80px] bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[25, 50, 100, 250, 500].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value="export"
            onValueChange={(v) => {
              if (v === "csv" || v === "excel") exportGrid(v);
            }}
          >
            <SelectTrigger className="h-7 w-[130px] bg-white">
              <SelectValue placeholder="Export Grid" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="export" disabled>
                Export Grid
              </SelectItem>
              <SelectItem value="csv">CSV</SelectItem>
              <SelectItem value="excel">Excel (CSV)</SelectItem>
            </SelectContent>
          </Select>
          <Label className="text-xs">Group by</Label>
          <Select value={groupBy} onValueChange={setGroupBy}>
            <SelectTrigger className="h-7 w-[140px] bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="status">Status</SelectItem>
              <SelectItem value="shop">Shop</SelectItem>
              <SelectItem value="wreck">Wreck?</SelectItem>
            </SelectContent>
          </Select>
          <Label className="text-xs">Sort</Label>
          <Select value={sortBy} onValueChange={(v) => setSortBy(v)}>
            <SelectTrigger className="h-7 w-[160px] bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="created">Created</SelectItem>
              <SelectItem value="status">Status</SelectItem>
              <SelectItem value="total">Total</SelectItem>
              <SelectItem value="shop">Shop</SelectItem>
              <SelectItem value="estimate">Estimate</SelectItem>
              <SelectItem value="yard_arrival">Arrived At Yard</SelectItem>
              <SelectItem value="outbound_target">Outbound Target</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7"
            onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
          >
            {sortDir === "asc" ? "Asc" : "Desc"}
          </Button>
        </div>

        <div className="border border-slate-300 rounded bg-white overflow-hidden">
          <div className="bg-slate-100 text-slate-600 text-xs px-3 py-1.5 border-b border-slate-200">
            Drag a column header here to group by that column — use Group by above
            {groupBy !== "none" ? ` (grouped by ${groupBy})` : ""}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse min-w-[1600px]">
              <thead>
                <tr className="bg-slate-600 text-white">
                  <th className="px-2 py-2 text-left font-medium w-8">
                    <Checkbox
                      checked={rows.length > 0 && selected.size === rows.length}
                      onCheckedChange={toggleSelectAll}
                    />
                  </th>
                  {[
                    "Estimate",
                    "Status",
                    "Total",
                    "Issues?",
                    "Attachment",
                    "Shop Name",
                    "Arrived At Yard",
                    "Approval Requested",
                    "Approved",
                    "Terminated",
                    "Action",
                    "Outbound Target",
                    "Outbound Date",
                    "Invoice #",
                    "Bad Order Reason",
                    "CTC",
                    "Assignment",
                    "Wreck?",
                    "Dispo Req'd",
                    "Lease Type",
                    "Resp 6 Email",
                  ].map((h) => (
                    <th key={h} className="px-2 py-2 text-left font-medium whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={22} className="px-3 py-8 text-center text-slate-500">
                      Loading estimates…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={22} className="px-3 py-8 text-center text-slate-500">
                      No estimates match the current filters. Try filtering in Approved, or run{" "}
                      <code>npm run repair:seed:estimates-history</code>.
                    </td>
                  </tr>
                ) : (
                  grouped.map((g) => (
                    <Fragment key={g.key || "all"}>
                      {g.key ? (
                        <tr className="bg-slate-200">
                          <td colSpan={22} className="px-3 py-1 font-semibold">
                            {g.key} ({g.rows.length})
                          </td>
                        </tr>
                      ) : null}
                      {g.rows.map((r, idx) => (
                        <tr
                          key={r.estimate_id}
                          className={idx % 2 === 0 ? "bg-white" : "bg-sky-50/60"}
                        >
                          <td className="px-2 py-1.5 border-b border-slate-100">
                            <Checkbox
                              checked={selected.has(r.estimate_id)}
                              onCheckedChange={() => toggleSelect(r.estimate_id)}
                            />
                          </td>
                          <td className="px-2 py-1.5 border-b border-slate-100 whitespace-nowrap">
                            <Link
                              href={`/repair/estimates/${r.estimate_id}`}
                              className="text-blue-700 underline font-medium"
                            >
                              {r.estimate_label}
                            </Link>
                          </td>
                          <td className={`px-2 py-1.5 border-b border-slate-100 whitespace-nowrap ${statusClass(r.status_code)}`}>
                            {r.status_name}
                          </td>
                          <td className="px-2 py-1.5 border-b border-slate-100 text-right whitespace-nowrap">
                            {money(r.total_display)}
                          </td>
                          <td className="px-2 py-1.5 border-b border-slate-100">{r.issues}</td>
                          <td className="px-2 py-1.5 border-b border-slate-100 text-center">
                            {r.attachment_count > 0 ? (
                              <span className="inline-flex items-center gap-0.5 text-slate-700" title={`${r.attachment_count} attachment(s)`}>
                                <Paperclip className="h-3.5 w-3.5" />
                                {r.attachment_count > 1 ? r.attachment_count : null}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-2 py-1.5 border-b border-slate-100 whitespace-nowrap">
                            {r.shop_display}
                          </td>
                          <td className="px-2 py-1.5 border-b border-slate-100 whitespace-nowrap">
                            {fmtDate(r.yard_arrived_at)}
                          </td>
                          <td className="px-2 py-1.5 border-b border-slate-100 whitespace-nowrap">
                            {fmtDate(r.approval_requested_at)}
                          </td>
                          <td className="px-2 py-1.5 border-b border-slate-100 text-center">
                            {r.approved_at ? (
                              <span title={fmtDate(r.approved_at)} className="text-emerald-600 inline-flex">
                                <Check className="h-4 w-4" />
                              </span>
                            ) : (
                              <span className="text-emerald-600/40 inline-flex" title="Approve via bulk or estimate page">
                                <Check className="h-4 w-4" />
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 border-b border-slate-100 text-center">
                            <span className="text-red-600/70 inline-flex" title={r.terminated_at ? fmtDate(r.terminated_at) : "Terminate on estimate page"}>
                              <X className="h-4 w-4" />
                            </span>
                          </td>
                          <td className="px-2 py-1.5 border-b border-slate-100 text-center">
                            <Link
                              href={`/repair/estimates/${r.estimate_id}`}
                              className="text-slate-500 inline-flex"
                              title="Open estimate"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Link>
                          </td>
                          <td
                            className={`px-2 py-1.5 border-b border-slate-100 whitespace-nowrap ${
                              isOutboundOverdue(r.target_outbound_at)
                                ? "bg-red-600 text-white font-semibold"
                                : ""
                            }`}
                          >
                            {fmtDate(r.target_outbound_at)}
                          </td>
                          <td className="px-2 py-1.5 border-b border-slate-100 whitespace-nowrap">
                            {fmtDate(r.actual_outbound_at)}
                          </td>
                          <td className="px-2 py-1.5 border-b border-slate-100 whitespace-nowrap">
                            {r.invoice_no ?? ""}
                          </td>
                          <td className="px-2 py-1.5 border-b border-slate-100 whitespace-nowrap">
                            {r.bad_order_reason ? (
                              <span className="text-blue-700 underline">{r.bad_order_reason}</span>
                            ) : null}
                          </td>
                          <td className="px-2 py-1.5 border-b border-slate-100">{r.ctc ?? ""}</td>
                          <td className="px-2 py-1.5 border-b border-slate-100 max-w-[220px] truncate" title={r.assignment ?? ""}>
                            {r.assignment}
                          </td>
                          <td className="px-2 py-1.5 border-b border-slate-100">{r.wreck}</td>
                          <td className="px-2 py-1.5 border-b border-slate-100">{r.dispo_reqd}</td>
                          <td className="px-2 py-1.5 border-b border-slate-100 whitespace-nowrap">
                            {r.lease_type}
                          </td>
                          <td className="px-2 py-1.5 border-b border-slate-100 whitespace-nowrap">
                            {fmtDate(r.resp6_email_at)}
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between px-3 py-2 border-t border-slate-200 text-xs text-slate-600">
            <button
              type="button"
              className="text-blue-700 underline"
              onClick={() => setShowCreateFilter((v) => !v)}
            >
              Create Filter
            </button>
            <span>RLMS Repair · Estimates History</span>
          </div>
          {showCreateFilter ? (
            <div className="px-3 pb-3 text-xs text-slate-600">
              Use Search filters above (Shop, Status, Initials, Number, Date Range + Date Range Filter).
              Saved views keep the combination. Advanced AND builder lands with later grid polish.
            </div>
          ) : null}
        </div>

        {viewAutoApproval ? (
          <div className="text-xs text-slate-600 border border-dashed border-slate-300 rounded p-2 bg-white">
            Auto Approval Queue view is a placeholder flag for §A — no separate queue yet.
          </div>
        ) : null}
      </div>
    </div>
  );
}
