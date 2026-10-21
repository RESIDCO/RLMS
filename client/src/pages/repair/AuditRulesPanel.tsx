/**
 * Reference Data → Audit Rules (13th tab). Versions are cloned, never rewritten
 * once a closed month has used them. Standing exceptions sit in this tab.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { repairUi } from "./repairTokens";
import { shopAa } from "./RepairNavChrome";
import { CrbChip, crbJson, toneForStatus } from "./CrbUi";

type RuleRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  rule_ref: string | null;
  params: Record<string, unknown>;
  enabled: boolean;
  severity: "INFO" | "WARN" | "HARD_STOP";
  effective_from: string;
  effective_to: string | null;
  version: number;
};

type Standing = {
  id: string;
  rule_code: string;
  reason: string;
  biller: string | null;
  effective_from: string;
  effective_to: string | null;
  enabled: boolean;
};

function primitives(params: Record<string, unknown>): Array<[string, unknown]> {
  return Object.entries(params).filter(([, value]) => value == null || ["string", "number", "boolean"].includes(typeof value));
}

export default function AuditRulesPanel() {
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [standing, setStanding] = useState<Standing[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [paramsText, setParamsText] = useState("{}");
  const [enabled, setEnabled] = useState(true);
  const [severity, setSeverity] = useState<RuleRow["severity"]>("WARN");
  const [effectiveFrom, setEffectiveFrom] = useState("2026-06-01");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [reason, setReason] = useState("");
  const [ruleCode, setRuleCode] = useState("R111_PRICE");
  const [biller, setBiller] = useState("");

  const load = useCallback(async () => {
    setError("");
    const res = await fetch("/api/repair/admin/audit-rules");
    const json = await crbJson<{ rules: RuleRow[]; standing: Standing[] }>(res);
    setRules(json.rules ?? []);
    setStanding(json.standing ?? []);
    setSelected((cur) => cur || json.rules?.[0]?.id || "");
  }, []);

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
  }, [load]);

  const current = useMemo(() => rules.find((rule) => rule.id === selected) ?? null, [rules, selected]);

  useEffect(() => {
    if (!current) return;
    setParamsText(JSON.stringify(current.params ?? {}, null, 2));
    setEnabled(current.enabled);
    setSeverity(current.severity);
  }, [current]);

  const parsed = useMemo(() => {
    try {
      return { ok: true as const, value: JSON.parse(paramsText) as Record<string, unknown> };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Invalid JSON" };
    }
  }, [paramsText]);

  function patchPrimitive(key: string, raw: string, sample: unknown) {
    if (!parsed.ok) return;
    const next = { ...parsed.value };
    if (typeof sample === "number") next[key] = Number(raw);
    else if (typeof sample === "boolean") next[key] = raw === "true";
    else next[key] = raw;
    setParamsText(JSON.stringify(next, null, 2));
  }

  async function save() {
    if (!current || !parsed.ok) {
      setError(parsed.ok ? "Select a rule" : parsed.error);
      return;
    }
    setError("");
    setMsg("");
    const res = await fetch(`/api/repair/admin/audit-rules/${current.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ params: parsed.value, enabled, severity }),
    });
    const json = await crbJson<{ ok: boolean }>(res);
    if (!json.ok) return;
    setMsg(`Saved ${current.code} v${current.version}`);
    await load();
  }

  async function clone() {
    if (!current || !parsed.ok) return;
    setError("");
    setMsg("");
    const res = await fetch(`/api/repair/admin/audit-rules/${current.id}/clone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ effectiveFrom, params: parsed.value, enabled, severity }),
    });
    const json = await crbJson<{ ok: boolean; version?: number }>(res);
    setMsg(`Cloned ${current.code} as version ${json.version ?? ""}`);
    await load();
  }

  async function addStanding() {
    setError("");
    setMsg("");
    const res = await fetch("/api/repair/admin/standing-exceptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ruleCode,
        reason,
        effectiveFrom,
        biller: biller.trim() || null,
      }),
    });
    await crbJson(res);
    setReason("");
    setMsg("Standing exception saved");
    await load();
  }

  const history = rules.filter((rule) => rule.code === current?.code);

  return (
    <div className={`${repairUi.panel} p-3 space-y-3`}>
      <div>
        <h2 className="font-semibold">Audit Rules</h2>
        <p className={shopAa.muted}>
          Evaluation uses the version effective for the invoice account month. A version used by a closed month is cloned, not edited.
        </p>
      </div>
      {error ? <div className={`${repairUi.badge} repair-chip-stop`}>{error}</div> : null}
      {msg ? <div className={repairUi.badge}>{msg}</div> : null}
      <div className="grid gap-3 md:grid-cols-[16rem_1fr]">
        <div className="space-y-1 max-h-[28rem] overflow-auto">
          {rules.map((rule) => (
            <button
              key={rule.id}
              type="button"
              className={rule.id === selected ? repairUi.navItemActive : `${repairUi.btnSecondary} w-full text-left`}
              onClick={() => setSelected(rule.id)}
            >
              {rule.code} v{rule.version}
            </button>
          ))}
        </div>
        {current ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2 items-center">
              <strong>{current.name}</strong>
              <CrbChip tone={toneForStatus(current.severity)}>{current.severity}</CrbChip>
              <span className={shopAa.muted}>{current.rule_ref}</span>
            </div>
            <p className={shopAa.value}>{current.description}</p>
            <p className={shopAa.muted}>
              v{current.version} from {String(current.effective_from).slice(0, 10)}
              {current.effective_to ? ` to ${String(current.effective_to).slice(0, 10)}` : " open"}
            </p>
            {parsed.ok
              ? primitives(parsed.value).map(([key, value]) => (
                  <label key={key} className="block">
                    <span className={shopAa.label}>{key}</span>
                    <input
                      className={repairUi.input}
                      value={String(value ?? "")}
                      onChange={(e) => patchPrimitive(key, e.target.value, value)}
                    />
                  </label>
                ))
              : <p className={repairUi.badge}>{parsed.error}</p>}
            <label className="block">
              <span className={shopAa.label}>params JSON</span>
              <textarea
                className={repairUi.textarea}
                rows={8}
                value={paramsText}
                onChange={(e) => setParamsText(e.target.value)}
              />
            </label>
            <label className="flex items-center gap-2">
              <input className={repairUi.checkbox} type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              <span>Enabled</span>
            </label>
            <label className="block">
              <span className={shopAa.label}>Severity</span>
              <select className={repairUi.select} value={severity} onChange={(e) => setSeverity(e.target.value as RuleRow["severity"])}>
                <option value="INFO">INFO</option>
                <option value="WARN">WARN</option>
                <option value="HARD_STOP">HARD_STOP</option>
              </select>
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={repairUi.btnPrimary} onClick={() => void save()}>Save version</button>
            </div>
            <div className="flex flex-wrap gap-2 items-end">
              <label>
                <span className={shopAa.label}>New version effective from</span>
                <input className={repairUi.input} type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
              </label>
              <button type="button" className={repairUi.btnSecondary} onClick={() => void clone()}>Clone new version</button>
            </div>
            <div>
              <h3 className="font-semibold text-sm">Version history</h3>
              <ul className="text-sm">
                {history.map((rule) => (
                  <li key={rule.id}>
                    v{rule.version} {String(rule.effective_from).slice(0, 10)}
                    {rule.effective_to ? ` – ${String(rule.effective_to).slice(0, 10)}` : ""} {rule.enabled ? "enabled" : "disabled"} {rule.severity}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      </div>
      <div className="space-y-2 border-t border-[var(--repair-border)] pt-3">
        <h3 className="font-semibold">Standing exceptions</h3>
        <div className="flex flex-wrap gap-2 items-end">
          <label>
            <span className={shopAa.label}>Rule code</span>
            <input className={repairUi.input} value={ruleCode} onChange={(e) => setRuleCode(e.target.value)} />
          </label>
          <label>
            <span className={shopAa.label}>Biller</span>
            <input className={repairUi.input} value={biller} onChange={(e) => setBiller(e.target.value)} />
          </label>
          <label className="min-w-[16rem] flex-1">
            <span className={shopAa.label}>Reason</span>
            <input className={repairUi.input} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <button type="button" className={repairUi.btnSecondary} onClick={() => void addStanding()}>Add standing exception</button>
        </div>
        <ul className="text-sm">
          {standing.map((row) => (
            <li key={row.id}>
              {row.rule_code} {row.biller ? `biller ${row.biller}` : ""} — {row.reason} ({String(row.effective_from).slice(0, 10)})
            </li>
          ))}
          {standing.length === 0 ? <li className={shopAa.muted}>None yet.</li> : null}
        </ul>
      </div>
    </div>
  );
}
