/**
 * Admin (gear) — owner-managed shop catalogs that grow over time.
 * Capabilities, car types accepted, AAR certification types.
 */
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/queryClient";
import RepairOwnerShell from "./RepairOwnerShell";
import { WorkspaceBanner } from "./WorkspaceTitle";
import { useRepairTheme } from "./repairTheme";

type Kind = "capability" | "car_type" | "cert_type";

type CatalogItem = {
  id: string;
  code: string;
  display_name: string;
  sort_order: number;
  active: boolean;
};

const TABS: { kind: Kind; label: string }[] = [
  { kind: "capability", label: "Shop capabilities" },
  { kind: "car_type", label: "Car types accepted" },
  { kind: "cert_type", label: "AAR cert types" },
];

function AdminBody() {
  const { theme } = useRepairTheme();
  const dark = theme === "dark";
  const [kind, setKind] = useState<Kind>("capability");
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiRequest(
        "GET",
        `/api/repair/admin/shop-catalog/${kind}?activeOnly=0`,
      );
      const data = await res.json();
      setItems(data.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load catalog");
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addItem() {
    setError("");
    setMsg("");
    try {
      await apiRequest("POST", `/api/repair/admin/shop-catalog/${kind}`, {
        code,
        displayName,
      });
      setCode("");
      setDisplayName("");
      setMsg("Saved.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
  }

  async function deactivate(id: string) {
    setError("");
    try {
      await apiRequest(
        "POST",
        `/api/repair/admin/shop-catalog/${kind}/${id}/deactivate`,
        {},
      );
      setMsg("Deactivated.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Deactivate failed");
    }
  }

  const panel = dark ? "border-slate-600 bg-slate-800/80" : "border-slate-400 repair-panel-muted-bg";
  const inputCls = dark
    ? "h-8 bg-slate-900 text-slate-100 border-slate-500"
    : "h-8 bg-white text-slate-900 border-slate-500";

  return (
    <div
      className={
        dark
          ? "min-h-full bg-slate-950 text-sm text-slate-100"
          : "min-h-full repair-page-bg text-sm"
      }
    >
      <WorkspaceBanner pageTitle="Admin" />
      <div className="p-3 space-y-3 max-w-3xl">
        <p className={dark ? "text-slate-300 text-xs" : "text-slate-700 text-xs"}>
          Manage lists used on Shop Master. Add codes as shops grow — deactivate
          never deletes.
        </p>
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

        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <Button
              key={t.kind}
              type="button"
              size="sm"
              variant={kind === t.kind ? "default" : "outline"}
              className="h-8"
              onClick={() => setKind(t.kind)}
            >
              {t.label}
            </Button>
          ))}
        </div>

        <div className={`border p-3 space-y-2 ${panel}`}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
            <div>
              <Label className="text-xs font-semibold">Code</Label>
              <Input
                className={inputCls}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="TANK_CLEANING"
              />
            </div>
            <div>
              <Label className="text-xs font-semibold">Display name</Label>
              <Input
                className={inputCls}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Tank cleaning"
              />
            </div>
            <Button type="button" className="h-8" onClick={() => void addItem()}>
              Add / update
            </Button>
          </div>
        </div>

        <div className={`border overflow-auto ${panel}`}>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className={dark ? "bg-slate-900" : "bg-slate-200"}>
                <th className="text-left p-2 border">Code</th>
                <th className="text-left p-2 border">Display</th>
                <th className="text-left p-2 border">Active</th>
                <th className="text-left p-2 border">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="p-4 text-center opacity-70">
                    Loading…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-4 text-center">
                    No items yet.
                  </td>
                </tr>
              ) : (
                items.map((it) => (
                  <tr key={it.id}>
                    <td className="p-2 border font-mono">{it.code}</td>
                    <td className="p-2 border">{it.display_name}</td>
                    <td className="p-2 border">{it.active ? "Yes" : "No"}</td>
                    <td className="p-2 border">
                      {it.active ? (
                        <button
                          type="button"
                          className="underline text-amber-800 dark:text-amber-300"
                          onClick={() => void deactivate(it.id)}
                        >
                          Deactivate
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function RepairAdmin() {
  return (
    <RepairOwnerShell>
      <AdminBody />
    </RepairOwnerShell>
  );
}
