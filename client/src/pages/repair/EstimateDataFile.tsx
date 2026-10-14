/**
 * Shared Data File header + lines + totals + attachments for
 * internal estimate review and lessee estimate (read-only mode).
 */
import { useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";

export type HeaderFieldDef = { key: string; label: string; group: string };

export type EstimateLine = {
  id?: string;
  line_no: number;
  aar_job_code: string | null;
  qualifier?: string | null;
  why_made?: string | null;
  condition_code?: string | null;
  resp_code: string | null;
  labor: number;
  material: number;
  total: number;
  repair_category: string | null;
  sub_category?: string | null;
  aar_component_id?: string | null;
  ddct_incident_id?: string | null;
};

export type HeaderEdit = {
  id: string;
  field_key: string;
  old_value: string | null;
  new_value: string | null;
  reason: string;
  actor: string;
  edited_at: string;
};

export type DocRow = {
  id: string;
  kind: string;
  original_filename?: string | null;
  mime?: string | null;
  size?: number;
  uploaded_at?: string;
  lifecycle_status?: string;
};

function money(n: number) {
  return Number(n ?? 0).toFixed(2);
}

type Props = {
  estimateId?: string;
  header: Record<string, unknown>;
  headerFields: HeaderFieldDef[];
  headerEdits?: HeaderEdit[];
  lines: EstimateLine[];
  documents?: DocRow[];
  /** When true: hide pencil + admin; show approve/dispute only for ownRespCodes */
  readOnly?: boolean;
  canPencilEdit?: boolean;
  ownRespCodes?: string[];
  onHeaderChanged?: () => void;
  onDecideLine?: (line: EstimateLine, decision: "APPROVE" | "DISPUTE") => void;
};

export function EstimateDataFile(props: Props) {
  const {
    estimateId,
    header,
    headerFields,
    headerEdits = [],
    lines,
    documents = [],
    readOnly = false,
    canPencilEdit = false,
    ownRespCodes = [],
    onHeaderChanged,
    onDecideLine,
  } = props;

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editReason, setEditReason] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const groups = useMemo(() => {
    const map = new Map<string, HeaderFieldDef[]>();
    for (const f of headerFields) {
      const g = map.get(f.group) ?? [];
      g.push(f);
      map.set(f.group, g);
    }
    return Array.from(map.entries());
  }, [headerFields]);

  const totals = useMemo(() => {
    let labor = 0;
    let material = 0;
    let total = 0;
    for (const l of lines) {
      labor += Math.round(Number(l.labor ?? 0) * 100);
      material += Math.round(Number(l.material ?? 0) * 100);
      total += Math.round(Number(l.total ?? 0) * 100);
    }
    return {
      labor: (labor / 100).toFixed(2),
      material: (material / 100).toFixed(2),
      total: (total / 100).toFixed(2),
    };
  }, [lines]);

  async function savePencil() {
    if (!estimateId || !editingKey) return;
    setErr("");
    setMsg("");
    try {
      const res = await apiRequest("POST", `/api/repair/estimates/${estimateId}/header-edit`, {
        fieldKey: editingKey,
        newValue: editValue,
        reason: editReason,
        actorRole: "reviewer",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Header edit failed");
      setMsg(`Header ${editingKey} updated (audited).`);
      setEditingKey(null);
      setEditReason("");
      onHeaderChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Header edit failed");
    }
  }

  return (
    <div className="space-y-6">
      {err && <p className="text-sm text-destructive">{err}</p>}
      {msg && <p className="text-sm text-foreground">{msg}</p>}

      <section className="space-y-3 border border-border rounded-md p-4">
        <h2 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
          Data File header
        </h2>
        <p className="text-xs text-muted-foreground">
          Full 500-byte header block (billing road, source code, shop, car, dates, invoice /
          account fields).
          {!readOnly && canPencilEdit
            ? " Use the pencil to edit a field — each change requires a reason and is audited."
            : null}
        </p>
        {groups.map(([group, fields]) => (
          <div key={group} className="space-y-2">
            <h3 className="text-xs font-medium text-muted-foreground pt-2">{group}</h3>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {fields.map((f) => {
                const val = header[f.key];
                const display = val == null || val === "" ? "—" : String(val);
                const isEditing = editingKey === f.key;
                return (
                  <div
                    key={f.key}
                    className="flex items-start gap-2 border-b border-border/60 pb-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        {f.label}
                      </div>
                      {!isEditing && (
                        <div className="text-sm font-medium truncate" title={display}>
                          {display}
                        </div>
                      )}
                      {isEditing && (
                        <div className="space-y-2 mt-1">
                          <Input
                            className="h-8 text-sm"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                          />
                          <Textarea
                            className="text-xs"
                            rows={2}
                            placeholder="Reason for change (required)"
                            value={editReason}
                            onChange={(e) => setEditReason(e.target.value)}
                          />
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={savePencil}
                              disabled={!editReason.trim()}
                            >
                              Save
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditingKey(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                    {!readOnly && canPencilEdit && !isEditing && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 shrink-0"
                        title={`Edit ${f.label}`}
                        onClick={() => {
                          setEditingKey(f.key);
                          setEditValue(val == null ? "" : String(val));
                          setEditReason("");
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      {!readOnly && headerEdits.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">Header audit log</h2>
          <div className="overflow-auto border border-border rounded-md max-h-40">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="p-2">When</th>
                  <th className="p-2">Field</th>
                  <th className="p-2">Old → New</th>
                  <th className="p-2">Reason</th>
                  <th className="p-2">User</th>
                </tr>
              </thead>
              <tbody>
                {headerEdits.map((e) => (
                  <tr key={e.id} className="border-t border-border">
                    <td className="p-2 whitespace-nowrap">
                      {new Date(e.edited_at).toLocaleString()}
                    </td>
                    <td className="p-2">{e.field_key}</td>
                    <td className="p-2">
                      {e.old_value ?? "—"} → {e.new_value ?? "—"}
                    </td>
                    <td className="p-2">{e.reason}</td>
                    <td className="p-2">{e.actor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Estimate lines</h2>
        <div className="overflow-auto border border-border rounded-md">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="p-2">Line</th>
                <th className="p-2">Resp</th>
                <th className="p-2">Job</th>
                <th className="p-2">Qual</th>
                <th className="p-2">Why</th>
                <th className="p-2">Cond</th>
                <th className="p-2">Category</th>
                <th className="p-2">CID / DDCT</th>
                <th className="p-2 text-right">Labor</th>
                <th className="p-2 text-right">Material</th>
                <th className="p-2 text-right">Total</th>
                {readOnly && onDecideLine ? <th className="p-2">Your action</th> : null}
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const own = ownRespCodes.includes(String(l.resp_code));
                return (
                  <tr key={l.id ?? l.line_no} className="border-t border-border">
                    <td className="p-2">{l.line_no}</td>
                    <td className="p-2">{l.resp_code}</td>
                    <td className="p-2">{l.aar_job_code}</td>
                    <td className="p-2">{l.qualifier}</td>
                    <td className="p-2">{l.why_made}</td>
                    <td className="p-2">{l.condition_code}</td>
                    <td className="p-2">
                      {[l.repair_category, l.sub_category].filter(Boolean).join(" / ")}
                    </td>
                    <td className="p-2 text-[10px]">
                      {[l.aar_component_id, l.ddct_incident_id].filter(Boolean).join(" / ") ||
                        "—"}
                    </td>
                    <td className="p-2 text-right">{money(l.labor)}</td>
                    <td className="p-2 text-right">{money(l.material)}</td>
                    <td className="p-2 text-right">{money(l.total)}</td>
                    {readOnly && onDecideLine ? (
                      <td className="p-2">
                        {own ? (
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => onDecideLine(l, "APPROVE")}
                            >
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => onDecideLine(l, "DISPUTE")}
                            >
                              Dispute
                            </Button>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="text-sm flex flex-wrap gap-4">
          <span>
            Labor <strong>${totals.labor}</strong>
          </span>
          <span>
            Material <strong>${totals.material}</strong>
          </span>
          <span>
            Total <strong>${totals.total}</strong>
          </span>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Attachments</h2>
        {documents.length === 0 ? (
          <p className="text-xs text-muted-foreground">No attachments.</p>
        ) : (
          <ul className="text-xs space-y-1">
            {documents.map((d) => (
              <li key={d.id} className="flex gap-2">
                <span className="font-medium">
                  {d.original_filename || d.kind || d.id.slice(0, 8)}
                </span>
                <span className="text-muted-foreground">{d.kind}</span>
                {d.lifecycle_status === "VOIDED" && (
                  <span className="text-destructive">VOIDED</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
