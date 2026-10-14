/**
 * Owner-managed Bad Order Reasons admin (`/#/repair/bo-reasons`).
 * Extends repair.bo_rules — do not invent full AAR shopping-reason lists.
 */
import { useEffect, useState } from "react";
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
import RepairOwnerShell from "./RepairOwnerShell";
import { WorkspaceBanner } from "./WorkspaceTitle";
import { useRepairTheme } from "./repairTheme";

type Rule = {
  id: string;
  code: string;
  description: string;
  event_rule: string;
  requires_other_text: boolean;
  allows_additional_detail: boolean;
  active: boolean;
  sort_order: number;
};

function BoReasonsBody() {
  const { theme } = useRepairTheme();
  const dark = theme === "dark";
  const [rules, setRules] = useState<Rule[]>([]);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [eventRule, setEventRule] = useState<"RULE_1" | "RULE_107">("RULE_1");
  const [requiresOther, setRequiresOther] = useState(false);
  const [allowsDetail, setAllowsDetail] = useState(true);

  const load = async () => {
    const r = await apiRequest("GET", "/api/repair/bo-rules?activeOnly=0");
    const d = await r.json();
    setRules(d.rules ?? []);
  };

  useEffect(() => {
    void load().catch((e) =>
      setError(e instanceof Error ? e.message : "Load failed"),
    );
  }, []);

  const create = async () => {
    setError("");
    setMsg("");
    try {
      const r = await apiRequest("POST", "/api/repair/bo-rules", {
        code,
        description,
        eventRule,
        requiresOtherText: requiresOther,
        allowsAdditionalDetail: allowsDetail,
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Create failed");
      setCode("");
      setDescription("");
      setRequiresOther(false);
      setAllowsDetail(true);
      setMsg(`Added ${d.rule?.code}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    }
  };

  const deactivate = async (id: string, ruleCode: string) => {
    if (!window.confirm(`Deactivate Bad Order Reason ${ruleCode}?`)) return;
    const r = await apiRequest("POST", `/api/repair/bo-rules/${id}/deactivate`, {
      reason: "owner deactivated",
    });
    const d = await r.json();
    if (!r.ok) {
      setError(d.error || "Deactivate failed");
      return;
    }
    setMsg(`Deactivated ${ruleCode}`);
    await load();
  };

  const toggleActive = async (rule: Rule) => {
    const r = await apiRequest("PATCH", `/api/repair/bo-rules/${rule.id}`, {
      active: !rule.active,
    });
    const d = await r.json();
    if (!r.ok) {
      setError(d.error || "Update failed");
      return;
    }
    await load();
  };

  const panel = dark
    ? "bg-slate-900/60 border-slate-700"
    : "bg-slate-50 border-slate-200";

  return (
    <div className={dark ? "bg-slate-950 text-slate-100" : "bg-white text-slate-900"}>
      <WorkspaceBanner subtitle="Bad Order Reasons" />
      <div className="px-4 py-3 max-w-4xl">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-lg font-semibold">Bad Order Reasons</h1>
            <p className="text-xs text-slate-500">
              Owner-managed list for the Bad Orders form. Seeded RULE_1 / RULE_107 /
              OTHER only — do not invent unmarked AAR shopping reasons.
            </p>
          </div>
          <Link href="/repair/bad-orders" className="text-sm text-sky-700 underline">
            ← Bad Orders
          </Link>
        </div>

        <div className={`border rounded p-3 mb-4 space-y-2 ${panel}`}>
          <h2 className="text-sm font-semibold">Add reason</h2>
          <div className="flex flex-wrap gap-2">
            <div>
              <Label className="text-xs">Code</Label>
              <Input
                className="h-8 w-36"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="BODY_DAMAGE"
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <Label className="text-xs">Description</Label>
              <Input
                className="h-8"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Body Damage"
              />
            </div>
            <div>
              <Label className="text-xs">Event rule</Label>
              <Select
                value={eventRule}
                onValueChange={(v) =>
                  setEventRule(v === "RULE_107" ? "RULE_107" : "RULE_1")
                }
              >
                <SelectTrigger className="h-8 w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="RULE_1">RULE_1</SelectItem>
                  <SelectItem value="RULE_107">RULE_107</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-wrap gap-4 text-xs">
            <label className="flex items-center gap-1.5">
              <Checkbox
                checked={requiresOther}
                onCheckedChange={(v) => setRequiresOther(Boolean(v))}
              />
              Requires keyed detail (Other)
            </label>
            <label className="flex items-center gap-1.5">
              <Checkbox
                checked={allowsDetail}
                onCheckedChange={(v) => setAllowsDetail(Boolean(v))}
              />
              Allows additional keyed detail
            </label>
          </div>
          <Button size="sm" onClick={() => void create()}>
            Add Bad Order Reason
          </Button>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {msg && <p className="text-sm text-emerald-700">{msg}</p>}
        </div>

        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className={dark ? "bg-slate-800" : "bg-slate-100"}>
              <th className="border px-2 py-1 text-left">Code</th>
              <th className="border px-2 py-1 text-left">Description</th>
              <th className="border px-2 py-1 text-left">Event</th>
              <th className="border px-2 py-1 text-center">Req. detail</th>
              <th className="border px-2 py-1 text-center">Extra detail</th>
              <th className="border px-2 py-1 text-center">Active</th>
              <th className="border px-2 py-1 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id} className={!r.active ? "opacity-50" : undefined}>
                <td className="border px-2 py-1 font-mono text-xs">{r.code}</td>
                <td className="border px-2 py-1">{r.description}</td>
                <td className="border px-2 py-1 text-xs">{r.event_rule}</td>
                <td className="border px-2 py-1 text-center">
                  {r.requires_other_text ? "Y" : ""}
                </td>
                <td className="border px-2 py-1 text-center">
                  {r.allows_additional_detail ? "Y" : ""}
                </td>
                <td className="border px-2 py-1 text-center">
                  <Checkbox
                    checked={r.active}
                    onCheckedChange={() => void toggleActive(r)}
                  />
                </td>
                <td className="border px-2 py-1">
                  {r.active && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => void deactivate(r.id, r.code)}
                    >
                      Deactivate
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function BoReasons() {
  return (
    <RepairOwnerShell>
      <BoReasonsBody />
    </RepairOwnerShell>
  );
}
