import { useEffect, useState } from "react";
import { apiGet } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { PARTY_KIND_LABEL, type PartyKind } from "@shared/crm";
import QuickProspectForm, { type CreatedProspect } from "@/components/crm/QuickProspectForm";

export type PartySelection = {
  entity: "account" | "company" | "contact";
  entity_id: number;
  account_id: number | null;
  company_id: number | null;
  contact_id: number | null;
  label: string;
  kind: PartyKind;
};

type PartyHit = PartySelection & {
  reporting_marks: string[] | null;
  account_manager: string | null;
};

const KIND_CLASS: Record<PartyKind, string> = {
  client: "bg-sky-500/15 text-sky-800",
  prospect: "bg-amber-500/15 text-amber-800",
  former: "bg-slate-500/15 text-slate-700",
  company: "bg-violet-500/15 text-violet-800",
  contact: "bg-emerald-500/15 text-emerald-800",
};

export default function PartyPicker({
  selected,
  onSelect,
  disabled,
}: {
  selected: PartySelection | null;
  onSelect: (party: PartySelection) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PartyHit[]>([]);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handle = window.setTimeout(() => {
      const params = new URLSearchParams({ limit: "20" });
      if (query.trim()) params.set("q", query.trim());
      void apiGet<PartyHit[]>(`/api/crm/parties?${params.toString()}`)
        .then(setHits)
        .catch(() => setHits([]));
    }, 250);
    return () => window.clearTimeout(handle);
  }, [query, open]);

  function choose(hit: PartyHit) {
    onSelect({
      entity: hit.entity,
      entity_id: hit.entity_id,
      account_id: hit.account_id,
      company_id: hit.company_id,
      contact_id: hit.contact_id,
      label: hit.label,
      kind: hit.kind,
    });
    setOpen(false);
    setCreating(false);
    setQuery("");
  }

  function created(row: CreatedProspect) {
    onSelect({
      entity: "account",
      entity_id: row.account_id,
      account_id: row.account_id,
      company_id: row.company_id,
      contact_id: row.contact_id,
      label: row.name,
      kind: "prospect",
    });
    setCreating(false);
    setOpen(false);
    setQuery("");
  }

  return (
    <div>
      <button
        type="button"
        className="h-9 w-full rounded-md border border-input bg-background px-2 text-left text-sm"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        {selected ? (
          <span className="inline-flex items-center gap-2">
            <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${KIND_CLASS[selected.kind]}`}>{PARTY_KIND_LABEL[selected.kind]}</span>
            {selected.label}
          </span>
        ) : (
          <span className="text-muted-foreground">Who is this deal with?</span>
        )}
      </button>
      {open && !disabled ? (
        <div className="mt-1 rounded-md border border-border bg-background p-2">
          <Input
            autoFocus
            value={query}
            placeholder="Search clients, prospects, companies, contacts"
            onChange={(e) => setQuery(e.target.value)}
          />
          <ul className="mt-2 max-h-56 overflow-auto text-sm">
            {hits.map((hit) => (
              <li key={`${hit.entity}-${hit.entity_id}`}>
                <button type="button" className="w-full text-left px-1 py-1 hover:bg-muted/50 rounded" onClick={() => choose(hit)}>
                  <span className={`mr-2 rounded px-1.5 py-0.5 text-[10px] uppercase ${KIND_CLASS[hit.kind]}`}>{PARTY_KIND_LABEL[hit.kind]}</span>
                  {hit.label}
                  {hit.reporting_marks?.length ? <span className="text-muted-foreground"> · {hit.reporting_marks.slice(0, 3).join(", ")}</span> : null}
                  {hit.account_manager ? <span className="text-muted-foreground"> · {hit.account_manager}</span> : null}
                </button>
              </li>
            ))}
            {hits.length === 0 ? <li className="px-1 py-1 text-muted-foreground">No matches.</li> : null}
          </ul>
          <button type="button" className="mt-2 text-sm text-primary hover:underline" onClick={() => setCreating(true)}>
            + New prospect{query.trim() ? ` '${query.trim()}'` : ""}
          </button>
          {creating ? (
            <QuickProspectForm initialName={query.trim()} onCreated={created} onCancel={() => setCreating(false)} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
