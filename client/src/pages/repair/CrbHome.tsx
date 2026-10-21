/**
 * §I r2 Invoice Worklist. `#/repair/crb`
 * Dense master rows, car children, line grandchildren.
 * Bulk action is mark reviewed only. Approval stays on the car or invoice.
 */
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import RepairOwnerShell from "./RepairOwnerShell";
import { RepairBreadcrumbs } from "./RepairNavChrome";
import { repairUi } from "./repairTokens";
import { shopAa } from "./RepairNavChrome";
import { CrbCarTable, type CrbGridCar } from "./CrbGrid";
import { CrbChip, crbCarTokens, crbJson, crbMoney, crbPct, toneForStatus, type ChipTone } from "./CrbUi";

type FileRow = {
  id: string;
  file_name: string;
  control_status: string;
  version_status: string;
  account_months: string[] | null;
  billed_party: string | null;
};

type UnmatchedHeader = {
  id: string;
  billing_party: string;
  invoice_number: string;
  account_month: string;
  total_cents: number | null;
};

type Countdown = { key: string; label: string; daysLeft: number | null; tone: ChipTone; text: string };
type Panel = {
  pct?: number | null;
  suggestedLabel?: string;
  countdowns?: Countdown[];
};

type InvoiceRow = {
  id: string;
  invoice_number: string;
  billing_party: string;
  billed_party: string;
  account_date: string;
  status: string;
  grand_total_cents: number;
  cars_decided: number;
  cars_total: number;
  hard_stops: number;
  control_ok: boolean;
  reviewed: boolean;
  error_panel: Panel | null;
};

type InvoiceDetail = {
  id: string;
  cars: CrbGridCar[];
};

const STATUSES = ["", "PENDING", "IN_REVIEW", "READY", "APPROVED", "RETURN_UNPAID", "APPROVED_WITH_EXCEPTIONS"];

function nearestDeadline(panel: Panel | null): string {
  const dated = (panel?.countdowns ?? []).filter((item) => item.daysLeft != null);
  if (!dated.length) return "None";
  dated.sort((a, b) => Number(a.daysLeft) - Number(b.daysLeft));
  return `${dated[0].daysLeft}d · ${dated[0].label}`;
}

function suggestedTone(label: string | undefined): ChipTone {
  if (!label) return "info";
  if (label.startsWith("Return unpaid")) return "stop";
  if (label.startsWith("N/A")) return "info";
  return "ok";
}

export default function CrbHome() {
  const [files, setFiles] = useState<FileRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [details, setDetails] = useState<Record<string, InvoiceDetail>>({});
  const [open, setOpen] = useState<Set<string>>(new Set());
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
  const [carDraft, setCarDraft] = useState("");
  const [carQuery, setCarQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expandSignal, setExpandSignal] = useState(0);
  const listGen = useRef(0);

  const tokens = crbCarTokens(carQuery);

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
    const carTokens = crbCarTokens(carQuery);
    if (carTokens.length) qs.set("cars", carTokens.join(","));
    const [fileRes, invRes] = await Promise.all([
      fetch("/api/repair/crb/files"),
      fetch(`/api/repair/crb/invoices?${qs}`),
    ]);
    const fileJson = await crbJson<{ files: FileRow[] }>(fileRes);
    const invJson = await crbJson<{ invoices: InvoiceRow[]; unmatchedHeaders?: UnmatchedHeader[] }>(invRes);
    setFiles(fileJson.files ?? []);
    setInvoices(invJson.invoices ?? []);
    setUnmatched(invJson.unmatchedHeaders ?? []);
  }, [biller, billedParty, accountMonth, status, hasExceptions, hardStops, dueSoon, minCents, maxCents, carQuery]);

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
  }, [load]);

  const refreshInvoice = useCallback(async (id: string) => {
    const res = await fetch(`/api/repair/crb/invoices/${id}`);
    const json = await crbJson<InvoiceDetail>(res);
    setDetails((cur) => ({ ...cur, [id]: json }));
  }, []);

  useEffect(() => {
    if (!tokens.length) return;
    let cancelled = false;
    const ids = invoices.map((inv) => inv.id);
    setOpen(new Set(ids));
    void Promise.all(ids.map(async (id) => {
      const res = await fetch(`/api/repair/crb/invoices/${id}`);
      const json = await crbJson<InvoiceDetail>(res);
      if (!cancelled) setDetails((cur) => ({ ...cur, [id]: json }));
    })).catch((e) => {
      if (!cancelled) setError(e instanceof Error ? e.message : "Car search failed");
    });
    return () => {
      cancelled = true;
    };
  }, [carQuery, invoices]);

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

  function toggleSelected(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function expandAllInvoices() {
    const gen = ++listGen.current;
    const ids = invoices.map((inv) => inv.id);
    await Promise.all(ids.map((id) => refreshInvoice(id)));
    if (gen !== listGen.current) return;
    setOpen(new Set(ids));
    setExpandSignal((n) => n + 1);
  }

  function collapseAllInvoices() {
    listGen.current += 1;
    setOpen(new Set());
    setExpandSignal(0);
  }

  async function toggleInvoice(id: string) {
    const next = new Set(open);
    if (next.has(id)) {
      next.delete(id);
      setOpen(next);
      return;
    }
    next.add(id);
    setOpen(next);
    if (!details[id]) await refreshInvoice(id);
  }

  return (
    <RepairOwnerShell>
      <div className={`${shopAa.page} p-3 space-y-3`}>
        <RepairBreadcrumbs items={[{ label: "Worklist" }]} />
        <h1 className="text-xl font-semibold">Invoice Worklist</h1>
        {error ? <div className={`${repairUi.badge} repair-chip-stop`}>{error}</div> : null}
        {msg ? <div className={repairUi.badge}>{msg}</div> : null}

        <section className={`${repairUi.panel} p-3 space-y-2`}>
          <div className="flex flex-wrap gap-3 items-end">
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
            <p className={shopAa.muted}>Same bytes are a no-op. {files.length} file{files.length === 1 ? "" : "s"}.</p>
          </div>
          <table className="crb-grid">
            <thead>
              <tr>
                <th>File</th>
                <th>Billed</th>
                <th>Months</th>
                <th>Control</th>
                <th>Version</th>
              </tr>
            </thead>
            <tbody>
              {files.map((file) => (
                <tr key={file.id}>
                  <td>{file.file_name}</td>
                  <td>{file.billed_party}</td>
                  <td>{(file.account_months ?? []).join(", ")}</td>
                  <td><CrbChip tone={toneForStatus(file.control_status)}>{file.control_status}</CrbChip></td>
                  <td>{file.version_status}</td>
                </tr>
              ))}
              {files.length === 0 ? <tr><td colSpan={5}>No files yet.</td></tr> : null}
            </tbody>
          </table>
        </section>

        <div className="crb-filter">
          <label>Biller<input className={repairUi.input} value={biller} onChange={(e) => setBiller(e.target.value)} /></label>
          <label>Billed party<input className={repairUi.input} value={billedParty} onChange={(e) => setBilledParty(e.target.value)} /></label>
          <label>Account month<input className={repairUi.input} value={accountMonth} onChange={(e) => setAccountMonth(e.target.value)} placeholder="YYMM" /></label>
          <label>
            Status
            <select className={repairUi.select} value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((item) => <option key={item || "all"} value={item}>{item || "All"}</option>)}
            </select>
          </label>
          <label>Min cents<input className={repairUi.input} value={minCents} onChange={(e) => setMinCents(e.target.value)} /></label>
          <label>Max cents<input className={repairUi.input} value={maxCents} onChange={(e) => setMaxCents(e.target.value)} /></label>
          <label className="crb-check"><input className={repairUi.checkbox} type="checkbox" checked={hasExceptions} onChange={(e) => setHasExceptions(e.target.checked)} /> Exceptions</label>
          <label className="crb-check"><input className={repairUi.checkbox} type="checkbox" checked={hardStops} onChange={(e) => setHardStops(e.target.checked)} /> Hard stops only</label>
          <label className="crb-check"><input className={repairUi.checkbox} type="checkbox" checked={dueSoon} onChange={(e) => setDueSoon(e.target.checked)} /> Due soon</label>
          <button type="button" className={repairUi.btnSecondary} onClick={() => void load()}>Refresh</button>
          <button type="button" className={repairUi.btnPrimary} disabled={selected.size === 0} onClick={() => void markReviewed()}>
            Mark reviewed
          </button>
        </div>

        <div className="crb-worklist">
          <div className="overflow-x-auto">
            <div className="flex flex-wrap gap-2 mb-2">
              <button type="button" className={repairUi.btnSecondary} aria-label="Expand all invoices" onClick={() => void expandAllInvoices().catch((err) => setError(err instanceof Error ? err.message : "Expand failed"))}>
                Expand all
              </button>
              <button type="button" className={repairUi.btnSecondary} aria-label="Collapse all invoices" onClick={collapseAllInvoices}>
                Collapse all
              </button>
            </div>
            <table className="crb-grid">
              <thead>
                <tr>
                  <th />
                  <th />
                  <th>Billing party</th>
                  <th>Invoice no</th>
                  <th>Acct month</th>
                  <th>Cars reviewed</th>
                  <th>Total</th>
                  <th>Error %</th>
                  <th>Suggested action</th>
                  <th>Nearest deadline</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const expanded = open.has(inv.id);
                  const detail = details[inv.id];
                  const panel = inv.error_panel;
                  return (
                    <Fragment key={inv.id}>
                      <tr>
                        <td>
                          <input className={repairUi.checkbox} type="checkbox" checked={selected.has(inv.id)} onChange={() => toggleSelected(inv.id)} aria-label={`Select ${inv.invoice_number}`} />
                        </td>
                        <td>
                          <button type="button" className={repairUi.btnSecondary} aria-expanded={expanded} onClick={() => void toggleInvoice(inv.id).catch((err) => setError(err instanceof Error ? err.message : "Load failed"))}>
                            {expanded ? "Hide cars" : "Show cars"}
                          </button>
                        </td>
                        <td>{inv.billing_party}</td>
                        <td><Link className={repairUi.link} href={`/repair/crb/invoice/${inv.id}`}>{inv.invoice_number}</Link></td>
                        <td>{inv.account_date}</td>
                        <td>{Number(inv.cars_decided)}/{Number(inv.cars_total)}</td>
                        <td>{crbMoney(Number(inv.grand_total_cents))}</td>
                        <td>{crbPct(panel?.pct ?? null)}</td>
                        <td><CrbChip tone={suggestedTone(panel?.suggestedLabel)}>{panel?.suggestedLabel || "Not calculated"}</CrbChip></td>
                        <td>{nearestDeadline(panel)}</td>
                        <td>
                          <CrbChip tone={toneForStatus(inv.control_ok ? inv.status : "OUT_OF_BALANCE")}>{inv.status}</CrbChip>
                          {inv.reviewed ? <span> reviewed</span> : null}
                          {Number(inv.hard_stops) > 0 ? <span> · {inv.hard_stops} hard stops</span> : null}
                        </td>
                      </tr>
                      {expanded ? (
                        <tr>
                          <td />
                          <td colSpan={10}>
                            {detail ? (
                              <CrbCarTable
                                invoiceId={inv.id}
                                cars={detail.cars}
                                tokens={tokens}
                                expandSignal={expandSignal}
                                onChanged={async () => {
                                  await load();
                                  await refreshInvoice(inv.id);
                                }}
                              />
                            ) : <p>Loading cars…</p>}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
                {invoices.length === 0 ? <tr><td colSpan={11}>No invoices match.</td></tr> : null}
              </tbody>
            </table>
            {unmatched.length > 0 ? (
              <div className="space-y-1 mt-3">
                <h2 className="font-semibold">Biller headers without a CRB invoice</h2>
                <ul className="space-y-1">
                  {unmatched.map((header) => (
                    <li key={header.id} className="flex flex-wrap items-center gap-2">
                      <CrbChip tone="warn">BILLER_INVOICE_WITHOUT_CRB</CrbChip>
                      <span>{header.billing_party} {header.invoice_number} {header.account_month}</span>
                      <span>{header.total_cents == null ? "" : crbMoney(Number(header.total_cents))}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
          <aside className="crb-side" aria-label="Enter car numbers">
            <h2 className="font-semibold">Enter car numbers</h2>
            <p>Paste a list to find those cars across invoices.</p>
            <textarea
              className={repairUi.textarea}
              rows={10}
              value={carDraft}
              onChange={(e) => setCarDraft(e.target.value)}
              aria-label="Enter car numbers"
              placeholder={"100010\nDEMO 100098"}
            />
            <button type="button" className={repairUi.btnPrimary} onClick={() => setCarQuery(carDraft)}>
              Search
            </button>
            <button type="button" className={repairUi.btnSecondary} onClick={() => { setCarDraft(""); setCarQuery(""); }}>
              Clear
            </button>
            {tokens.length ? <p>{invoices.length} invoice{invoices.length === 1 ? " includes" : "s include"} the list.</p> : null}
          </aside>
        </div>
      </div>
    </RepairOwnerShell>
  );
}
