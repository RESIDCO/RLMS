import { changeCaptureRow } from "@shared/crm";
import { isAccountTier, TIER_VALUES } from "@shared/account-mgmt";

export type AccountPatchInput = {
  name?: string;
  notes?: string | null;
  account_manager?: string | null;
  tier?: string | null;
  touch_cadence_days?: number | string | null;
};

export type AccountWriteDeps = {
  get(id: number): Promise<Record<string, unknown> | null>;
  update(id: number, updates: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  insert(row: Record<string, unknown>): Promise<Record<string, unknown>>;
  activeOwners(): Promise<Set<string>>;
  record(opts: {
    table: string;
    pk: number;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    action: string;
    entity_type: "account";
    entity_id: number;
    actor: string;
  }): Promise<unknown>;
  inGroup<T extends object>(actor: string, fn: () => Promise<T>): Promise<T & { change_group: string }>;
};

function httpError(status: number, message: string): Error {
  const err = new Error(message);
  (err as { status?: number }).status = status;
  return err;
}

function hasUpdatedAt(row: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(row, "updated_at") || Object.prototype.hasOwnProperty.call(row, "search_vector");
}

export async function applyAccountUpdate(
  id: number,
  input: AccountPatchInput,
  actor: string,
  deps: AccountWriteDeps,
): Promise<(Record<string, unknown> & { change_group: string }) | null> {
  const before = await deps.get(id);
  if (!before) return null;
  const updates: Record<string, unknown> = {};

  if (input.name !== undefined) {
    const name = String(input.name ?? "").trim();
    if (!name) throw httpError(400, "Name is required");
    updates.name = name;
  }
  if (input.notes !== undefined) updates.notes = input.notes == null ? null : String(input.notes).trim() || null;
  if (input.account_manager !== undefined) {
    const raw = input.account_manager == null ? "" : String(input.account_manager).trim();
    if (!raw) updates.account_manager = null;
    else {
      const owners = await deps.activeOwners();
      if (!owners.has(raw)) throw httpError(400, "account_manager must be an active territory owner");
      updates.account_manager = raw;
    }
  }
  if (input.tier !== undefined) {
    if (input.tier == null || input.tier === "") updates.tier = null;
    else if (!isAccountTier(input.tier)) {
      throw httpError(400, `tier must be ${TIER_VALUES.join(", ")} or blank`);
    } else updates.tier = input.tier;
  }
  if (input.touch_cadence_days !== undefined) {
    if (input.touch_cadence_days == null || input.touch_cadence_days === "") updates.touch_cadence_days = null;
    else {
      const n = Number(input.touch_cadence_days);
      if (!Number.isInteger(n) || n < 7 || n > 365) {
        throw httpError(400, "touch_cadence_days must be between 7 and 365, or blank");
      }
      updates.touch_cadence_days = n;
    }
  }

  if (Object.keys(updates).length === 0) {
    return { ...before, change_group: "" };
  }

  return deps.inGroup(actor, async () => {
    const saved = await deps.update(id, { ...updates, updated_at: new Date().toISOString() });
    if (!saved) throw httpError(404, "Account not found");
    const beforeCapture = changeCaptureRow(before);
    const afterCapture = changeCaptureRow(saved);
    if (hasUpdatedAt(beforeCapture) || hasUpdatedAt(afterCapture)) {
      throw httpError(500, "updated_at leaked into the change record");
    }
    await deps.record({
      table: "accounts",
      pk: id,
      before: beforeCapture,
      after: afterCapture,
      action: "update_account",
      entity_type: "account",
      entity_id: id,
      actor,
    });
    return saved;
  });
}

export async function applyAccountInsert(
  input: { name: string; notes?: string | null; account_manager?: string | null },
  actor: string,
  deps: AccountWriteDeps,
): Promise<Record<string, unknown> & { change_group: string }> {
  const name = String(input.name ?? "").trim();
  if (!name) throw httpError(400, "Name is required");
  const row: Record<string, unknown> = { name, notes: input.notes?.trim() || null };
  if (input.account_manager !== undefined) {
    const raw = input.account_manager == null ? "" : String(input.account_manager).trim();
    if (!raw) row.account_manager = null;
    else {
      const owners = await deps.activeOwners();
      if (!owners.has(raw)) throw httpError(400, "account_manager must be an active territory owner");
      row.account_manager = raw;
    }
  }
  return deps.inGroup(actor, async () => {
    const saved = await deps.insert(row);
    const afterCapture = changeCaptureRow(saved);
    await deps.record({
      table: "accounts",
      pk: Number(saved.id),
      before: {},
      after: afterCapture,
      action: "create_account",
      entity_type: "account",
      entity_id: Number(saved.id),
      actor,
    });
    return saved;
  });
}
