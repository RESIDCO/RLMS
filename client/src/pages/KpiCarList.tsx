import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useHashSearch } from "@/lib/hash-location";
import { olPath } from "@/lib/browse-nav";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import PageHeader from "@/components/PageHeader";
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
import { apiGet, apiRequest, downloadXlsx } from "@/lib/queryClient";
import { useCanEdit } from "@/lib/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { COMMITMENT_TYPES, type CommitmentType } from "@shared/commitment";
import { KPI_SORT_COLS, KPI_TITLES } from "@shared/kpi-buckets";
import { ArrowLeft, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { KpiCarSheet } from "@/pages/KpiCarSheet";

type Row = {
  railcar_id: number;
  car: string;
  entity: string | null;
  status_tag: string | null;
  derived_status: string | null;
  current_lease: string | null;
  lessee: string | null;
  legal_owner: string | null;
  buyer: string | null;
  commitment: string | null;
  rent_start_date: string | null;
  last_ol: string | null;
  reason: string | null;
};

function qsFrom(sp: URLSearchParams) {
  const q = sp.toString();
  return q ? `?${q}` : "";
}

export function KpiCarListPage() {
  const search = useHashSearch();
  const [, navigate] = useLocation();
  const canEdit = useCanEdit();
  const { toast } = useToast();
  const qc = useQueryClient();
  const sp = useMemo(() => new URLSearchParams(search.replace(/^\?/, "")), [search]);
  const bucket = sp.get("bucket") ?? "off_rent";
  const title = KPI_TITLES[bucket] ?? bucket;
  const q = sp.get("q") ?? "";
  const entity = sp.get("entity") ?? "";
  const lease = sp.get("lease") ?? "";
  const lessee = sp.get("lessee") ?? "";
  const reason = sp.get("reason") ?? "";
  const sort = sp.get("sort") ?? "car";
  const dir = sp.get("dir") ?? "asc";
  const group = sp.get("group") ?? "";
  const page = Math.max(1, Number(sp.get("page") ?? 1) || 1);
  const carId = Number(sp.get("car") || 0) || null;

  const setParams = (patch: Record<string, string | null>, resetPage = true) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === "") next.delete(k);
      else next.set(k, v);
    }
    if (resetPage) next.delete("page");
    navigate(`/kpi/cars${qsFrom(next)}`);
  };

  const listQs = useMemo(() => {
    const p = new URLSearchParams();
    p.set("bucket", bucket);
    if (q) p.set("q", q);
    if (entity) p.set("entity", entity);
    if (lease) p.set("lease", lease);
    if (lessee) p.set("lessee", lessee);
    if (reason) p.set("reason", reason);
    p.set("sort", sort);
    p.set("dir", dir);
    if (group) p.set("group", group);
    p.set("page", String(page));
    p.set("page_size", "200");
    return p.toString();
  }, [bucket, q, entity, lease, lessee, reason, sort, dir, group, page]);

  const { data, isLoading } = useQuery({
    queryKey: ["/api/kpi/cars", listQs],
    queryFn: () => apiGet<any>(`/api/kpi/cars?${listQs}`),
  });

  const rows: Row[] = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 200));
  const groups: { key: string; count: number }[] = data?.groups ?? [];

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<
    "commitment" | "clear_commitment" | "rent_start" | "sold" | "unsold" | "classify_external" | "classify_intercompany" | null
  >(null);
  const [preview, setPreview] = useState<any>(null);
  const [commitType, setCommitType] = useState<CommitmentType>("deal");
  const [commitName, setCommitName] = useState("");
  const [target, setTarget] = useState("");
  const [rentDate, setRentDate] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [qDraft, setQDraft] = useState(q);
  const sheetPushedRef = useRef(false);

  const listPathWithoutCar = useMemo(() => {
    const next = new URLSearchParams(sp);
    next.delete("car");
    return `/kpi/cars${qsFrom(next)}`;
  }, [sp]);

  useEffect(() => {
    setQDraft(q);
  }, [q]);

  useLayoutEffect(() => {
    if (carId) return;
    const y = sessionStorage.getItem(`rlms:kpi-scroll:${listPathWithoutCar}`);
    if (y) window.scrollTo(0, Number(y) || 0);
  }, [carId, listPathWithoutCar]);

  useEffect(() => {
    const persist = () => {
      sessionStorage.setItem(`rlms:kpi-scroll:${listPathWithoutCar}`, String(window.scrollY));
    };
    window.addEventListener("scroll", persist, { passive: true });
    return () => window.removeEventListener("scroll", persist);
  }, [listPathWithoutCar]);

  const selectedIds = async () => {
    if (selectAllMatching) {
      const r = await apiGet<{ ids: number[] }>(`/api/kpi/cars/ids?${listQs}`);
      return r.ids;
    }
    return Array.from(selected);
  };

  const runPreview = useMutation({
    mutationFn: async () => {
      const ids = await selectedIds();
      if (!ids.length) throw new Error("Select cars first");
      if (bulk === "sold") {
        return (await apiRequest("POST", "/api/railcars/sold/preview", { ids, bucket })).json();
      }
      if (bulk === "unsold") {
        return (await apiRequest("POST", "/api/railcars/unsold/preview", { ids, bucket })).json();
      }
      if (bulk === "rent_start") {
        return (await apiRequest("POST", "/api/rent-start/bulk/preview", {
          ids,
          date: rentDate || null,
          overwrite,
          bucket,
        })).json();
      }
      if (bulk === "classify_external" || bulk === "classify_intercompany") {
        return (await apiRequest("POST", "/api/sale-class/preview", {
          ids,
          class: bulk === "classify_external" ? "external" : "intercompany",
        })).json();
      }
      return (await apiRequest("POST", "/api/commitments/bulk/preview", {
          ids,
          action: bulk === "clear_commitment" ? "clear" : "set",
          type: commitType,
          name: commitName,
          target_date: target || null,
          overwrite,
          bucket,
      })).json();
    },
    onSuccess: setPreview,
    onError: (e: Error) => toast({ title: "Preview failed", description: e.message, variant: "destructive" }),
  });

  const apply = useMutation({
    mutationFn: async () => {
      const token = preview?.preview_token;
      if (!token) throw new Error("Preview first");
      if (bulk === "sold") return (await apiRequest("POST", "/api/railcars/sold/apply", { preview_token: token })).json();
      if (bulk === "unsold") return (await apiRequest("POST", "/api/railcars/unsold/apply", { preview_token: token })).json();
      if (bulk === "rent_start") return (await apiRequest("POST", "/api/rent-start/bulk/apply", { preview_token: token })).json();
      if (bulk === "classify_external" || bulk === "classify_intercompany") {
        return (await apiRequest("POST", "/api/sale-class/apply", { preview_token: token })).json();
      }
      return (await apiRequest("POST", "/api/commitments/bulk/apply", { preview_token: token })).json();
    },
    onSuccess: () => {
      toast({ title: "Applied" });
      setPreview(null);
      setSelected(new Set());
      setSelectAllMatching(false);
      qc.invalidateQueries({ queryKey: ["/api/kpi/cars"] });
      qc.invalidateQueries({ queryKey: ["/api/dashboard"] });
    },
    onError: (e: Error) => toast({ title: "Apply failed", description: e.message, variant: "destructive" }),
  });

  const toggleSort = (col: string) => {
    if (sort === col) setParams({ sort: col, dir: dir === "asc" ? "desc" : "asc" }, false);
    else setParams({ sort: col, dir: "asc" }, false);
  };

  const groupedRows = useMemo(() => {
    if (!group) return [{ key: "", count: rows.length, rows }];
    const map = new Map<string, Row[]>();
    for (const r of rows) {
      const key =
        group === "lease" ? r.current_lease ?? "—" :
        group === "lessee" ? r.lessee ?? "—" :
        group === "entity" ? r.entity ?? "—" :
        r.reason ?? "—";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    const counts = new Map(groups.map((g) => [g.key, g.count]));
    return Array.from(map.entries()).map(([key, rs]) => ({
      key,
      count: counts.get(key) ?? rs.length,
      rows: rs,
    }));
  }, [rows, group, groups]);

  const exportHref = (format: "csv" | "xlsx") => {
    const p = new URLSearchParams(listQs);
    p.set("format", format);
    return `/api/kpi/cars/export?${p.toString()}`;
  };

  const pageIds = rows.map((r) => r.railcar_id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  return (
    <div>
      <PageHeader
        title={title}
        subtitle={`${total.toLocaleString()} cars`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => downloadXlsx(exportHref("csv"), `RLMS_${bucket}.csv`)}>
              Export CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => downloadXlsx(exportHref("xlsx"), `RLMS_${bucket}.xlsx`)}>
              Export XLSX
            </Button>
          </div>
        }
      />
      <div className="px-6 pt-3 space-y-3">
        <nav className="text-sm text-muted-foreground flex items-center gap-2">
          <Link href="/" className="hover:text-primary">Dashboard</Link>
          <span>›</span>
          <span className="text-foreground">{title}</span>
        </nav>
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Dashboard
        </Link>
        <div className="flex flex-wrap gap-2 items-end">
          <div>
            <Label>Search</Label>
            <Input
              value={qDraft}
              onChange={(e) => setQDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setParams({ q: qDraft });
              }}
              className="w-48"
            />
          </div>
          <div>
            <Label>Entity</Label>
            <Input value={entity} onChange={(e) => setParams({ entity: e.target.value })} className="w-36" />
          </div>
          <div>
            <Label>Lease</Label>
            <Input value={lease} onChange={(e) => setParams({ lease: e.target.value })} className="w-36" />
          </div>
          <div>
            <Label>Lessee</Label>
            <Input value={lessee} onChange={(e) => setParams({ lessee: e.target.value })} className="w-40" />
          </div>
          <div>
            <Label>Reason</Label>
            <Input value={reason} onChange={(e) => setParams({ reason: e.target.value })} className="w-40" />
          </div>
          <div>
            <Label>Group by</Label>
            <Select value={group || "none"} onValueChange={(v) => setParams({ group: v === "none" ? "" : v })}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="lease">Lease</SelectItem>
                <SelectItem value="lessee">Lessee</SelectItem>
                <SelectItem value="entity">Entity</SelectItem>
                <SelectItem value="reason">Reason</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" onClick={() => setParams({ q: qDraft })}>Apply filters</Button>
        </div>

        {canEdit && bucket !== "leased_off_rent" && (
          <div className="flex flex-wrap gap-2 items-end border border-border rounded-md p-3">
            <div className="text-sm">{selectAllMatching ? `All ${total} matching` : `${selected.size} selected`}</div>
            <Button size="sm" variant="outline" onClick={() => setSelectAllMatching(true)}>Select all {total} matching</Button>
            <Select value={bulk ?? "none"} onValueChange={(v) => { setBulk(v === "none" ? null : (v as any)); setPreview(null); }}>
              <SelectTrigger className="w-48"><SelectValue placeholder="Bulk action" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Bulk action</SelectItem>
                <SelectItem value="commitment">Set Commitment</SelectItem>
                <SelectItem value="clear_commitment">Clear Commitment</SelectItem>
                <SelectItem value="rent_start">Set Rent Start</SelectItem>
                <SelectItem value="sold">Mark Sold</SelectItem>
                <SelectItem value="unsold">Remove Sold tag</SelectItem>
                <SelectItem value="classify_external">Classify External</SelectItem>
                <SelectItem value="classify_intercompany">Classify Intercompany</SelectItem>
              </SelectContent>
            </Select>
            {bulk === "commitment" && (
              <>
                <Select value={commitType} onValueChange={(v) => setCommitType(v as CommitmentType)}>
                  <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {COMMITMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input placeholder="Name" value={commitName} onChange={(e) => setCommitName(e.target.value)} className="w-36" />
                <Input type="date" value={target} onChange={(e) => setTarget(e.target.value)} />
              </>
            )}
            {bulk === "rent_start" && (
              <>
                <Input type="date" value={rentDate} onChange={(e) => setRentDate(e.target.value)} />
                <label className="text-xs flex items-center gap-1">
                  <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
                  Overwrite
                </label>
              </>
            )}
            <Button size="sm" disabled={!bulk} onClick={() => runPreview.mutate()}>Preview</Button>
            <Button size="sm" variant="secondary" disabled={!preview?.preview_token} onClick={() => apply.mutate()}>
              Apply preview
            </Button>
          </div>
        )}

        {preview && (
          <div className="text-sm rounded-md border border-border p-3 space-y-1">
            <div>
              Preview rows: {(preview.cars ?? preview.to_write ?? preview.matched ?? preview.ids ?? []).length}
              {" · "}rejected inactive: {(preview.rejected_inactive ?? []).length}
            </div>
            {(preview.rejected_inactive ?? []).length > 0 && (
              <div className="text-destructive">Inactive (no writes): {preview.rejected_inactive.length}</div>
            )}
            {(preview.summary ?? []).map((m: string) => (
              <div key={m} className="font-medium">{m}</div>
            ))}
            {(preview.kpi_delta ?? []).slice(0, 8).map((d: any) => (
              <div key={d.railcar_id}>
                {d.car}: {d.before_title} → {d.after_title}
                {d.leaves_current ? " (leaves this list)" : ""}
              </div>
            ))}
            {(preview.kpi_delta ?? []).length > 8 ? (
              <div className="text-muted-foreground">+{preview.kpi_delta.length - 8} more</div>
            ) : null}
          </div>
        )}

        {bucket === "leased_off_rent" && (
          <div className="text-sm rounded-md border border-border p-3">
            Retag preview (tagged Leased, off rent). Apply only after sign-off — this page does not write tags.
          </div>
        )}
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground text-xs">
                  <th className="w-8">
                    <Checkbox
                      checked={allPageSelected}
                      onCheckedChange={(v) => {
                        const next = new Set(selected);
                        if (v) pageIds.forEach((id) => next.add(id));
                        else pageIds.forEach((id) => next.delete(id));
                        setSelected(next);
                        setSelectAllMatching(false);
                      }}
                    />
                  </th>
                  {KPI_SORT_COLS.map((col) => (
                    <th key={col}>
                      <button type="button" className="hover:underline" onClick={() => toggleSort(col)}>
                        {col}{sort === col ? (dir === "asc" ? " ↑" : " ↓") : ""}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groupedRows.map((g) => {
                  const hide = Boolean(group) && collapsed.has(g.key);
                  return (
                    <Fragment key={g.key || "all"}>
                      {group ? (
                        <tr key={`g-${g.key}`} className="bg-muted/40">
                          <td colSpan={13} className="py-1.5">
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 font-medium"
                              onClick={() => {
                                const next = new Set(collapsed);
                                if (next.has(g.key)) next.delete(g.key);
                                else next.add(g.key);
                                setCollapsed(next);
                              }}
                            >
                              {hide ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                              {g.key} ({g.count})
                            </button>
                          </td>
                        </tr>
                      ) : null}
                      {!hide &&
                        g.rows.map((r) => (
                          <tr key={r.railcar_id} className="border-t border-border/40">
                            <td>
                              <Checkbox
                                checked={selectAllMatching || selected.has(r.railcar_id)}
                                onCheckedChange={(v) => {
                                  const next = new Set(selected);
                                  if (v) next.add(r.railcar_id);
                                  else next.delete(r.railcar_id);
                                  setSelected(next);
                                  setSelectAllMatching(false);
                                }}
                              />
                            </td>
                            <td className="py-1.5 font-mono">
                              <button
                                type="button"
                                className="underline"
                                onClick={() => {
                                  sessionStorage.setItem(`rlms:kpi-scroll:${listPathWithoutCar}`, String(window.scrollY));
                                  sheetPushedRef.current = true;
                                  setParams({ car: String(r.railcar_id) }, false);
                                }}
                              >
                                {r.car}
                              </button>
                            </td>
                            <td>{r.entity ?? "—"}</td>
                            <td>{r.status_tag ?? "—"}</td>
                            <td>{r.derived_status ?? "—"}</td>
                            <td>
                              {r.current_lease ? (
                                <span className="inline-flex items-center gap-1">
                                  <button
                                    type="button"
                                    className="underline"
                                    onClick={() => setParams({ lease: r.current_lease })}
                                  >
                                    {r.current_lease}
                                  </button>
                                  <Link
                                    href={olPath(r.current_lease)}
                                    title="Open in Browse"
                                    className="text-muted-foreground hover:text-primary"
                                  >
                                    <ExternalLink className="h-3.5 w-3.5" />
                                  </Link>
                                </span>
                              ) : "—"}
                            </td>
                            <td>{r.lessee ?? "—"}</td>
                            <td>{r.legal_owner ?? "—"}</td>
                            <td>{r.buyer ?? "—"}</td>
                            <td>{r.commitment ?? "—"}</td>
                            <td>{r.rent_start_date ?? "—"}</td>
                            <td>{r.last_ol ?? "—"}</td>
                            <td>{r.reason ?? "—"}</td>
                          </tr>
                        ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center gap-3 pb-8 text-sm">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setParams({ page: String(page - 1) }, false)}>
            Prev
          </Button>
          <span>Page {page} of {pages}</span>
          <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setParams({ page: String(page + 1) }, false)}>
            Next
          </Button>
        </div>
      </div>
      <KpiCarSheet
        carId={carId}
        bucket={bucket}
        fromPath={listPathWithoutCar}
        onClose={() => {
          if (!carId) return;
          if (sheetPushedRef.current) {
            sheetPushedRef.current = false;
            window.history.back();
            return;
          }
          const next = new URLSearchParams(sp);
          next.delete("car");
          navigate(`/kpi/cars${qsFrom(next)}`, { replace: true });
        }}
      />
    </div>
  );
}
