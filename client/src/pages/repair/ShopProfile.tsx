/**
 * OWNER_UI §B — Shop Profile (read mode)
 * Route: `/#/repair/shops/:id`
 * Edit → form on Shop Master (`/#/repair/shops?edit=:id`).
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import RepairOwnerShell from "./RepairOwnerShell";
import { WorkspaceBanner } from "./WorkspaceTitle";
import { useRepairTheme } from "./repairTheme";

type Contact = {
  id?: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
};

type DeliveringLine = {
  mark: string;
  name: string | null;
  label: string;
  manual_entry: boolean;
  needs_review: boolean;
};

type CatalogItem = { id: string; code: string; display_name: string };

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
  active: boolean;
  display_label: string;
  contacts: Contact[];
  delivering_lines: DeliveringLine[];
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
  documents: Array<{
    id: string;
    kind: string;
    original_filename: string | null;
    size: number;
  }>;
};

type Recent = {
  badOrders: Array<{
    event_id: string;
    car_mark: string;
    car_number: string;
    status_code: string | null;
    created_at: string;
  }>;
  estimates: Array<{
    estimate_id: string;
    event_id: string;
    car_mark: string;
    car_number: string;
    status_code: string | null;
    total_cents: number | null;
    created_at: string;
  }>;
};

function cents(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `$${(n / 100).toFixed(2)}`;
}

function ShopProfileBody({ shopId }: { shopId: string }) {
  const { theme } = useRepairTheme();
  const dark = theme === "dark";
  const panel = dark
    ? "border-slate-600 bg-slate-950/40"
    : "border-slate-300 bg-white";
  const muted = dark ? "text-slate-400" : "text-slate-600";

  const [shop, setShop] = useState<Shop | null>(null);
  const [recent, setRecent] = useState<Recent | null>(null);
  const [capabilities, setCapabilities] = useState<CatalogItem[]>([]);
  const [carTypes, setCarTypes] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [shopRes, cap, car] = await Promise.all([
        apiRequest("GET", `/api/repair/shops/${shopId}`),
        apiRequest("GET", "/api/repair/admin/shop-catalog/capability"),
        apiRequest("GET", "/api/repair/admin/shop-catalog/car_type"),
      ]);
      const data = await shopRes.json();
      setShop(data.shop ?? null);
      setRecent(data.recent ?? { badOrders: [], estimates: [] });
      setCapabilities((await cap.json()).items ?? []);
      setCarTypes((await car.json()).items ?? []);
      if (!data.shop) setError("Shop not found");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load shop");
    } finally {
      setLoading(false);
    }
  }, [shopId]);

  useEffect(() => {
    void load();
  }, [load]);

  const capNames = new Map(capabilities.map((c) => [c.id, c.display_name]));
  const carNames = new Map(carTypes.map((c) => [c.id, c.display_name]));

  if (loading) {
    return (
      <div className="p-6 text-sm opacity-70" data-testid="shop-profile-loading">
        Loading shop profile…
      </div>
    );
  }

  if (error || !shop) {
    return (
      <div className="p-6 space-y-3" data-testid="shop-profile-error">
        <p className="text-sm text-red-700 dark:text-red-300">
          {error || "Shop not found"}
        </p>
        <Link href="/repair/shops" className="underline text-sm">
          ← Back to Shop Master
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 max-w-5xl" data-testid="shop-profile">
      <WorkspaceBanner />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className={`text-xs uppercase tracking-wide ${muted}`}>Shop Profile</p>
          <h1 className="text-xl font-semibold">{shop.display_label}</h1>
          <p className={`text-xs ${muted}`}>
            Read-only. Use Edit to open the shop form.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/repair/shops">
            <Button type="button" variant="outline" className="h-9 text-xs">
              ← Shop list
            </Button>
          </Link>
          <Link href={`/repair/shops?edit=${shop.id}`}>
            <Button type="button" className="h-9 text-xs" data-testid="shop-profile-edit">
              Edit
            </Button>
          </Link>
        </div>
      </div>

      <section className={`border p-4 space-y-2 ${panel}`}>
        <h2 className="text-sm font-semibold">Header</h2>
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-xs">
          <div>
            <dt className={muted}>Legal name</dt>
            <dd className="font-medium">{shop.name}</dd>
          </div>
          <div>
            <dt className={muted}>Shop mark</dt>
            <dd>{shop.shop_mark ?? "—"}</dd>
          </div>
          <div>
            <dt className={muted}>City / ST</dt>
            <dd>
              {shop.city}, {shop.state}
            </dd>
          </div>
          <div>
            <dt className={muted}>SPLC</dt>
            <dd>{shop.splc ?? "—"}</dd>
          </div>
          <div>
            <dt className={muted}>Billing road</dt>
            <dd>{shop.billing_road ?? "—"}</dd>
          </div>
          <div>
            <dt className={muted}>Active</dt>
            <dd>{shop.active ? "Yes" : "No"}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className={muted}>Website</dt>
            <dd>
              {shop.website ? (
                <a
                  href={shop.website}
                  className="underline text-blue-700 dark:text-sky-300"
                  target="_blank"
                  rel="noreferrer"
                >
                  {shop.website}
                </a>
              ) : (
                "—"
              )}
            </dd>
          </div>
        </dl>
      </section>

      <section className={`border p-4 space-y-2 ${panel}`}>
        <h2 className="text-sm font-semibold">Delivering lines</h2>
        {(shop.delivering_lines ?? []).length === 0 ? (
          <p className={`text-xs ${muted}`}>None</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5 text-xs">
            {shop.delivering_lines.map((l) => (
              <li
                key={l.mark}
                className={`border px-2 py-0.5 ${
                  l.needs_review
                    ? "border-amber-600 bg-amber-50 dark:bg-amber-950/40"
                    : ""
                }`}
              >
                {l.label}
                {l.needs_review ? " · review" : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <section className={`border p-4 space-y-2 ${panel}`}>
          <h2 className="text-sm font-semibold">Capabilities</h2>
          <p className="text-xs">
            {(shop.capability_ids ?? [])
              .map((id) => capNames.get(id) ?? id)
              .join(", ") || "—"}
          </p>
        </section>
        <section className={`border p-4 space-y-2 ${panel}`}>
          <h2 className="text-sm font-semibold">Car types</h2>
          <p className="text-xs">
            {(shop.car_type_ids ?? [])
              .map((id) => carNames.get(id) ?? id)
              .join(", ") || "—"}
          </p>
        </section>
      </div>

      <section className={`border p-4 space-y-2 ${panel}`}>
        <h2 className="text-sm font-semibold">Certifications</h2>
        {(shop.certifications ?? []).length === 0 ? (
          <p className={`text-xs ${muted}`}>None</p>
        ) : (
          <ul className="text-xs space-y-1">
            {shop.certifications.map((c) => (
              <li key={c.id} className="flex flex-wrap gap-2 items-center">
                <span className="font-medium">
                  {c.cert_type_label ?? "Cert"}
                </span>
                <span className="font-mono">{c.certificate_number ?? "—"}</span>
                <span>exp {c.expires_on ?? "—"}</span>
                {c.expiry_warning === "expired" ? (
                  <span className="text-red-700 dark:text-red-300 font-semibold">
                    EXPIRED
                  </span>
                ) : null}
                {c.expiry_warning === "expiring_soon" ? (
                  <span className="text-amber-800 dark:text-amber-300 font-semibold">
                    ≤60 days
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={`border p-4 space-y-2 ${panel}`}>
        <h2 className="text-sm font-semibold">Contacts</h2>
        {(shop.contacts ?? []).length === 0 ? (
          <p className={`text-xs ${muted}`}>None</p>
        ) : (
          <ul className="text-xs space-y-2">
            {shop.contacts.map((c, i) => (
              <li key={c.id ?? i} className="flex flex-wrap gap-x-3 gap-y-1">
                <span className="font-medium">{c.name}</span>
                {c.role ? <span className={muted}>{c.role}</span> : null}
                {c.email ? (
                  <a
                    className="underline text-blue-700 dark:text-sky-300"
                    href={`mailto:${c.email}`}
                  >
                    {c.email}
                  </a>
                ) : null}
                {c.phone ? (
                  <a
                    className="underline text-blue-700 dark:text-sky-300"
                    href={`tel:${c.phone}`}
                  >
                    {c.phone}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={`border p-4 space-y-2 ${panel}`}>
        <h2 className="text-sm font-semibold">Attachments</h2>
        {(shop.documents ?? []).length === 0 ? (
          <p className={`text-xs ${muted}`}>None</p>
        ) : (
          <ul className="text-xs space-y-1">
            {shop.documents.map((d) => (
              <li key={d.id}>
                <span className="font-mono mr-2">{d.kind}</span>
                {d.original_filename ?? d.id}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={`border p-4 space-y-2 ${panel}`}>
        <h2 className="text-sm font-semibold">Notes / hours</h2>
        <p className="text-xs whitespace-pre-wrap">
          {shop.hours_notes?.trim() || "—"}
        </p>
      </section>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <section className={`border p-4 space-y-2 ${panel}`}>
          <h2 className="text-sm font-semibold">Recent bad orders</h2>
          {(recent?.badOrders ?? []).length === 0 ? (
            <p className={`text-xs ${muted}`}>None yet at this shop</p>
          ) : (
            <ul className="text-xs space-y-1">
              {recent!.badOrders.map((b) => (
                <li key={b.event_id} className="flex flex-wrap gap-2">
                  <span className="font-mono">
                    {b.car_mark} {b.car_number}
                  </span>
                  <span className={muted}>{b.status_code ?? "—"}</span>
                  <span className={muted}>
                    {new Date(b.created_at).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className={`border p-4 space-y-2 ${panel}`}>
          <h2 className="text-sm font-semibold">Recent estimates</h2>
          {(recent?.estimates ?? []).length === 0 ? (
            <p className={`text-xs ${muted}`}>None yet at this shop</p>
          ) : (
            <ul className="text-xs space-y-1">
              {recent!.estimates.map((e) => (
                <li key={e.estimate_id} className="flex flex-wrap gap-2">
                  <Link
                    href={`/repair/estimates/${e.estimate_id}`}
                    className="underline text-blue-700 dark:text-sky-300 font-mono"
                  >
                    {e.car_mark} {e.car_number}
                  </Link>
                  <span className={muted}>{e.status_code ?? "—"}</span>
                  <span>{cents(e.total_cents)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

export default function ShopProfile() {
  const [, params] = useRoute("/repair/shops/:id");
  const shopId = params?.id ?? "";
  return (
    <RepairOwnerShell>
      {shopId ? (
        <ShopProfileBody shopId={shopId} />
      ) : (
        <div className="p-6 text-sm">Missing shop id</div>
      )}
    </RepairOwnerShell>
  );
}
