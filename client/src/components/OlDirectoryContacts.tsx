import { useQuery } from "@tanstack/react-query";
import { Mail, Phone } from "lucide-react";
import { apiGet } from "@/lib/queryClient";
import { contactsDirectoryPath } from "@/lib/directory-nav";
import { navigateHash } from "@/lib/hash-location";

export type OlDirectoryContact = {
  id: number;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  company_name: string | null;
  company_id: number | null;
  via_company?: boolean;
};

export function OlDirectoryContacts({
  riderId,
  emptyHint = "No directory people linked to this OL yet.",
  onPersonClick,
}: {
  riderId: number | null | undefined;
  emptyHint?: string;
  onPersonClick?: () => void;
}) {
  const enabled = Boolean(riderId && riderId > 0);
  const { data: contacts = [], isLoading } = useQuery<OlDirectoryContact[]>({
    queryKey: ["/api/riders", riderId, "contacts"],
    queryFn: () => apiGet(`/api/riders/${riderId}/contacts`),
    enabled,
  });

  if (!enabled) return null;

  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
        Contacts
      </div>
      {isLoading ? (
        <div className="text-xs text-muted-foreground">Loading…</div>
      ) : contacts.length === 0 ? (
        <div className="text-xs text-muted-foreground">{emptyHint}</div>
      ) : (
        <ul className="space-y-2">
          {contacts.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="text-left w-full"
                onClick={() => {
                  onPersonClick?.();
                  navigateHash(contactsDirectoryPath({
                    q: c.name,
                    companyId: c.company_id,
                    contactId: c.id,
                    people: true,
                    leaseTied: false,
                  }));
                }}
              >
                <div className="text-sm font-medium hover:text-primary">{c.name}</div>
                <div className="text-xs text-muted-foreground">
                  {[c.title, c.company_name, c.via_company ? "via company" : null].filter(Boolean).join(" · ")}
                </div>
              </button>
              <div className="flex flex-wrap gap-3 mt-0.5">
                {c.email ? (
                  <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                    <Mail className="h-3 w-3" />{c.email}
                  </a>
                ) : null}
                {c.phone ? (
                  <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                    <Phone className="h-3 w-3" />{c.phone}
                  </a>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
