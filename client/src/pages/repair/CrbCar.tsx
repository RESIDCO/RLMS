/**
 * §I one CRB car, BRC-style. `#/repair/crb/invoice/:id/car/:carId`
 * Keys: J/K car, A approve, R reject, O override, N next undecided, ? help.
 * Pencil edits are proposed corrections. The raw 500-byte line stays intact.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import RepairOwnerShell from "./RepairOwnerShell";
import { RepairBreadcrumbs, shopAa } from "./RepairNavChrome";
import { repairUi } from "./repairTokens";
import { CrbBillingLines, type CrbBillingLine } from "./CrbGrid";
import { CrbChip, crbJson, toneForStatus, useCrbTitle } from "./CrbUi";

type Finding = {
  id: string;
  rule_code: string;
  rule_version: number;
  rule_ref: string | null;
  severity: string | null;
  scope: string;
  target_id: string;
  message: string;
  status: string;
  amount_in_question_cents: number;
  invalid: boolean;
};
type Line = CrbBillingLine & {
  detail_source: string | null;
  condition_code: string | null;
  facility_type: string | null;
  bucket_hint: string | null;
};
type Car = {
  id: string;
  invoice_id: string;
  invoice_number: string;
  billing_party: string;
  car_initial: string;
  car_number: string;
  status: string;
  lessee_name: string | null;
  flags: string[] | null;
  owned_on_repair_date: boolean | null;
  repair_date: string | null;
  lines: Line[];
  findings: Finding[];
  prevCarId: string | null;
  nextCarId: string | null;
  proposed_corrections: Record<string, { value?: string; reason?: string }> | null;
};

type Modal =
  | { kind: "reject-car" }
  | { kind: "reject-line"; lineId: string }
  | { kind: "override"; scope: "LINE" | "CAR" | "INVOICE"; targetId: string; finding: Finding | null }
  | { kind: "pencil"; scope: "CAR" | "LINE"; id: string; field: string }
  | null;

export default function CrbCar() {
  const [, params] = useRoute("/repair/crb/invoice/:id/car/:carId");
  const [, setLocation] = useLocation();
  const invoiceId = params?.id ?? "";
  const carId = params?.carId ?? "";
  const [car, setCar] = useState<Car | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [help, setHelp] = useState(false);
  const [rawOn, setRawOn] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [reason, setReason] = useState("");
  const [pencilValue, setPencilValue] = useState("");
  const carHeading = car ? `Car ${car.car_initial} ${car.car_number}` : "Car";
  useCrbTitle(`CRB Staging › ${carHeading}`);

  const load = useCallback(async () => {
    if (!carId) return;
    const res = await fetch(`/api/repair/crb/cars/${carId}`);
    setCar(await crbJson<Car>(res));
  }, [carId]);

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
  }, [load]);

  const go = useCallback((next: string | null) => {
    if (!next) return;
    setLocation(`/repair/crb/invoice/${invoiceId}/car/${next}`);
  }, [invoiceId, setLocation]);

  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      const tag = (ev.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (modal) return;
      const key = ev.key.toLowerCase();
      if (key === "?" || ev.key === "?") {
        setHelp((v) => !v);
        return;
      }
      if (!car) return;
      if (key === "j") go(car.nextCarId);
      if (key === "k") go(car.prevCarId);
      if (key === "a") void decide("APPROVED");
      if (key === "r") {
        setReason("");
        setModal({ kind: "reject-car" });
      }
      if (key === "o") {
        setReason("");
        setModal({ kind: "override", scope: "CAR", targetId: car.id, finding: car.findings[0] ?? null });
      }
      if (key === "n") {
        void fetch(`/api/repair/crb/next-car?after=${car.id}`)
          .then((res) => crbJson<{ next: { carId: string; invoiceId: string } | null }>(res))
          .then((json) => {
            if (json.next) setLocation(`/repair/crb/invoice/${json.next.invoiceId}/car/${json.next.carId}`);
            else setMsg("No undecided cars.");
          })
          .catch((e) => setError(e instanceof Error ? e.message : "Next failed"));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function decide(decision: "APPROVED" | "OVERRIDDEN" | "REJECTED", why?: string) {
    if (!car) return;
    setError("");
    const res = await fetch(`/api/repair/crb/cars/${car.id}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, reason: why }),
    });
    await crbJson(res);
    setMsg(`Car ${decision.toLowerCase()}`);
    setModal(null);
    await load();
  }

  async function submitModal() {
    if (!modal || !car) return;
    try {
      if (modal.kind === "reject-car") await decide("REJECTED", reason);
      else if (modal.kind === "reject-line") {
        const res = await fetch(`/api/repair/crb/lines/${modal.lineId}/reject`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        });
        await crbJson(res);
        setMsg("Line rejected");
        setModal(null);
        await load();
      } else if (modal.kind === "override") {
        const res = await fetch("/api/repair/crb/overrides", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scope: modal.scope,
            targetId: modal.targetId,
            findingId: modal.finding?.id ?? null,
            reason,
          }),
        });
        await crbJson(res);
        setMsg("Override recorded");
        setModal(null);
        await load();
      } else if (modal.kind === "pencil") {
        const res = await fetch("/api/repair/crb/corrections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scope: modal.scope,
            id: modal.id,
            field: modal.field,
            value: pencilValue,
            reason,
          }),
        });
        await crbJson(res);
        setMsg("Proposed correction saved. Raw line unchanged.");
        setModal(null);
        await load();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    }
  }

  if (!car) {
    return (
      <RepairOwnerShell>
        <div className={`${shopAa.page} p-3`}>{error || "Loading car…"}</div>
      </RepairOwnerShell>
    );
  }

  return (
    <RepairOwnerShell>
      <div className={`${shopAa.page} p-3 space-y-3 max-w-[1100px]`}>
        <RepairBreadcrumbs
          items={[
            { label: "CRB Staging", href: "/repair/crb" },
            { label: `Invoice ${car.billing_party} ${car.invoice_number}`, href: `/repair/crb/invoice/${car.invoice_id}` },
            { label: carHeading },
          ]}
        />
        <div className="flex flex-wrap gap-2 items-center">
          <h1 className="text-xl font-semibold">{carHeading}</h1>
          <CrbChip tone={toneForStatus(car.status)}>{car.status}</CrbChip>
          {(car.flags ?? []).map((flag) => <CrbChip key={flag} tone={flag.includes("NOT_OWNED") ? "stop" : "warn"}>{flag}</CrbChip>)}
        </div>
        <p className={shopAa.muted}>
          {car.billing_party} · lessee {car.lessee_name || "none"} · repair {car.repair_date || "—"} · owned {String(car.owned_on_repair_date)}
        </p>
        {error ? <div className={`${repairUi.badge} repair-chip-stop`}>{error}</div> : null}
        {msg ? <div className={repairUi.badge}>{msg}</div> : null}
        {help ? (
          <div className={`${repairUi.panel} p-3`} role="dialog" aria-label="Keyboard help">
            <p>J next car · K previous car · A approve · R reject · O override · N next undecided · ? hide this help</p>
          </div>
        ) : null}

        <div className={`${repairUi.panel} p-3 flex flex-wrap gap-2`}>
          <button type="button" className={repairUi.btnSecondary} onClick={() => go(car.prevCarId)}>Previous (K)</button>
          <button type="button" className={repairUi.btnSecondary} onClick={() => go(car.nextCarId)}>Next (J)</button>
          <button type="button" className={repairUi.btnPrimary} onClick={() => void decide("APPROVED").catch((e) => setError(e.message))}>Approve (A)</button>
          <button type="button" className={repairUi.btnSecondary} onClick={() => { setReason(""); setModal({ kind: "reject-car" }); }}>Reject (R)</button>
          <button type="button" className={repairUi.btnSecondary} onClick={() => { setReason(""); setModal({ kind: "override", scope: "CAR", targetId: car.id, finding: car.findings[0] ?? null }); }}>Override (O)</button>
          <button type="button" className={repairUi.btnSecondary} onClick={() => setHelp((v) => !v)}>Help (?)</button>
          <label className="flex items-center gap-1">
            <input className={repairUi.checkbox} type="checkbox" checked={rawOn} onChange={(e) => setRawOn(e.target.checked)} />
            Raw 500-byte
          </label>
          <button
            type="button"
            className={repairUi.btnSecondary}
            aria-label="Edit lessee name"
            onClick={() => {
              setPencilValue(String(car.proposed_corrections?.lessee_name?.value ?? car.lessee_name ?? ""));
              setReason("");
              setModal({ kind: "pencil", scope: "CAR", id: car.id, field: "lessee_name" });
            }}
          >
            Pencil header
          </button>
        </div>

        <CrbBillingLines
          lines={car.lines}
          findings={car.findings}
          onReject={(lineId) => {
            setReason("");
            setModal({ kind: "reject-line", lineId });
          }}
          onOverride={(lineId, finding) => {
            setReason("");
            setModal({ kind: "override", scope: "LINE", targetId: lineId, finding });
          }}
          lineExtras={(line) => (
            <div className="space-y-1">
              {line.narrative ? <p>{line.narrative}</p> : null}
              {line.bucket_hint ? <CrbChip tone="info">{line.bucket_hint}</CrbChip> : null}
              {line.proposed_corrections && Object.keys(line.proposed_corrections).length > 0 ? (
                <p className={shopAa.muted}>Proposed: {JSON.stringify(line.proposed_corrections)}</p>
              ) : null}
              <button
                type="button"
                className={repairUi.btnSecondary}
                aria-label={`Edit narrative ${line.line_number}`}
                onClick={() => {
                  setPencilValue(String(line.proposed_corrections?.narrative?.value ?? line.narrative ?? ""));
                  setReason("");
                  setModal({ kind: "pencil", scope: "LINE", id: line.id, field: "narrative" });
                }}
              >
                Pencil
              </button>
              {rawOn && line.raw_line ? <pre className="whitespace-pre-wrap break-all text-xs">{line.raw_line}</pre> : null}
            </div>
          )}
        />

        <p><Link className={repairUi.link} href={`/repair/crb/invoice/${car.invoice_id}`}>Back to invoice</Link></p>

        {modal ? (
          <div className={`${repairUi.panel} p-3 space-y-2`} role="dialog" aria-label="Reason">
            <h2 className="font-semibold">
              {modal.kind === "pencil" ? `Proposed ${modal.field}` : modal.kind === "override" ? `Override ${modal.finding?.rule_code ?? ""} v${modal.finding?.rule_version ?? ""}` : "Reject"}
            </h2>
            {modal.kind === "override" && modal.finding ? <p className={shopAa.muted}>{modal.finding.rule_ref} — {modal.finding.message}</p> : null}
            {modal.kind === "pencil" ? (
              <label>
                <span className={shopAa.label}>Value</span>
                <input className={repairUi.input} value={pencilValue} onChange={(e) => setPencilValue(e.target.value)} />
              </label>
            ) : null}
            <label>
              <span className={shopAa.label}>Reason (at least 8 characters)</span>
              <textarea className={repairUi.textarea} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <div className="flex gap-2">
              <button type="button" className={repairUi.btnPrimary} onClick={() => void submitModal()}>Save</button>
              <button type="button" className={repairUi.btnSecondary} onClick={() => setModal(null)}>Cancel</button>
            </div>
          </div>
        ) : null}
      </div>
    </RepairOwnerShell>
  );
}
