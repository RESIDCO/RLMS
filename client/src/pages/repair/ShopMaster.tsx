/**
 * OWNER_UI §B — Shop master `/#/repair/shops`
 * Empty until owner creates shops. Never hard-delete — deactivate.
 * Optional: shop mark, delivering lines, capabilities, car types, certs,
 * website/hours, attachments (delete → VOIDED).
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

type CatalogItem = { id: string; code: string; display_name: string };
type Road = { mark: string; name: string | null };

type CertRow = {
  id?: string;
  certTypeId: string;
  certTypeLabel: string;
  certificateNumber: string;
  expiresOn: string;
  expiry_warning?: "expired" | "expiring_soon" | null;
};

type ShopDoc = {
  id: string;
  kind: string;
  original_filename: string | null;
  size: number;
};

type Shop = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  splc: string | null;
  billing_road: string | null;
  shop_mark: string | null;
  website: string | null;
  hours_notes: string | null;
  reporting_mark: string;
  active: boolean;
  display_label: string;
  contacts: Contact[];
  delivering_lines: string[];
  capability_ids: string[];
  car_type_ids: string[];
  certifications: Array<{
    id: string;
    cert_type_id: string | null;
    cert_type_label: string | null;
    certificate_number: string | null;
    expires_on: string | null;
    expiry_warning: "expired" | "expiring_soon" | null;
  }>;
  documents: ShopDoc[];
};

const emptyForm = () => ({
  legalName: "",
  city: "",
  state: "",
  splc: "",
  billingRoad: "",
  shopMark: "",
  website: "",
  hoursNotes: "",
  active: true,
  contacts: [{ name: "", email: "", phone: "", role: "" }] as Contact[],
  deliveringLines: [] as string[],
  capabilityIds: [] as string[],
  carTypeIds: [] as string[],
  certifications: [
    {
      certTypeId: "",
      certTypeLabel: "",
      certificateNumber: "",
      expiresOn: "",
    },
  ] as CertRow[],
});

function toggleId(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

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
  const [capabilities, setCapabilities] = useState<CatalogItem[]>([]);
  const [carTypes, setCarTypes] = useState<CatalogItem[]>([]);
  const [certTypes, setCertTypes] = useState<CatalogItem[]>([]);
  const [roads, setRoads] = useState<Road[]>([]);
  const [docKind, setDocKind] = useState("w9");
  const [uploading, setUploading] = useState(false);

  const loadCatalogs = useCallback(async () => {
    const [cap, car, cert, roadRes] = await Promise.all([
      apiRequest("GET", "/api/repair/admin/shop-catalog/capability"),
      apiRequest("GET", "/api/repair/admin/shop-catalog/car_type"),
      apiRequest("GET", "/api/repair/admin/shop-catalog/cert_type"),
      apiRequest("GET", "/api/repair/billing-roads"),
    ]);
    setCapabilities((await cap.json()).items ?? []);
    setCarTypes((await car.json()).items ?? []);
    setCertTypes((await cert.json()).items ?? []);
    setRoads((await roadRes.json()).billingRoads ?? []);
  }, []);

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
    void loadCatalogs().catch((e) =>
      setError(e instanceof Error ? e.message : "Failed to load catalogs"),
    );
  }, [load, loadCatalogs]);

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
      shopMark: shop.shop_mark ?? "",
      website: shop.website ?? "",
      hoursNotes: shop.hours_notes ?? "",
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
      deliveringLines: [...(shop.delivering_lines ?? [])],
      capabilityIds: [...(shop.capability_ids ?? [])],
      carTypeIds: [...(shop.car_type_ids ?? [])],
      certifications:
        shop.certifications?.length > 0
          ? shop.certifications.map((c) => ({
              id: c.id,
              certTypeId: c.cert_type_id ?? "",
              certTypeLabel: c.cert_type_label ?? "",
              certificateNumber: c.certificate_number ?? "",
              expiresOn: c.expires_on ?? "",
              expiry_warning: c.expiry_warning,
            }))
          : [
              {
                certTypeId: "",
                certTypeLabel: "",
                certificateNumber: "",
                expiresOn: "",
              },
            ],
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
        shopMark: form.shopMark.trim() || null,
        website: form.website.trim() || null,
        hoursNotes: form.hoursNotes.trim() || null,
        active: form.active,
        contacts: form.contacts.filter((c) => c.name.trim()),
        deliveringLines: form.deliveringLines,
        capabilityIds: form.capabilityIds,
        carTypeIds: form.carTypeIds,
        certifications: form.certifications
          .filter(
            (c) =>
              c.certTypeId ||
              c.certTypeLabel.trim() ||
              c.certificateNumber.trim() ||
              c.expiresOn.trim(),
          )
          .map((c) => ({
            certTypeId: c.certTypeId || null,
            certTypeLabel: c.certTypeLabel || null,
            certificateNumber: c.certificateNumber || null,
            expiresOn: c.expiresOn || null,
          })),
      };
      if (editingId) {
        await apiRequest("PATCH", `/api/repair/shops/${editingId}`, body);
        setMsg("Shop updated.");
      } else {
        const res = await apiRequest("POST", "/api/repair/shops", body);
        const data = await res.json();
        setEditingId(data.shop?.id ?? null);
        setMsg("Shop created.");
      }
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

  async function uploadDoc(file: File | null) {
    if (!editingId || !file) return;
    setUploading(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", docKind);
      const res = await fetch(`/api/repair/shops/${editingId}/documents`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Upload failed (${res.status})`);
      }
      setMsg("Attachment uploaded.");
      await load();
      const updated = (await (
        await apiRequest("GET", `/api/repair/shops/${editingId}`)
      ).json()) as { shop: Shop };
      if (updated.shop) openEdit(updated.shop);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function voidDoc(docId: string) {
    if (!confirm("Delete attachment? It will be VOIDED (retained, never purged).")) {
      return;
    }
    try {
      await apiRequest("POST", `/api/repair/documents/${docId}/soft-delete`, {
        reason: "Owner removed shop attachment",
      });
      setMsg("Attachment VOIDED.");
      if (editingId) {
        const updated = (await (
          await apiRequest("GET", `/api/repair/shops/${editingId}`)
        ).json()) as { shop: Shop };
        if (updated.shop) openEdit(updated.shop);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  const panel = dark ? "border-slate-600 bg-slate-800/80" : "border-slate-400 bg-[#e8eaed]";
  const inputCls = dark
    ? "h-8 bg-slate-900 text-slate-100 border-slate-500"
    : "h-8 bg-white text-slate-900 border-slate-500";
  const labelCls = dark
    ? "text-xs text-slate-100 font-semibold"
    : "text-xs text-slate-900 font-semibold";

  const editingShop = editingId
    ? shops.find((s) => s.id === editingId)
    : null;

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
            className={`w-72 ${inputCls}`}
            placeholder="Search name, mark, city, capability…"
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
                <th className="text-left p-2 border">Shop mark</th>
                <th className="text-left p-2 border">City</th>
                <th className="text-left p-2 border">ST</th>
                <th className="text-left p-2 border">SPLC</th>
                <th className="text-left p-2 border">Billing road</th>
                <th className="text-left p-2 border">Lines</th>
                <th className="text-left p-2 border">Caps</th>
                <th className="text-left p-2 border">Active</th>
                <th className="text-left p-2 border">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10} className="p-4 text-center opacity-70">
                    Loading…
                  </td>
                </tr>
              ) : shops.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-6 text-center" data-testid="shops-empty">
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
                    <td className="p-2 border">{s.shop_mark ?? "—"}</td>
                    <td className="p-2 border">{s.city}</td>
                    <td className="p-2 border">{s.state}</td>
                    <td className="p-2 border">{s.splc}</td>
                    <td className="p-2 border">{s.billing_road ?? "—"}</td>
                    <td className="p-2 border">
                      {(s.delivering_lines ?? []).join(", ") || "—"}
                    </td>
                    <td className="p-2 border">{s.capability_ids?.length ?? 0}</td>
                    <td className="p-2 border">{s.active ? "Yes" : "No"}</td>
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
          <div className={`border p-4 space-y-4 max-w-3xl ${panel}`} data-testid="shop-form">
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
                <Label className={labelCls}>Shop mark / AAR shop code</Label>
                <Input
                  className={inputCls}
                  value={form.shopMark}
                  onChange={(e) =>
                    setForm({ ...form, shopMark: e.target.value.toUpperCase() })
                  }
                  placeholder="e.g. A084"
                />
              </div>
              <div>
                <Label className={labelCls}>Mark / billing road</Label>
                <Input
                  className={inputCls}
                  value={form.billingRoad}
                  onChange={(e) =>
                    setForm({ ...form, billingRoad: e.target.value.toUpperCase() })
                  }
                  placeholder="Validated vs billing-road table"
                />
              </div>
              <div>
                <Label className={labelCls}>Website</Label>
                <Input
                  className={inputCls}
                  value={form.website}
                  onChange={(e) => setForm({ ...form, website: e.target.value })}
                  placeholder="https://…"
                />
              </div>
              <div className="sm:col-span-2">
                <Label className={labelCls}>Hours / notes</Label>
                <Input
                  className={inputCls}
                  value={form.hoursNotes}
                  onChange={(e) => setForm({ ...form, hoursNotes: e.target.value })}
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
              <Label className={labelCls}>Delivering line(s)</Label>
              <div className="flex flex-wrap gap-2 max-h-28 overflow-auto border p-2">
                {roads.length === 0 ? (
                  <span className="text-xs opacity-70">No billing roads seeded yet.</span>
                ) : (
                  roads.map((r) => (
                    <label
                      key={r.mark}
                      className="inline-flex items-center gap-1 text-xs border px-2 py-1"
                    >
                      <Checkbox
                        checked={form.deliveringLines.includes(r.mark)}
                        onCheckedChange={() =>
                          setForm({
                            ...form,
                            deliveringLines: toggleId(form.deliveringLines, r.mark),
                          })
                        }
                      />
                      {r.mark}
                    </label>
                  ))
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label className={labelCls}>Shop capabilities</Label>
              <div className="flex flex-wrap gap-2">
                {capabilities.map((c) => (
                  <label
                    key={c.id}
                    className="inline-flex items-center gap-1 text-xs border px-2 py-1"
                  >
                    <Checkbox
                      checked={form.capabilityIds.includes(c.id)}
                      onCheckedChange={() =>
                        setForm({
                          ...form,
                          capabilityIds: toggleId(form.capabilityIds, c.id),
                        })
                      }
                    />
                    {c.display_name}
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label className={labelCls}>Car types accepted</Label>
              <div className="flex flex-wrap gap-2">
                {carTypes.map((c) => (
                  <label
                    key={c.id}
                    className="inline-flex items-center gap-1 text-xs border px-2 py-1"
                  >
                    <Checkbox
                      checked={form.carTypeIds.includes(c.id)}
                      onCheckedChange={() =>
                        setForm({
                          ...form,
                          carTypeIds: toggleId(form.carTypeIds, c.id),
                        })
                      }
                    />
                    {c.display_name}
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className={labelCls}>AAR certifications</Label>
                <Button
                  type="button"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() =>
                    setForm({
                      ...form,
                      certifications: [
                        ...form.certifications,
                        {
                          certTypeId: "",
                          certTypeLabel: "",
                          certificateNumber: "",
                          expiresOn: "",
                        },
                      ],
                    })
                  }
                >
                  + Cert
                </Button>
              </div>
              {form.certifications.map((c, i) => (
                <div key={i} className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                  <select
                    className={`${inputCls} rounded border px-2`}
                    value={c.certTypeId}
                    onChange={(e) => {
                      const id = e.target.value;
                      const t = certTypes.find((x) => x.id === id);
                      const certifications = [...form.certifications];
                      certifications[i] = {
                        ...c,
                        certTypeId: id,
                        certTypeLabel: t?.display_name ?? c.certTypeLabel,
                      };
                      setForm({ ...form, certifications });
                    }}
                  >
                    <option value="">Type…</option>
                    {certTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.display_name}
                      </option>
                    ))}
                  </select>
                  <Input
                    className={inputCls}
                    placeholder="Certificate #"
                    value={c.certificateNumber}
                    onChange={(e) => {
                      const certifications = [...form.certifications];
                      certifications[i] = {
                        ...c,
                        certificateNumber: e.target.value,
                      };
                      setForm({ ...form, certifications });
                    }}
                  />
                  <Input
                    className={inputCls}
                    type="date"
                    value={c.expiresOn}
                    onChange={(e) => {
                      const certifications = [...form.certifications];
                      certifications[i] = { ...c, expiresOn: e.target.value };
                      setForm({ ...form, certifications });
                    }}
                  />
                  <div className="text-xs flex items-center">
                    {c.expiry_warning === "expired" ? (
                      <span className="text-red-700 font-semibold">Expired</span>
                    ) : c.expiry_warning === "expiring_soon" ? (
                      <span className="text-amber-700 font-semibold">
                        Expires ≤60 days
                      </span>
                    ) : (
                      <span className="opacity-50">—</span>
                    )}
                  </div>
                </div>
              ))}
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

            <div className="space-y-2">
              <Label className={labelCls}>
                Attachments (W-9, certificates, rate sheets)
              </Label>
              {!editingId ? (
                <p className="text-xs opacity-70">
                  Save the shop first, then attach documents.
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2 items-center">
                    <select
                      className={`${inputCls} rounded border px-2`}
                      value={docKind}
                      onChange={(e) => setDocKind(e.target.value)}
                    >
                      <option value="w9">W-9</option>
                      <option value="certificate">Certificate</option>
                      <option value="rate_sheet">Rate sheet</option>
                      <option value="shop_attachment">Other</option>
                    </select>
                    <Input
                      type="file"
                      className={inputCls}
                      disabled={uploading}
                      onChange={(e) =>
                        void uploadDoc(e.target.files?.[0] ?? null)
                      }
                    />
                  </div>
                  <ul className="text-xs space-y-1">
                    {(editingShop?.documents ?? []).map((d) => (
                      <li key={d.id} className="flex gap-2 items-center">
                        <span className="font-mono">{d.kind}</span>
                        <span>{d.original_filename ?? d.id}</span>
                        <button
                          type="button"
                          className="underline text-amber-800 dark:text-amber-300"
                          onClick={() => void voidDoc(d.id)}
                        >
                          Delete → VOIDED
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>

            <p className={`text-xs ${dark ? "text-slate-300" : "text-slate-700"}`}>
              All fields above except legal name / city / ST / SPLC are optional.
              Deactivate never deletes. BO dropdown shows{" "}
              <span className="font-medium">Name (MARK) – City, ST</span> when shop
              mark is set. Catalogs grow under Admin (gear).
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
