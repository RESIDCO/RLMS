import { Link, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import PageHeader from "@/components/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { formatCalendarDate } from "@shared/lease-authority";
import { displayRailcarStatus, displayStatusInputFromRailcar } from "@shared/fleet-status";
import { displayLeaseNumber } from "@shared/residco-import";
import { ChevronRight } from "lucide-react";
import {
  ENTITY_SLUGS,
  entityOlCarPath,
  entityOlPath,
  entityPath,
  lesseeOlCarPath,
  lesseeOlPath,
  lesseePath,
  olCarPath,
  turning50CarPath,
  openAppTab,
  programPath,
} from "@/lib/browse-nav";
import { CATEGORY_BADGE, STATUS_LABEL, type ProgramStatus } from "@shared/programs";

type RiderRow = {
  ol: string;
  rider_id: number | null;
  rider_name: string;
  lease_type: string | null;
  effective_date: string | null;
  expiration_date: string | null;
  lease_number: string | null;
  car_count: number;
};

type CarRow = {
  id: number;
  car_number: string;
  reporting_marks: string | null;
  car_type: string | null;
  status: string | null;
  entity: string | null;
  active?: boolean | null;
  fleet_status?: string | null;
  lessee_name?: string | null;
  rider_external_id?: string | null;
};

type GroupPayload = {
  kind: "lessee" | "entity";
  key: string;
  entity_slug: string | null;
  car_count: number;
  riders: RiderRow[];
};

type OlPayload = RiderRow & { cars: CarRow[] };
type TurningPayload = { year: number; build_year: number; car_count: number; cars: CarRow[] };

const ENTITY_STYLES: Record<string, { label: string; cls: string }> = {
  "Rail Partners Select": { label: "RPS", cls: "bg-umler-steel/15 text-umler-steel border-umler-steel/30" },
  Main: { label: "MAIN", cls: "bg-umler-teal/15 text-umler-teal border-umler-teal/30" },
  Coal: { label: "COAL", cls: "bg-umler-faint/15 text-umler-faint border-umler-faint/30" },
};

function EntityBadge({ entity }: { entity: string | null | undefined }) {
  if (!entity) return null;
  const s = ENTITY_STYLES[entity] ?? { label: entity.slice(0, 4).toUpperCase(), cls: "bg-muted text-muted-foreground border-border" };
  return (
    <span className={cn("text-[9px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded border", s.cls)}>
      {s.label}
    </span>
  );
}

function Crumb({ href, children, current }: { href?: string; children: React.ReactNode; current?: boolean }) {
  if (!href || current) {
    return <span className={cn("text-sm", current ? "text-foreground font-medium" : "text-muted-foreground")}>{children}</span>;
  }
  return (
    <Link href={href} className="text-sm text-muted-foreground hover:text-primary">
      {children}
    </Link>
  );
}

function Breadcrumb({ items }: { items: { href?: string; label: string }[] }) {
  return (
    <nav className="flex items-center gap-1.5 flex-wrap mb-4" aria-label="Breadcrumb">
      {items.map((it, i) => (
        <span key={`${it.label}-${i}`} className="flex items-center gap-1.5">
          {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" />}
          <Crumb href={it.href} current={i === items.length - 1}>
            {it.label}
          </Crumb>
        </span>
      ))}
    </nav>
  );
}

function CarTable({
  cars,
  hrefFor,
}: {
  cars: CarRow[];
  hrefFor: (c: CarRow) => string;
}) {
  return (
    <div className="rounded-xl border border-card-border bg-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium">Marks</th>
              <th className="px-4 py-2.5 text-left font-medium">Car #</th>
              <th className="px-4 py-2.5 text-left font-medium">Entity</th>
              <th className="px-4 py-2.5 text-left font-medium">Status</th>
              <th className="px-4 py-2.5 text-left font-medium hidden sm:table-cell">Type</th>
            </tr>
          </thead>
          <tbody>
            {cars.map((c) => (
              <tr key={c.id} className="border-t border-border/50 hover:bg-muted/30">
                <td className="px-4 py-2.5 font-mono text-muted-foreground">{c.reporting_marks ?? "—"}</td>
                <td className="px-4 py-2.5 font-mono font-semibold">
                  <Link href={hrefFor(c)} className="hover:text-primary">
                    {c.car_number}
                  </Link>
                </td>
                <td className="px-4 py-2.5">
                  <EntityBadge entity={c.entity} />
                </td>
                <td className="px-4 py-2.5">
                  {displayRailcarStatus(displayStatusInputFromRailcar(c as any))}
                </td>
                <td className="px-4 py-2.5 text-muted-foreground hidden sm:table-cell">{c.car_type ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GroupView({ kind, keyName }: { kind: "lessee" | "entity"; keyName: string }) {
  const { data, isLoading, error } = useQuery<GroupPayload>({
    queryKey: ["/api/browse/group", kind, keyName],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/browse/group?kind=${encodeURIComponent(kind)}&key=${encodeURIComponent(keyName)}`,
      );
      return res.json();
    },
  });
  const title = kind === "entity" ? (ENTITY_SLUGS[keyName.toLowerCase()]?.label ?? data?.key ?? keyName) : keyName;
  const olHref = (ol: string) =>
    kind === "entity" ? entityOlPath(keyName, ol) : lesseeOlPath(keyName, ol);

  return (
    <>
      <PageHeader title={title} subtitle={`${(data?.car_count ?? 0).toLocaleString()} cars · ${(data?.riders.length ?? 0).toLocaleString()} OLs`} />
      <div className="px-4 sm:px-8 py-5">
        <Breadcrumb items={[{ href: "/", label: "Dashboard" }, { label: title }]} />
        {isLoading ? (
          <Skeleton className="h-48 rounded-xl" />
        ) : error ? (
          <p className="text-sm text-destructive">{String((error as Error).message)}</p>
        ) : !data?.riders.length ? (
          <p className="text-sm text-muted-foreground">No OLs in this group.</p>
        ) : (
          <div className="rounded-xl border border-card-border bg-card overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">OL / Rider</th>
                  <th className="px-4 py-2.5 text-left font-medium">Lease type</th>
                  <th className="px-4 py-2.5 text-left font-medium">Effective</th>
                  <th className="px-4 py-2.5 text-left font-medium">Expires</th>
                  <th className="px-4 py-2.5 text-right font-medium">Cars</th>
                </tr>
              </thead>
              <tbody>
                {data.riders.map((r) => (
                  <tr key={r.ol} className="border-t border-border/50 hover:bg-muted/30">
                    <td className="px-4 py-2.5">
                      <Link href={olHref(r.ol)} className="font-medium hover:text-primary">
                        {r.ol}
                      </Link>
                      {r.rider_name && r.rider_name !== r.ol && (
                        <div className="text-[11px] text-muted-foreground mt-0.5">{r.rider_name}</div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 capitalize text-muted-foreground">{r.lease_type ?? "—"}</td>
                    <td className="px-4 py-2.5 font-mono-num">{formatCalendarDate(r.effective_date)}</td>
                    <td className="px-4 py-2.5 font-mono-num">{formatCalendarDate(r.expiration_date)}</td>
                    <td className="px-4 py-2.5 text-right font-mono-num">{r.car_count.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function OlView({
  ol,
  parent,
}: {
  ol: string;
  parent?: { kind: "lessee"; lessee: string } | { kind: "entity"; entity: string };
}) {
  const { data, isLoading, error } = useQuery<OlPayload>({
    queryKey: ["/api/browse/ol", ol, parent],
    queryFn: async () => {
      const qs = new URLSearchParams({ code: ol });
      if (parent?.kind === "lessee") qs.set("lessee", parent.lessee);
      if (parent?.kind === "entity") qs.set("entity", parent.entity);
      const res = await apiRequest("GET", `/api/browse/ol?${qs.toString()}`);
      return res.json();
    },
  });
  const { data: olPrograms = [] } = useQuery<any[]>({
    queryKey: ["/api/programs/history", ol],
    queryFn: () => apiRequest("GET", `/api/programs/history?ol=${encodeURIComponent(ol)}`).then((r) => r.json()),
  });
  const carHref = (c: CarRow) => {
    if (parent?.kind === "lessee") return lesseeOlCarPath(parent.lessee, ol, c.id);
    if (parent?.kind === "entity") return entityOlCarPath(parent.entity, ol, c.id);
    return olCarPath(ol, c.id);
  };
  const crumbs = [
    { href: "/", label: "Dashboard" },
    ...(parent?.kind === "lessee"
      ? [{ href: lesseePath(parent.lessee), label: parent.lessee }]
      : parent?.kind === "entity"
        ? [{ href: entityPath(parent.entity), label: ENTITY_SLUGS[parent.entity]?.label ?? parent.entity }]
        : []),
    { label: data?.ol ?? ol },
  ];

  return (
    <>
      <PageHeader
        title={data?.ol ?? ol}
        subtitle={`${(data?.car_count ?? 0).toLocaleString()} cars${data?.lease_type ? ` · ${data.lease_type}` : ""}`}
      />
      <div className="px-4 sm:px-8 py-5">
        <Breadcrumb items={crumbs} />
        {data && (
          <div className="mb-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <Meta label="Lease type" value={data.lease_type} />
            <Meta label="Effective" value={formatCalendarDate(data.effective_date)} />
            <Meta label="Expires" value={formatCalendarDate(data.expiration_date)} />
            <Meta label="MLA" value={displayLeaseNumber(data.lease_number) || "—"} />
          </div>
        )}
        {isLoading ? (
          <Skeleton className="h-48 rounded-xl" />
        ) : error ? (
          <p className="text-sm text-destructive">{String((error as Error).message)}</p>
        ) : (
          <CarTable cars={data?.cars ?? []} hrefFor={carHref} />
        )}
        <section className="mt-6 rounded-xl border border-card-border bg-card p-5">
          <h2 className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold mb-3">Program History</h2>
          {olPrograms.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No programs recorded for this OL.</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="text-left py-1.5 font-medium">Program</th>
                  <th className="text-left py-1.5 font-medium">Category</th>
                  <th className="text-left py-1.5 font-medium">Status</th>
                  <th className="text-right py-1.5 font-medium">Cars from this OL</th>
                </tr>
              </thead>
              <tbody>
                {olPrograms.map((row: any) => {
                  const cat = row.program?.category?.name ?? "";
                  return (
                    <tr key={row.program?.id} className="border-t border-border/50">
                      <td className="py-2">
                        <button
                          type="button"
                          className="text-left hover:underline font-medium"
                          onClick={() => openAppTab(programPath(row.program.id))}
                        >
                          {row.program?.name}
                        </button>
                      </td>
                      <td className="py-2">
                        {cat && (
                          <span className={cn("text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border", CATEGORY_BADGE[cat] ?? "bg-muted border-border")}>{cat}</span>
                        )}
                      </td>
                      <td className="py-2">{STATUS_LABEL[(row.program?.status as ProgramStatus) ?? "open"]}</td>
                      <td className="py-2 text-right font-mono">{row.car_count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </>
  );
}

function TurningView({ year }: { year: number }) {
  const { data, isLoading, error } = useQuery<TurningPayload>({
    queryKey: ["/api/browse/turning50", year],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/browse/turning50?year=${year}`);
      return res.json();
    },
  });
  return (
    <>
      <PageHeader
        title={`Turning 50 in ${year}`}
        subtitle={`${(data?.car_count ?? 0).toLocaleString()} active cars · build year ${year - 50}`}
      />
      <div className="px-4 sm:px-8 py-5">
        <Breadcrumb items={[{ href: "/", label: "Dashboard" }, { label: `Turning 50 in ${year}` }]} />
        {isLoading ? (
          <Skeleton className="h-48 rounded-xl" />
        ) : error ? (
          <p className="text-sm text-destructive">{String((error as Error).message)}</p>
        ) : (
          <CarTable cars={data?.cars ?? []} hrefFor={(c) => turning50CarPath(year, c.id)} />
        )}
      </div>
    </>
  );
}

function Meta({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">{label}</div>
      <div className="font-medium capitalize">{value || "—"}</div>
    </div>
  );
}

export default function FleetBrowsePage() {
  const [lesseeOl, lesseeOlParams] = useRoute("/browse/lessee/:lessee/ol/:ol");
  const [lesseeOnly, lesseeParams] = useRoute("/browse/lessee/:lessee");
  const [entityOl, entityOlParams] = useRoute("/browse/entity/:entity/ol/:ol");
  const [entityOnly, entityParams] = useRoute("/browse/entity/:entity");
  const [olOnly, olParams] = useRoute("/browse/ol/:ol");
  const [t50, t50Params] = useRoute("/browse/turning50/:year");

  if (lesseeOl && lesseeOlParams) {
    return <OlView ol={decodeURIComponent(lesseeOlParams.ol)} parent={{ kind: "lessee", lessee: decodeURIComponent(lesseeOlParams.lessee) }} />;
  }
  if (entityOl && entityOlParams) {
    return <OlView ol={decodeURIComponent(entityOlParams.ol)} parent={{ kind: "entity", entity: decodeURIComponent(entityOlParams.entity) }} />;
  }
  if (lesseeOnly && lesseeParams) {
    return <GroupView kind="lessee" keyName={decodeURIComponent(lesseeParams.lessee)} />;
  }
  if (entityOnly && entityParams) {
    return <GroupView kind="entity" keyName={decodeURIComponent(entityParams.entity)} />;
  }
  if (olOnly && olParams) {
    return <OlView ol={decodeURIComponent(olParams.ol)} />;
  }
  if (t50 && t50Params) {
    return <TurningView year={Number(t50Params.year)} />;
  }
  return (
    <div className="p-8 text-sm text-muted-foreground">Nothing to show.</div>
  );
}
