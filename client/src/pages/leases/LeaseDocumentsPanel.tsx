import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Download, ExternalLink } from "lucide-react";
import AttachmentsPanel from "@/components/AttachmentsPanel";
import {
  classLabel,
  distinctDocClasses,
  documentCountLabel,
  filterLeaseDocs,
  groupLeaseDocs,
  leaseDocumentsPath,
  type LeaseDoc,
} from "@/pages/leases/lease-documents";

export type { LeaseDoc };

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

async function openSigned(id: number, download: boolean, fileName: string) {
  const data = await apiGet<{ url: string; file_name: string }>(`/api/attachments/${id}/signed-url`);
  if (download) {
    const a = document.createElement("a");
    a.href = data.url;
    a.download = fileName;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } else {
    window.open(data.url, "_blank", "noopener,noreferrer");
  }
}

export default function LeaseDocumentsPanel(props: {
  kind: "rider" | "lessee";
  id: number;
  fallbackUrls?: { label: string; url: string }[];
  /** Fill a bounded parent: filters stay put, the list is the only scroll region. */
  fill?: boolean;
}) {
  const path = leaseDocumentsPath(props.kind, props.id);
  const { data, isLoading } = useQuery<{ rows: LeaseDoc[] }>({
    queryKey: [path],
    queryFn: () => apiGet(path),
    enabled: props.id > 0,
  });
  const [q, setQ] = useState("");
  const [ol, setOl] = useState("all");
  const [docClass, setDocClass] = useState("all");
  const rows = data?.rows ?? [];
  const classes = useMemo(() => distinctDocClasses(rows), [rows]);
  const ols = useMemo(() => {
    const codes = new Set<string>();
    for (const row of rows) {
      if (row.rider_code) codes.add(row.rider_code);
    }
    return Array.from(codes);
  }, [rows]);
  const filtered = useMemo(
    () => filterLeaseDocs(rows, { q, ol, docClass }),
    [rows, q, ol, docClass],
  );
  const groups = useMemo(() => groupLeaseDocs(filtered), [filtered]);

  const filters = (
    <div className="flex w-full min-w-0 flex-wrap items-center gap-2 [&>*]:max-w-full">
      <Input
        className="h-8 w-full min-w-[12rem] flex-1 sm:max-w-xs"
        placeholder="Filter name or path"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <select
        className="h-8 max-w-full rounded-md border bg-background px-2 text-sm"
        value={docClass}
        onChange={(e) => setDocClass(e.target.value)}
        aria-label="Document class"
      >
        <option value="all">All classes</option>
        {classes.map((c) => (
          <option key={c} value={c}>{classLabel(c)}</option>
        ))}
      </select>
      {props.kind === "lessee" ? (
        <select
          className="h-8 max-w-full rounded-md border bg-background px-2 text-sm"
          value={ol}
          onChange={(e) => setOl(e.target.value)}
          aria-label="Operating lease"
        >
          <option value="all">All OLs</option>
          {ols.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      ) : null}
      <span className="text-xs text-muted-foreground">
        {isLoading ? "Loading documents…" : `${filtered.length} file${filtered.length === 1 ? "" : "s"}`}
      </span>
    </div>
  );

  const list = (
    <>
      {!isLoading && !rows.length ? (
        <div className="text-xs text-muted-foreground space-y-1">
          <p>{documentCountLabel(0)}</p>
          {(props.fallbackUrls ?? []).map((d) => (
            <p key={d.url} className="font-mono break-all">{d.label}: {d.url}</p>
          ))}
        </div>
      ) : null}
      {!isLoading && rows.length > 0 && !filtered.length ? (
        <p className="text-xs text-muted-foreground">No documents match this filter.</p>
      ) : null}
      <div className="space-y-3">
        {groups.map((group) => (
          <div key={group.key} className="rounded-md border">
            <div className="sticky top-0 z-10 border-b bg-muted px-3 py-1.5 text-xs font-medium">
              {group.label} · {group.docs.length}
            </div>
            <ul>
              {group.docs.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-3 py-2 text-xs">
                  <div className="min-w-0 flex-1 basis-48">
                    <div className="break-words text-foreground">{r.file_name}</div>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-muted-foreground">
                      {props.kind === "lessee" ? <span className="font-mono">{r.rider_code ?? "—"}</span> : null}
                      <span>{r.sub_folder || "—"}</span>
                      <span className="font-mono-num">{r.source_modified ?? "—"}</span>
                      <span className="font-mono-num">{formatBytes(r.file_size)}</span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase">Z:</span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-md font-mono text-xs">{r.source_path || r.source}</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-1">
                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => void openSigned(r.id, false, r.file_name)}>
                      <ExternalLink className="h-3 w-3" /> View
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => void openSigned(r.id, true, r.file_name)}>
                      <Download className="h-3 w-3" /> Download
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <details className="rounded-md border px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium">Upload or remove a file</summary>
        <div className="pt-3">
          <AttachmentsPanel
            entityType={props.kind === "rider" ? "rider" : "master_lease"}
            entityId={props.id}
            compact
          />
        </div>
      </details>
    </>
  );

  if (props.fill) {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col gap-3">
        <div className="shrink-0">{filters}</div>
        <div className="min-h-0 flex-1 space-y-3 overflow-auto">{list}</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {filters}
      {list}
    </div>
  );
}
