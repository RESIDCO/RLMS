/**
 * Owner-managed Bad Order Reasons admin (`/#/repair/bo-reasons`).
 * Name + optional short name + active + sort order.
 * Optional rule-based flag (Rule 1 / Rule 107 / Other).
 * Do not invent full AAR shopping-reason lists.
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
  short_name: string | null;
  description: string;
  event_rule: string;
  is_rule_based: boolean;
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
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [sortOrder, setSortOrder] = useState("100");
  const [isRuleBased, setIsRuleBased] = useState(false);
  const [eventRule, setEventRule] = useState<"RULE_1" | "RULE_107" | "OTHER">(
    "RULE_1",
  );
  const [requiresOther, setRequiresOther] = useState(false);

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
        description: name,
        shortName: shortName || undefined,
        sortOrder: Number(sortOrder) || 100,
        isRuleBased,
        eventRule: isRuleBased ? eventRule : "RULE_1",
        requiresOtherText: requiresOther || (isRuleBased && eventRule === "OTHER"),
        allowsAdditionalDetail: true,
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Create failed");
      setName("");
      setShortName("");
      setSortOrder("100");
      setIsRuleBased(false);
      setEventRule("RULE_1");
      setRequiresOther(false);
      setMsg(`Added ${d.rule?.description}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    }
  };

  const deactivate = async (id: string, label: string) => {
    if (!window.confirm(`Deactivate Bad Order Reason “${label}”?`)) return;
    const r = await apiRequest("POST", `/api/repair/bo-rules/${id}/deactivate`, {
      reason: "owner deactivated",
    });
    const d = await r.json();
    if (!r.ok) {
      setError(d.error || "Deactivate failed");
      return;
    }
    setMsg(`Deactivated ${label}`);
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

  const saveSort = async (rule: Rule, next: string) => {
    const n = Number(next);
    if (!Number.isFinite(n)) return;
    const r = await apiRequest("PATCH", `/api/repair/bo-rules/${rule.id}`, {
      sortOrder: n,
    });
    if (!r.ok) {
      const d = await r.json();
      setError(d.error || "Sort update failed");
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
            <p className="text-xs text-slate-700">
              Name + optional short name + active + sort order. Optional rule-based
              flag (Rule 1 / Rule 107 / Other). Seeded reasons only — do not invent
              unmarked AAR shopping reasons.
            </p>
          </div>
          <Link href="/repair/bad-orders" className="text-sm text-sky-700 underline">
            ← Bad Orders
          </Link>
        </div>

        <div className={`border rounded p-3 mb-4 space-y-2 ${panel}`}>
          <h2 className="text-sm font-semibold">Add reason</h2>
          <div className="flex flex-wrap gap-2">
            <div className="flex-1 min-w-[200px]">
              <Label className="text-xs">
                Name <span className="text-red-600">*</span>
              </Label>
              <Input
                className="h-8"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Body Damage"
              />
            </div>
            <div>
              <Label className="text-xs">Short name (optional)</Label>
              <Input
                className="h-8 w-40"
                value={shortName}
                onChange={(e) => setShortName(e.target.value)}
                placeholder="BODY"
              />
            </div>
            <div>
              <Label className="text-xs">Sort order</Label>
              <Input
                className="h-8 w-24"
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-4 text-xs items-end">
            <label className="flex items-center gap-1.5">
              <Checkbox
                checked={isRuleBased}
                onCheckedChange={(v) => setIsRuleBased(Boolean(v))}
              />
              Rule-based
            </label>
            {isRuleBased && (
              <div>
                <Label className="text-xs">Rule</Label>
                <Select
                  value={eventRule}
                  onValueChange={(v) =>
                    setEventRule(
                      v === "RULE_107"
                        ? "RULE_107"
                        : v === "OTHER"
                          ? "OTHER"
                          : "RULE_1",
                    )
                  }
                >
                  <SelectTrigger className="h-8 w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="RULE_1">Rule 1</SelectItem>
                    <SelectItem value="RULE_107">Rule 107</SelectItem>
                    <SelectItem value="OTHER">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <label className="flex items-center gap-1.5">
              <Checkbox
                checked={requiresOther || (isRuleBased && eventRule === "OTHER")}
                onCheckedChange={(v) => setRequiresOther(Boolean(v))}
              />
              Requires keyed detail
            </label>
          </div>
          <Button size="sm" onClick={() => void create()} disabled={!name.trim()}>
            Add Bad Order Reason
          </Button>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {msg && <p className="text-sm text-emerald-700">{msg}</p>}
        </div>

        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className={dark ? "bg-slate-800" : "bg-slate-100"}>
              <th className="border px-2 py-1 text-left">Name</th>
              <th className="border px-2 py-1 text-left">Short name</th>
              <th className="border px-2 py-1 text-left">Rule-based</th>
              <th className="border px-2 py-1 text-center">Sort</th>
              <th className="border px-2 py-1 text-center">Active</th>
              <th className="border px-2 py-1 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id} className={!r.active ? "opacity-50" : undefined}>
                <td className="border px-2 py-1">{r.description}</td>
                <td className="border px-2 py-1 text-xs">
                  {r.short_name || "—"}
                </td>
                <td className="border px-2 py-1 text-xs">
                  {r.is_rule_based
                    ? r.event_rule === "RULE_107"
                      ? "Rule 107"
                      : r.event_rule === "OTHER"
                        ? "Other"
                        : "Rule 1"
                    : "—"}
                </td>
                <td className="border px-2 py-1 text-center">
                  <Input
                    className="h-7 w-16 mx-auto text-xs text-center"
                    defaultValue={String(r.sort_order)}
                    onBlur={(e) => void saveSort(r, e.target.value)}
                  />
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
                      onClick={() => void deactivate(r.id, r.description)}
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
