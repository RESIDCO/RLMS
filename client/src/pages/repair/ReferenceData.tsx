/**
 * Gear → Reference Data — owner / system manager.
 * Tabs for every AAR/RESIDCO ref table; add/edit/retire/restore; import dry-run; export.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import RepairOwnerShell from "./RepairOwnerShell";
import { WorkspaceBanner } from "./WorkspaceTitle";
import { useRepairTheme } from "./repairTheme";

type TableMeta = {
  key: string;
  label: string;
  columns: string[];
  naturalKey: string[];
};

type RefRow = Record<string, unknown> & {
  id: string;
  active?: boolean;
  source?: string | null;
  description?: string | null;
  owner_override?: boolean;
};

const HIDDEN_EDIT = new Set([
  "active",
  "effective_to",
  "owner_override",
]);

function RefDataBody() {
  const { theme } = useRepairTheme();
  const dark = theme === "dark";
  const [tables, setTables] = useState<TableMeta[]>([]);
  const [tableKey, setTableKey] = useState("job_codes");
  const [rows, setRows] = useState<RefRow[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("");
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [activeOnly, setActiveOnly] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<Array<Record<string, unknown>>>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [importText, setImportText] = useState("");
  const [edition, setEdition] = useState("");
  const [quarter, setQuarter] = useState("");
  const [dryRun, setDryRun] = useState<{
    dryRunId: string;
    counts: Record<string, number>;
    committed: boolean;
  } | null>(null);

  const meta = useMemo(
    () => tables.find((t) => t.key === tableKey),
    [tables, tableKey],
  );

  const loadTables = useCallback(async () => {
    const res = await apiRequest("GET", "/api/repair/admin/ref-data/tables");
    const data = await res.json();
    setTables(data.tables ?? []);
  }, []);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (activeOnly) params.set("activeOnly", "1");
      if (sort) params.set("sort", sort);
      params.set("dir", dir);
      params.set("limit", "200");
      const res = await apiRequest(
        "GET",
        `/api/repair/admin/ref-data/${tableKey}?${params}`,
      );
      const data = await res.json();
      setRows(data.rows ?? []);
      setColumns(data.columns ?? []);
      setTotal(Number(data.total ?? 0));
      if (!sort && data.naturalKey?.[0]) setSort(String(data.naturalKey[0]));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [tableKey, q, activeOnly, sort, dir]);

  useEffect(() => {
    void loadTables().catch((e) =>
      setError(e instanceof Error ? e.message : "Tables failed"),
    );
  }, [loadTables]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  function startAdd() {
    setEditId(null);
    const blank: Record<string, string> = {};
    for (const c of columns) {
      if (!HIDDEN_EDIT.has(c)) blank[c] = c === "source" ? "RESIDCO" : "";
    }
    setForm(blank);
    setReason("");
  }

  function startEdit(row: RefRow) {
    setEditId(row.id);
    const next: Record<string, string> = {};
    for (const c of columns) {
      if (HIDDEN_EDIT.has(c)) continue;
      next[c] = row[c] == null ? "" : String(row[c]);
    }
    setForm(next);
    setReason("");
  }

  async function saveRow() {
    setError("");
    setMsg("");
    if (!reason.trim()) {
      setError("Reason required for every change");
      return;
    }
    try {
      await apiRequest("POST", `/api/repair/admin/ref-data/${tableKey}`, {
        id: editId ?? undefined,
        values: {
          ...form,
          owner_override: form.source?.toUpperCase() === "RESIDCO",
        },
        reason,
      });
      setMsg(editId ? "Updated." : "Added (source=RESIDCO).");
      setEditId(null);
      setForm({});
      await loadRows();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
  }

  async function retire(id: string) {
    const r = reason.trim() || window.prompt("Reason to retire?") || "";
    if (!r.trim()) {
      setError("Reason required");
      return;
    }
    try {
      await apiRequest(
        "POST",
        `/api/repair/admin/ref-data/${tableKey}/${id}/retire`,
        { reason: r },
      );
      setMsg("Retired (inactive + effective_to). Never hard-deleted.");
      await loadRows();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Retire failed");
    }
  }

  async function restore(id: string) {
    const r = reason.trim() || window.prompt("Reason to restore?") || "";
    if (!r.trim()) {
      setError("Reason required");
      return;
    }
    try {
      await apiRequest(
        "POST",
        `/api/repair/admin/ref-data/${tableKey}/${id}/restore`,
        { reason: r },
      );
      setMsg("Restored.");
      await loadRows();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restore failed");
    }
  }

  async function loadHistory(rowId?: string) {
    setShowHistory(true);
    const params = rowId ? `?rowId=${rowId}` : "";
    const res = await apiRequest(
      "GET",
      `/api/repair/admin/ref-data/${tableKey}/history${params}`,
    );
    const data = await res.json();
    setHistory(data.rows ?? []);
  }

  async function runDryImport() {
    setError("");
    setMsg("");
    setDryRun(null);
    try {
      const res = await apiRequest(
        "POST",
        `/api/repair/admin/ref-data/${tableKey}/import/dry-run`,
        { csvText: importText, edition, quarter },
      );
      const data = await res.json();
      setDryRun({
        dryRunId: data.dryRunId,
        counts: data.counts,
        committed: false,
      });
      setMsg(
        `Dry-run only — added=${data.counts.added} changed=${data.counts.changed} retired=${data.counts.retired} conflicts=${data.counts.conflicts} (not committed)`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Dry-run failed");
    }
  }

  async function confirmImport() {
    if (!dryRun || dryRun.committed) {
      setError("Run dry-run first");
      return;
    }
    const r = reason.trim() || "Quarterly AAR import confirm";
    try {
      const res = await apiRequest(
        "POST",
        `/api/repair/admin/ref-data/${tableKey}/import/confirm`,
        {
          csvText: importText,
          dryRunId: dryRun.dryRunId,
          edition,
          quarter,
          reason: r,
        },
      );
      const data = await res.json();
      setDryRun({ ...dryRun, committed: true });
      setMsg(`Import confirmed — applied=${data.applied}`);
      await loadRows();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Confirm failed");
    }
  }

  async function exportCsv() {
    const res = await apiRequest(
      "GET",
      `/api/repair/admin/ref-data/${tableKey}/export`,
    );
    const text = await res.text();
    const blob = new Blob([text], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${tableKey}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const panel = dark
    ? "border-slate-600 bg-slate-800/80"
    : "border-slate-400 repair-panel-muted-bg";
  const inputCls = dark
    ? "h-8 bg-slate-900 text-slate-100 border-slate-500"
    : "h-8 bg-white text-slate-900 border-slate-500";

  const displayCols = columns.filter((c) =>
    [
      "job_code",
      "code",
      "qualifier",
      "description",
      "rule",
      "source",
      "rule_page",
      "edition",
      "effective_quarter",
      "active",
      "effective_to",
      "owner_override",
      "price_key",
      "label",
      "require_on",
      "combo_key",
      "import_key",
      "chart_group",
    ].includes(c),
  );

  return (
    <div
      className={
        dark
          ? "min-h-full bg-slate-950 text-sm text-slate-100"
          : "min-h-full repair-page-bg text-sm"
      }
    >
      <WorkspaceBanner pageTitle="Reference Data" />
      <div className="p-3 space-y-3 max-w-[1200px]">
        <p className={dark ? "text-slate-300 text-xs" : "text-slate-700 text-xs"}>
          Owner / system manager only. Soft-retire never hard-deletes. Manual
          rows are source=RESIDCO; AAR import wins unless owner override.
        </p>

        <div className="flex flex-wrap gap-1">
          {tables.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setTableKey(t.key);
                setDryRun(null);
                setShowHistory(false);
              }}
              className={
                t.key === tableKey
                  ? "px-2 py-1 rounded text-xs font-semibold repair-nav-item-active"
                  : dark
                    ? "px-2 py-1 rounded text-xs border border-slate-600 hover:bg-slate-800"
                    : "px-2 py-1 rounded text-xs border border-slate-400 hover:bg-white"
              }
            >
              {t.label}
            </button>
          ))}
        </div>

        {error ? (
          <div className="text-red-700 bg-red-50 border border-red-300 px-3 py-2 rounded">
            {error}
          </div>
        ) : null}
        {msg ? (
          <div className="text-emerald-800 bg-emerald-50 border border-emerald-300 px-3 py-2 rounded">
            {msg}
          </div>
        ) : null}

        <div className={`border rounded-md p-3 space-y-2 ${panel}`}>
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-[12rem]">
              <Label className="text-xs">Search</Label>
              <Input
                className={inputCls}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filter code / description / source…"
              />
            </div>
            <label className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={activeOnly}
                onChange={(e) => setActiveOnly(e.target.checked)}
              />
              Active only
            </label>
            <Button type="button" size="sm" variant="outline" onClick={() => void loadRows()}>
              Refresh
            </Button>
            <Button type="button" size="sm" onClick={startAdd}>
              Add
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => void exportCsv()}>
              Export CSV
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void loadHistory()}
            >
              History
            </Button>
          </div>
          <div className="text-xs opacity-80">
            {meta?.label ?? tableKey}: {total} rows
            {loading ? " (loading…)" : ""}
          </div>
        </div>

        {(editId !== null || Object.keys(form).length > 0) && (
          <div className={`border rounded-md p-3 space-y-2 ${panel}`}>
            <div className="font-semibold text-xs uppercase tracking-wide">
              {editId ? "Edit row" : "Add row"}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {columns
                .filter((c) => !HIDDEN_EDIT.has(c))
                .slice(0, 12)
                .map((c) => (
                  <div key={c}>
                    <Label className="text-[10px]">{c}</Label>
                    <Input
                      className={inputCls}
                      value={form[c] ?? ""}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, [c]: e.target.value }))
                      }
                    />
                  </div>
                ))}
            </div>
            <div>
              <Label className="text-xs">Reason (required, audited)</Label>
              <Input
                className={inputCls}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why this change?"
              />
            </div>
            <div className="flex gap-2">
              <Button type="button" size="sm" onClick={() => void saveRow()}>
                Save
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditId(null);
                  setForm({});
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        <div className={`border rounded-md overflow-auto ${panel}`}>
          <table className="w-full text-xs">
            <thead>
              <tr className={dark ? "bg-slate-900" : "bg-slate-200"}>
                {displayCols.map((c) => (
                  <th key={c} className="text-left p-1.5 font-semibold">
                    <button
                      type="button"
                      className="underline-offset-2 hover:underline"
                      onClick={() => {
                        if (sort === c) setDir(dir === "asc" ? "desc" : "asc");
                        else {
                          setSort(c);
                          setDir("asc");
                        }
                      }}
                    >
                      {c}
                      {sort === c ? (dir === "asc" ? " ↑" : " ↓") : ""}
                    </button>
                  </th>
                ))}
                <th className="p-1.5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className={
                    dark
                      ? "border-t border-slate-700"
                      : "border-t border-slate-300"
                  }
                >
                  {displayCols.map((c) => (
                    <td key={c} className="p-1.5 max-w-[10rem] truncate" title={String(row[c] ?? "")}>
                      {c === "active"
                        ? row.active
                          ? "yes"
                          : "retired"
                        : String(row[c] ?? "")}
                    </td>
                  ))}
                  <td className="p-1.5 whitespace-nowrap space-x-1">
                    <button
                      type="button"
                      className="text-sky-700 underline"
                      onClick={() => startEdit(row)}
                    >
                      Edit
                    </button>
                    {row.active ? (
                      <button
                        type="button"
                        className="text-amber-800 underline"
                        onClick={() => void retire(row.id)}
                      >
                        Retire
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="text-emerald-800 underline"
                        onClick={() => void restore(row.id)}
                      >
                        Restore
                      </button>
                    )}
                    <button
                      type="button"
                      className="text-slate-600 underline"
                      onClick={() => void loadHistory(row.id)}
                    >
                      Hist
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={displayCols.length + 1}
                    className="p-3 text-center opacity-70"
                  >
                    No rows
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className={`border rounded-md p-3 space-y-2 ${panel}`}>
          <div className="font-semibold text-xs uppercase tracking-wide">
            Quarterly import (CSV / paste from Excel)
          </div>
          <div className="grid grid-cols-2 gap-2 max-w-md">
            <div>
              <Label className="text-xs">Edition</Label>
              <Input
                className={inputCls}
                value={edition}
                onChange={(e) => setEdition(e.target.value)}
                placeholder="e.g. CRB-2026Q3"
              />
            </div>
            <div>
              <Label className="text-xs">Quarter</Label>
              <Input
                className={inputCls}
                value={quarter}
                onChange={(e) => setQuarter(e.target.value)}
                placeholder="e.g. 2026Q3"
              />
            </div>
          </div>
          <Textarea
            className={dark ? "bg-slate-900 border-slate-500 min-h-[6rem]" : "bg-white min-h-[6rem]"}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder="Paste CSV header + rows for this table…"
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => void runDryImport()}>
              Dry-run diff
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!dryRun || dryRun.committed}
              onClick={() => void confirmImport()}
            >
              Confirm import
            </Button>
          </div>
          {dryRun ? (
            <pre className="text-[11px] opacity-90 whitespace-pre-wrap">
              {JSON.stringify(dryRun.counts, null, 2)}
              {dryRun.committed ? "\n(committed)" : "\n(not committed)"}
            </pre>
          ) : null}
        </div>

        {showHistory ? (
          <div className={`border rounded-md p-3 space-y-2 ${panel}`}>
            <div className="flex justify-between items-center">
              <div className="font-semibold text-xs uppercase">Change history</div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setShowHistory(false)}
              >
                Close
              </Button>
            </div>
            <ul className="space-y-1 text-xs max-h-64 overflow-auto">
              {history.map((h) => (
                <li key={String(h.id)} className="border-b border-border/40 pb-1">
                  <span className="font-mono">{String(h.action)}</span>{" "}
                  {String(h.natural_key)} — {String(h.reason)}{" "}
                  <span className="opacity-70">
                    by {String(h.actor)} @ {String(h.created_at)}
                  </span>
                </li>
              ))}
              {history.length === 0 ? <li>No history yet.</li> : null}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function ReferenceData() {
  return (
    <RepairOwnerShell>
      <RefDataBody />
    </RepairOwnerShell>
  );
}
