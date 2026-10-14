/**
 * OWNER_UI §B — Shop master `/#/repair/shops`
 * Empty until owner creates shops. Never hard-delete — deactivate.
 */
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { apiRequest } from "@/lib/queryClient";
import RepairOwnerShell from "./RepairOwnerShell";
import { WorkspaceBanner } from "./WorkspaceTitle";
import { useRepairTheme } from "./repairTheme";

type Contact = {
  id?: string;
  name: string;
  email?: string;
  phone?: string;
  role?: string;
  active?: boolean;
};

type Shop = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  splc: string | null;
  billing_road: string | null;
  reporting_mark: string;
  active: boolean;
  display_label: string;
  contacts: Contact[];
};

const emptyForm = () => ({
  legalName: "",
  city: "",
  state: "",
  splc: "",
  billingRoad: "",
  active: true,
  contacts: [{ name: "", email: "", phone: "", role: "" }] as Contact[],
});

function ShopMasterBody() {
  const { theme } = useRepairTheme();
  const dark = theme === "dark";
  const [shops, setShops] = useState<Shop[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams({
        master: "1",
        activeOnly: activeOnly ? "1" : "0",
      });
      if (search.trim()) qs.set("q", search.trim());
      const res = await apiRequest("GET", `/api/repair/shops?${qs}`);
      const data = await res.json();
      setShops(data.shops ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load shops");
    } finally {
      setLoading(false);
    }
  }, [activeOnly, search]);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm());
    setShowForm(true);
    setMsg("");
  }

  function openEdit(shop: Shop) {
    setEditingId(shop.id);
    setForm({
      legalName: shop.name,
      city: shop.city ?? "",
      state: shop.state ?? "",
      splc: shop.splc ?? "",
      billingRoad: shop.billing_road ?? "",
      active: shop.active,
      contacts:
        shop.contacts?.length > 0
          ? shop.contacts.map((c) => ({
              id: c.id,
              name: c.name,
              email: c.email ?? "",
              phone: c.phone ?? "",
              role: c.role ?? "",
              active: c.active !== false,
            }))
          : [{ name: "", email: "", phone: "", role: "" }],
    });
    setShowForm(true);
    setMsg("");
  }

  async function save() {
    setSaving(true);
    setError("");
    setMsg("");
    try {
      const body = {
        legalName: form.legalName,
        city: form.city,
        state: form.state,
        splc: form.splc,
        billingRoad: form.billingRoad.trim() || null,
        active: form.active,
        contacts: form.contacts.filter((c) => c.name.trim()),
      };
      if (editingId) {
        await apiRequest("PATCH", `/api/repair/shops/${editingId}`, body);
        setMsg("Shop updated.");
      } else {
        await apiRequest("POST", "/api/repair/shops", body);
        setMsg("Shop created.");
      }
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(shop: Shop) {
    if (!confirm(`Deactivate ${shop.display_label}? Shops are never deleted.`)) {
      return;
    }
    setError("");
    try {
      await apiRequest("POST", `/api/repair/shops/${shop.id}/deactivate`, {
        reason: "Owner deactivated",
      });
      setMsg("Shop deactivated.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Deactivate failed");
    }
  }

  const panel = dark ? "border-slate-600 bg-slate-800/80" : "border-slate-400 bg-[#e8eaed]";
  const inputCls = dark
    ? "h-8 bg-slate-900 text-slate-100 border-slate-500"
    : "h-8 bg-white text-slate-900 border-slate-500";
  const labelCls = dark
    ? "text-xs text-slate-100 font-semibold"
    : "text-xs text-slate-900 font-semibold";

  return (
    <div
      className={
        dark
          ? "min-h-full bg-slate-950 text-sm text-slate-100"
          : "min-h-full bg-[#f3f4f6] text-sm text-slate-900"
      }
    >
      <WorkspaceBanner
        pageTitle="Shop Master"
        right={
          <Button
            type="button"
            size="sm"
            className="h-7 bg-white text-[#8B1E1E] hover:bg-slate-100"
            onClick={openCreate}
          >
            + New Shop
          </Button>
        }
      />

      <div className="p-3 space-y-3">
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

        <div className={`flex flex-wrap gap-3 items-center border p-2 ${panel}`}>
          <label className="inline-flex items-center gap-2 text-xs font-semibold">
            <Checkbox
              checked={activeOnly}
              onCheckedChange={(v) => setActiveOnly(v === true)}
            />
            Active only
          </label>
          <Input
            className={`w-64 ${inputCls}`}
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button type="button" variant="outline" className="h-8" onClick={() => void load()}>
            Search
          </Button>
        </div>

        <div className={`border overflow-auto ${panel}`}>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className={dark ? "bg-slate-900" : "bg-slate-200"}>
                <th className="text-left p-2 border">Legal name</th>
                <th className="text-left p-2 border">City</th>
                <th className="text-left p-2 border">ST</th>
                <th className="text-left p-2 border">SPLC</th>
                <th className="text-left p-2 border">Mark</th>
                <th className="text-left p-2 border">Active</th>
                <th className="text-left p-2 border">Contacts</th>
                <th className="text-left p-2 border">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="p-4 text-center opacity-70">
                    Loading…
                  </td>
                </tr>
              ) : shops.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-6 text-center" data-testid="shops-empty">
                    No shops yet — create one. Shop dropdowns elsewhere stay empty until a
                    shop is created. Billing roads are a separate lookup, not this list.
                  </td>
                </tr>
              ) : (
                shops.map((s) => (
                  <tr
                    key={s.id}
                    className={dark ? "odd:bg-slate-900/40" : "odd:bg-white even:bg-sky-50/40"}
                  >
                    <td className="p-2 border font-medium">{s.name}</td>
                    <td className="p-2 border">{s.city}</td>
                    <td className="p-2 border">{s.state}</td>
                    <td className="p-2 border">{s.splc}</td>
                    <td className="p-2 border">{s.billing_road ?? "—"}</td>
                    <td className="p-2 border">{s.active ? "Yes" : "No"}</td>
                    <td className="p-2 border">{s.contacts?.length ?? 0}</td>
                    <td className="p-2 border space-x-2 whitespace-nowrap">
                      <button
                        type="button"
                        className="underline text-blue-700 dark:text-sky-300"
                        onClick={() => openEdit(s)}
                      >
                        Edit
                      </button>
                      {s.active ? (
                        <button
                          type="button"
                          className="underline text-amber-800 dark:text-amber-300"
                          onClick={() => void deactivate(s)}
                        >
                          Deactivate
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {showForm ? (
          <div className={`border p-4 space-y-3 max-w-2xl ${panel}`} data-testid="shop-form">
            <h2 className="text-base font-semibold">
              {editingId ? "Edit Shop" : "Create Shop"}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <Label className={labelCls}>Legal name *</Label>
                <Input
                  className={inputCls}
                  value={form.legalName}
                  onChange={(e) => setForm({ ...form, legalName: e.target.value })}
                />
              </div>
              <div>
                <Label className={labelCls}>City *</Label>
                <Input
                  className={inputCls}
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                />
              </div>
              <div>
                <Label className={labelCls}>State *</Label>
                <Input
                  className={inputCls}
                  maxLength={2}
                  value={form.state}
                  onChange={(e) =>
                    setForm({ ...form, state: e.target.value.toUpperCase() })
                  }
                />
              </div>
              <div>
                <Label className={labelCls}>SPLC *</Label>
                <Input
                  className={inputCls}
                  value={form.splc}
                  onChange={(e) => setForm({ ...form, splc: e.target.value })}
                />
              </div>
              <div>
                <Label className={labelCls}>Mark / billing road (optional)</Label>
                <Input
                  className={inputCls}
                  value={form.billingRoad}
                  onChange={(e) =>
                    setForm({ ...form, billingRoad: e.target.value.toUpperCase() })
                  }
                  placeholder="Validated vs billing-road table"
                />
              </div>
              <label className="inline-flex items-center gap-2 text-xs font-semibold sm:col-span-2">
                <Checkbox
                  checked={form.active}
                  onCheckedChange={(v) => setForm({ ...form, active: v === true })}
                />
                Active
              </label>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className={labelCls}>Contacts</Label>
                <Button
                  type="button"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() =>
                    setForm({
                      ...form,
                      contacts: [
                        ...form.contacts,
                        { name: "", email: "", phone: "", role: "" },
                      ],
                    })
                  }
                >
                  + Contact
                </Button>
              </div>
              {form.contacts.map((c, i) => (
                <div key={i} className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <Input
                    className={inputCls}
                    placeholder="Name"
                    value={c.name}
                    onChange={(e) => {
                      const contacts = [...form.contacts];
                      contacts[i] = { ...c, name: e.target.value };
                      setForm({ ...form, contacts });
                    }}
                  />
                  <Input
                    className={inputCls}
                    placeholder="Email"
                    value={c.email ?? ""}
                    onChange={(e) => {
                      const contacts = [...form.contacts];
                      contacts[i] = { ...c, email: e.target.value };
                      setForm({ ...form, contacts });
                    }}
                  />
                  <Input
                    className={inputCls}
                    placeholder="Phone"
                    value={c.phone ?? ""}
                    onChange={(e) => {
                      const contacts = [...form.contacts];
                      contacts[i] = { ...c, phone: e.target.value };
                      setForm({ ...form, contacts });
                    }}
                  />
                  <Input
                    className={inputCls}
                    placeholder="Role"
                    value={c.role ?? ""}
                    onChange={(e) => {
                      const contacts = [...form.contacts];
                      contacts[i] = { ...c, role: e.target.value };
                      setForm({ ...form, contacts });
                    }}
                  />
                </div>
              ))}
            </div>

            <p className={`text-xs ${dark ? "text-slate-300" : "text-slate-700"}`}>
              Deactivate never deletes. Shops are linked to the owner workspace (RESIDCO).
            </p>

            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button type="button" disabled={saving} onClick={() => void save()}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function ShopMaster() {
  return (
    <RepairOwnerShell>
      <ShopMasterBody />
    </RepairOwnerShell>
  );
}
