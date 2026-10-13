import { useEffect, useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import PageHeader from "@/components/PageHeader";
import { apiRequest } from "@/lib/queryClient";

type Line = {
  id: string;
  line_no: number;
  aar_job_code: string | null;
  qualifier: string | null;
  why_made: string | null;
  resp_code: string | null;
  labor: number;
  material: number;
  total: number;
  repair_category: string | null;
  sub_category: string | null;
};

type RevBlock = {
  revision: {
    id: string;
    rev_no: number;
    action: string;
    new_status: string | null;
    comment: string | null;
    labor: number;
    material: number;
    total: number;
  };
  lines: Line[];
  byResp: Record<string, Line[]>;
};

export default function EstimateReview() {
  const [, params] = useRoute("/repair/estimates/:id");
  const estimateId = params?.id ?? "";
  const [blocks, setBlocks] = useState<RevBlock[]>([]);
  const [compare, setCompare] = useState<{
    from: number;
    to: number;
    added: number;
    removed: number;
    changed: number;
  } | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [lesseeEmail, setLesseeEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [respFilter, setRespFilter] = useState<string>("all");
  const [respNames, setRespNames] = useState<Record<string, string>>({});

  async function load() {
    setError("");
    try {
      const res = await apiRequest("GET", `/api/repair/estimates/${estimateId}/review`);
      const data = await res.json();
      setBlocks(data.revisions ?? []);
      setCompare(data.compare ?? null);
      const codesRes = await apiRequest("GET", "/api/repair/resp-codes");
      const codesData = await codesRes.json();
      const map: Record<string, string> = {};
      for (const c of codesData.codes ?? []) {
        map[String(c.code)] = String(c.display_name ?? c.code);
      }
      setRespNames(map);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load review");
    }
  }

  useEffect(() => {
    if (estimateId) void load();
  }, [estimateId]);

  function respLabel(code: string) {
    if (code === "(none)" || code === "all") return code;
    return respNames[code] ? `${code} — ${respNames[code]}` : code;
  }

  const latest = blocks[blocks.length - 1];
  const respKeys = useMemo(
    () => (latest ? Object.keys(latest.byResp).sort() : []),
    [latest],
  );
  const visibleLines = useMemo(() => {
    if (!latest) return [];
    if (respFilter === "all") return latest.lines;
    return latest.byResp[respFilter] ?? [];
  }, [latest, respFilter]);

  async function act(path: string) {
    setMsg("");
    setError("");
    try {
      const res = await apiRequest("POST", `/api/repair/estimates/${estimateId}/${path}`, {
        comment: note || undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || path);
      setMsg(`${path}: ok`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : path);
    }
  }

  async function sendLessee() {
    setMsg("");
    setError("");
    try {
      const res = await apiRequest(
        "POST",
        `/api/repair/estimates/${estimateId}/lessee-approval`,
        { lesseeEmail, note: note || undefined },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "lessee-approval failed");
      setMsg(
        `Lessee email logged (dev). Link path: ${data.lesseeUrlPath} — shop was not copied.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "lessee send failed");
    }
  }

  return (
    <div className="p-6 max-w-5xl space-y-6">
      <PageHeader
        title="Estimate review"
        subtitle="Lines by responsibility code, revision compare, approve / request revision (audited)."
      />
      <p className="text-sm text-muted-foreground">
        <Link href="/repair" className="underline">
          ← Repair home
        </Link>
        {" · "}
        Estimate {estimateId.slice(0, 8)}…
      </p>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {msg && <p className="text-sm text-foreground">{msg}</p>}

      {compare && (
        <div className="text-sm border-b border-border pb-3">
          Revision compare r{compare.from} → r{compare.to}:{" "}
          <span className="font-medium">{compare.added}</span> added,{" "}
          <span className="font-medium">{compare.removed}</span> removed,{" "}
          <span className="font-medium">{compare.changed}</span> changed
        </div>
      )}

      {latest && (
        <>
          <div className="flex flex-wrap gap-2 items-end">
            <div className="grid gap-1">
              <Label>Filter by resp code</Label>
              <select
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={respFilter}
                onChange={(e) => setRespFilter(e.target.value)}
              >
                <option value="all">All ({latest.lines.length})</option>
                {respKeys.map((k) => (
                  <option key={k} value={k}>
                    {respLabel(k)} ({latest.byResp[k].length})
                  </option>
                ))}
              </select>
            </div>
            <div className="text-sm text-muted-foreground pb-2">
              Rev {latest.revision.rev_no} · {latest.revision.new_status} · labor $
              {Number(latest.revision.labor).toFixed(2)} · material $
              {Number(latest.revision.material).toFixed(2)} · total $
              {Number(latest.revision.total).toFixed(2)}
            </div>
          </div>

          <div className="overflow-auto border border-border rounded-md">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="p-2">Line</th>
                  <th className="p-2">Resp</th>
                  <th className="p-2">Job</th>
                  <th className="p-2">Qual</th>
                  <th className="p-2">Why</th>
                  <th className="p-2">Category</th>
                  <th className="p-2 text-right">Labor</th>
                  <th className="p-2 text-right">Material</th>
                  <th className="p-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {visibleLines.map((l) => (
                  <tr key={l.id} className="border-t border-border">
                    <td className="p-2">{l.line_no}</td>
                    <td className="p-2">{l.resp_code}</td>
                    <td className="p-2">{l.aar_job_code}</td>
                    <td className="p-2">{l.qualifier}</td>
                    <td className="p-2">{l.why_made}</td>
                    <td className="p-2">
                      {[l.repair_category, l.sub_category].filter(Boolean).join(" / ")}
                    </td>
                    <td className="p-2 text-right">{Number(l.labor).toFixed(2)}</td>
                    <td className="p-2 text-right">{Number(l.material).toFixed(2)}</td>
                    <td className="p-2 text-right">{Number(l.total).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 max-w-xl">
            <div className="grid gap-1">
              <Label htmlFor="note">Comment (audited)</Label>
              <Textarea
                id="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => act("submit")}>
                Submit for approval
              </Button>
              <Button variant="outline" onClick={() => act("request-revision")}>
                Request revision
              </Button>
              <Button onClick={() => act("approve")}>Approve</Button>
            </div>
            <div className="grid gap-1 pt-2 border-t border-border">
              <Label htmlFor="lessee">Resp 6 — lessee email (shop never copied)</Label>
              <Input
                id="lessee"
                type="email"
                placeholder="lessee@example.com"
                value={lesseeEmail}
                onChange={(e) => setLesseeEmail(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Every lessee email includes a login-free approval link (primary). Reply is
                secondary and needs reviewer confirmation. Attachments pass through the shop’s
                original files; a PDF is generated only if the shop did not send one.
              </p>
              <Button variant="secondary" onClick={sendLessee} disabled={!lesseeEmail}>
                Send lessee approval email (dev log)
              </Button>
            </div>
          </div>
        </>
      )}

      {!latest && !error && (
        <p className="text-sm text-muted-foreground">No revisions yet for this estimate.</p>
      )}
    </div>
  );
}
