/**
 * ContactsProvider — shop/lessee/other contact bank.
 *
 * Phase 1: LocalContactsProvider backed by repair.contacts.
 * Future: swap implementation to link/sync with RLMS Contacts module
 * via nullable repair.contacts.rlms_contact_id (do not build that module here).
 */
import {
  listContacts,
  softDeleteContact,
  upsertContact,
} from "../services/contacts";

export type ContactRecord = {
  id: string;
  tenant_id: string;
  party_type: "shop" | "lessee" | "other" | string;
  party_ref: string | null;
  name: string;
  email: string | null;
  phone?: string | null;
  role?: string | null;
  active: boolean;
  /** Future link to RLMS Contacts module — null today. */
  rlms_contact_id?: string | null;
  created_at?: string;
};

export type UpsertContactInput = {
  id?: string;
  tenantId?: string;
  partyType: "shop" | "lessee" | "other";
  partyRef?: string;
  name: string;
  email?: string;
  phone?: string;
  role?: string;
  active?: boolean;
  /** Reserved for future RLMS Contacts sync — ignored by local provider writes today. */
  rlmsContactId?: string | null;
  actor: string;
};

export interface ContactsProvider {
  list(opts?: {
    tenantId?: string;
    partyType?: "shop" | "lessee" | "other";
    activeOnly?: boolean;
  }): Promise<ContactRecord[]>;

  upsert(opts: UpsertContactInput): Promise<
    | { ok: true; contact: ContactRecord }
    | { ok: false; status: number; error: string }
  >;

  softDelete(opts: {
    id: string;
    actor: string;
    reason?: string;
    tenantId?: string;
  }): Promise<
    | { ok: true; contact: ContactRecord }
    | { ok: false; status: number; error: string }
  >;
}

/** Local table adapter — source of truth until RLMS Contacts module is wired. */
export class LocalContactsProvider implements ContactsProvider {
  async list(opts?: {
    tenantId?: string;
    partyType?: "shop" | "lessee" | "other";
    activeOnly?: boolean;
  }): Promise<ContactRecord[]> {
    const rows = await listContacts(opts);
    return rows as ContactRecord[];
  }

  async upsert(opts: UpsertContactInput) {
    const result = await upsertContact({
      id: opts.id,
      tenantId: opts.tenantId,
      partyType: opts.partyType,
      partyRef: opts.partyRef,
      name: opts.name,
      email: opts.email,
      active: opts.active,
      actor: opts.actor,
      phone: opts.phone,
      role: opts.role,
      rlmsContactId: opts.rlmsContactId,
    });
    if (!result.ok) return result;
    return { ok: true as const, contact: result.contact as ContactRecord };
  }

  async softDelete(opts: {
    id: string;
    actor: string;
    reason?: string;
    tenantId?: string;
  }) {
    const result = await softDeleteContact(opts);
    if (!result.ok) return result;
    return { ok: true as const, contact: result.contact as ContactRecord };
  }
}

let contactsProvider: ContactsProvider = new LocalContactsProvider();

export function getContactsProvider(): ContactsProvider {
  return contactsProvider;
}

export function setContactsProvider(provider: ContactsProvider): void {
  contactsProvider = provider;
}
