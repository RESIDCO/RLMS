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
import { invalidateFleetQueries } from "@/lib/fleetQueryRefresh";
import { useCanEdit } from "@/lib/AuthContext";
import { AddNoteField, appendNoteBody } from "@/components/AddNoteField";
import { useToast } from "@/hooks/use-toast";
import { COMMITMENT_TYPES, type CommitmentType } from "@shared/commitment";
import { KPI_COL_LAYOUT, KPI_SORT_COLS, KPI_TITLES } from "@shared/kpi-buckets";
import { useColumnPrefs } from "@/hooks/use-column-prefs";
import { ColumnPicker } from "@/components/ColumnPicker";
import { mergeColOrder } from "@/lib/grid-columns";
import { colsQuery } from "@shared/column-views";
import { columnLabel } from "@shared/column-dictionary";
import { ColumnHelp, KpiReasonHelp } from "@/components/ColumnHelp";
import { formatCarId } from "@shared/residco-import";
import { CopyCarsButton } from "@/components/CopyCarsButton";
import { collectPages } from "@/lib/copy-cars";
import { FormerlyBadge } from "@/components/FormerlyBadge";
import { LineageCarLink } from "@/components/LineageCarLink";
import { overlayLifecycle } from "@shared/programs";
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
  formerly?: string | null;
};

function qsFrom(sp: URLSearchParams) {
  const q = sp.toString();
  return q ? `?${q}` : "";
}

function kpiThClass(col: (typeof KPI_SORT_COLS)[number]) {
  const sticky =
    col === "car"
      ? "sticky left-8 z-20 bg-background border-r border-border"
      : "";
  return `py-1.5 pr-3 ${sticky}`;
}

function kpiTdClass(col: (typeof KPI_SORT_COLS)[number], selected = false) {
  const layout = KPI_COL_LAYOUT[col];
  const fill = selected
    ? "bg-muted/40 group-hover/kpirow:bg-muted/40"
    : "bg-background group-hover/kpirow:bg-muted/20";
  const sticky =
    col === "car"
      ? `sticky left-8 z-10 ${fill} border-r border-border`
      : "";
  const wrap = col === "car" ? "whitespace-nowrap font-mono" : layout.truncate ? "max-w-[12rem] truncate" : "";
  return `py-1.5 pr-3 ${sticky} ${wrap}`.trim();
}

function kpiCheckClass(selected = false) {
  const fill = selected
    ? "bg-muted/40 group-hover/kpirow:bg-muted/40"
    : "bg-background group-hover/kpirow:bg-muted/20";
  return `sticky left-0 z-10 ${fill}`;
}

const KPI_DEFAULT_COLS = new Set<string>(KPI_SORT_COLS);
const KPI_PICKER_COLS = KPI_SORT_COLS.map((key) => ({
  key,
  label: columnLabel("kpi_cars", key),
  pinned: key === "car",
}));

function KpiCell({
  col,
  r,
  rowSelected,
  listPathWithoutCar,
  sheetPushedRef,
  setParams,
}: {
  col: (typeof KPI_SORT_COLS)[number];
  r: Row;
  rowSelected: boolean;
  listPathWithoutCar: string;
  sheetPushedRef: { current: boolean };
  setParams: (patch: Record<string, string | null>, resetPage?: boolean) => void;
}) {
  const style = { minWidth: KPI_COL_LAYOUT[col].minWidth };
  if (col === "car") {
    return (
      <td className={kpiTdClass("car", rowSelected)} style={style}>
        <button
          type="button"
          className="underline whitespace-nowrap"
          onClick={() => {
            sessionStorage.setItem(`rlms:kpi-scroll:${listPathWithoutCar}`, String(window.scrollY));
            sheetPushedRef.current = true;
            setParams({ car: String(r.railcar_id) }, false);
          }}
        >
          {formatCarId(r)}
        </button>
        <LineageCarLink id={r.railcar_id} query={formatCarId(r)} />
        <FormerlyBadge formerly={r.formerly} />
      </td>
    );
  }
  if (col === "current_lease") {
    return (
      <td className={kpiTdClass("current_lease")} style={style} title={r.current_lease ?? undefined}>
        {r.current_lease ? (
          <span className="inline-flex items-center gap-1 max-w-full">
            <button
              type="button"
              className="underline truncate"
              title={r.current_lease}
              onClick={() => setParams({ lease: r.current_lease })}
            >
              {r.current_lease}
            </button>
            <Link href={olPath(r.current_lease)} title="Open in Browse" className="text-muted-foreground hover:text-primary shrink-0">
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </span>
        ) : "—"}
      </td>
    );
  }
  const value =
    col === "entity" ? r.entity :
    col === "status_tag" ? r.status_tag :
    col === "derived_status" ? r.derived_status :
    col === "lessee" ? r.lessee :
    col === "legal_owner" ? r.legal_owner :
    col === "buyer" ? r.buyer :
    col === "commitment" ? r.commitment :
    col === "rent_start_date" ? r.rent_start_date :
    col === "last_ol" ? r.last_ol :
    r.reason;
  return (
    <td className={kpiTdClass(col)} style={style} title={col === "reason" ? undefined : (value ?? undefined)}>
      {col === "reason" ? <KpiReasonHelp value={value} /> : (value ?? "—")}
    </td>
  );
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
    "commitment" | "clear_commitment" | "rent_start" | "sold" | "unsold" | "classify_external" | "classify_intercompany" | "add_program" | null
  >(null);
  const [programId, setProgramId] = useState("");
  const { data: programOpts = [] } = useQuery<{ id: number; name: string; progress?: { lifecycle?: string }; lifecycle?: string; closed_date?: string | null }[]>({
    queryKey: ["/api/programs"],
    queryFn: () => apiRequest("GET", "/api/programs").then((r) => r.json()),
    enabled: bulk === "add_program",
  });
  const activeProgramOpts = useMemo(
    () =>
      programOpts.filter(
        (p) => (p.progress?.lifecycle ?? overlayLifecycle(p)) === "active",
      ),
    [programOpts],
  );
  const [preview, setPreview] = useState<any>(null);
  const [addNote, setAddNote] = useState("");
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
      if (bulk === "add_program") {
        if (!programId) throw new Error("Pick a program");
        return (await apiRequest("POST", `/api/programs/${programId}/cars/preview`, { railcar_ids: ids })).json();
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
      const note = bulk === "sold" || bulk === "unsold" || bulk === "rent_start" ? appendNoteBody(addNote) : {};
      if (bulk === "sold") return (await apiRequest("POST", "/api/railcars/sold/apply", { preview_token: token, ...note })).json();
      if (bulk === "unsold") return (await apiRequest("POST", "/api/railcars/unsold/apply", { preview_token: token, ...note })).json();
      if (bulk === "rent_start") return (await apiRequest("POST", "/api/rent-start/bulk/apply", { preview_token: token, ...note })).json();
      if (bulk === "add_program") {
        return (await apiRequest("POST", `/api/programs/${programId}/cars/apply`, { preview_token: token })).json();
      }
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
      void invalidateFleetQueries(qc);
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

  const colPrefs = useColumnPrefs("kpi_cars", KPI_DEFAULT_COLS);
  const kpiCols = useMemo(() => {
    const movable = KPI_SORT_COLS.filter((c) => c !== "car");
    const ordered = mergeColOrder([...movable], colPrefs.colOrder).filter((c) => colPrefs.visibleCols.has(c));
    return ["car" as const, ...(ordered as typeof movable)];
  }, [colPrefs.visibleCols, colPrefs.colOrder]);

  const exportHref = (format: "csv" | "xlsx") => {
    const p = new URLSearchParams(listQs);
    p.set("format", format);
    p.set("cols", colsQuery(kpiCols));
    return `/api/kpi/cars/export?${p.toString()}`;
  };

  async function loadAllKpiRows() {
    const pageSize = 500;
    return collectPages(async (pageNumber, size) => {
      const params = new URLSearchParams(listQs);
      params.set("page", String(pageNumber));
      params.set("page_size", String(size));
      const body = await apiGet<{ rows?: Row[]; total?: number }>(`/api/kpi/cars?${params.toString()}`);
      return { rows: body.rows ?? [], total: Number(body.total ?? 0) };
    }, pageSize);
  }

  const pageIds = rows.map((r) => r.railcar_id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  return (
    <div>
      <PageHeader
        title={title}
        subtitle={`${total.toLocaleString()} cars`}
        actions={
          <div className="flex flex-wrap gap-2">
            <CopyCarsButton
              rows={rows}
              selectedIds={selectAllMatching ? null : selected}
              idOf={(row) => row.railcar_id}
              lineOf={(row) => row.car}
              totalCount={total}
              loadAll={loadAllKpiRows}
              disabled={isLoading || total === 0}
            />
            <Button variant="outline" size="sm" onClick={() => downloadXlsx(exportHref("csv"), `RLMS_${bucket}.csv`)}>
              Export CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => downloadXlsx(exportHref("xlsx"), `RLMS_${bucket}.xlsx`)}>
              Export XLSX
            </Button>
            <ColumnPicker columns={KPI_PICKER_COLS} prefs={colPrefs} />
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
            <Label>Why in KPI</Label>
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
                <SelectItem value="reason">Why in KPI</SelectItem>
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
                <SelectItem value="add_program">Add to program…</SelectItem>
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
            {bulk === "add_program" && (
              <Select value={programId || "none"} onValueChange={(v) => setProgramId(v === "none" ? "" : v)}>
                <SelectTrigger className="w-56"><SelectValue placeholder="Program" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Pick program</SelectItem>
                  {activeProgramOpts.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            {(bulk === "sold" || bulk === "unsold" || bulk === "rent_start") && (
              <div className="min-w-[220px]">
                <AddNoteField id="kpi-list-note" value={addNote} onChange={setAddNote} />
              </div>
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
                {formatCarId(d)}: {d.before_title} → {d.after_title}
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
            <table className="w-full text-sm border-separate border-spacing-0">
              <thead>
                <tr className="text-left text-muted-foreground text-xs">
                  <th className="w-8 min-w-8 sticky left-0 z-20 bg-background">
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
                  {kpiCols.map((col) => (
                    <th key={col} className={kpiThClass(col)} style={{ minWidth: KPI_COL_LAYOUT[col].minWidth }}>
                      <span className="inline-flex items-center gap-1">
                        <button type="button" className="hover:underline" onClick={() => toggleSort(col)}>
                          {columnLabel("kpi_cars", col)}{sort === col ? (dir === "asc" ? " ↑" : " ↓") : ""}
                        </button>
                        {col === "car" ? (
                          <CopyCarsButton
                            appearance="header"
                            rows={rows}
                            selectedIds={selectAllMatching ? null : selected}
                            idOf={(row) => row.railcar_id}
                            lineOf={(row) => row.car}
                            totalCount={total}
                            loadAll={loadAllKpiRows}
                            disabled={isLoading || total === 0}
                          />
                        ) : null}
                        <ColumnHelp listKey="kpi_cars" colKey={col} />
                      </span>
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
                          <td colSpan={1 + kpiCols.length} className="py-1.5">
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
                        g.rows.map((r) => {
                          const rowSelected = selectAllMatching || selected.has(r.railcar_id);
                          return (
                          <tr
                            key={r.railcar_id}
                            className={`group/kpirow border-t border-border/40 ${rowSelected ? "bg-muted/40" : "hover:bg-muted/20"}`}
                          >
                            <td className={kpiCheckClass(rowSelected)}>
                              <Checkbox
                                checked={rowSelected}
                                onCheckedChange={(v) => {
                                  const next = new Set(selected);
                                  if (v) next.add(r.railcar_id);
                                  else next.delete(r.railcar_id);
                                  setSelected(next);
                                  setSelectAllMatching(false);
                                }}
                              />
                            </td>
                            {kpiCols.map((col) => (
                              <KpiCell
                                key={col}
                                col={col}
                                r={r}
                                rowSelected={rowSelected}
                                listPathWithoutCar={listPathWithoutCar}
                                sheetPushedRef={sheetPushedRef}
                                setParams={setParams}
                              />
                            ))}
                          </tr>
                          );
                        })}
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
