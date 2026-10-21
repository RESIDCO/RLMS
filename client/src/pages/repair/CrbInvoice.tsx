/**
 * §I CRB invoice master. `#/repair/crb/invoice/:id`
 */
import { useCallback, useEffect, useState } from "react";
import { useRoute } from "wouter";
import RepairOwnerShell from "./RepairOwnerShell";
import { RepairBreadcrumbs, shopAa } from "./RepairNavChrome";
import { repairUi } from "./repairTokens";
import { CrbCarTable } from "./CrbGrid";
import { CrbChip, crbJson, crbMoney, crbPct, toneForStatus, type ChipTone } from "./CrbUi";

type Countdown = { key: string; label: string; tone: ChipTone; text: string };
type Panel = {
  suggestedLabel?: string;
  pct?: number | null;
  limitPct?: number | null;
  netCents?: number;
  totalCents?: number;
  exceeds?: boolean;
  belowMinimum?: boolean;
  aggregateCents?: number;
  minAggregateCents?: number;
  na?: boolean;
  improperlyRendered?: boolean;
  headerOrLine?: string | null;
  countdowns?: Countdown[];
  exemptTypesPresent?: string[];
};
type CarRow = {
  id: string;
  car_initial: string;
  car_number: string;
  status: string;
  flags: string[] | null;
  lessee_name: string | null;
  owned_on_repair_date: boolean | null;
  total_cents: number;
  labor_cents?: number;
  material_cents?: number;
  line_count: number;
  finding_count?: number;
};
type Subtotal = {
  detailSource: string;
  count: number;
  laborCents: number;
  materialCents: number;
};
type Finding = {
  id: string;
  rule_code: string;
  severity: string | null;
  message: string;
  status: string;
  amount_in_question_cents: number;
};
type Pkg = { id: string; type: string; letter_seq: number; status: string; filed_at: string | null };
type Month = { id: string; monthLabel: string; status: string };
type Invoice = {
  id: string;
  invoice_number: string;
  billing_party: string;
  billed_party: string;
  account_date: string;
  status: string;
  grand_total_cents: number;
  car_count: number;
  control_ok: boolean;
  receipt_date: string | null;
  currency: string | null;
  error_panel: Panel | null;
  detail_subtotals: Subtotal[] | null;
  cars: CarRow[];
  findings: Finding[];
  packages: Pkg[];
  biller_total_cents: number | null;
  biller_car_count: number | null;
};

const PACKAGE_TYPES = [
  ["RETURN_UNPAID_HEADER", "Return unpaid (header)"],
  ["RETURN_UNPAID_LINES", "Return unpaid (lines)"],
  ["PAID_EXCEPTION_LETTER_n", "Paid exception letter"],
  ["REBUTTAL_DR_JR", "DR/JR rebuttal"],
  ["RULE122_PACKET", "Rule 122 packet"],
] as const;

export default function CrbInvoice() {
  const [, params] = useRoute("/repair/crb/invoice/:id");
  const id = params?.id ?? "";
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [months, setMonths] = useState<Month[]>([]);
  const [monthId, setMonthId] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    const [invRes, monthRes] = await Promise.all([
      fetch(`/api/repair/crb/invoices/${id}`),
      fetch("/api/repair/accounting-months"),
    ]);
    setInvoice(await crbJson<Invoice>(invRes));
    const monthJson = await crbJson<{ months: Month[] }>(monthRes);
    setMonths(monthJson.months ?? []);
  }, [id]);

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
  }, [load]);

  if (!invoice) {
    return (
      <RepairOwnerShell>
        <div className={`${shopAa.page} p-3`}>{error || "Loading invoice…"}</div>
      </RepairOwnerShell>
    );
  }

  const panel = invoice.error_panel;
  const pending = invoice.cars.filter((car) => car.status === "PENDING").length;
  const hard = invoice.findings.filter((f) => f.severity === "HARD_STOP" && f.status === "OPEN").length;
  const approveBlocked = pending > 0 || hard > 0;
  const returnBlocked = pending > 0;

  async function setStatus(status: "APPROVED" | "RETURN_UNPAID" | "APPROVED_WITH_EXCEPTIONS") {
    setError("");
    setMsg("");
    const res = await fetch(`/api/repair/crb/invoices/${invoice!.id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, monthBucketId: monthId || null }),
    });
    const json = await crbJson<{ monthLabel?: string | null; poolLines?: number }>(res);
    setMsg(`${status}${json.monthLabel ? ` → ${json.monthLabel}` : ""}${json.poolLines != null ? ` (${json.poolLines} pool lines)` : ""}`);
    await load();
  }

  async function makePackage(type: string) {
    setError("");
    setMsg("");
    const res = await fetch(`/api/repair/crb/invoices/${invoice!.id}/packages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type }),
    });
    const json = await crbJson<{ fileName?: string }>(res);
    setMsg(`Draft package ${json.fileName ?? type} written locally. Nothing was sent.`);
    await load();
  }

  async function markFiled(packageId: string) {
    const filedAt = new Date().toISOString().slice(0, 10);
    const res = await fetch(`/api/repair/crb/packages/${packageId}/filed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filedAt }),
    });
    await crbJson(res);
    setMsg(`Marked filed manually ${filedAt}`);
    await load();
  }

  return (
    <RepairOwnerShell>
      <div className={`${shopAa.page} p-3 space-y-3`}>
        <RepairBreadcrumbs
          items={[
            { label: "Worklist", href: "/repair/crb" },
            { label: `${invoice.billing_party} ${invoice.invoice_number}` },
          ]}
        />
        <h1 className="text-xl font-semibold">
          {invoice.billing_party} {invoice.invoice_number}
        </h1>
        {error ? <div className={`${repairUi.badge} repair-chip-stop`}>{error}</div> : null}
        {msg ? <div className={repairUi.badge}>{msg}</div> : null}

        <dl className="crb-field-strip">
          <div><dt>Billing party</dt><dd>{invoice.billing_party}</dd></div>
          <div><dt>Invoice no</dt><dd>{invoice.invoice_number}</dd></div>
          <div><dt>Billed party</dt><dd>{invoice.billed_party}</dd></div>
          <div><dt>Acct month</dt><dd>{invoice.account_date}</dd></div>
          <div><dt>Currency</dt><dd>{invoice.currency || "—"}</dd></div>
          <div><dt>Receipt</dt><dd>{invoice.receipt_date ?? "unset"}</dd></div>
          <div><dt>Total</dt><dd>{crbMoney(Number(invoice.grand_total_cents))}</dd></div>
          <div><dt>Status</dt><dd><CrbChip tone={toneForStatus(invoice.status)}>{invoice.status}</CrbChip></dd></div>
          <div>
            <dt>Control check</dt>
            <dd><CrbChip tone={invoice.control_ok ? "ok" : "stop"}>{invoice.control_ok ? "In balance" : "Out of balance"}</CrbChip></dd>
          </div>
          <div>
            <dt>Biller match</dt>
            <dd>
              {invoice.biller_total_cents != null
                ? `${crbMoney(Number(invoice.biller_total_cents))} · ${invoice.biller_car_count} cars`
                : "No biller invoice header matched."}
            </dd>
          </div>
          <div>
            <dt>Error %</dt>
            <dd>
              {panel ? `${panel.na ? "N/A" : crbPct(panel.pct ?? null)} of ${crbMoney(panel.totalCents)} · net ${crbMoney(panel.netCents)} · limit ${panel.limitPct ?? "n/a"}%` : "Panel not calculated yet."}
            </dd>
          </div>
          <div>
            <dt>Suggested action</dt>
            <dd>
              <CrbChip tone={panel?.exceeds || panel?.improperlyRendered ? "stop" : "ok"}>{panel?.suggestedLabel || "Not calculated"}</CrbChip>
              {panel?.headerOrLine ? <span> Choose header-level or line-level return.</span> : null}
            </dd>
          </div>
          <div className="crb-field-wide">
            <dt>Subtotals</dt>
            <dd>
              {(invoice.detail_subtotals ?? []).length === 0 ? "None" : (invoice.detail_subtotals ?? []).map((row) => (
                <span key={row.detailSource} className="mr-3">
                  {row.detailSource}: {row.count} lines, labor {crbMoney(row.laborCents)}, material {crbMoney(row.materialCents)}
                </span>
              ))}
            </dd>
          </div>
          <div className="crb-field-wide">
            <dt>Countdowns</dt>
            <dd className="flex flex-wrap gap-2">
              {(panel?.countdowns ?? []).length === 0 ? "None" : (panel?.countdowns ?? []).map((item) => (
                <CrbChip key={item.key} tone={item.tone}>{item.text}</CrbChip>
              ))}
            </dd>
          </div>
          {panel ? (
            <div className="crb-field-wide">
              <dt>Minimum</dt>
              <dd>
                Aggregate {crbMoney(panel.aggregateCents)} vs minimum {crbMoney(panel.minAggregateCents)}
                {panel.belowMinimum ? " · below minimum" : " · meets minimum or exempt"}.
                Exempt: {(panel.exemptTypesPresent ?? []).join(", ") || "none"}.
              </dd>
            </div>
          ) : null}
        </dl>

        <section className="space-y-2">
          <h2 className="font-semibold">Cars ({invoice.cars.length})</h2>
          <CrbCarTable
            invoiceId={invoice.id}
            cars={invoice.cars}
            tokens={[]}
            onChanged={() => load()}
          />
        </section>

        <section className={`${repairUi.panel} p-3 space-y-2`}>
          <h2 className="font-semibold">Decision</h2>
          <p className={shopAa.muted}>
            {pending} cars still pending. {hard} unresolved hard stops.
            Closed months stay closed. The open month is the default when the receipt month is not open.
          </p>
          <label>
            <span className={shopAa.label}>Pool month</span>
            <select className={repairUi.select} value={monthId} onChange={(e) => setMonthId(e.target.value)}>
              <option value="">Receipt month, or the current open month</option>
              {months.map((month) => (
                <option key={month.id} value={month.id} disabled={month.status !== "OPEN"}>
                  {month.monthLabel} ({month.status})
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={repairUi.btnPrimary} disabled={approveBlocked} onClick={() => void setStatus("APPROVED").catch((e) => setError(e.message))}>
              Approve
            </button>
            <button type="button" className={repairUi.btnPrimary} disabled={approveBlocked} onClick={() => void setStatus("APPROVED_WITH_EXCEPTIONS").catch((e) => setError(e.message))}>
              Approve with exceptions
            </button>
            <button type="button" className={repairUi.btnSecondary} disabled={returnBlocked} onClick={() => void setStatus("RETURN_UNPAID").catch((e) => setError(e.message))}>
              Return unpaid
            </button>
          </div>
        </section>

        <section className={`${repairUi.panel} p-3 space-y-2`}>
          <h2 className="font-semibold">Exception packages (local draft only)</h2>
          <div className="flex flex-wrap gap-2">
            {PACKAGE_TYPES.map(([type, label]) => (
              <button key={type} type="button" className={repairUi.btnSecondary} onClick={() => void makePackage(type).catch((e) => setError(e.message))}>
                {label}
              </button>
            ))}
          </div>
          <ul className="text-sm">
            {invoice.packages.map((pkg) => (
              <li key={pkg.id} className="flex flex-wrap gap-2 items-center">
                <span>{pkg.type} #{pkg.letter_seq}</span>
                <CrbChip tone={pkg.status === "DRAFT" ? "info" : "ok"}>{pkg.status}</CrbChip>
                {pkg.status === "DRAFT" ? (
                  <button type="button" className={repairUi.btnSecondary} onClick={() => void markFiled(pkg.id).catch((e) => setError(e.message))}>
                    Mark filed manually
                  </button>
                ) : <span className={shopAa.muted}>{pkg.filed_at}</span>}
              </li>
            ))}
          </ul>
        </section>

        <section className={`${repairUi.panel} p-3 space-y-1`}>
          <h2 className="font-semibold">Invoice findings</h2>
          {invoice.findings.filter((f) => f.severity === "HARD_STOP" || f.message.includes("MISMATCH") || f.message.includes("BILLER") || f.message.includes("CONTROL")).map((f) => (
            <p key={f.id}>
              <CrbChip tone={toneForStatus(f.severity || f.status)}>{f.severity || f.status}</CrbChip> {f.rule_code}: {f.message}
            </p>
          ))}
        </section>
      </div>
    </RepairOwnerShell>
  );
}
