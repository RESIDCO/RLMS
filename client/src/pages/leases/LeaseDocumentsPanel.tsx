import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Download, ExternalLink } from "lucide-react";
import AttachmentsPanel from "@/components/AttachmentsPanel";

export type LeaseDoc = {
  id: number;
  file_name: string;
  file_size: number;
  mime_type: string | null;
  source_path: string | null;
  source_modified: string | null;
  doc_class: string | null;
  source: string | null;
  rider_id?: number | null;
  rider_code?: string | null;
  sub_folder?: string | null;
};

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function classLabel(raw: string | null) {
  if (raw === "likely_executed") return "Likely executed";
  return raw || "Other";
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
}) {
  const path = props.kind === "rider"
    ? `/api/lease-mgmt/riders/${props.id}/documents`
    : `/api/lease-mgmt/lessees/${props.id}/documents`;
  const { data, isLoading } = useQuery<{ rows: LeaseDoc[] }>({
    queryKey: [path],
    queryFn: () => apiGet(path),
    enabled: props.id > 0,
  });
  const [q, setQ] = useState("");
  const [ol, setOl] = useState("all");
  const rows = data?.rows ?? [];
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (ol !== "all" && String(r.rider_code ?? r.rider_id) !== ol) return false;
      if (!needle) return true;
      const hay = `${r.file_name} ${r.source_path ?? ""} ${r.rider_code ?? ""}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [rows, q, ol]);
  const groups = useMemo(() => {
    const m = new Map<string, LeaseDoc[]>();
    for (const r of filtered) {
      const k = r.doc_class || "other";
      const list = m.get(k) ?? [];
      list.push(r);
      m.set(k, list);
    }
    for (const list of m.values()) {
      list.sort((a, b) => String(b.source_modified ?? "").localeCompare(String(a.source_modified ?? "")));
    }
    return [...m.entries()];
  }, [filtered]);
  const ols = [...new Set(rows.map((r) => r.rider_code).filter(Boolean))] as string[];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <Input className="max-w-xs h-8" placeholder="Filter name or path" value={q} onChange={(e) => setQ(e.target.value)} />
        {props.kind === "lessee" ? (
          <select className="h-8 rounded-md border bg-background px-2 text-sm" value={ol} onChange={(e) => setOl(e.target.value)}>
            <option value="all">All OLs</option>
            {ols.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        ) : null}
        <span className="text-xs text-muted-foreground">{filtered.length} file{filtered.length === 1 ? "" : "s"}</span>
      </div>
      {isLoading ? <p className="text-xs text-muted-foreground">Loading documents…</p> : null}
      {!isLoading && !rows.length ? (
        <div className="text-xs text-muted-foreground space-y-1">
          <p>No contract on file</p>
          {(props.fallbackUrls ?? []).map((d) => (
            <p key={d.url} className="font-mono">{d.label}: {d.url}</p>
          ))}
        </div>
      ) : null}
      {groups.map(([cls, list]) => (
        <div key={cls} className="border rounded-md">
          <div className="px-3 py-1.5 text-xs font-medium border-b bg-muted/30">{classLabel(cls)} · {list.length}</div>
          <div className="overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  {props.kind === "lessee" ? <th className="px-2 py-1">OL</th> : null}
                  <th className="px-2 py-1">Name</th>
                  <th className="px-2 py-1">Sub-folder</th>
                  <th className="px-2 py-1">Modified</th>
                  <th className="px-2 py-1">Size</th>
                  <th className="px-2 py-1">Source</th>
                  <th className="px-2 py-1"></th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id} className="border-t">
                    {props.kind === "lessee" ? <td className="px-2 py-1 font-mono">{r.rider_code ?? "—"}</td> : null}
                    <td className="px-2 py-1">{r.file_name}</td>
                    <td className="px-2 py-1 text-muted-foreground">{r.sub_folder || "—"}</td>
                    <td className="px-2 py-1 font-mono-num">{r.source_modified ?? "—"}</td>
                    <td className="px-2 py-1 font-mono-num">{formatBytes(r.file_size)}</td>
                    <td className="px-2 py-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase">Z:</span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-md font-mono text-xs">{r.source_path || r.source}</TooltipContent>
                      </Tooltip>
                    </td>
                    <td className="px-2 py-1">
                      <div className="flex flex-wrap gap-1">
                        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => void openSigned(r.id, false, r.file_name)}>
                          <ExternalLink className="h-3 w-3" /> View
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => void openSigned(r.id, true, r.file_name)}>
                          <Download className="h-3 w-3" /> Download
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <AttachmentsPanel
          entityType={props.kind === "rider" ? "rider" : "master_lease"}
          entityId={props.id}
        />
      </div>
    </div>
  );
}
