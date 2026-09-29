import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Mail, Phone, User } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { contactsDirectoryPath } from "@/lib/directory-nav";
import { groupDirectoryPeopleById } from "@/lib/directory-people-group";

export type AccountDirectoryPerson = {
  id: number;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  company_id: number | null;
  company_name: string | null;
  rider?: { rider_name?: string | null; schedule_number?: string | null } | null;
  master_lease?: { lease_number?: string | null; lessee?: string | null } | null;
  via_company?: boolean;
};

export function AccountDirectoryPeople({
  accountId,
  searchHint,
  compact,
  onOpen,
}: {
  accountId: number | null | undefined;
  searchHint?: string;
  compact?: boolean;
  onOpen: (path: string) => void;
}) {
  const enabled = Boolean(accountId && accountId > 0);
  const { data: people = [], isLoading } = useQuery<AccountDirectoryPerson[]>({
    queryKey: ["/api/accounts", accountId, "contacts"],
    queryFn: () => apiRequest("GET", `/api/accounts/${accountId}/contacts`).then((r) => r.json()),
    enabled,
  });

  const grouped = useMemo(() => groupDirectoryPeopleById(people), [people]);

  if (!enabled) return null;

  return (
    <div className={compact ? "rounded-lg border border-border bg-card overflow-hidden" : "rounded-xl border border-card-border bg-card overflow-hidden"}>
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Directory contacts</div>
        <div className="flex items-center gap-3 shrink-0">
        <button
          type="button"
          className="text-xs text-primary hover:underline"
          onClick={() => onOpen(contactsDirectoryPath({
            q: searchHint ?? "",
            companyId: null,
            contactId: null,
            people: true,
            leaseTied: true,
          }))}
        >
          Open Contacts
        </button>
        <button
          type="button"
          className="text-xs text-primary hover:underline"
          onClick={() => onOpen(contactsDirectoryPath({
            q: searchHint ?? "",
            companyId: null,
            contactId: null,
            people: true,
            leaseTied: false,
            addContact: true,
          }))}
        >
          Add contact
        </button>
        </div>
      </div>
      <div className="px-4 py-3">
        {isLoading ? (
          <p className="text-xs text-muted-foreground">Loading people linked to this account’s leases…</p>
        ) : grouped.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No directory people are linked to this account’s MLAs or OLs yet.
          </p>
        ) : (
          <ul className="space-y-3">
            {grouped.map((p) => (
              <li key={p.id} className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                  <User className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    className="text-sm font-medium hover:text-primary text-left"
                    onClick={() => onOpen(contactsDirectoryPath({
                      q: p.name,
                      companyId: p.company_id,
                      contactId: p.id,
                      people: true,
                      leaseTied: false,
                    }))}
                  >
                    {p.name}
                  </button>
                  <div className="text-xs text-muted-foreground">
                    {[p.title, p.company_name, p.via_company ? "via company" : null].filter(Boolean).join(" · ")}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-0.5">
                    {p.email ? (
                      <a href={`mailto:${p.email}`} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                        <Mail className="h-3 w-3" />{p.email}
                      </a>
                    ) : null}
                    {p.phone ? (
                      <a href={`tel:${p.phone}`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                        <Phone className="h-3 w-3" />{p.phone}
                      </a>
                    ) : null}
                  </div>
                  {p.leases.length > 0 ? (
                    <div className="text-[11px] text-muted-foreground mt-1">{p.leases.join(" · ")}</div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
