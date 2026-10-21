/**
 * Invoice > car > billing-line drill-down.
 * Approve, override, and reject call the same r1 endpoints and reason rule.
 */
import React, { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { RepairCode, type CodeFace } from "./CodeHover";
import { repairUi } from "./repairTokens";
import {
  CrbChip,
  crbCarListed,
  crbJson,
  crbMoney,
  toneForStatus,
} from "./CrbUi";

export type CrbGridCar = {
  id: string;
  car_initial: string;
  car_number: string;
  status: string;
  lessee_name: string | null;
  owned_on_repair_date: boolean | null;
  line_count: number;
  labor_cents?: number;
  material_cents?: number;
  total_cents: number;
  finding_count?: number;
  flags?: string[] | null;
};

export type CrbBillingFinding = {
  id: string;
  rule_code: string;
  rule_version: number;
  rule_ref: string | null;
  severity: string | null;
  scope: string;
  target_id: string;
  message: string;
  status: string;
  invalid: boolean;
};

export type CrbBillingLine = {
  id: string;
  line_number: string | null;
  sort_order?: number | null;
  record_format?: string | null;
  applied_job_code: string | null;
  applied_qualifier?: string | null;
  condition_code?: string | null;
  why_made: string | null;
  location_on_car: string | null;
  quantity?: string | null;
  decoded?: {
    job?: CodeFace | null;
    qualifier?: CodeFace | null;
    why_made?: CodeFace | null;
    condition?: CodeFace | null;
    location?: CodeFace | null;
    responsibility?: CodeFace | null;
    record_format?: CodeFace | null;
  } | null;
  labor_cents: number;
  material_cents: number;
  material_sign?: string | null;
  responsibility: string | null;
  status: string;
  parsed?: Record<string, unknown> | null;
  narrative?: string | null;
  bucket_hint?: string | null;
  raw_line?: string | null;
  proposed_corrections?: Record<string, { value?: string; reason?: string }> | null;
};

type LoadedCar = {
  lines: CrbBillingLine[];
  findings: CrbBillingFinding[];
};

type Modal =
  | { kind: "reject"; carId: string }
  | { kind: "override"; carId: string; finding: CrbBillingFinding | null }
  | { kind: "reject-line"; carId: string; lineId: string }
  | { kind: "override-line"; carId: string; lineId: string; finding: CrbBillingFinding | null };

const REASON_MIN = 8;
const CAR_COLUMNS = 10;
const LINE_COLUMNS = 15;

function narrativesOf(line: CrbBillingLine): { wheel: string; nonWheel: string } {
  const fields = line.parsed && typeof line.parsed === "object" ? line.parsed : {};
  const wheel = String(fields.narrative ?? "").trim();
  const nonWheel = String(fields.narrative_non_wheel ?? line.narrative ?? "").trim();
  return { wheel, nonWheel };
}

function ownedLabel(car: CrbGridCar): { text: string; tone: "ok" | "stop" | "info" } {
  const notOwned = car.owned_on_repair_date === false || (car.flags ?? []).some((flag) => flag.includes("NOT_OWNED"));
  if (car.owned_on_repair_date == null && !notOwned) return { text: "Ownership unknown", tone: "info" };
  if (notOwned) return { text: "Not owned", tone: "stop" };
  return { text: "Owned", tone: "ok" };
}

function qtyLabel(raw: string | null | undefined): string {
  const text = String(raw ?? "").trim();
  if (!text) return "—";
  const n = Number(text);
  return Number.isFinite(n) ? String(n) : text;
}

function laborHoursLabel(laborCents: number, parsed: unknown): string {
  const fields = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const rate = Number(String(fields.labor_rate ?? "").trim() || "0");
  if (!Number.isFinite(rate) || rate <= 0) return "—";
  const hours = Number(laborCents) / rate;
  return hours.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function signedMaterialCents(cents: number, sign: string | null | undefined): number {
  const mag = Math.abs(Number(cents) || 0);
  return String(sign ?? "").trim().toUpperCase() === "C" ? -mag : mag;
}

function recordFormatLabel(value: string | null | undefined): string {
  const text = String(value ?? "").trim();
  return text || "1";
}

function modalTitle(modal: Modal): string {
  switch (modal.kind) {
    case "reject":
      return "Reject car";
    case "override":
      return `Override ${modal.finding?.rule_code ?? "car"} v${modal.finding?.rule_version ?? ""}`;
    case "reject-line":
      return "Reject billing line";
    case "override-line":
      return `Override ${modal.finding?.rule_code ?? "line"} v${modal.finding?.rule_version ?? ""}`;
    default: {
      const neverModal: never = modal;
      return `Unhandled action ${String(neverModal)}`;
    }
  }
}

export function CrbBillingLines<F extends CrbBillingFinding>({
  lines,
  findings,
  onReject,
  onOverride,
  lineExtras,
}: {
  lines: CrbBillingLine[];
  findings: F[];
  onReject: (lineId: string) => void;
  onOverride: (lineId: string, finding: F | null) => void;
  lineExtras?: (line: CrbBillingLine) => ReactNode;
}) {
  const [openFindings, setOpenFindings] = useState<Set<string>>(new Set());
  return (
    <div className="crb-lines-wrap">
      <h3 className="font-semibold">Billing lines ({lines.length})</h3>
      <div className="overflow-auto rounded-md border border-border">
        <table className="crb-grid crb-lines w-full border-collapse text-left" aria-label="Billing lines">
          <thead>
            <tr className="repair-brand-fill">
              <th>Line</th>
              <th>Record format</th>
              <th>Location / position</th>
              <th>Job code</th>
              <th>Condition</th>
              <th>Qualifier</th>
              <th>Why made</th>
              <th>Responsibility</th>
              <th>Qty</th>
              <th>Labor hrs</th>
              <th className="text-right">Labor</th>
              <th className="text-right">Material</th>
              <th className="text-right">Total</th>
              <th>Audit</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const lineFindings = findings.filter((finding) => finding.target_id === line.id);
              const primary = lineFindings.find((finding) => finding.scope === "LINE") ?? lineFindings[0] ?? null;
              const findingText = lineFindings.map((finding) => finding.message).join("\n");
              const material = signedMaterialCents(line.material_cents, line.material_sign);
              const total = Number(line.labor_cents) + material;
              const expanded = openFindings.has(line.id);
              const narrative = narrativesOf(line);
              const codes = line.decoded;
              return (
                <Fragment key={line.id}>
                  <tr>
                    <td>{line.line_number?.trim() || (line.sort_order != null ? String(line.sort_order) : "—")}</td>
                    <td>
                      <RepairCode kind="record_format" code={recordFormatLabel(line.record_format)} face={codes?.record_format} />
                    </td>
                    <td>
                      <RepairCode kind="location" code={line.location_on_car} face={codes?.location} />
                    </td>
                    <td>
                      <RepairCode kind="job" code={line.applied_job_code} qualifier={line.applied_qualifier} face={codes?.job} />
                    </td>
                    <td>
                      <RepairCode kind="condition" code={line.condition_code} face={codes?.condition} />
                    </td>
                    <td>
                      <RepairCode kind="qualifier" code={line.applied_job_code} qualifier={line.applied_qualifier ?? ""} face={codes?.qualifier} />
                    </td>
                    <td>
                      <RepairCode kind="why_made" code={line.why_made} face={codes?.why_made} />
                    </td>
                    <td>
                      <RepairCode kind="responsibility" code={line.responsibility} face={codes?.responsibility} />
                    </td>
                    <td>{qtyLabel(line.quantity)}</td>
                    <td>{laborHoursLabel(Number(line.labor_cents), line.parsed)}</td>
                    <td className="text-right">{crbMoney(Number(line.labor_cents))}</td>
                    <td className="text-right">{crbMoney(material)}</td>
                    <td className="text-right">{crbMoney(total)}</td>
                    <td>
                      <button
                        type="button"
                        className={repairUi.btnSecondary}
                        aria-expanded={expanded}
                        title={findingText || "No line findings."}
                        onClick={() => {
                          setOpenFindings((cur) => {
                            const next = new Set(cur);
                            if (next.has(line.id)) next.delete(line.id);
                            else next.add(line.id);
                            return next;
                          });
                        }}
                      >
                        {lineFindings.length === 0 ? (
                          <CrbChip tone="ok">Clear</CrbChip>
                        ) : lineFindings.map((finding) => (
                          <CrbChip key={finding.id} tone={finding.invalid ? "info" : toneForStatus(finding.severity || finding.status)}>
                            {finding.invalid ? "INVALID" : finding.severity || finding.status}
                          </CrbChip>
                        ))}
                      </button>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        <button type="button" className={repairUi.btnSecondary} onClick={() => onReject(line.id)}>Reject</button>
                        <button type="button" className={repairUi.btnSecondary} onClick={() => onOverride(line.id, primary)}>Override</button>
                      </div>
                    </td>
                  </tr>
                  <tr className="crb-line-narrative">
                    <td colSpan={LINE_COLUMNS}>
                      <p>Narrative: {narrative.wheel || "—"}</p>
                      <p>Non-wheel narrative: {narrative.nonWheel || "—"}</p>
                    </td>
                  </tr>
                  {expanded ? (
                    <tr className="crb-line-findings">
                      <td colSpan={LINE_COLUMNS}>
                        {lineFindings.length === 0 ? <p>No line findings.</p> : lineFindings.map((finding) => (
                          <p key={finding.id}>
                            <CrbChip tone={finding.invalid ? "info" : toneForStatus(finding.severity || "WARN")}>
                              {finding.invalid ? "INVALID" : finding.severity || "WARN"}
                            </CrbChip>{" "}
                            {finding.rule_code} v{finding.rule_version} {finding.rule_ref ? `(${finding.rule_ref})` : ""} — {finding.message} {finding.status}
                            <button type="button" className={`${repairUi.btnSecondary} ml-2`} onClick={() => onOverride(line.id, finding)}>
                              Override
                            </button>
                          </p>
                        ))}
                      </td>
                    </tr>
                  ) : null}
                  {lineExtras ? (
                    <tr>
                      <td colSpan={LINE_COLUMNS}>{lineExtras(line)}</td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
            {lines.length === 0 ? (
              <tr>
                <td colSpan={LINE_COLUMNS}>No billing lines.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function CrbCarTable({
  invoiceId,
  cars,
  tokens,
  onChanged,
  expandSignal = 0,
}: {
  invoiceId: string;
  cars: CrbGridCar[];
  tokens: string[];
  onChanged: () => Promise<void> | void;
  expandSignal?: number;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState<Record<string, LoadedCar>>({});
  const [modal, setModal] = useState<Modal | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const expandSeen = useRef(0);
  const expandGen = useRef(0);
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;

  async function loadCar(carId: string) {
    const res = await fetch(`/api/repair/crb/cars/${carId}`);
    const json = await crbJson<{ lines: CrbBillingLine[]; findings: CrbBillingFinding[] }>(res);
    const next = { lines: json.lines ?? [], findings: json.findings ?? [] };
    setLoaded((cur) => ({ ...cur, [carId]: next }));
    return next;
  }

  async function toggle(carId: string) {
    setError("");
    const next = new Set(open);
    if (next.has(carId)) {
      next.delete(carId);
      setOpen(next);
      return;
    }
    next.add(carId);
    setOpen(next);
    if (!loadedRef.current[carId]) await loadCar(carId);
  }

  async function expandAll() {
    const gen = ++expandGen.current;
    setError("");
    const ids = cars.map((car) => car.id);
    setOpen(new Set(ids));
    await Promise.all(ids.filter((id) => !loadedRef.current[id]).map((id) => loadCar(id)));
    if (gen !== expandGen.current) return;
  }

  function collapseAll() {
    expandGen.current += 1;
    setOpen(new Set());
  }

  useEffect(() => {
    if (!expandSignal) {
      if (expandSeen.current !== 0) {
        expandSeen.current = 0;
        expandGen.current += 1;
        setOpen(new Set());
      }
      return;
    }
    if (expandSignal === expandSeen.current) return;
    expandSeen.current = expandSignal;
    void expandAll().catch((err) => setError(err instanceof Error ? err.message : "Expand failed"));
  }, [expandSignal]);

  async function approve(carId: string) {
    setError("");
    const res = await fetch(`/api/repair/crb/cars/${carId}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "APPROVED" }),
    });
    await crbJson(res);
    setMsg("Car approved");
    if (open.has(carId)) await loadCar(carId);
    await onChanged();
  }

  async function submitModal() {
    if (!modal) return;
    setError("");
    const carId = modal.carId;
    try {
      switch (modal.kind) {
        case "reject": {
          const res = await fetch(`/api/repair/crb/cars/${modal.carId}/decide`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ decision: "REJECTED", reason }),
          });
          await crbJson(res);
          setMsg("Car rejected");
          break;
        }
        case "override": {
          const res = await fetch("/api/repair/crb/overrides", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              scope: "CAR",
              targetId: modal.carId,
              findingId: modal.finding?.id ?? null,
              reason,
            }),
          });
          await crbJson(res);
          setMsg("Override recorded");
          break;
        }
        case "reject-line": {
          const res = await fetch(`/api/repair/crb/lines/${modal.lineId}/reject`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reason }),
          });
          await crbJson(res);
          setMsg("Line rejected");
          break;
        }
        case "override-line": {
          const res = await fetch("/api/repair/crb/overrides", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              scope: "LINE",
              targetId: modal.lineId,
              findingId: modal.finding?.id ?? null,
              reason,
            }),
          });
          await crbJson(res);
          setMsg("Override recorded");
          break;
        }
        default: {
          const neverModal: never = modal;
          throw new Error(`Unhandled action ${String(neverModal)}`);
        }
      }
      setModal(null);
      setReason("");
      if (open.has(carId)) await loadCar(carId);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    }
  }

  async function openOverride(car: CrbGridCar) {
    let findings = loadedRef.current[car.id]?.findings;
    if (!findings) {
      const loadedCar = await loadCar(car.id);
      findings = loadedCar.findings;
    }
    const finding = findings.find((row) => row.scope === "CAR" && row.target_id === car.id) ?? findings[0] ?? null;
    setReason("");
    setModal({ kind: "override", carId: car.id, finding });
  }

  return (
    <div className="space-y-2">
      {error ? <div className={`${repairUi.badge} repair-chip-stop`}>{error}</div> : null}
      {msg ? <div className={repairUi.badge}>{msg}</div> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={repairUi.btnSecondary} aria-label="Expand all billing lines" onClick={() => void expandAll().catch((err) => setError(err instanceof Error ? err.message : "Expand failed"))}>
          Expand all
        </button>
        <button type="button" className={repairUi.btnSecondary} aria-label="Collapse all billing lines" onClick={collapseAll}>
          Collapse all
        </button>
      </div>
      <table className="crb-grid crb-grid-nested">
        <thead>
          <tr>
            <th>Car</th>
            <th>Lessee</th>
            <th>Owned</th>
            <th>Lines</th>
            <th>Labor</th>
            <th>Material</th>
            <th>Total</th>
            <th>Flagged</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {cars.map((car) => {
            const owned = ownedLabel(car);
            const match = crbCarListed(car.car_initial, car.car_number, tokens);
            const detail = loaded[car.id];
            const expanded = open.has(car.id);
            const href = `/repair/crb/invoice/${invoiceId}/car/${car.id}`;
            return (
              <Fragment key={car.id}>
                <tr className={match ? "crb-match" : undefined}>
                  <td>
                    <button type="button" className={repairUi.btnSecondary} aria-expanded={expanded} aria-label={`Show billing lines for ${car.car_initial} ${car.car_number}`} onClick={() => void toggle(car.id).catch((err) => setError(err instanceof Error ? err.message : "Load failed"))}>
                      {expanded ? "Hide lines" : "Show lines"}
                    </button>{" "}
                    <Link className={repairUi.link} href={href}>
                      {car.car_initial} {car.car_number}
                    </Link>{" "}
                    <Link className={repairUi.btnSecondary} href={href}>Open BRC</Link>
                  </td>
                  <td>{car.lessee_name || "None"}</td>
                  <td><CrbChip tone={owned.tone}>{owned.text}</CrbChip></td>
                  <td>{Number(car.line_count)}</td>
                  <td>{crbMoney(Number(car.labor_cents ?? 0))}</td>
                  <td>{crbMoney(Number(car.material_cents ?? 0))}</td>
                  <td>{crbMoney(Number(car.total_cents))}</td>
                  <td>{Number(car.finding_count ?? 0)}</td>
                  <td><CrbChip tone={toneForStatus(car.status)}>{car.status}</CrbChip></td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      <button type="button" className={repairUi.btnPrimary} onClick={() => void approve(car.id).catch((err) => setError(err instanceof Error ? err.message : "Approve failed"))}>
                        Approve
                      </button>
                      <button type="button" className={repairUi.btnSecondary} onClick={() => { setReason(""); setModal({ kind: "reject", carId: car.id }); }}>
                        Reject
                      </button>
                      <button type="button" className={repairUi.btnSecondary} onClick={() => void openOverride(car).catch((err) => setError(err instanceof Error ? err.message : "Override failed"))}>
                        Override
                      </button>
                    </div>
                  </td>
                </tr>
                {expanded && detail ? (
                  <tr>
                    <td colSpan={CAR_COLUMNS}>
                      <CrbBillingLines
                        lines={detail.lines}
                        findings={detail.findings}
                        onReject={(lineId) => {
                          setReason("");
                          setError("");
                          setModal({ kind: "reject-line", carId: car.id, lineId });
                        }}
                        onOverride={(lineId, finding) => {
                          setReason("");
                          setError("");
                          setModal({ kind: "override-line", carId: car.id, lineId, finding });
                        }}
                      />
                    </td>
                  </tr>
                ) : null}
                {expanded && !detail ? (
                  <tr>
                    <td colSpan={CAR_COLUMNS}>Loading billing lines…</td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {modal ? (
        <div className={`${repairUi.panel} p-3 space-y-2`} role="dialog" aria-label="Reason">
          <h3 className="font-semibold">{modalTitle(modal)}</h3>
          {(modal.kind === "override" || modal.kind === "override-line") && modal.finding ? (
            <p>{modal.finding.rule_ref ? `${modal.finding.rule_ref} — ` : ""}{modal.finding.message}</p>
          ) : null}
          <label>
            <span className={repairUi.label}>Reason (at least 8 characters)</span>
            <textarea className={repairUi.textarea} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <div className="flex gap-2">
            <button type="button" className={repairUi.btnPrimary} disabled={reason.trim().length < REASON_MIN} onClick={() => void submitModal()}>
              Save
            </button>
            <button type="button" className={repairUi.btnSecondary} onClick={() => setModal(null)}>Cancel</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
