import { useEffect, useState } from "react";
import { ApiError, apiGet, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PROSPECT_COMPANY_TYPES, type ProspectCompanyType } from "@shared/crm";

export type CreatedProspect = {
  account_id: number;
  company_id: number | null;
  contact_id: number | null;
  name: string;
};

type DedupHit = {
  source: "account" | "company" | "umler";
  id: number;
  label: string;
  kind: string | null;
  reason: string;
  reporting_marks?: string[];
};

export default function QuickProspectForm({
  initialName,
  onCreated,
  onCancel,
}: {
  initialName: string;
  onCreated: (row: CreatedProspect) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [companyType, setCompanyType] = useState<ProspectCompanyType>("prospect");
  const [marks, setMarks] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [title, setTitle] = useState("");
  const [hits, setHits] = useState<DedupHit[]>([]);
  const [existing, setExisting] = useState<{ account_id?: number; company_id?: number } | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setName(initialName);
  }, [initialName]);

  async function lookup() {
    const trimmed = name.trim();
    const markList = marks.split(/[,\s]+/).map((mark) => mark.trim()).filter(Boolean);
    if (!trimmed && markList.length === 0) {
      setHits([]);
      return;
    }
    const params = new URLSearchParams();
    if (trimmed) params.set("name", trimmed);
    if (markList.length) params.set("marks", markList.join(","));
    const rows = await apiGet<DedupHit[]>(`/api/crm/prospect-dedup?${params.toString()}`);
    setHits(rows);
  }

  function applyHit(hit: DedupHit) {
    if (hit.source === "umler") {
      setName(hit.label);
      const fromHit = (hit.reporting_marks ?? []).filter(Boolean);
      if (fromHit.length) setMarks(fromHit.join(", "));
      return;
    }
    void useExisting(hit.source, hit.id, hit.label);
  }

  async function useExisting(kind: "account" | "company", id: number, label: string) {
    setPending(true);
    setError("");
    try {
      const res = await apiRequest("POST", "/api/crm/prospects", {
        name: label,
        company_type: companyType,
        use_existing: { kind, id },
      });
      const row = (await res.json()) as CreatedProspect;
      onCreated({ ...row, name: row.name || label });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not use that record");
    } finally {
      setPending(false);
    }
  }

  async function save() {
    setPending(true);
    setError("");
    setExisting(null);
    try {
      const res = await apiRequest("POST", "/api/crm/prospects", {
        name: name.trim(),
        company_type: companyType,
        reporting_marks: marks.split(/[,\s]+/).map((mark) => mark.trim()).filter(Boolean),
        contact: contactName.trim()
          ? { name: contactName.trim(), email: email.trim() || null, phone: phone.trim() || null, title: title.trim() || null }
          : undefined,
      });
      const row = (await res.json()) as CreatedProspect;
      onCreated({ ...row, name: row.name || name.trim() });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const accountId = Number(err.body.account_id);
        const companyId = Number(err.body.company_id);
        setExisting({
          account_id: Number.isFinite(accountId) && accountId > 0 ? accountId : undefined,
          company_id: Number.isFinite(companyId) && companyId > 0 ? companyId : undefined,
        });
      }
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-2 rounded-md border border-border p-3 space-y-2">
      <div className="text-xs font-medium">New prospect</div>
      <div>
        <Label>Name</Label>
        <Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => void lookup()} />
      </div>
      <div>
        <Label>Type</Label>
        <select
          className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2"
          value={companyType}
          onChange={(e) => setCompanyType(e.target.value as ProspectCompanyType)}
        >
          {PROSPECT_COMPANY_TYPES.map((row) => (
            <option key={row.value} value={row.value}>{row.label}</option>
          ))}
        </select>
      </div>
      <div>
        <Label>Reporting marks</Label>
        <Input className="mt-1" value={marks} placeholder="Optional" onChange={(e) => setMarks(e.target.value)} onBlur={() => void lookup()} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>First contact</Label>
          <Input className="mt-1" value={contactName} placeholder="Optional" onChange={(e) => setContactName(e.target.value)} />
        </div>
        <div>
          <Label>Title</Label>
          <Input className="mt-1" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <Label>Email</Label>
          <Input className="mt-1" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <Label>Phone</Label>
          <Input className="mt-1" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
      </div>
      {hits.length > 0 ? (
        <div className="text-xs space-y-1">
          <div className="text-muted-foreground">Did you mean…?</div>
          {hits.map((hit) => (
            <button key={`${hit.source}-${hit.id}`} type="button" className="block text-left hover:underline" onClick={() => applyHit(hit)}>
              {hit.label} · {hit.reason}
            </button>
          ))}
        </div>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {existing?.account_id ? (
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => void useExisting("account", existing.account_id!, name.trim())}>
          Use existing
        </Button>
      ) : null}
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={pending || !name.trim()} onClick={() => void save()}>Save prospect</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
