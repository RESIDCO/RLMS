/**
 * §I CRB file + invoice queue. `#/repair/crb`
 * Bulk action is mark reviewed only. Approval stays on the invoice.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import RepairOwnerShell from "./RepairOwnerShell";
import { RepairBreadcrumbs } from "./RepairNavChrome";
import { repairUi } from "./repairTokens";
import { shopAa } from "./RepairNavChrome";
import { CrbChip, crbJson, crbMoney, toneForStatus } from "./CrbUi";

type FileRow = {
  id: string;
  file_name: string;
  control_status: string;
  version_status: string;
  account_months: string[] | null;
  billed_party: string | null;
  uploaded_at: string;
  record_counts: Record<string, number> | null;
};

type UnmatchedHeader = {
  id: string;
  billing_party: string;
  invoice_number: string;
  account_month: string;
  total_cents: number | null;
  car_count: number | null;
  message: string;
};

type InvoiceRow = {
  id: string;
  invoice_number: string;
  billing_party: string;
  billed_party: string;
  account_date: string;
  status: string;
  grand_total_cents: number;
  car_count: number;
  cars_decided: number;
  cars_total: number;
  hard_stops: number;
  exceptions: number;
  control_ok: boolean;
  reviewed: boolean;
};

const STATUSES = ["", "PENDING", "IN_REVIEW", "READY", "APPROVED", "RETURN_UNPAID", "APPROVED_WITH_EXCEPTIONS"];

export default function CrbHome() {
  const [files, setFiles] = useState<FileRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [unmatched, setUnmatched] = useState<UnmatchedHeader[]>([]);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [biller, setBiller] = useState("");
  const [billedParty, setBilledParty] = useState("");
  const [accountMonth, setAccountMonth] = useState("");
  const [status, setStatus] = useState("");
  const [hasExceptions, setHasExceptions] = useState(false);
  const [hardStops, setHardStops] = useState(false);
  const [dueSoon, setDueSoon] = useState(false);
  const [minCents, setMinCents] = useState("");
  const [maxCents, setMaxCents] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setError("");
    const qs = new URLSearchParams();
    if (biller.trim()) qs.set("biller", biller.trim().toUpperCase());
    if (billedParty.trim()) qs.set("billedParty", billedParty.trim().toUpperCase());
    if (accountMonth.trim()) qs.set("accountMonth", accountMonth.trim());
    if (status) qs.set("status", status);
    if (hasExceptions) qs.set("hasExceptions", "1");
    if (hardStops) qs.set("hardStops", "1");
    if (dueSoon) qs.set("dueSoon", "1");
    if (minCents.trim()) qs.set("minCents", minCents.trim());
    if (maxCents.trim()) qs.set("maxCents", maxCents.trim());
    const [fileRes, invRes] = await Promise.all([
      fetch("/api/repair/crb/files"),
      fetch(`/api/repair/crb/invoices?${qs}`),
    ]);
    const fileJson = await crbJson<{ files: FileRow[] }>(fileRes);
    const invJson = await crbJson<{ invoices: InvoiceRow[]; unmatchedHeaders?: UnmatchedHeader[] }>(invRes);
    setFiles(fileJson.files ?? []);
    setInvoices(invJson.invoices ?? []);
    setUnmatched(invJson.unmatchedHeaders ?? []);
  }, [biller, billedParty, accountMonth, status, hasExceptions, hardStops, dueSoon, minCents, maxCents]);

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
  }, [load]);

  async function upload(file: File) {
    setError("");
    setMsg("");
    const body = new FormData();
    body.set("file", file);
    const res = await fetch("/api/repair/crb/files", { method: "POST", body });
    const json = await crbJson<{ noop?: boolean; controlStatus?: string }>(res);
    setMsg(json.noop ? "Same file already loaded (no-op)." : `Loaded. Control ${json.controlStatus}.`);
    await load();
  }

  async function markReviewed() {
    setError("");
    setMsg("");
    const res = await fetch("/api/repair/crb/invoices/mark-reviewed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: Array.from(selected) }),
    });
    const json = await crbJson<{ updated?: number }>(res);
    setMsg(`Marked reviewed: ${json.updated ?? 0}. Approval is not a bulk action.`);
    setSelected(new Set());
    await load();
  }

  function toggle(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <RepairOwnerShell>
      <div className={`${shopAa.page} p-3 space-y-3 max-w-[1200px]`}>
        <RepairBreadcrumbs items={[{ label: "Repair", href: "/repair" }, { label: "CRB" }]} />
        <h1 className="text-xl font-semibold">CRB staging</h1>
        <p className={shopAa.muted}>Upload a 500-byte DX (.txt, .dat, or a .zip with one text file). Re-uploading the same bytes is a no-op.</p>
        {error ? <div className={`${repairUi.badge} repair-chip-stop`}>{error}</div> : null}
        {msg ? <div className={repairUi.badge}>{msg}</div> : null}

        <section className={`${repairUi.panel} p-3 space-y-2`}>
          <h2 className="font-semibold">Files</h2>
          <label className={shopAa.label}>
            Upload DX
            <input
              className={repairUi.input}
              type="file"
              accept=".txt,.dat,.zip,text/plain"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file).catch((err) => setError(err instanceof Error ? err.message : "Upload failed"));
              }}
            />
          </label>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="text-left">File</th>
                <th className="text-left">Billed</th>
                <th className="text-left">Months</th>
                <th className="text-left">Control</th>
                <th className="text-left">Version</th>
              </tr>
            </thead>
            <tbody>
              {files.map((file) => (
                <tr key={file.id} className="border-t border-[var(--repair-border)]">
                  <td>{file.file_name}</td>
                  <td>{file.billed_party}</td>
                  <td>{(file.account_months ?? []).join(", ")}</td>
                  <td><CrbChip tone={toneForStatus(file.control_status)}>{file.control_status}</CrbChip></td>
                  <td>{file.version_status}</td>
                </tr>
              ))}
              {files.length === 0 ? <tr><td colSpan={5} className={shopAa.muted}>No files yet.</td></tr> : null}
            </tbody>
          </table>
        </section>

        <section className={`${repairUi.panel} p-3 space-y-2`}>
          <h2 className="font-semibold">Invoices</h2>
          <div className="flex flex-wrap gap-2 items-end">
            <label><span className={shopAa.label}>Biller</span><input className={repairUi.input} value={biller} onChange={(e) => setBiller(e.target.value)} /></label>
            <label><span className={shopAa.label}>Billed party</span><input className={repairUi.input} value={billedParty} onChange={(e) => setBilledParty(e.target.value)} /></label>
            <label><span className={shopAa.label}>Account month</span><input className={repairUi.input} value={accountMonth} onChange={(e) => setAccountMonth(e.target.value)} placeholder="YYMM" /></label>
            <label>
              <span className={shopAa.label}>Status</span>
              <select className={repairUi.select} value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUSES.map((item) => <option key={item || "all"} value={item}>{item || "All"}</option>)}
              </select>
            </label>
            <label><span className={shopAa.label}>Min cents</span><input className={repairUi.input} value={minCents} onChange={(e) => setMinCents(e.target.value)} /></label>
            <label><span className={shopAa.label}>Max cents</span><input className={repairUi.input} value={maxCents} onChange={(e) => setMaxCents(e.target.value)} /></label>
            <label className="flex items-center gap-1"><input className={repairUi.checkbox} type="checkbox" checked={hasExceptions} onChange={(e) => setHasExceptions(e.target.checked)} /> Exceptions</label>
            <label className="flex items-center gap-1"><input className={repairUi.checkbox} type="checkbox" checked={hardStops} onChange={(e) => setHardStops(e.target.checked)} /> Hard stops</label>
            <label className="flex items-center gap-1"><input className={repairUi.checkbox} type="checkbox" checked={dueSoon} onChange={(e) => setDueSoon(e.target.checked)} /> Due soon</label>
            <button type="button" className={repairUi.btnSecondary} onClick={() => void load()}>Refresh</button>
          </div>
          <button type="button" className={repairUi.btnPrimary} disabled={selected.size === 0} onClick={() => void markReviewed()}>
            Mark reviewed
          </button>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th />
                <th className="text-left">Invoice</th>
                <th className="text-left">Biller</th>
                <th className="text-left">Month</th>
                <th className="text-left">Total</th>
                <th className="text-left">Progress</th>
                <th className="text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-t border-[var(--repair-border)]">
                  <td>
                    <input className={repairUi.checkbox} type="checkbox" checked={selected.has(inv.id)} onChange={() => toggle(inv.id)} aria-label={`Select ${inv.invoice_number}`} />
                  </td>
                  <td><Link className={repairUi.link} href={`/repair/crb/invoice/${inv.id}`}>{inv.invoice_number}</Link></td>
                  <td>{inv.billing_party}</td>
                  <td>{inv.account_date}</td>
                  <td>{crbMoney(Number(inv.grand_total_cents))}</td>
                  <td>{Number(inv.cars_decided)}/{Number(inv.cars_total)} cars{Number(inv.hard_stops) > 0 ? ` · ${inv.hard_stops} hard stops` : ""}</td>
                  <td>
                    <CrbChip tone={toneForStatus(inv.control_ok ? inv.status : "OUT_OF_BALANCE")}>{inv.status}</CrbChip>
                    {inv.reviewed ? <span className={shopAa.muted}> reviewed</span> : null}
                  </td>
                </tr>
              ))}
              {invoices.length === 0 ? <tr><td colSpan={7} className={shopAa.muted}>No invoices match.</td></tr> : null}
            </tbody>
          </table>
          {unmatched.length > 0 ? (
            <div className="space-y-1">
              <h3 className="font-semibold">Biller headers without a CRB invoice</h3>
              <ul className="space-y-1">
                {unmatched.map((header) => (
                  <li key={header.id} className="flex flex-wrap items-center gap-2">
                    <CrbChip tone="warn">BILLER_INVOICE_WITHOUT_CRB</CrbChip>
                    <span>{header.billing_party} {header.invoice_number} {header.account_month}</span>
                    <span className={shopAa.muted}>{header.total_cents == null ? "" : crbMoney(Number(header.total_cents))}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      </div>
    </RepairOwnerShell>
  );
}
