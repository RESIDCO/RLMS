/**
 * Expandable car rows with line grandchildren.
 * Approve, override, and reject call the same r1 endpoints and reason rule.
 */
import { Fragment, useState } from "react";
import { Link } from "wouter";
import { CodeHover } from "./CodeHover";
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
  total_cents: number;
  finding_count?: number;
  flags?: string[] | null;
};

type GridFinding = {
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

type GridLine = {
  id: string;
  line_number: string | null;
  applied_job_code: string | null;
  applied_qualifier: string | null;
  location_on_car: string | null;
  why_made: string | null;
  responsibility: string | null;
  labor_cents: number;
  material_cents: number;
  status: string;
};

type LoadedCar = {
  lines: GridLine[];
  findings: GridFinding[];
};

type Modal =
  | { kind: "reject"; carId: string }
  | { kind: "override"; carId: string; finding: GridFinding | null };

const REASON_MIN = 8;

function ownedLabel(car: CrbGridCar): { text: string; tone: "ok" | "stop" | "info" } {
  const notOwned = car.owned_on_repair_date === false || (car.flags ?? []).some((flag) => flag.includes("NOT_OWNED"));
  if (car.owned_on_repair_date == null && !notOwned) return { text: "Ownership unknown", tone: "info" };
  if (notOwned) return { text: "Not owned", tone: "stop" };
  return { text: "Owned", tone: "ok" };
}

export function CrbCarTable({
  invoiceId,
  cars,
  tokens,
  onChanged,
}: {
  invoiceId: string;
  cars: CrbGridCar[];
  tokens: string[];
  onChanged: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState<Record<string, LoadedCar>>({});
  const [modal, setModal] = useState<Modal | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

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
    if (!loaded[carId]) await loadCar(carId);
  }

  async function loadCar(carId: string) {
    const res = await fetch(`/api/repair/crb/cars/${carId}`);
    const json = await crbJson<{ lines: GridLine[]; findings: GridFinding[] }>(res);
    setLoaded((cur) => ({
      ...cur,
      [carId]: { lines: json.lines ?? [], findings: json.findings ?? [] },
    }));
  }

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
    try {
      if (modal.kind === "reject") {
        const res = await fetch(`/api/repair/crb/cars/${modal.carId}/decide`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision: "REJECTED", reason }),
        });
        await crbJson(res);
        setMsg("Car rejected");
      } else if (modal.kind === "override") {
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
      } else {
        const neverModal: never = modal;
        throw new Error(`Unhandled action ${String(neverModal)}`);
      }
      const carId = modal.carId;
      setModal(null);
      setReason("");
      if (open.has(carId)) await loadCar(carId);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    }
  }

  async function openOverride(car: CrbGridCar) {
    let findings = loaded[car.id]?.findings;
    if (!findings) {
      const res = await fetch(`/api/repair/crb/cars/${car.id}`);
      const json = await crbJson<{ lines: GridLine[]; findings: GridFinding[] }>(res);
      findings = json.findings ?? [];
      setLoaded((cur) => ({ ...cur, [car.id]: { lines: json.lines ?? [], findings } }));
    }
    const finding = findings.find((row) => row.scope === "CAR" && row.target_id === car.id) ?? findings[0] ?? null;
    setReason("");
    setModal({ kind: "override", carId: car.id, finding });
  }

  return (
    <div className="space-y-2">
      {error ? <div className={`${repairUi.badge} repair-chip-stop`}>{error}</div> : null}
      {msg ? <div className={repairUi.badge}>{msg}</div> : null}
      <table className="crb-grid crb-grid-nested">
        <thead>
          <tr>
            <th>Car</th>
            <th>Lessee</th>
            <th>Owned</th>
            <th>Lines</th>
            <th>$</th>
            <th>Findings</th>
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
            return (
              <Fragment key={car.id}>
                <tr className={match ? "crb-match" : undefined}>
                  <td>
                    <button type="button" className={repairUi.btnSecondary} aria-expanded={expanded} onClick={() => void toggle(car.id).catch((err) => setError(err instanceof Error ? err.message : "Load failed"))}>
                      {expanded ? "Hide lines" : "Show lines"}
                    </button>{" "}
                    <Link className={repairUi.link} href={`/repair/crb/invoice/${invoiceId}/car/${car.id}`}>
                      {car.car_initial} {car.car_number}
                    </Link>
                  </td>
                  <td>{car.lessee_name || "None"}</td>
                  <td><CrbChip tone={owned.tone}>{owned.text}</CrbChip></td>
                  <td>{car.line_count}</td>
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
                {expanded && detail ? detail.lines.map((line) => {
                  const findings = detail.findings.filter((finding) => finding.target_id === line.id);
                  return (
                    <tr key={line.id}>
                      <td colSpan={8}>
                        <div className="flex flex-wrap gap-2 items-center">
                          <span>Line {line.line_number || "—"}</span>
                          <CodeHover kind="job" code={line.applied_job_code}><span>Job {line.applied_job_code || "—"}</span></CodeHover>
                          <CodeHover kind="qualifier" code={line.applied_job_code} qualifier={line.applied_qualifier}><span>Qual {line.applied_qualifier || "—"}</span></CodeHover>
                          <CodeHover kind="location" code={line.location_on_car}><span>Loc {line.location_on_car || "—"}</span></CodeHover>
                          <CodeHover kind="why_made" code={line.why_made}><span>WM {line.why_made || "—"}</span></CodeHover>
                          <CodeHover kind="responsibility" code={line.responsibility}><span>Resp {line.responsibility || "—"}</span></CodeHover>
                          <span>Labor {crbMoney(Number(line.labor_cents))}</span>
                          <span>Material {crbMoney(Number(line.material_cents))}</span>
                          <CrbChip tone={toneForStatus(line.status)}>{line.status}</CrbChip>
                        </div>
                        {findings.length === 0 ? <p>No line findings.</p> : findings.map((finding) => (
                          <p key={finding.id}>
                            <CrbChip tone={finding.invalid ? "info" : toneForStatus(finding.severity || "WARN")}>
                              {finding.invalid ? "INVALID" : finding.severity || "WARN"}
                            </CrbChip>{" "}
                            {finding.rule_code} v{finding.rule_version} {finding.rule_ref ? `(${finding.rule_ref})` : ""} — {finding.message} {finding.status}
                          </p>
                        ))}
                      </td>
                    </tr>
                  );
                }) : null}
                {expanded && !detail ? (
                  <tr>
                    <td colSpan={8}>Loading lines…</td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {modal ? (
        <div className={`${repairUi.panel} p-3 space-y-2`} role="dialog" aria-label="Reason">
          <h3 className="font-semibold">
            {modal.kind === "override"
              ? `Override ${modal.finding?.rule_code ?? "car"} v${modal.finding?.rule_version ?? ""}`
              : "Reject car"}
          </h3>
          {modal.kind === "override" && modal.finding ? (
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
