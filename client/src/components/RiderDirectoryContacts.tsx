import { useEffect, useState } from "react";
import { useCanEdit, usePermissions } from "@/lib/AuthContext";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Mail, Pencil, Phone, Plus, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import ContactLeaseLinks from "@/components/ContactLeaseLinks";
import { confirmDelete, confirmSave } from "@/components/ConfirmActionDialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { contactsDirectoryPath } from "@/lib/directory-nav";
import { navigateHash } from "@/lib/hash-location";
import type { RiderContact } from "@shared/schema";

function RiderContactForm({
  open,
  onClose,
  riderId,
  contact,
}: {
  open: boolean;
  onClose: () => void;
  riderId: number;
  contact: RiderContact | null;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      setForm({
        name: contact?.name ?? "",
        title: contact?.title ?? "",
        email: contact?.email ?? "",
        phone: contact?.phone ?? "",
        notes: contact?.notes ?? "",
      });
    }
  }, [open, contact]);

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: form.name,
        title: form.title || null,
        email: form.email || null,
        phone: form.phone || null,
        notes: form.notes || null,
      };
      if (contact) {
        if (contact.source === "directory" || contact.company_contact_id) {
          await apiRequest("PATCH", `/api/company-contacts/${contact.company_contact_id || contact.id}`, body);
        } else {
          await apiRequest("PATCH", `/api/contacts/${contact.id}`, body);
        }
      } else {
        await apiRequest("POST", `/api/riders/${riderId}/contacts`, body);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/riders", riderId, "contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/directory-search"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      queryClient.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "/api/accounts" });
      toast({ title: contact ? "Contact updated" : "Contact added" });
      onClose();
    },
    onError: (e: Error) =>
      toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{contact ? "Edit Contact" : "Add Lessee Contact"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Name <span className="text-destructive">*</span></Label>
            <Input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Jane Smith" />
          </div>
          <div>
            <Label>Title / Role</Label>
            <Input value={form.title ?? ""} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Fleet Manager" />
          </div>
          <div>
            <Label>Email</Label>
            <Input type="email" value={form.email ?? ""} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="jane@company.com" />
          </div>
          <div>
            <Label>Phone</Label>
            <Input type="tel" value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+1 (555) 000-0000" />
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea rows={2} value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Preferred contact for billing disputes…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            onClick={async () => {
              if (contact) {
                const ok = await confirmSave({
                  title: `Save changes to ${form.name?.trim() || contact.name}?`,
                  description: "Updates will be written to this contact record.",
                });
                if (!ok) return;
              }
              save.mutate();
            }}
            disabled={save.isPending || !form.name?.trim()}
          >
            {save.isPending ? "Saving…" : contact ? "Save" : "Add Contact"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RiderDirectoryContacts({
  riderId,
  canEdit,
  variant = "panel",
  emptyHint = "No contacts linked to this OL yet.",
  onPersonClick,
}: {
  riderId: number;
  canEdit?: boolean;
  variant?: "panel" | "compact";
  emptyHint?: string;
  onPersonClick?: () => void;
}) {
  const { toast } = useToast();
  const pageCanEdit = useCanEdit();
  const { canDeleteContacts, canEditContacts } = usePermissions();
  const [addOpen, setAddOpen] = useState(false);
  const [editContact, setEditContact] = useState<RiderContact | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const compact = variant === "compact";

  const { data: contacts, isLoading } = useQuery<RiderContact[]>({
    queryKey: ["/api/riders", riderId, "contacts"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/riders/${riderId}/contacts`);
      return res.json();
    },
  });

  const deleteContact = useMutation({
    mutationFn: async (c: RiderContact) => {
      if (c.source === "directory") {
        if (!c.link_id) throw new Error("This person is on the lease via their company — unlink the company on the MLA, or open Contacts to delete them.");
        await apiRequest("DELETE", `/api/contact-lease-links/${c.link_id}`);
        return;
      }
      await apiRequest("DELETE", `/api/contacts/${c.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/riders", riderId, "contacts"] });
      queryClient.invalidateQueries({ queryKey: [`/api/riders/${riderId}/contact-links`] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      queryClient.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "/api/accounts" });
      toast({ title: "Contact removed from this OL" });
    },
    onError: (e: Error) =>
      toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const write = (canEdit ?? pageCanEdit) || canEditContacts;

  const openPerson = (c: RiderContact) => {
    onPersonClick?.();
    navigateHash(contactsDirectoryPath({
      q: c.name,
      companyId: c.company_id ?? null,
      contactId: c.company_contact_id ?? (c.source === "directory" ? c.id : null),
      people: true,
      leaseTied: false,
    }));
  };

  return (
    <div className={compact ? "" : "px-5 pb-5 bg-muted/10 border-t border-border/60"}>
      <div className={compact ? "flex items-center justify-between mb-2 gap-2" : "pt-3 flex items-center justify-between mb-3"}>
        <div className={compact
          ? "text-[10px] uppercase tracking-wider text-muted-foreground"
          : "flex items-center gap-2 text-[10px] uppercase tracking-[0.15em] text-muted-foreground"}
        >
          {!compact ? <Users className="h-3.5 w-3.5" /> : null}
          Contacts
        </div>
        <div className="flex gap-1 flex-wrap justify-end">
          {!compact ? (
            <Button size="sm" variant="ghost" className="h-7 text-xs" asChild>
              <Link href="/contacts/review?tab=leases">Directory lease links</Link>
            </Button>
          ) : null}
          {write && (
            <>
              <Button size="sm" variant="ghost" onClick={() => setLinkOpen((v) => !v)} className="h-7 text-xs gap-1">
                Link existing
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAddOpen(true)} className="h-7 text-xs gap-1">
                <Plus className="h-3.5 w-3.5" /> Add
              </Button>
            </>
          )}
        </div>
      </div>

      {isLoading ? (
        compact ? <div className="text-xs text-muted-foreground">Loading…</div> : <Skeleton className="h-12 rounded" />
      ) : (contacts ?? []).length === 0 ? (
        <div className={compact ? "text-xs text-muted-foreground" : "text-xs text-muted-foreground italic py-4 text-center"}>
          {emptyHint}
        </div>
      ) : (
        <div className={compact ? "space-y-2" : "space-y-2"}>
          {(contacts ?? []).map((c) => (
            <div key={`${c.source}-${c.id}-${c.link_id ?? ""}`} className={compact ? "flex items-start gap-2" : "rounded-md border border-border bg-card px-4 py-3 flex items-start gap-3"}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    className="text-sm font-medium text-foreground hover:text-primary text-left"
                    onClick={() => openPerson(c)}
                  >
                    {c.name}
                  </button>
                  {c.title && <span className="text-xs text-muted-foreground">· {c.title}</span>}
                  {c.company_name && <span className="text-[11px] text-muted-foreground">{c.company_name}</span>}
                  {c.source === "legacy" && (
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Legacy OL</span>
                  )}
                  {c.source === "directory" && !c.link_id && (
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Via company on lease</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                  {c.email && (
                    <a href={`mailto:${c.email}`} className="flex items-center gap-1 text-xs text-primary hover:underline">
                      <Mail className="h-3 w-3" />{c.email}
                    </a>
                  )}
                  {c.phone && (
                    <a href={`tel:${c.phone}`} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                      <Phone className="h-3 w-3" />{c.phone}
                    </a>
                  )}
                </div>
                {c.notes && <div className="text-xs text-muted-foreground mt-1 italic">{c.notes}</div>}
              </div>
              {write ? (
                <div className="flex gap-1 shrink-0">
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditContact(c)}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                  {canDeleteContacts && (c.source !== "directory" || Boolean(c.link_id)) && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={async () => {
                        const ok = await confirmDelete({
                          title: c.source === "directory" ? `Unlink “${c.name}” from this OL?` : `Delete contact "${c.name}"?`,
                          description: c.source === "directory"
                            ? "They stay in the Contacts directory and can be linked again later."
                            : "This will permanently delete this legacy OL contact.",
                        });
                        if (ok) deleteContact.mutate(c);
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {linkOpen && (
        <div className="mt-3">
          <ContactLeaseLinks mode="rider" riderId={riderId} canAdd={write} canRemove={write} />
        </div>
      )}

      <RiderContactForm
        open={addOpen || !!editContact}
        onClose={() => { setAddOpen(false); setEditContact(null); }}
        riderId={riderId}
        contact={editContact}
      />
    </div>
  );
}
