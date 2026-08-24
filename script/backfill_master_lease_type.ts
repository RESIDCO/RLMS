/**
 * One-time: set master_leases.lease_type from assigned cars (never trust the
 * hardcoded Net Lease backfill default). Dry-run unless --confirm.
 *
 *   npx tsx script/backfill_master_lease_type.ts
 *   npx tsx script/backfill_master_lease_type.ts --confirm
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { createClient } from "@supabase/supabase-js";
import {
  deriveLeaseTypeFromCars,
  storedLeaseTypeFromDerived,
} from "../shared/lease-type.ts";

const confirm = process.argv.includes("--confirm");
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function fetchAll<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await sb.from(table).select(columns).order("id").range(from, from + 999);
    if (error) throw error;
    const chunk = (data ?? []) as T[];
    out.push(...chunk);
    if (chunk.length < 1000) break;
    from += 1000;
  }
  return out;
}

const leases = await fetchAll<{ id: number; lessee: string | null; lease_type: string | null }>(
  "master_leases",
  "id, lessee, lease_type",
);
const riders = await fetchAll<{ id: number; master_lease_id: number }>(
  "riders",
  "id, master_lease_id",
);

const carsByRider = new Map<number, Array<{ lease_type: string | null; active: boolean | null }>>();
{
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from("railcar_assignments")
      .select("rider_id, railcars(lease_type, active)")
      .order("id")
      .range(from, from + 999);
    if (error) throw error;
    const chunk = data ?? [];
    for (const row of chunk) {
      const rid = Number(row.rider_id);
      if (!Number.isFinite(rid)) continue;
      const car = Array.isArray(row.railcars) ? row.railcars[0] : row.railcars;
      if (!car) continue;
      const list = carsByRider.get(rid) ?? [];
      list.push({ lease_type: car.lease_type ?? null, active: car.active ?? null });
      carsByRider.set(rid, list);
    }
    if (chunk.length < 1000) break;
    from += 1000;
  }
}

const ridersByLease = new Map<number, number[]>();
for (const r of riders) {
  const list = ridersByLease.get(r.master_lease_id) ?? [];
  list.push(r.id);
  ridersByLease.set(r.master_lease_id, list);
}

const updates: Array<{
  id: number;
  lessee: string | null;
  from: string | null;
  to: string | null;
  mixed: boolean;
  breakdown: Array<{ type: string; count: number }>;
}> = [];

for (const lease of leases) {
  const riderIds = ridersByLease.get(lease.id) ?? [];
  const cars: Array<{ lease_type: string | null; active: boolean | null }> = [];
  for (const rid of riderIds) cars.push(...(carsByRider.get(rid) ?? []));
  const derived = deriveLeaseTypeFromCars(cars);
  const to = storedLeaseTypeFromDerived(derived);
  updates.push({
    id: lease.id,
    lessee: lease.lessee,
    from: lease.lease_type,
    to,
    mixed: derived.mixed,
    breakdown: derived.breakdown,
  });
}

const changing = updates.filter((u) => u.to != null && (u.from ?? null) !== u.to);
const mixed = updates.filter((u) => u.mixed);
const byTo = new Map<string, number>();
for (const u of updates) {
  const k = u.to ?? "(null)";
  byTo.set(k, (byTo.get(k) ?? 0) + 1);
}

console.log(
  JSON.stringify(
    {
      leases: leases.length,
      wouldChange: changing.length,
      mixedCount: mixed.length,
      byTo: Object.fromEntries(byTo),
      sampleAce: updates.find((u) => /ace ethanol/i.test(String(u.lessee ?? ""))),
      sampleMixed: mixed.slice(0, 5).map((u) => ({
        id: u.id,
        lessee: u.lessee,
        to: u.to,
        breakdown: u.breakdown,
      })),
      write: confirm,
    },
    null,
    2,
  ),
);

if (!confirm) {
  console.log("Dry-run only. Pass --confirm to write master_leases.lease_type.");
  process.exit(0);
}

const WAVE = 40;
let written = 0;
for (let i = 0; i < changing.length; i += WAVE) {
  const slice = changing.slice(i, i + WAVE);
  const results = await Promise.all(
    slice.map((u) => sb.from("master_leases").update({ lease_type: u.to }).eq("id", u.id)),
  );
  for (const r of results) {
    if (r.error) throw r.error;
  }
  written += slice.length;
  console.log(`wrote ${written}/${changing.length}`);
}
console.log(JSON.stringify({ ok: true, written }, null, 2));
