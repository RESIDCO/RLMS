import { Link, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import PageHeader from "@/components/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { formatCalendarDate } from "@shared/lease-authority";
import { displayRailcarStatus, displayStatusInputFromRailcar } from "@shared/fleet-status";
import { displayLeaseNumber } from "@shared/residco-import";
import { fmtUsd, fmtInt } from "@/lib/dv/format";
import { InactiveFleetBadge } from "@/components/InactiveFleetBadge";
import { LeaseTypeBadge } from "@/components/LeaseTypeBadge";
import { asOne } from "@shared/lease-type";
import { ChevronRight, Calculator } from "lucide-react";
import { CATEGORY_BADGE, STATUS_LABEL, type ProgramStatus } from "@shared/programs";
import {
  ENTITY_SLUGS,
  entityOlPath,
  entityPath,
  lesseeOlPath,
  lesseePath,
  olPath,
  openAppTab,
  programPath,
  turning50OlPath,
  turning50Path,
} from "@/lib/browse-nav";

type DetailPayload = {
  railcar: any;
  history?: any[];
  number_history?: any[];
};

const ENTITY_STYLES: Record<string, { label: string; cls: string }> = {
  "Rail Partners Select": { label: "RPS", cls: "bg-umler-steel/15 text-umler-steel border-umler-steel/30" },
  Main: { label: "MAIN", cls: "bg-umler-teal/15 text-umler-teal border-umler-teal/30" },
  Coal: { label: "COAL", cls: "bg-umler-faint/15 text-umler-faint border-umler-faint/30" },
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      <div className="text-sm text-foreground">{children}</div>
    </div>
  );
}

function dash(v: unknown) {
  if (v == null || v === "") return "—";
  return String(v);
}

export default function CarDetailPage() {
  const [direct, directP] = useRoute("/cars/:id");
  const [fromLessee, lesseeP] = useRoute("/browse/lessee/:lessee/ol/:ol/car/:id");
  const [fromEntity, entityP] = useRoute("/browse/entity/:entity/ol/:ol/car/:id");
  const [fromOl, olP] = useRoute("/browse/ol/:ol/car/:id");
  const [fromT50Ol, t50OlP] = useRoute("/browse/turning50/:year/ol/:ol/car/:id");
  const [fromT50, t50P] = useRoute("/browse/turning50/:year/car/:id");
  const id = Number((lesseeP || entityP || olP || t50OlP || t50P || directP)?.id);
  const { data, isLoading, error } = useQuery<DetailPayload>({
    queryKey: ["/api/railcars", id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/railcars/${id}`);
      return res.json();
    },
    enabled: Number.isFinite(id) && id > 0,
  });
  const { data: programHistory = [] } = useQuery<any[]>({
    queryKey: ["/api/railcars", id, "programs"],
    queryFn: () => apiRequest("GET", `/api/railcars/${id}/programs`).then((r) => r.json()),
    enabled: Number.isFinite(id) && id > 0,
  });

  const r = data?.railcar;
  const assignment = asOne(r?.assignment);
  const rider = asOne(assignment?.rider);
  const lease = asOne(rider?.master_lease);
  const mark = r ? [r.reporting_marks, r.car_number].filter(Boolean).join(" ") : "Car";
  const ol = r?.rider_external_id || (olP?.ol ? decodeURIComponent(olP.ol) : null) || (lesseeP?.ol ? decodeURIComponent(lesseeP.ol) : null) || (entityP?.ol ? decodeURIComponent(entityP.ol) : null);
  const lessee = r?.lessee_name || (lesseeP?.lessee ? decodeURIComponent(lesseeP.lessee) : null);
  const crumbs: { href?: string; label: string }[] = [{ href: "/", label: "Dashboard" }];
  if (fromLessee && lesseeP) {
    const L = decodeURIComponent(lesseeP.lessee);
    const O = decodeURIComponent(lesseeP.ol);
    crumbs.push({ href: lesseePath(L), label: L }, { href: lesseeOlPath(L, O), label: O });
  } else if (fromEntity && entityP) {
    const E = decodeURIComponent(entityP.entity);
    const O = decodeURIComponent(entityP.ol);
    crumbs.push({ href: entityPath(E), label: ENTITY_SLUGS[E]?.label ?? E }, { href: entityOlPath(E, O), label: O });
  } else if (fromOl && olP) {
    crumbs.push({ href: olPath(decodeURIComponent(olP.ol)), label: decodeURIComponent(olP.ol) });
  } else if (fromT50Ol && t50OlP) {
    const O = decodeURIComponent(t50OlP.ol);
    crumbs.push(
      { href: turning50Path(Number(t50OlP.year)), label: `Turning 50 in ${t50OlP.year}` },
      { href: turning50OlPath(Number(t50OlP.year), O), label: O },
    );
  } else if (fromT50 && t50P) {
    crumbs.push({ href: turning50Path(Number(t50P.year)), label: `Turning 50 in ${t50P.year}` });
  } else if (direct && lessee && ol) {
    crumbs.push({ href: lesseePath(lessee), label: lessee }, { href: lesseeOlPath(lessee, ol), label: ol });
  }
  crumbs.push({ label: mark });

  const build =
    (r?.build_date && String(r.build_date).slice(0, 10)) ||
    (r?.build_year != null ? String(r.build_year) : r?.built_year != null ? String(r.built_year) : null);
  const entity = r?.entity as string | undefined;
  const entStyle = entity ? ENTITY_STYLES[entity] : null;
  const abs = Array.isArray(r?.railcar_ab_items) ? r.railcar_ab_items : [];

  return (
    <>
      <PageHeader
        title={mark}
        subtitle={r ? [r.car_type, r.mechanical_designation].filter(Boolean).join(" · ") : undefined}
        actions={
          r ? (
            <Link href="/dv">
              <Button size="sm" variant="outline">
                <Calculator className="h-3.5 w-3.5 mr-1.5" />
                DV Calculator
              </Button>
            </Link>
          ) : null
        }
      />
      <div className="px-4 sm:px-8 py-5 max-w-5xl">
        <nav className="flex items-center gap-1.5 flex-wrap mb-5" aria-label="Breadcrumb">
          {crumbs.map((it, i) => (
            <span key={`${it.label}-${i}`} className="flex items-center gap-1.5">
              {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" />}
              {it.href && i < crumbs.length - 1 ? (
                <Link href={it.href} className="text-sm text-muted-foreground hover:text-primary">
                  {it.label}
                </Link>
              ) : (
                <span className="text-sm text-foreground font-medium">{it.label}</span>
              )}
            </span>
          ))}
        </nav>

        {isLoading ? (
          <Skeleton className="h-64 rounded-xl" />
        ) : error || !r ? (
          <p className="text-sm text-destructive">Car not found.</p>
        ) : (
          <div className="space-y-4">
            <section className="rounded-xl border border-card-border bg-card p-5 grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Field label="Entity">
                {entStyle ? (
                  <span className={cn("text-[10px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded border", entStyle.cls)}>
                    {entStyle.label}
                  </span>
                ) : (
                  dash(entity)
                )}
              </Field>
              <Field label="Car type / mech">{[r.car_type, r.mechanical_designation].filter(Boolean).join(" · ") || "—"}</Field>
              <Field label="Car status">{displayRailcarStatus(displayStatusInputFromRailcar(r))}</Field>
              <Field label="Rental status">
                <span className="inline-flex items-center gap-2">
                  {dash(r.fleet_status)}
                  <InactiveFleetBadge active={r.active} />
                </span>
              </Field>
            </section>

            <section className="rounded-xl border border-card-border bg-card p-5">
              <h2 className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold mb-4">Current lease</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <Field label="OL">{dash(ol)}</Field>
                <Field label="Lessee">{dash(lessee)}</Field>
                <Field label="Master lease">{displayLeaseNumber(lease?.lease_number) || "—"}</Field>
                <Field label="Agreement">{dash(lease?.agreement_number)}</Field>
                <Field label="Lessor">{dash(lease?.lessor)}</Field>
                <Field label="Lease type">
                  <LeaseTypeBadge carType={r.lease_type} mlaType={lease?.lease_type} />
                </Field>
                <Field label="Effective">{formatCalendarDate(rider?.effective_date)}</Field>
                <Field label="Expiration / termination">{formatCalendarDate(rider?.expiration_date || r.lease_end_date || r.lease_expiry)}</Field>
                <Field label="Rate">{rider?.monthly_rate_pct != null ? `${Number(rider.monthly_rate_pct)}%` : "—"}</Field>
                <Field label="Rent / car">{fmtUsd(rider?.monthly_rent_per_car ?? r.monthly_rent_per_car)}</Field>
                <Field label="Lessor's cost">{fmtUsd(rider?.lessors_cost)}</Field>
              </div>
            </section>

            <section className="rounded-xl border border-card-border bg-card p-5">
              <h2 className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold mb-4">Values & specs</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <Field label="Build date">{dash(build)}</Field>
                <Field label="NBV (book value)">{fmtUsd(r.nbv)}</Field>
                <Field label="OEC">{fmtUsd(r.oec)}</Field>
                <Field label="Railinc OEC">{fmtUsd(r.railinc_oec)}</Field>
                <Field label="Tare weight">{r.tare_weight_lbs != null ? `${fmtInt(r.tare_weight_lbs)} lb` : "—"}</Field>
              </div>
            </section>

            {abs.length > 0 && (
              <section className="rounded-xl border border-card-border bg-card p-5">
                <h2 className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold mb-3">Additions & Betterments</h2>
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="text-left py-1.5 font-medium">Code</th>
                      <th className="text-left py-1.5 font-medium">Date</th>
                      <th className="text-right py-1.5 font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {abs.map((it: any, i: number) => (
                      <tr key={i} className="border-t border-border/50">
                        <td className="py-2 font-mono">{it.code}</td>
                        <td className="py-2">{formatCalendarDate(it.application_date)}</td>
                        <td className="py-2 text-right font-mono">{fmtUsd(it.signed_amount ?? it.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            <section className="rounded-xl border border-card-border bg-card p-5">
              <h2 className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold mb-3">Program History</h2>
              {programHistory.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">This car has not been part of a program.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="text-left py-1.5 font-medium">Program</th>
                      <th className="text-left py-1.5 font-medium">Category</th>
                      <th className="text-left py-1.5 font-medium">Status</th>
                      <th className="text-left py-1.5 font-medium">Joined</th>
                      <th className="text-left py-1.5 font-medium">Exited</th>
                      <th className="text-right py-1.5 font-medium">BRC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {programHistory.map((row: any) => {
                      const cat = row.program?.category?.name ?? "";
                      const brc = row.repair_cost_total ?? row.custom_fields?.final_brc_total ?? row.custom_fields?.original_brc_total;
                      return (
                        <tr key={row.id} className="border-t border-border/50">
                          <td className="py-2">
                            {row.program?.id ? (
                              <button
                                type="button"
                                className="text-left hover:underline font-medium"
                                onClick={() => openAppTab(programPath(row.program.id))}
                              >
                                {row.program.name}
                              </button>
                            ) : "—"}
                          </td>
                          <td className="py-2">
                            {cat && (
                              <span className={cn("text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border", CATEGORY_BADGE[cat] ?? "bg-muted border-border")}>{cat}</span>
                            )}
                          </td>
                          <td className="py-2">{row.status || (row.exited_date ? "Exited" : STATUS_LABEL[(row.program?.status as ProgramStatus) ?? "open"])}</td>
                          <td className="py-2">{formatCalendarDate(row.joined_date)}</td>
                          <td className="py-2">{formatCalendarDate(row.exited_date) || "—"}</td>
                          <td className="py-2 text-right font-mono">{brc != null && brc !== "" ? fmtUsd(brc) : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        )}
      </div>
    </>
  );
}
