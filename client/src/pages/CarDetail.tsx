import { Link, useRoute, useLocation } from "wouter";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import PageHeader from "@/components/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { formatCalendarDate } from "@shared/lease-authority";
import { fmtUsd } from "@/lib/dv/format";
import { useCanEdit } from "@/lib/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { ChevronRight, Calculator, ArrowLeft } from "lucide-react";
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
import { hasSearchSession, searchReturnPath } from "@/lib/search-query";
import { CarDetail, RailcarFormDialog } from "@/pages/FleetRegistry";

type DetailPayload = {
  railcar: any;
  history?: any[];
  number_history?: any[];
};

export default function CarDetailPage() {
  const [, navigate] = useLocation();
  const canEdit = useCanEdit();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editCar, setEditCar] = useState<any | null>(null);

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

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/railcars/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/railcars"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: "Railcar deleted" });
      navigate("/railcars");
    },
    onError: (e: Error) =>
      toast({ title: "Cannot delete", description: e.message, variant: "destructive" }),
  });

  const r = data?.railcar;
  const mark = r ? [r.reporting_marks, r.car_number].filter(Boolean).join(" ") : "Car";
  const ol =
    r?.rider_external_id ||
    (olP?.ol ? decodeURIComponent(olP.ol) : null) ||
    (lesseeP?.ol ? decodeURIComponent(lesseeP.ol) : null) ||
    (entityP?.ol ? decodeURIComponent(entityP.ol) : null);
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

  const searchBackPath = hasSearchSession() ? searchReturnPath() : null;
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
        {searchBackPath && (
          <div className="mb-3">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary"
              data-testid="link-back-to-search"
              onClick={() => {
                // Hash router: set the hash directly. A plain <a href="/search?restore=1">
                // (or "#/search?restore=1") gets re-split by the browser into
                // /?restore=1#/search, which drops restore from the SPA route.
                const path = searchBackPath.startsWith("/") ? searchBackPath : `/${searchBackPath}`;
                window.location.hash = path;
              }}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to search results
            </button>
          </div>
        )}
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

        {!Number.isFinite(id) || id <= 0 ? (
          <p className="text-sm text-destructive">Car not found.</p>
        ) : isLoading ? (
          <Skeleton className="h-64 rounded-xl" />
        ) : error ? (
          <p className="text-sm text-destructive">Car not found.</p>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-card-border bg-card p-5">
              <CarDetail
                carId={id}
                canEdit={canEdit}
                showCarPageLink={false}
                onEdit={(car) => setEditCar(car)}
                onDelete={() => deleteMutation.mutate()}
              />
            </div>

            {abs.length > 0 && (
              <section className="rounded-xl border border-card-border bg-card p-5">
                <h2 className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold mb-3">
                  Additions & Betterments
                </h2>
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
              <h2 className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold mb-3">
                Program History
              </h2>
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
                      const brc =
                        row.repair_cost_total ??
                        row.custom_fields?.final_brc_total ??
                        row.custom_fields?.original_brc_total;
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
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="py-2">
                            {cat && (
                              <span
                                className={cn(
                                  "text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border",
                                  CATEGORY_BADGE[cat] ?? "bg-muted border-border",
                                )}
                              >
                                {cat}
                              </span>
                            )}
                          </td>
                          <td className="py-2">
                            {row.status ||
                              (row.exited_date
                                ? "Exited"
                                : STATUS_LABEL[(row.program?.status as ProgramStatus) ?? "open"])}
                          </td>
                          <td className="py-2">{formatCalendarDate(row.joined_date)}</td>
                          <td className="py-2">{formatCalendarDate(row.exited_date) || "—"}</td>
                          <td className="py-2 text-right font-mono">
                            {brc != null && brc !== "" ? fmtUsd(brc) : "—"}
                          </td>
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

      <RailcarFormDialog open={!!editCar} onClose={() => setEditCar(null)} car={editCar} />
    </>
  );
}
